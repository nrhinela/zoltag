"""FastAPI application entry point."""

from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse, RedirectResponse
from typing import Optional, List
from pathlib import Path
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from google.cloud import storage
from google.cloud import secretmanager
import io
import json

from photocat.tenant import Tenant, TenantContext
from photocat.settings import settings
from photocat.metadata import ImageMetadata, ImageTag, DropboxCursor, Permatag, Tenant as TenantModel, Person
from photocat.image import ImageProcessor
from photocat.config import TenantConfig
from photocat.config.db_config import ConfigManager
from photocat.tagging import get_tagger
from photocat.dropbox import DropboxClient, DropboxWebhookValidator

app = FastAPI(
    title="PhotoCat",
    description="Multi-tenant image organization and search utility",
    version="0.1.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Database setup
engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)


def get_secret(secret_id: str) -> str:
    """Get secret from Google Cloud Secret Manager."""
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{settings.gcp_project_id}/secrets/{secret_id}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode('UTF-8')


def store_secret(secret_id: str, value: str) -> None:
    """Store secret in Google Cloud Secret Manager."""
    client = secretmanager.SecretManagerServiceClient()
    parent = f"projects/{settings.gcp_project_id}"
    
    try:
        # Try to create secret
        secret = client.create_secret(
            request={
                "parent": parent,
                "secret_id": secret_id,
                "secret": {"replication": {"automatic": {}}},
            }
        )
    except Exception:
        # Secret already exists
        pass
    
    # Add version
    parent_secret = f"projects/{settings.gcp_project_id}/secrets/{secret_id}"
    client.add_secret_version(
        request={
            "parent": parent_secret,
            "payload": {"data": value.encode('UTF-8')},
        }
    )


