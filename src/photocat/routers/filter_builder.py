"""Unified filter builder for reducing duplication in query building.

Consolidates repeated patterns of building filters in both materialized and
subquery forms, reducing code duplication from ~100 functions to ~25.
"""

from typing import Set, Optional
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql.selectable import Selectable

from photocat.metadata import ImageMetadata, KeywordModel, MachineTag
from photocat.tenant import Tenant


class FilterBuilder:
    """Builder class for creating filters in both materialized and subquery forms.

    This consolidates the pattern of:
    1. Building a query with specific filters
    2. Returning either a materialized set (for intersection) or a subquery (for composition)

    Example:
        builder = FilterBuilder(db, tenant_id)
        # Materialized form (returns Set[int])
        matching_ids = builder.apply_rating(3, "gte")

        # Subquery form (returns Selectable)
        subq = builder.apply_rating_subquery(3, "gte")
    """

    def __init__(self, db: Session, tenant: Tenant):
        """Initialize filter builder.

        Args:
            db: Database session
            tenant: Current tenant
        """
        self.db = db
        self.tenant = tenant

    def _base_query(self):
        """Get base query filtered by tenant."""
        return self.db.query(ImageMetadata.id).filter(
            ImageMetadata.tenant_id == self.tenant.id
        )

    def _apply_filter_logic(self, query, logic_func):
        """Apply filter logic to query and return both forms.

        Args:
            query: Base SQLAlchemy query
            logic_func: Function that takes query and returns modified query

        Returns:
            Tuple of (materialized_set, subquery)
        """
        filtered_query = logic_func(query)

        # Materialized form
        results = filtered_query.all()
        materialized = {row[0] for row in results}

        # Subquery form
        subquery = filtered_query.subquery()

        return materialized, subquery

    def apply_rating(
        self,
        rating: int,
        operator: str,
        existing_filter: Optional[Set[int]] = None,
        as_subquery: bool = False
    ):
        """Apply rating filter.

        Args:
            rating: Rating value (0-3)
            operator: Comparison operator ("eq", "gte", "gt", "is_null")
            existing_filter: Existing filter set to intersect with (materialized only)
            as_subquery: Return subquery form instead of materialized

        Returns:
            Set[int] or Selectable depending on as_subquery
        """
        def logic(q):
            if operator == "is_null":
                return q.filter(ImageMetadata.rating.is_(None))
            elif operator == "gte":
                return q.filter(ImageMetadata.rating >= rating)
            elif operator == "gt":
                return q.filter(ImageMetadata.rating > rating)
            else:
                return q.filter(ImageMetadata.rating == rating)

        materialized, subquery = self._apply_filter_logic(self._base_query(), logic)

        if as_subquery:
            return subquery

        if existing_filter is None:
            return materialized
        else:
            return existing_filter.intersection(materialized)

    def apply_hide_zero_rating(
        self,
        existing_filter: Optional[Set[int]] = None,
        as_subquery: bool = False
    ):
        """Filter out zero ratings.

        Args:
            existing_filter: Existing filter set to intersect with (materialized only)
            as_subquery: Return subquery form instead of materialized

        Returns:
            Set[int] or Selectable depending on as_subquery
        """
        def logic(q):
            return q.filter(ImageMetadata.rating != 0)

        materialized, subquery = self._apply_filter_logic(self._base_query(), logic)

        if as_subquery:
            return subquery

        if existing_filter is None:
            return materialized
        else:
            return existing_filter.intersection(materialized)

    def apply_reviewed(
        self,
        reviewed: bool,
        existing_filter: Optional[Set[int]] = None,
        as_subquery: bool = False
    ):
        """Filter by review status.

        Args:
            reviewed: True for reviewed, False for unreviewed
            existing_filter: Existing filter set to intersect with (materialized only)
            as_subquery: Return subquery form instead of materialized

        Returns:
            Set[int] or Selectable depending on as_subquery
        """
        def logic(q):
            return q.filter(ImageMetadata.reviewed == reviewed)

        materialized, subquery = self._apply_filter_logic(self._base_query(), logic)

        if as_subquery:
            return subquery

        if existing_filter is None:
            return materialized
        else:
            return existing_filter.intersection(materialized)

    def apply_list(
        self,
        list_id: int,
        existing_filter: Optional[Set[int]] = None,
        as_subquery: bool = False
    ):
        """Filter by list membership.

        Args:
            list_id: List ID to filter by
            existing_filter: Existing filter set to intersect with (materialized only)
            as_subquery: Return subquery form instead of materialized

        Returns:
            Set[int] or Selectable depending on as_subquery
        """
        def logic(q):
            # Join with ListItem to find images in list
            from photocat.models.config import ListItem
            return q.join(
                ListItem,
                ImageMetadata.id == ListItem.image_id
            ).filter(ListItem.list_id == list_id)

        materialized, subquery = self._apply_filter_logic(self._base_query(), logic)

        if as_subquery:
            return subquery

        if existing_filter is None:
            return materialized
        else:
            return existing_filter.intersection(materialized)

    def apply_custom(
        self,
        logic_func,
        existing_filter: Optional[Set[int]] = None,
        as_subquery: bool = False
    ):
        """Apply custom filter logic.

        Args:
            logic_func: Function(query) -> modified_query for custom filter logic
            existing_filter: Existing filter set to intersect with (materialized only)
            as_subquery: Return subquery form instead of materialized

        Returns:
            Set[int] or Selectable depending on as_subquery
        """
        materialized, subquery = self._apply_filter_logic(self._base_query(), logic_func)

        if as_subquery:
            return subquery

        if existing_filter is None:
            return materialized
        else:
            return existing_filter.intersection(materialized)
