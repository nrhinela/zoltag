# Zoltag - Image Organization & Search Utility

## Project Overview
Zoltag is a multi-tenant utility for organizing and finding images within large file collections stored in Dropbox. The system focuses on three core capabilities:
1. **Image Processing**: Efficient handling of various image formats from Dropbox
2. **Metadata Creation**: Extracting and generating searchable metadata (EXIF, visual features, tags)
3. **Flexible Search**: Fast, multi-dimensional search across image collections

**Key Constraint**: Minimize AI/ML processing costs through intelligent caching, batch processing, and selective model usage.

**Multi-Tenant Design**: Each tenant has isolated configuration (keywords, people), Dropbox credentials, and data storage.

## Architecture Guidelines

### Core Components
- **Tenant Manager**: Handle tenant registration, activation, and context isolation
- **Configuration Manager**: Load/validate controlled vocabularies (keywords, people), API keys, processing rules per tenant
- **Dropbox Integration Layer**: Handle OAuth, file sync, and batch operations using Dropbox API v2 (tenant-scoped)
- **Image Processor**: Process images (thumbnails, feature extraction, format conversion)
- **Metadata Engine**: Extract EXIF data, generate embeddings/hashes, store structured metadata with tenant_id
- **Tagging Engine**: Apply controlled keywords and facial recognition using configured people list (tenant-specific)
- **Search Service**: Index and query images by metadata, content, date, location, etc. (tenant-isolated queries)
- **Storage Layer**: Cloud Storage for image cache/thumbnails, Cloud SQL (PostgreSQL) with tenant partitioning and row-level security

### Google Cloud Platform Architecture
- **Compute**: Cloud Run for API/web service (auto-scaling, serverless) or GKE for complex workflows
- **Storage**: 
  - Cloud Storage buckets for cached images/thumbnails (bucket per tenant or shared with tenant prefix)
  - Cloud SQL PostgreSQL for metadata with row-level security policies
- **Secrets**: Secret Manager for Dropbox tokens, API keys, database credentials
- **Background Processing**: Cloud Tasks or Pub/Sub for async image processing jobs
- **Monitoring**: Cloud Logging and Cloud Monitoring for observability
- **IAM**: Service accounts with least-privilege access per component

### Data Flow
1. Tenant context → Load tenant-specific configuration and credentials
2. Dropbox → Download/Stream images using tenant's API token
3. Image Processor → Extract features and generate thumbnails
4. Metadata Engine → Create searchable records with tenant_id
5. Search Service → Index for fast retrieval (tenant-scoped queries)
6. Cache processed results to avoid reprocessing

## Development Practices

### Configuration Management
- Store controlled vocabularies per tenant: `config/{tenant_id}/keywords.yaml` and `config/{tenant_id}/people.yaml`
- Keywords: hierarchical categories (e.g., nature/landscape, people/family, events/vacation)
- People: name, face embedding reference, aliases
- Each tenant has isolated Dropbox API credentials and processing preferences
- Support hot-reload of configuration without restart
- Validate configuration on startup and tenant activation

### Python Project Setup
- Use `pyproject.toml` for dependency management (consider Poetry or uv)
- Pin versions for image processing libraries (Pillow, opencv-python)
- Include dev dependencies: pytest, black, ruff

### Key Libraries to Consider
- **Google Cloud**: `google-cloud-storage`, `google-cloud-secret-manager`, `google-cloud-tasks`, `google-cloud-logging`
- **Database**: `sqlalchemy`, `psycopg2-binary` for Cloud SQL PostgreSQL
- **Dropbox**: `dropbox` (official SDK)
- **Image Processing**: `Pillow`, `opencv-python`, or `imageio`
- **EXIF**: `piexif` or `exifread`
- **Search/Indexing**: `whoosh`, `sqlite-fts5`, or vector search with `faiss`/`chromadb`
- **Facial Recognition**: `face_recognition` or `deepface` (use smaller models like MobileFaceNet for cost efficiency)
- **Embeddings**: `sentence-transformers` or `clip` for visual similarity (consider quantized models)

### Testing Strategy
- Mock Dropbox API calls to avoid rate limits
- Use sample image fixtures (various formats: JPEG, PNG, HEIC, RAW)
- Test edge cases: corrupted images, missing EXIF, large files

### Performance & Cost Optimization
- **Batch Processing**: Group images for bulk API calls and model inference to reduce per-image overhead
- **Incremental Sync**: Use Dropbox delta API to process only new/changed files
- **Smart Caching**: Store all AI-generated data (embeddings, face encodings, tags) to avoid reprocessing
  - Use Cloud Storage with lifecycle policies to manage cache size and costs
  - Consider Cloud CDN for frequently accessed thumbnails