def get_db():
    """Get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_tenant(x_tenant_id: Optional[str] = Header(None)) -> Tenant:
    """Extract and validate tenant from request headers."""
    if not x_tenant_id:
        raise HTTPException(status_code=400, detail="X-Tenant-ID header required")
    
    tenant = Tenant(id=x_tenant_id, name=f"Tenant {x_tenant_id}")
    TenantContext.set(tenant)
    
    return tenant


@app.get("/")
async def root():
    """Serve the web interface."""
    html_file = static_dir / "index.html"
    if html_file.exists():
        return HTMLResponse(content=html_file.read_text())
    return RedirectResponse(url="/health")


@app.get("/admin")
async def admin():
    """Serve the admin interface."""
    html_file = static_dir / "admin.html"
    if html_file.exists():
        return HTMLResponse(content=html_file.read_text())
    return RedirectResponse(url="/health")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Include configuration router (after dependencies are defined)
from photocat.api_config import router as config_router
app.include_router(config_router)


@app.get("/api/v1/images")
async def list_images(
    tenant: Tenant = Depends(get_tenant),
    limit: int = None,
    offset: int = 0,
    keywords: Optional[str] = None,  # Comma-separated keywords (deprecated)
    operator: str = "OR",  # "AND" or "OR" (deprecated)
    category_filters: Optional[str] = None,  # JSON string with per-category filters
    db: Session = Depends(get_db)
):
    """List images for tenant with optional faceted search by keywords."""
    from sqlalchemy import func, distinct, and_
    from sqlalchemy.orm import aliased
    import json

    # Handle per-category filters if provided
    if category_filters:
        try:
            filters = json.loads(category_filters)
            # filters structure: {category: {keywords: [...], operator: "OR"|"AND"}}

            # Start with base query
            base_query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)

            # For each category, apply its filter
            # Categories are combined with OR (image matches any category's criteria)
            category_image_ids = []

            for category, filter_data in filters.items():
                category_keywords = filter_data.get('keywords', [])
                category_operator = filter_data.get('operator', 'OR').upper()

                if not category_keywords:
                    continue

                # Get all images and their tags/permatags to compute "current tags"
                # This is necessary because we need to exclude machine tags that are negatively permatagged
                all_images = db.query(ImageMetadata.id).filter_by(tenant_id=tenant.id).all()
                all_image_ids = [img[0] for img in all_images]

                # Get all tags for these images
                all_tags = db.query(ImageTag).filter(
                    ImageTag.tenant_id == tenant.id,
                    ImageTag.image_id.in_(all_image_ids)
                ).all()

                # Get all permatags for these images
                all_permatags = db.query(Permatag).filter(
                    Permatag.tenant_id == tenant.id,
                    Permatag.image_id.in_(all_image_ids)
                ).all()

                # Build permatag map by image_id and keyword
                permatag_map = {}
                for p in all_permatags:
                    if p.image_id not in permatag_map:
                        permatag_map[p.image_id] = {}
                    permatag_map[p.image_id][p.keyword] = p.signum

                # Compute current tags for each image
                current_tags_by_image = {}
                for tag in all_tags:
                    # Include machine tag only if not negatively permatagged
                    if tag.image_id in permatag_map and permatag_map[tag.image_id].get(tag.keyword) == -1:
                        continue  # Skip negatively permatagged machine tags
                    if tag.image_id not in current_tags_by_image:
                        current_tags_by_image[tag.image_id] = []
                    current_tags_by_image[tag.image_id].append(tag.keyword)

                # Add positive permatags
                for p in all_permatags:
                    if p.signum == 1:
                        # Only add if not already in machine tags
                        if p.image_id not in current_tags_by_image or p.keyword not in current_tags_by_image[p.image_id]:
                            if p.image_id not in current_tags_by_image:
                                current_tags_by_image[p.image_id] = []
                            current_tags_by_image[p.image_id].append(p.keyword)

                # Now filter based on current tags
                if category_operator == "OR":
                    # Image must have ANY of the keywords in this category (in current tags)
                    for image_id, current_keywords in current_tags_by_image.items():
                        if any(kw in category_keywords for kw in current_keywords):
                            category_image_ids.append(image_id)

                elif category_operator == "AND":
                    # Image must have ALL keywords in this category (in current tags)
                    for image_id, current_keywords in current_tags_by_image.items():
                        if all(kw in current_keywords for kw in category_keywords):
                            category_image_ids.append(image_id)

            if category_image_ids:
                # Remove duplicates
                unique_image_ids = list(set(category_image_ids))

                # Get all keywords for relevance counting
                all_keywords = []
                for filter_data in filters.values():
                    all_keywords.extend(filter_data.get('keywords', []))

                # Query with relevance ordering
                query = db.query(
                    ImageMetadata,
                    func.count(ImageTag.id).label('match_count')
                ).join(
                    ImageTag,
                    and_(
                        ImageTag.image_id == ImageMetadata.id,
                        ImageTag.keyword.in_(all_keywords),
                        ImageTag.tenant_id == tenant.id
                    )
                ).filter(
                    ImageMetadata.tenant_id == tenant.id,
                    ImageMetadata.id.in_(unique_image_ids)
                ).group_by(
                    ImageMetadata.id
                ).order_by(
                    func.count(ImageTag.id).desc(),
                    ImageMetadata.id.desc()
                )

                total = len(unique_image_ids)
                results = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
                images = [img for img, _ in results]
            else:
                # No matches
                total = 0
                images = []

        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"Error parsing category_filters: {e}")
            # Fall back to returning all images
            query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
            total = query.count()
            images = query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else query.order_by(ImageMetadata.id.desc()).offset(offset).all()

    # Apply keyword filtering if provided (legacy support)
    elif keywords:
        keyword_list = [k.strip() for k in keywords.split(',') if k.strip()]

        if keyword_list and operator.upper() == "OR":
            # OR: Image must have ANY of the selected keywords
            # Use subquery to get image IDs that match keywords
            matching_image_ids = db.query(ImageTag.image_id).filter(
                ImageTag.keyword.in_(keyword_list),
                ImageTag.tenant_id == tenant.id
            ).distinct().subquery()

            # Main query with relevance ordering
            query = db.query(
                ImageMetadata,
                func.count(ImageTag.id).label('match_count')
            ).join(
                ImageTag,
                and_(
                    ImageTag.image_id == ImageMetadata.id,
                    ImageTag.keyword.in_(keyword_list),
                    ImageTag.tenant_id == tenant.id
                )
            ).filter(
                ImageMetadata.tenant_id == tenant.id,
                ImageMetadata.id.in_(matching_image_ids)
            ).group_by(
                ImageMetadata.id
            ).order_by(
                func.count(ImageTag.id).desc(),
                ImageMetadata.id.desc()
            )

            total = db.query(ImageMetadata).filter(
                ImageMetadata.tenant_id == tenant.id,
                ImageMetadata.id.in_(matching_image_ids)
            ).count()

            results = query.limit(limit).offset(offset).all() if limit else query.offset(offset).all()
            images = [img for img, _ in results]

        elif keyword_list and operator.upper() == "AND":
            # AND: Image must have ALL selected keywords
            # Start with images that have tenant_id
            base_query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)

            # For each keyword, filter images that have that keyword
            for keyword in keyword_list:
                subquery = db.query(ImageTag.image_id).filter(
                    ImageTag.keyword == keyword,
                    ImageTag.tenant_id == tenant.id
                ).subquery()

                base_query = base_query.filter(ImageMetadata.id.in_(subquery))

            total = base_query.count()
            images = base_query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else base_query.order_by(ImageMetadata.id.desc()).offset(offset).all()
        else:
            # No valid keywords, return all
            query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
            total = query.count()
            images = query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else query.order_by(ImageMetadata.id.desc()).offset(offset).all()
    else:
        # No keywords filter, return all
        query = db.query(ImageMetadata).filter_by(tenant_id=tenant.id)
        total = query.count()
        images = query.order_by(ImageMetadata.id.desc()).limit(limit).offset(offset).all() if limit else query.order_by(ImageMetadata.id.desc()).offset(offset).all()
    
    # Get tags for all images
    image_ids = [img.id for img in images]
    tags = db.query(ImageTag).filter(
        ImageTag.image_id.in_(image_ids),
        ImageTag.tenant_id == tenant.id
    ).all()

    # Get permatags for all images
    permatags = db.query(Permatag).filter(
        Permatag.image_id.in_(image_ids),
        Permatag.tenant_id == tenant.id
    ).all()

    # Group tags by image_id
    tags_by_image = {}
    for tag in tags:
        if tag.image_id not in tags_by_image:
            tags_by_image[tag.image_id] = []
        tags_by_image[tag.image_id].append({
            "keyword": tag.keyword,
            "category": tag.category,
            "confidence": round(tag.confidence, 2)
        })

    # Group permatags by image_id
    permatags_by_image = {}
    for permatag in permatags:
        if permatag.image_id not in permatags_by_image:
            permatags_by_image[permatag.image_id] = []
        permatags_by_image[permatag.image_id].append({
            "keyword": permatag.keyword,
            "category": permatag.category,
            "signum": permatag.signum
        })
    
    return {
        "tenant_id": tenant.id,
        "images": [
            {
                "id": img.id,
                "filename": img.filename,
                "width": img.width,
                "height": img.height,
                "format": img.format,
                "file_size": img.file_size,
                "dropbox_path": img.dropbox_path,
                "camera_make": img.camera_make,
                "camera_model": img.camera_model,
                "lens_model": img.lens_model,
                "iso": img.iso,
                "aperture": img.aperture,
                "capture_timestamp": img.capture_timestamp.isoformat() if img.capture_timestamp else None,
                "modified_time": img.modified_time.isoformat() if img.modified_time else None,
                "thumbnail_path": img.thumbnail_path,
                "thumbnail_url": f"https://storage.googleapis.com/{settings.thumbnail_bucket}/{img.thumbnail_path}" if img.thumbnail_path else None,
                "tags_applied": img.tags_applied,
                "faces_detected": img.faces_detected,
                "tags": sorted(tags_by_image.get(img.id, []), key=lambda x: x['confidence'], reverse=True),
                "permatags": permatags_by_image.get(img.id, [])
            }
            for img in images
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@app.get("/api/v1/keywords")
async def get_available_keywords(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all available keywords from config for faceted search with counts."""
    from sqlalchemy import func

    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Get counts for each keyword
    keyword_counts = db.query(
        ImageTag.keyword,
        func.count(func.distinct(ImageTag.image_id)).label('count')
    ).filter(
        ImageTag.tenant_id == tenant.id
    ).group_by(
        ImageTag.keyword
    ).all()

    # Create a dictionary of keyword -> count
    counts_dict = {kw: count for kw, count in keyword_counts}

    # Group by category with counts
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        keyword = kw['keyword']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append({
            'keyword': keyword,
            'count': counts_dict.get(keyword, 0)
        })

    return {
        "tenant_id": tenant.id,
        "keywords_by_category": by_category,
        "all_keywords": [kw['keyword'] for kw in all_keywords]
    }


