"""Query builder for list_images endpoint.

This module encapsulates common query construction patterns used across
the 3 code paths in list_images (category filters, keyword filters, no filters).

Provides a unified interface for:
- Applying subquery filters
- Building order clauses
- ML score ordering
- Pagination
- Total count calculation
"""

from typing import Optional, List, Union, Tuple
from sqlalchemy import func, select
from sqlalchemy.orm import Session, Query
from sqlalchemy.sql import Selectable

from photocat.tenant import Tenant
from photocat.metadata import ImageMetadata, MachineTag, KeywordModel
from photocat.dependencies import get_tenant_setting


class QueryBuilder:
    """Encapsulates common query construction patterns for list_images endpoint.

    Provides methods for:
    - Applying subquery filters to queries
    - Building standardized order clauses
    - ML score ordering with outer join
    - Pagination (SQL-based and Python list-based)
    - Total count calculation (query and list-based)
    """

    def __init__(
        self,
        db: Session,
        tenant: Tenant,
        date_order: str = "desc",
        order_by: Optional[str] = None
    ):
        """Initialize query builder with session and ordering preferences.

        Args:
            db: SQLAlchemy database session
            tenant: Current tenant
            date_order: Sort order for dates ("asc" or "desc"), defaults to "desc"
            order_by: Ordering strategy ("photo_creation", "image_id", "processed", "ml_score", "rating"), defaults to None
        """
        self.db = db
        self.tenant = tenant

        # Validate and normalize date_order
        self.date_order = (date_order or "desc").lower()
        if self.date_order not in ("asc", "desc"):
            self.date_order = "desc"

        # Validate and normalize order_by
        self.order_by = (order_by or "").lower() if order_by else None
        if self.order_by and self.order_by not in ("photo_creation", "image_id", "processed", "ml_score", "rating"):
            self.order_by = None

    def apply_subqueries(
        self,
        query: Query,
        subqueries_list: List[Selectable],
        exclude_subqueries_list: Optional[List[Selectable]] = None
    ) -> Query:
        """Apply list of subquery filters to a SQLAlchemy query.

        This consolidates the filter application pattern used in 3 different places
        in list_images. Each subquery filters the image IDs, and all are combined
        with AND logic (intersection).

        Args:
            query: SQLAlchemy query to apply filters to
            subqueries_list: List of subquery Selectable objects

        Returns:
            Modified query with all subqueries applied as filters
        """
        for subquery in subqueries_list:
            query = query.filter(ImageMetadata.id.in_(select(subquery.c.id)))
        for subquery in exclude_subqueries_list or []:
            query = query.filter(~ImageMetadata.id.in_(select(subquery.c.id)))
        return query

    def build_order_clauses(self, ml_keyword_id: Optional[int] = None) -> Tuple:
        """Build order by clauses based on date_order and order_by settings.

        This consolidates the order clause construction logic that was duplicated
        4 times in list_images:
        - Lines 117-120 (initial setup)
        - Line 261 (keyword OR path)
        - Line 333 (keyword AND path)
        - Line 367 (no filters path)

        Args:
            ml_keyword_id: Optional keyword ID for ML score ordering (unused in this method)

        Returns:
            Tuple of SQLAlchemy order clauses to apply to query
        """
        if self.order_by == "processed":
            order_by_date = func.coalesce(
                ImageMetadata.last_processed,
                ImageMetadata.created_at
            )
        else:
            # Build date clause (coalesce capture_timestamp or modified_time)
            order_by_date = func.coalesce(
                ImageMetadata.capture_timestamp,
                ImageMetadata.modified_time
            )

        # Apply date sort direction
        if self.date_order == "desc":
            order_by_date = order_by_date.desc()
        else:
            order_by_date = order_by_date.asc()

        # Build ID clause
        id_order = (
            ImageMetadata.id.desc()
            if self.date_order == "desc"
            else ImageMetadata.id.asc()
        )

        # Return tuple of order clauses based on order_by strategy
        if self.order_by == "image_id":
            return (id_order,)
        if self.order_by == "rating":
            rating_order = ImageMetadata.rating.desc() if self.date_order == "desc" else ImageMetadata.rating.asc()
            rating_order = rating_order.nullslast()
            return (rating_order, order_by_date, id_order)
        # Default: date then id
        return (order_by_date, id_order)

    def apply_ml_score_ordering(
        self,
        query: Query,
        ml_keyword_id: int,
        ml_tag_type: Optional[str] = None,
        require_match: bool = False,
    ) -> Tuple[Query, Selectable]:
        """Add ML score ordering to a query via join with scoring subquery.

        This consolidates the ML score query construction (lines 373-402) that
        was only in the "no filters" path. Adds an outer join with a subquery
        that computes max confidence scores for the specified keyword.

        Args:
            query: SQLAlchemy query to add ML scoring to
            ml_keyword_id: ID of keyword to score on
            ml_tag_type: Optional machine tag type (defaults to tenant's active type)
            require_match: If True, only include rows with a matching ML score

        Returns:
            Tuple of (modified_query, ml_scores_subquery) where:
            - modified_query: Query with ML score join applied
            - ml_scores_subquery: The subquery for use in order clauses
        """
        # Get active tag type if not specified
        if ml_tag_type is None:
            ml_tag_type = get_tenant_setting(
                self.db,
                self.tenant.id,
                'active_machine_tag_type',
                default='siglip'
            )

        # Check for trained model if using trained tag type
        model_name = None
        if ml_tag_type.strip().lower() == 'trained':
            model_row = self.db.query(KeywordModel.model_name).filter(
                KeywordModel.tenant_id == self.tenant.id
            ).order_by(
                func.coalesce(KeywordModel.updated_at, KeywordModel.created_at).desc()
            ).first()
            if model_row:
                model_name = model_row[0]

        # Build ML scores subquery (max confidence for this keyword) keyed by asset_id.
        ml_scores = self.db.query(
            MachineTag.asset_id.label('asset_id'),
            func.max(MachineTag.confidence).label('ml_score')
        ).filter(
            MachineTag.keyword_id == ml_keyword_id,
            MachineTag.tenant_id == self.tenant.id,
            MachineTag.tag_type == ml_tag_type,
            MachineTag.asset_id.is_not(None),
            *([MachineTag.model_name == model_name] if model_name else [])
        ).group_by(
            MachineTag.asset_id
        ).subquery()

        # Join with ML scores. Use inner join when rows must have an ML match.
        if require_match:
            query = query.join(ml_scores, ml_scores.c.asset_id == ImageMetadata.asset_id)
        else:
            query = query.outerjoin(ml_scores, ml_scores.c.asset_id == ImageMetadata.asset_id)

        return query, ml_scores

    def apply_pagination(self, query: Query, offset: int, limit: Optional[int]) -> List:
        """Apply SQL-based pagination to a SQLAlchemy query and execute.

        Handles the limit/offset pattern used in Path 2 (keyword filters)
        and Path 3 (no filters) in list_images.

        Args:
            query: SQLAlchemy query to paginate
            offset: Number of results to skip
            limit: Maximum number of results to return (None means no limit)

        Returns:
            List of query results (executed from database)
        """
        if limit:
            return query.limit(limit).offset(offset).all()
        else:
            return query.offset(offset).all()

    def paginate_id_list(
        self,
        image_ids: List[int],
        offset: int,
        limit: Optional[int]
    ) -> List[int]:
        """Apply Python list-based pagination to a materialized ID list.

        Handles the Python list slicing pattern used in Path 1 (category filters)
        in list_images.

        Args:
            image_ids: List of image IDs to paginate
            offset: Number of results to skip
            limit: Maximum number of results to return (None means no limit)

        Returns:
            Sliced list of image IDs
        """
        if limit:
            return image_ids[offset:offset + limit]
        else:
            return image_ids[offset:]

    def get_total_count(self, query_or_ids: Union[Query, List]) -> int:
        """Get total count from either a SQLAlchemy query or a list of IDs.

        Smart count that handles both lazy queries and materialized ID lists,
        consolidating the count logic duplicated across all 3 code paths.

        Args:
            query_or_ids: Either a SQLAlchemy Query object or a List of IDs

        Returns:
            Integer count of items
        """
        if isinstance(query_or_ids, list):
            return len(query_or_ids)
        else:
            # Count against a narrow ID-only subquery to avoid expensive wide-row count plans.
            id_subquery = (
                query_or_ids
                .with_entities(ImageMetadata.id)
                .order_by(None)
                .distinct()
                .subquery()
            )
            return int(self.db.query(func.count()).select_from(id_subquery).scalar() or 0)

    def apply_filters_to_id_set(
        self,
        image_ids: List[int],
        subqueries_list: List[Selectable],
        exclude_subqueries_list: Optional[List[Selectable]] = None
    ) -> List[int]:
        """Filter a materialized ID set with subqueries (Path 1 special case).

        This consolidates the subquery filtering for materialized ID lists,
        which is only used in Path 1 (category filters) in list_images.

        Creates a temporary query that filters the given ID set with all
        subqueries, then returns the filtered IDs.

        Args:
            image_ids: List of image IDs to filter
            subqueries_list: List of subquery Selectable objects

        Returns:
            Filtered list of image IDs
        """
        # Build query starting with given ID set
        filtered_query = self.db.query(ImageMetadata.id).filter(
            ImageMetadata.id.in_(image_ids)
        )

        # Apply all subqueries
        filtered_query = self.apply_subqueries(filtered_query, subqueries_list, exclude_subqueries_list)

        # Execute and extract IDs
        return [row[0] for row in filtered_query.all()]