- **Selective Processing**: Skip AI models for images that haven't changed (check file hash/mtime)
- **Model Selection**: Use smaller, quantized models where accuracy trade-offs are acceptable
- **Async I/O**: Process multiple images concurrently to maximize throughput
  - Use Cloud Tasks for background processing to avoid Cloud Run timeouts
  - Consider batch jobs on Compute Engine for large processing runs
- **Memory Management**: Stream large images, process in batches to avoid OOM errors
- **Deduplication**: Use perceptual hashing early to skip processing of duplicates
- **GCP Cost Controls**: Set budgets and alerts, use committed use discounts for predictable workloads

## Common Workflows

### Initial Development
```bash
# Setup environment
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black . && ruff check .
```

### GCP Deployment
```bash
# Deploy to Cloud Run
gcloud run deploy zoltag \
  --source . \
  --region us-central1 \
  --allow-unauthenticated

# Setup Cloud SQL proxy for local development
cloud-sql-proxy INSTANCE_CONNECTION_NAME

# Deploy background worker
gcloud run deploy zoltag-worker \
  --source . \
  --no-allow-unauthenticated \
  --set-env-vars WORKER_MODE=true
```

### Dropbox Integration

#### App Registration (Developer Setup)
1. Create app at [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Choose access type: **Full Dropbox** (access all files) or **App folder** (sandboxed)
3. Obtain **App Key** and **App Secret** → Store in Secret Manager as `dropbox-app-key` and `dropbox-app-secret`
4. Configure OAuth redirect URIs (e.g., `https://your-app.run.app/oauth/dropbox/callback`)
5. Enable required permissions in app settings

#### Required OAuth Scopes
- `files.metadata.read` - Read file/folder metadata, EXIF data
- `files.content.read` - Download image files
- `files.content.write` - Upload processed files (optional, if writing back to Dropbox)
- Consider `account_info.read` for user details and quota checks

#### Per-Tenant OAuth Flow
1. **Authorization**: Redirect tenant to Dropbox OAuth URL with your App Key
2. **Callback**: Receive authorization code at your redirect URI
3. **Token Exchange**: Exchange code for Access Token and Refresh Token
4. **Storage**: Store refresh token in Secret Manager as `dropbox-token-{tenant_id}`
5. **Access Token**: Short-lived (~4 hours), refresh automatically using refresh token

#### Token Management
- Implement automatic token refresh before expiration
- Handle token refresh failures gracefully (re-authenticate tenant)
- Use refresh token rotation (Dropbox provides new refresh token on refresh)
- Store token metadata: issued_at, expires_at, last_used timestamps

#### Incremental Sync with Delta API
- Use `/files/list_folder/continue` with cursors to get only changed files
- Store cursor state per tenant in database: `dropbox_cursor` table with tenant_id
- Initial sync: `/files/list_folder` with `recursive=True`
- Subsequent syncs: Use saved cursor to get deltas only
- Handle deletions, moves, and modifications appropriately

#### Webhooks (Optional but Recommended)
- Register webhook URL: `https://your-app.run.app/webhooks/dropbox`
- Verify webhook with challenge parameter on setup
- Receive notifications when tenant's files change
- Trigger background processing job via Cloud Tasks
- Validate webhook signatures for security

#### Rate Limiting & Error Handling
- Respect Dropbox rate limits (exponential backoff with jitter)
- Handle tenant-specific rate limiting with separate queues
- Retry transient errors (429, 500, 503) with backoff
- Log permanent errors (401, 403) and notify tenant
- Implement circuit breaker pattern for failing tenants

### Metadata Schema Design
Consider tracking:
- Tenant isolation: tenant_id (foreign key, indexed, required on all tables)
- File metadata: path, size, modified date, content hash (for change detection)
- EXIF: camera, lens, ISO, aperture, GPS coordinates, capture timestamp
- Visual features: perceptual hash (for deduplication within tenant), color histogram, ML embeddings (cached)
- Content tags: controlled keywords from `config/{tenant_id}/keywords.yaml`, confidence scores
- People: recognized faces from `config/{tenant_id}/people.yaml`, bounding boxes, confidence scores
- Processing state: last_processed timestamp, model versions used (for reprocessing decisions)

## Search Features to Implement
- **Text search**: filename, tags, location names
- **Date range**: taken date, modified date
- **Visual similarity**: find similar images using embeddings
- **Location**: GPS coordinates with radius search
- **Advanced filters**: camera model, resolution, file type

## Error Handling
- Gracefully handle Dropbox API errors (network, auth, quota)
- Skip corrupted or unsupported image formats with logging
- Implement retry logic for transient failures
- Provide clear error messages for user-facing operations

## Future Considerations
- Web UI for browsing and searching
- Duplicate detection using perceptual hashing
- Face detection and recognition
- Automatic tagging using image classification models
- Export/backup functionality