@app.get("/api/v1/images/{image_id}")
async def get_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get image details with signed thumbnail URL."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Get tags
    tags = db.query(ImageTag).filter(
        ImageTag.image_id == image_id,
        ImageTag.tenant_id == tenant.id
    ).all()
    
    # Get permatags
    permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).all()
    
    return {
        "id": image.id,
        "filename": image.filename,
        "width": image.width,
        "height": image.height,
        "format": image.format,
        "file_size": image.file_size,
        "dropbox_path": image.dropbox_path,
        "camera_make": image.camera_make,
        "camera_model": image.camera_model,
        "perceptual_hash": image.perceptual_hash,
        "thumbnail_path": image.thumbnail_path,
        "tags": [{"keyword": t.keyword, "category": t.category, "confidence": round(t.confidence, 2), "created_at": t.created_at.isoformat() if t.created_at else None} for t in tags],
        "permatags": [{"id": p.id, "keyword": p.keyword, "category": p.category, "signum": p.signum, "created_at": p.created_at.isoformat() if p.created_at else None} for p in permatags],
        "exif_data": image.exif_data,
    }


@app.get("/api/v1/images/{image_id}/thumbnail")
async def get_thumbnail(
    image_id: int,
    db: Session = Depends(get_db)
):
    """Get image thumbnail from Cloud Storage with aggressive caching."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id
    ).first()
    
    if not image or not image.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    
    try:
        storage_client = storage.Client(project=settings.gcp_project_id)
        bucket = storage_client.bucket(settings.thumbnail_bucket)
        blob = bucket.blob(image.thumbnail_path)
        
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")
        
        thumbnail_data = blob.download_as_bytes()
        
        return StreamingResponse(
            iter([thumbnail_data]),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=3600",  # Cache for 1 hour
                "ETag": f'"{image.id}-{image.modified_time.timestamp() if image.modified_time else 0}"'
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching thumbnail: {str(e)}")


@app.get("/api/v1/images/{image_id}/permatags")
async def get_permatags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Get all permatags for an image."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    permatags = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).all()
    
    return {
        "image_id": image_id,
        "permatags": [
            {
                "id": p.id,
                "keyword": p.keyword,
                "category": p.category,
                "signum": p.signum,
                "created_at": p.created_at.isoformat(),
                "created_by": p.created_by
            }
            for p in permatags
        ]
    }


@app.post("/api/v1/images/{image_id}/permatags")
async def add_permatag(
    image_id: int,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Add or update a permatag for an image."""
    body = await request.json()
    keyword = body.get("keyword")
    category = body.get("category")
    signum = body.get("signum", 1)
    
    if not keyword:
        raise HTTPException(status_code=400, detail="keyword is required")
    
    if signum not in [-1, 1]:
        raise HTTPException(status_code=400, detail="signum must be -1 or 1")
    
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Check if permatag already exists (update or insert)
    existing = db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword == keyword
    ).first()
    
    if existing:
        # Update existing permatag
        existing.category = category
        existing.signum = signum
        existing.created_at = datetime.utcnow()
        permatag = existing
    else:
        # Create new permatag
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=keyword,
            category=category,
            signum=signum,
            created_by=None  # Could be set from auth header if available
        )
        db.add(permatag)
    
    db.commit()
    db.refresh(permatag)
    
    return {
        "id": permatag.id,
        "keyword": permatag.keyword,
        "category": permatag.category,
        "signum": permatag.signum,
        "created_at": permatag.created_at.isoformat()
    }


