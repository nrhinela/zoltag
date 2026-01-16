"""Search indexing and query service."""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session

from photocat.metadata import ImageMetadata, MachineTag, DetectedFace


class SearchQuery:
    """Build and execute image search queries."""
    
    def __init__(self, session: Session, tenant_id: str):
        """Initialize search query."""
        self.session = session
        self.tenant_id = tenant_id
        self._query = session.query(ImageMetadata).filter(
            ImageMetadata.tenant_id == tenant_id
        )
    
    def with_keywords(self, keywords: List[str], tag_type: str = 'siglip') -> "SearchQuery":
        """Filter by keywords (OR condition)."""
        self._query = self._query.join(MachineTag).filter(
            MachineTag.keyword.in_(keywords),
            MachineTag.tag_type == tag_type
        )
        return self
    
    def with_person(self, person_name: str) -> "SearchQuery":
        """Filter by detected person."""
        self._query = self._query.join(DetectedFace).filter(
            DetectedFace.person_name == person_name
        )
        return self
    
    def with_date_range(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        use_capture: bool = True
    ) -> "SearchQuery":
        """Filter by date range."""
        date_field = ImageMetadata.capture_timestamp if use_capture else ImageMetadata.modified_time
        
        if start_date:
            self._query = self._query.filter(date_field >= start_date)
        if end_date:
            self._query = self._query.filter(date_field <= end_date)
        
        return self
    
    def with_location(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 10.0
    ) -> "SearchQuery":
        """Filter by GPS location with radius."""
        # Simplified distance calculation (Haversine formula would be more accurate)
        lat_range = radius_km / 111.0  # Approximate km per degree
        lon_range = radius_km / (111.0 * abs(func.cos(func.radians(latitude))))
        
        self._query = self._query.filter(
            and_(
                ImageMetadata.gps_latitude.between(
                    latitude - lat_range,
                    latitude + lat_range
                ),
                ImageMetadata.gps_longitude.between(
                    longitude - lon_range,
                    longitude + lon_range
                )
            )
        )
        return self
    
    def with_camera(self, make: Optional[str] = None, model: Optional[str] = None) -> "SearchQuery":
        """Filter by camera make/model."""
        if make:
            self._query = self._query.filter(
                ImageMetadata.camera_make.ilike(f"%{make}%")
            )
        if model:
            self._query = self._query.filter(
                ImageMetadata.camera_model.ilike(f"%{model}%")
            )
        return self
    
    def with_filename(self, pattern: str) -> "SearchQuery":
        """Filter by filename pattern."""
        self._query = self._query.filter(
            ImageMetadata.filename.ilike(f"%{pattern}%")
        )
        return self
    
    def with_similar_hash(self, perceptual_hash: str, max_distance: int = 5) -> "SearchQuery":
        """Find images with similar perceptual hash (for duplicates)."""
        # Note: This is a simple implementation; consider using specialized indexes
        self._query = self._query.filter(
            ImageMetadata.perceptual_hash.isnot(None)
        )
        return self
    
    def order_by_date(self, ascending: bool = False) -> "SearchQuery":
        """Order results by capture date."""
        if ascending:
            self._query = self._query.order_by(ImageMetadata.capture_timestamp.asc())
        else:
            self._query = self._query.order_by(ImageMetadata.capture_timestamp.desc())
        return self
    
    def limit(self, count: int) -> "SearchQuery":
        """Limit number of results."""
        self._query = self._query.limit(count)
        return self
    
    def offset(self, count: int) -> "SearchQuery":
        """Skip number of results."""
        self._query = self._query.offset(count)
        return self
    
    def execute(self) -> List[ImageMetadata]:
        """Execute the query and return results."""
        return self._query.all()
    
    def count(self) -> int:
        """Count matching results without fetching."""
        return self._query.count()


class SimilaritySearch:
    """Search for visually similar images using embeddings."""
    
    def __init__(self, session: Session, tenant_id: str):
        """Initialize similarity search."""
        self.session = session
        self.tenant_id = tenant_id
    
    def find_similar(
        self,
        embedding: List[float],
        top_k: int = 10,
        threshold: float = 0.8
    ) -> List[ImageMetadata]:
        """Find similar images by embedding cosine similarity.
        
        Note: This is a simple implementation. For production, consider:
        - pgvector extension for PostgreSQL
        - Dedicated vector database (Pinecone, Milvus, etc.)
        - FAISS for local indexing
        """
        # TODO: Implement efficient similarity search with vector index
        # This would require pgvector or external vector database
        raise NotImplementedError("Vector similarity search requires pgvector or external service")