@app.delete("/api/v1/images/{image_id}/permatags/{permatag_id}")
async def delete_permatag(
    image_id: int,
    permatag_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Delete a permatag."""
    permatag = db.query(Permatag).filter(
        Permatag.id == permatag_id,
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id
    ).first()
    
    if not permatag:
        raise HTTPException(status_code=404, detail="Permatag not found")
    
    db.delete(permatag)
    db.commit()
    
    return {"success": True}


@app.post("/api/v1/images/{image_id}/permatags/accept-all")
async def accept_all_tags(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Accept all current tags as positive permatags and create negative permatags for all other keywords."""
    image = db.query(ImageMetadata).filter_by(
        id=image_id,
        tenant_id=tenant.id
    ).first()
    
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Get current machine tags
    current_tags = db.query(ImageTag).filter(
        ImageTag.image_id == image_id,
        ImageTag.tenant_id == tenant.id
    ).all()
    
    # Get all keywords from config
    config_manager = ConfigManager(db, tenant.id)
    all_keywords = config_manager.get_all_keywords()
    
    # Build set of current tag keywords
    current_keywords = {tag.keyword for tag in current_tags}
    all_keyword_names = {kw['keyword'] for kw in all_keywords}
    
    # Delete existing permatags ONLY for keywords in the controlled vocabulary
    # This preserves manually added permatags for keywords not in the vocabulary
    db.query(Permatag).filter(
        Permatag.image_id == image_id,
        Permatag.tenant_id == tenant.id,
        Permatag.keyword.in_(all_keyword_names)
    ).delete(synchronize_session=False)
    
    # Create positive permatags for all current tags
    for tag in current_tags:
        permatag = Permatag(
            image_id=image_id,
            tenant_id=tenant.id,
            keyword=tag.keyword,
            category=tag.category,
            signum=1
        )
        db.add(permatag)
    
    # Create negative permatags for all keywords NOT in current tags
    for kw_info in all_keywords:
        keyword = kw_info['keyword']
        if keyword not in current_keywords:
            permatag = Permatag(
                image_id=image_id,
                tenant_id=tenant.id,
                keyword=keyword,
                category=kw_info['category'],
                signum=-1
            )
            db.add(permatag)
    
    db.commit()
    
    # Return counts
    positive_count = len(current_keywords)
    negative_count = len(all_keyword_names - current_keywords)
    
    return {
        "success": True,
        "positive_permatags": positive_count,
        "negative_permatags": negative_count
    }


@app.post("/api/v1/images/upload")
async def upload_images(
    files: List[UploadFile] = File(...),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Upload and process images in real-time."""
    processor = ImageProcessor(thumbnail_size=(settings.thumbnail_size, settings.thumbnail_size))
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)
    
    results = []
    
    for file in files:
        try:
            # Check if file is an image
            if not processor.is_supported(file.filename):
                results.append({
                    "filename": file.filename,
                    "status": "skipped",
                    "message": "Unsupported file format"
                })
                continue
            
            # Read file data
            image_data = await file.read()
            
            # Extract features
            features = processor.extract_features(image_data)
            
            # Check for duplicate based on perceptual hash
            existing = db.query(ImageMetadata).filter(
                ImageMetadata.tenant_id == tenant.id,
                ImageMetadata.perceptual_hash == features['perceptual_hash']
            ).first()
            
            if existing:
                # Delete old thumbnail from Cloud Storage
                try:
                    if existing.thumbnail_path:
                        blob = thumbnail_bucket.blob(existing.thumbnail_path)
                        if blob.exists():
                            blob.delete()
                except Exception as e:
                    print(f"Error deleting old thumbnail: {e}")
                
                # Delete existing tags
                db.query(ImageTag).filter(ImageTag.image_id == existing.id).delete()
                
                # Delete existing metadata
                db.delete(existing)
                db.commit()
            
            # Upload thumbnail to Cloud Storage with cache headers
            thumbnail_path = f"{tenant.id}/thumbnails/{Path(file.filename).stem}_thumb.jpg"
            blob = thumbnail_bucket.blob(thumbnail_path)
            blob.cache_control = "public, max-age=31536000, immutable"  # 1 year cache
            blob.upload_from_string(features['thumbnail'], content_type='image/jpeg')
            
            # Create metadata record
            exif = features['exif']
            
            metadata = ImageMetadata(
                tenant_id=tenant.id,
                dropbox_path=f"/uploads/{file.filename}",
                dropbox_id=f"upload_{Path(file.filename).stem}",
                filename=file.filename,
                file_size=len(image_data),
                content_hash=None,
                width=features['width'],
                height=features['height'],
                format=features['format'],
                perceptual_hash=features['perceptual_hash'],
                color_histogram=features['color_histogram'],
                exif_data=exif,
                camera_make=exif.get('Make'),
                camera_model=exif.get('Model'),
                lens_model=exif.get('LensModel'),
                thumbnail_path=thumbnail_path,
                embedding_generated=False,
                faces_detected=False,
                tags_applied=False,
            )
            
            db.add(metadata)
            db.commit()
            db.refresh(metadata)
            
            # Apply automatic tags from keywords using CLIP
            try:
                config_mgr = ConfigManager(db, tenant.id)
                all_keywords = config_mgr.get_all_keywords()
                
                # Group keywords by category to avoid softmax suppression
                by_category = {}
                for kw in all_keywords:
                    cat = kw['category']
                    if cat not in by_category:
                        by_category[cat] = []
                    by_category[cat].append(kw)
                
                # Run CLIP separately for each category
                all_tags = []
                tagger = get_tagger(model_type=settings.tagging_model)
                
                for category, keywords in by_category.items():
                    category_tags = tagger.tag_image(
                        image_data,
                        keywords,
                        threshold=0.15
                    )
                    all_tags.extend(category_tags)
                
                tags_with_confidence = all_tags
                
                # Create tags for matching keywords
                keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
                
                for keyword, confidence in tags_with_confidence:
                    tag = ImageTag(
                        image_id=metadata.id,
                        tenant_id=tenant.id,
                        keyword=keyword,
                        category=keyword_to_category[keyword],
                        confidence=confidence,
                        manual=False
                    )
                    db.add(tag)
                
                if tags_with_confidence:
                    metadata.tags_applied = True
                    
                db.commit()
            except Exception as e:
                print(f"Tagging error: {e}")
                import traceback
                traceback.print_exc()
            
            results.append({
                "filename": file.filename,
                "status": "success",
                "image_id": metadata.id,
                "thumbnail_url": f"/api/v1/images/{metadata.id}/thumbnail"
            })
            
        except Exception as e:
            results.append({
                "filename": file.filename,
                "status": "error",
                "message": str(e)
            })
    
    return {
        "tenant_id": tenant.id,
        "uploaded": len([r for r in results if r["status"] == "success"]),
        "failed": len([r for r in results if r["status"] == "error"]),
        "results": results
    }


@app.get("/api/v1/images/{image_id}/analyze")
async def analyze_image_keywords(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """
    Analyze an image and return ALL keyword scores (not just above threshold).
    Useful for debugging and tuning keyword configurations.
    """
    from photocat.config import TenantConfig
    from photocat.tagging import get_tagger
    from google.cloud import storage

    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Load config
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Group keywords by category
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(kw)

    # Setup tagger and storage
    tagger = get_tagger(model_type=settings.tagging_model)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)

    try:
        # Download thumbnail
        blob = thumbnail_bucket.blob(image.thumbnail_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        image_data = blob.download_as_bytes()

        # Run model with threshold=0 to get ALL scores
        all_scores_by_category = {}
        for category, keywords in by_category.items():
            category_scores = tagger.tag_image(
                image_data,
                keywords,
                threshold=0.0  # Get all scores
            )
            all_scores_by_category[category] = [
                {"keyword": kw, "confidence": round(conf, 3)}
                for kw, conf in category_scores
            ]

        return {
            "tenant_id": tenant.id,
            "image_id": image_id,
            "filename": image.filename,
            "model": settings.tagging_model,
            "threshold": 0.15,  # Show current threshold
            "scores_by_category": all_scores_by_category
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error analyzing {image.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/api/v1/images/{image_id}/retag")
async def retag_single_image(
    image_id: int,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Retag a single image with current keywords."""
    from photocat.config import TenantConfig
    from photocat.tagging import get_tagger
    from google.cloud import storage

    # Get the image
    image = db.query(ImageMetadata).filter(
        ImageMetadata.id == image_id,
        ImageMetadata.tenant_id == tenant.id
    ).first()

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Load config
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()

    # Group keywords by category
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(kw)

    # Setup CLIP tagger and storage
    tagger = get_tagger(model_type=settings.tagging_model)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)

    try:
        # Delete existing tags
        db.query(ImageTag).filter(ImageTag.image_id == image.id).delete()

        # Download thumbnail
        blob = thumbnail_bucket.blob(image.thumbnail_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Thumbnail not found in storage")

        image_data = blob.download_as_bytes()

        # Run CLIP separately for each category
        all_tags = []
        for category, keywords in by_category.items():
            category_tags = tagger.tag_image(
                image_data,
                keywords,
                threshold=0.15
            )
            all_tags.extend(category_tags)

        # Create new tags
        keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}

        for keyword, confidence in all_tags:
            tag = ImageTag(
                image_id=image.id,
                tenant_id=tenant.id,
                keyword=keyword,
                category=keyword_to_category[keyword],
                confidence=confidence,
                manual=False
            )
            db.add(tag)

        # Update tags_applied flag
        image.tags_applied = len(all_tags) > 0

        db.commit()

        return {
            "tenant_id": tenant.id,
            "image_id": image_id,
            "filename": image.filename,
            "tags_count": len(all_tags),
            "tags": [{"keyword": kw, "confidence": round(conf, 2)} for kw, conf in all_tags]
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error processing {image.filename}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Retagging failed: {str(e)}")


@app.post("/api/v1/retag")
async def retag_all_images(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db)
):
    """Retag all images with current keywords."""
    from photocat.config import TenantConfig
    from photocat.tagging import get_tagger
    from google.cloud import storage
    
    # Load config
    config_mgr = ConfigManager(db, tenant.id)
    all_keywords = config_mgr.get_all_keywords()
    
    # Group keywords by category
    by_category = {}
    for kw in all_keywords:
        cat = kw['category']
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(kw)
    
    # Get all images
    images = db.query(ImageMetadata).filter(
        ImageMetadata.tenant_id == tenant.id
    ).all()
    
    # Setup CLIP tagger and storage
    tagger = get_tagger(model_type=settings.tagging_model)
    storage_client = storage.Client(project=settings.gcp_project_id)
    thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)
    
    processed = 0
    failed = 0
    
    for image in images:
        try:
            # Delete existing tags
            db.query(ImageTag).filter(ImageTag.image_id == image.id).delete()
            
            # Download thumbnail
            blob = thumbnail_bucket.blob(image.thumbnail_path)
            if not blob.exists():
                failed += 1
                continue
            
            image_data = blob.download_as_bytes()
            
            # Run CLIP separately for each category
            all_tags = []
            for category, keywords in by_category.items():
                category_tags = tagger.tag_image(
                    image_data,
                    keywords,
                    threshold=0.15
                )
                all_tags.extend(category_tags)
            
            # Create new tags
            keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
            
            for keyword, confidence in all_tags:
                tag = ImageTag(
                    image_id=image.id,
                    tenant_id=tenant.id,
                    keyword=keyword,
                    category=keyword_to_category[keyword],
                    confidence=confidence,
                    manual=False
                )
                db.add(tag)
            
            # Update tags_applied flag
            image.tags_applied = len(all_tags) > 0
            
            db.commit()
            processed += 1
            
        except Exception as e:
            print(f"Error processing {image.filename}: {e}")
            db.rollback()
            failed += 1
    
    return {
        "tenant_id": tenant.id,
        "total": len(images),
        "processed": processed,
        "failed": failed
    }


@app.post("/api/v1/sync")
async def trigger_sync(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    model: str = "siglip"  # Query parameter: 'clip' or 'siglip'
):
    """Trigger Dropbox sync for tenant."""
    try:
        # Get tenant's Dropbox credentials
        refresh_token = get_secret(f"dropbox-token-{tenant.id}")
        app_key = tenant.dropbox_app_key
        app_secret = get_secret(f"dropbox-app-secret-{tenant.id}")
        
        # Use Dropbox SDK directly with refresh token
        from dropbox import Dropbox
        dbx = Dropbox(
            oauth2_refresh_token=refresh_token,
            app_key=app_key,
            app_secret=app_secret
        )
        
        # Define folders to sync
        sync_folders = [
            "/Archive - Photo/Events/2025 Events",
            "/Archive - Photo/Events/2024 Events",
            "/Archive - Photo/Events/2023 Events"
        ]
        
        # Only fetch unprocessed files by checking what's already in DB
        from dropbox.files import FileMetadata
        
        # Get already processed dropbox IDs
        processed_ids = set(
            row[0] for row in db.query(ImageMetadata.dropbox_id)
            .filter(ImageMetadata.tenant_id == tenant.id)
            .all()
        )
        
        # Find next unprocessed image (process only first folder that has unprocessed files)
        file_entry = None
        for folder_path in sync_folders:
            try:
                result = dbx.files_list_folder(folder_path, recursive=True)
                entries = list(result.entries)
                
                # Handle pagination
                while result.has_more:
                    result = dbx.files_list_folder_continue(result.cursor)
                    entries.extend(result.entries)
                
                # Filter to images, sort by date, find first unprocessed
                file_entries = [e for e in entries if isinstance(e, FileMetadata)]
                file_entries.sort(key=lambda e: e.server_modified, reverse=True)
                
                for entry in file_entries:
                    if entry.id not in processed_ids:
                        processor = ImageProcessor()
                        if processor.is_supported(entry.name):
                            file_entry = entry
                            break
                
                if file_entry:
                    break  # Found one, stop searching
                    
            except Exception as e:
                print(f"Error listing folder {folder_path}: {e}")
        
        if not file_entry:
            return {
                "tenant_id": tenant.id,
                "status": "sync_complete",
                "processed": 0,
                "has_more": False
            }
        
        changes = {
            "entries": [file_entry],
            "cursor": None,
            "has_more": True  # Assume more until we check all folders
        }
        
        # Setup image processor
        processor = ImageProcessor()
        storage_client = storage.Client(project=settings.gcp_project_id)
        thumbnail_bucket = storage_client.bucket(settings.thumbnail_bucket)
        
        # Load config for tagging
        config_mgr = ConfigManager(db, tenant.id)
        all_keywords = config_mgr.get_all_keywords()
        
        # Group keywords by category
        by_category = {}
        for kw in all_keywords:
            cat = kw['category']
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(kw)
        
        tagger = get_tagger(model_type=model)
        processed = 0
        max_per_sync = 1  # Process one at a time for real-time UI updates
        
        # Process new/changed images (limit to 1 per sync)
        from dropbox.files import FileMetadata
        for entry in changes['entries']:
            if processed >= max_per_sync:
                break
                
            if isinstance(entry, FileMetadata) and processor.is_supported(entry.name):
                try:
                    status_messages = []
                    
                    # Download thumbnail for faster processing (skip HEIC - not supported)
                    from dropbox.files import ThumbnailFormat, ThumbnailSize
                    image_data = None
                    
                    # HEIC files don't support thumbnails, download full file
                    if not entry.name.lower().endswith(('.heic', '.heif')):
                        try:
                            status_messages.append(f"Downloading thumbnail: {entry.name}")
                            _, thumbnail_response = dbx.files_get_thumbnail(
                                path=entry.path_display,
                                format=ThumbnailFormat.jpeg,
                                size=ThumbnailSize.w480h320
                            )
                            image_data = thumbnail_response.content
                        except Exception as thumb_error:
                            print(f"Thumbnail failed for {entry.name}: {thumb_error}")
                    
                    # Fallback to full download if thumbnail not available
                    if image_data is None:
                        status_messages.append(f"Downloading full image: {entry.name}")
                        _, response = dbx.files_download(entry.path_display)
                        image_data = response.content
                    
                    # Extract features
                    status_messages.append(f"Extracting metadata and EXIF data")
                    features = processor.extract_features(image_data)
                    
                    # Check if already exists
                    existing = db.query(ImageMetadata).filter(
                        ImageMetadata.tenant_id == tenant.id,
                        ImageMetadata.dropbox_id == entry.id
                    ).first()
                    
                    if existing:
                        # Skip already processed, don't count toward limit
                        continue
                    
                    # Upload thumbnail with cache headers
                    status_messages.append(f"Saving thumbnail and metadata")
                    thumbnail_path = f"{tenant.id}/thumbnails/{Path(entry.name).stem}_thumb.jpg"
                    blob = thumbnail_bucket.blob(thumbnail_path)
                    blob.cache_control = "public, max-age=31536000, immutable"  # 1 year cache
                    blob.upload_from_string(features['thumbnail'], content_type='image/jpeg')
                    
                    # Create new metadata
                    exif = features['exif']
                    metadata = ImageMetadata(
                        tenant_id=tenant.id,
                        dropbox_path=entry.path_display,
                        dropbox_id=entry.id,
                        filename=entry.name,
                        file_size=entry.size,
                        content_hash=entry.content_hash if hasattr(entry, 'content_hash') else None,
                        modified_time=entry.server_modified,
                        width=features['width'],
                        height=features['height'],
                        format=features['format'],
                        perceptual_hash=features['perceptual_hash'],
                        color_histogram=features['color_histogram'],
                        exif_data=exif,
                        camera_make=exif.get('Make'),
                        camera_model=exif.get('Model'),
                        lens_model=exif.get('LensModel'),
                        thumbnail_path=thumbnail_path,
                        embedding_generated=False,
                        faces_detected=False,
                        tags_applied=False,
                    )
                    db.add(metadata)
                    db.commit()
                    db.refresh(metadata)
                    
                    # Tag with CLIP (per category)
                    status_messages.append(f"Running {model.upper()} inference for tagging")
                    db.query(ImageTag).filter(ImageTag.image_id == metadata.id).delete()
                    
                    all_tags = []
                    for category, keywords in by_category.items():
                        category_tags = tagger.tag_image(image_data, keywords, threshold=0.15)
                        all_tags.extend(category_tags)
                    
                    keyword_to_category = {kw['keyword']: kw['category'] for kw in all_keywords}
                    
                    for keyword, confidence in all_tags:
                        tag = ImageTag(
                            image_id=metadata.id,
                            tenant_id=tenant.id,
                            keyword=keyword,
                            category=keyword_to_category[keyword],
                            confidence=confidence,
                            manual=False
                        )
                        db.add(tag)
                    
                    metadata.tags_applied = len(all_tags) > 0
                    status_messages.append(f"Complete: {len(all_tags)} tags applied")
                    db.commit()
                    processed += 1
                    
                except Exception as e:
                    print(f"Error processing {entry.name}: {e}")
                    status_messages = [f"Error: {str(e)}"]
        
        return {
            "tenant_id": tenant.id,
            "status": "sync_complete",
            "processed": processed,
            "has_more": len(file_entries) > processed,
            "status_message": " → ".join(status_messages) if 'status_messages' in locals() else None,
            "filename": file_entry.name if file_entry else None
        }
        
    except Exception as e:
        import traceback
        error_detail = f"Sync failed: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.get("/oauth/dropbox/authorize")
async def dropbox_authorize(tenant: str, db: Session = Depends(get_db)):
    """Redirect user to Dropbox OAuth."""
    # Get tenant's app key from database
    tenant_obj = db.query(TenantModel).filter(TenantModel.id == tenant).first()
    if not tenant_obj or not tenant_obj.dropbox_app_key:
        raise HTTPException(status_code=400, detail="Tenant not found or app key not configured")
    
    app_key = tenant_obj.dropbox_app_key
    redirect_uri = f"{settings.app_url}/oauth/dropbox/callback"
    
    oauth_url = (
        f"https://www.dropbox.com/oauth2/authorize"
        f"?client_id={app_key}"
        f"&response_type=code"
        f"&token_access_type=offline"
        f"&redirect_uri={redirect_uri}"
        f"&state={tenant}"
    )
    
    return RedirectResponse(oauth_url)


@app.get("/oauth/dropbox/callback")
async def dropbox_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Handle Dropbox OAuth callback."""
    tenant_id = state
    
    # Get tenant's app key from database
    tenant_obj = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant_obj or not tenant_obj.dropbox_app_key:
        raise HTTPException(status_code=400, detail="Tenant not found or app key not configured")
    
    # Exchange code for tokens
    app_key = tenant_obj.dropbox_app_key
    app_secret = get_secret(f"dropbox-app-secret-{tenant_id}")
    redirect_uri = f"{settings.app_url}/oauth/dropbox/callback"
    
    import requests
    response = requests.post(
        "https://api.dropboxapi.com/oauth2/token",
        data={
            "code": code,
            "grant_type": "authorization_code",
            "client_id": app_key,
            "client_secret": app_secret,
            "redirect_uri": redirect_uri,
        }
    )
    
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange code")
    
    tokens = response.json()
    
    # Store refresh token in Secret Manager
    store_secret(f"dropbox-token-{tenant_id}", tokens['refresh_token'])
    
    return HTMLResponse("""
        <html>
            <body>
                <h1>✓ Dropbox Connected!</h1>
                <p>You can close this window and return to PhotoCat.</p>
                <script>window.close();</script>
            </body>
        </html>
    """)


@app.post("/webhooks/dropbox")
async def dropbox_webhook(request: Request):
    """Handle Dropbox webhook notifications."""
    # Verify webhook challenge on setup
    if request.method == "GET":
        challenge = request.query_params.get("challenge")
        if challenge:
            return {"challenge": challenge}
    
    # Verify webhook signature
    signature = request.headers.get("X-Dropbox-Signature", "")
    body = await request.body()
    
    app_secret = get_secret("dropbox-app-secret")
    validator = DropboxWebhookValidator(app_secret)
    
    if not validator.validate_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    # Parse notification
    data = json.loads(body)
    
    # Queue sync jobs for affected tenants
    # TODO: Trigger async sync via Cloud Tasks
    print(f"Webhook received: {data}")
    
    return {"status": "ok"}


# Admin API Endpoints

@app.get("/api/v1/admin/tenants/{tenant_id}/photo_count")
async def get_tenant_photo_count(
    tenant_id: str,
    db: Session = Depends(get_db)
):
    """Return the number of photos owned by a tenant."""
    count = db.query(ImageMetadata).filter(ImageMetadata.tenant_id == tenant_id).count()
    return {"count": count}


@app.get("/api/v1/admin/tenants")
async def list_tenants(db: Session = Depends(get_db)):
    """List all tenants."""
    tenants = db.query(TenantModel).all()
    return [{
        "id": t.id,
        "name": t.name,
        "active": t.active,
        "dropbox_app_key": t.dropbox_app_key,
        "dropbox_configured": bool(t.dropbox_app_key),  # Has app key configured
        "settings": t.settings,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None
    } for t in tenants]


@app.post("/api/v1/admin/tenants")
async def create_tenant(
    tenant_data: dict,
    db: Session = Depends(get_db)
):
    """Create a new tenant."""
    # Validate required fields
    if not tenant_data.get("id") or not tenant_data.get("name"):
        raise HTTPException(status_code=400, detail="id and name are required")
    
    # Check if tenant already exists
    existing = db.query(TenantModel).filter(TenantModel.id == tenant_data["id"]).first()
    if existing:
        raise HTTPException(status_code=409, detail="Tenant already exists")
    
    # Create tenant
    tenant = TenantModel(
        id=tenant_data["id"],
        name=tenant_data["name"],
        active=tenant_data.get("active", True),
        dropbox_app_key=tenant_data.get("dropbox_app_key"),
        settings=tenant_data.get("settings", {})
    )
    
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    
    return {
        "id": tenant.id,
        "name": tenant.name,
        "active": tenant.active,
        "created_at": tenant.created_at.isoformat()
    }


@app.put("/api/v1/admin/tenants/{tenant_id}")
async def update_tenant(
    tenant_id: str,
    tenant_data: dict,
    db: Session = Depends(get_db)
):
    """Update an existing tenant."""
    tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    # Update fields
    if "name" in tenant_data:
        tenant.name = tenant_data["name"]
    if "active" in tenant_data:
        tenant.active = tenant_data["active"]
    if "dropbox_app_key" in tenant_data:
        tenant.dropbox_app_key = tenant_data["dropbox_app_key"]
    if "settings" in tenant_data:
        tenant.settings = tenant_data["settings"]
    
    tenant.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tenant)
    
    return {
        "id": tenant.id,
        "name": tenant.name,
        "active": tenant.active,
        "updated_at": tenant.updated_at.isoformat()
    }


@app.delete("/api/v1/admin/tenants/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    db: Session = Depends(get_db)
):
    """Delete a tenant and all associated data."""
    tenant = db.query(TenantModel).filter(TenantModel.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    db.delete(tenant)
    db.commit()
    
    return {"status": "deleted", "tenant_id": tenant_id}


@app.get("/api/v1/admin/people")
async def list_people(
    tenant_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List people (optionally filtered by tenant)."""
    query = db.query(Person)
    if tenant_id:
        query = query.filter(Person.tenant_id == tenant_id)
    
    people = query.all()
    return [{
        "id": p.id,
        "tenant_id": p.tenant_id,
        "name": p.name,
        "aliases": p.aliases,
        "face_embedding_ref": p.face_embedding_ref,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None
    } for p in people]


@app.post("/api/v1/admin/people")
async def create_person(
    person_data: dict,
    db: Session = Depends(get_db)
):
    """Create a new person."""
    # Validate required fields
    if not person_data.get("tenant_id") or not person_data.get("name"):
        raise HTTPException(status_code=400, detail="tenant_id and name are required")
    
    # Verify tenant exists
    tenant = db.query(TenantModel).filter(TenantModel.id == person_data["tenant_id"]).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    # Create person
    person = Person(
        tenant_id=person_data["tenant_id"],
        name=person_data["name"],
        aliases=person_data.get("aliases", []),
        face_embedding_ref=person_data.get("face_embedding_ref")
    )
    
    db.add(person)
    db.commit()
    db.refresh(person)
    
    return {
        "id": person.id,
        "tenant_id": person.tenant_id,
        "name": person.name,
        "aliases": person.aliases,
        "created_at": person.created_at.isoformat()
    }


@app.put("/api/v1/admin/people/{person_id}")
async def update_person(
    person_id: int,
    person_data: dict,
    db: Session = Depends(get_db)
):
    """Update an existing person."""
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    
    # Update fields
    if "name" in person_data:
        person.name = person_data["name"]
    if "aliases" in person_data:
        person.aliases = person_data["aliases"]
    if "face_embedding_ref" in person_data:
        person.face_embedding_ref = person_data["face_embedding_ref"]
    
    person.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(person)
    
    return {
        "id": person.id,
        "name": person.name,
        "aliases": person.aliases,
        "updated_at": person.updated_at.isoformat()
    }


@app.delete("/api/v1/admin/people/{person_id}")
async def delete_person(
    person_id: int,
    db: Session = Depends(get_db)
):
    """Delete a person."""
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    
    db.delete(person)
    db.commit()
    
    return {"status": "deleted", "person_id": person_id}


if __name__ == "__main__":
    import uvicorn
    from photocat.settings import settings
    
    uvicorn.run(
        "photocat.api:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        reload=settings.debug
    )

