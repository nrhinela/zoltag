# Per-Tenant Storage Configuration

This guide explains how to configure per-tenant GCS storage buckets for PhotoCat.

## Overview

PhotoCat supports per-tenant storage buckets, allowing each tenant to have isolated storage for their images and thumbnails. This provides better data isolation, easier management, and the ability to configure different access controls per tenant.

## Architecture

### Bucket Naming Convention

- **Storage bucket**: `{project-id}-{tenant-id}-images`
- **Thumbnail bucket**: `{project-id}-{tenant-id}-thumbnails`

Example for tenant "acme" in project "photocat-483622":
- Storage: `photocat-483622-acme-images`
- Thumbnails: `photocat-483622-acme-thumbnails`

### CDN Strategy

**Recommended: Public Buckets with storage.googleapis.com URLs**

The simplest approach is to make thumbnail buckets publicly readable and serve them directly via Google Cloud Storage URLs:

```
https://storage.googleapis.com/{bucket-name}/{path}
```

**Benefits:**
- Automatic global edge caching via Google's infrastructure
- No additional CDN configuration required
- Simple setup and maintenance
- Predictable costs

**Security:**
- Thumbnail buckets: Public read access (thumbnails are safe to expose)
- Storage buckets: Private (only your application can write/read full-size images)

### Fallback Behavior

If a tenant doesn't have custom buckets configured, the system falls back to global settings:
1. First checks tenant's `thumbnail_bucket` field
2. Falls back to tenant's `storage_bucket` field
3. Falls back to global `settings.thumbnail_bucket`
4. Falls back to global `settings.storage_bucket_name`

This allows gradual migration and mixed deployments.

## Setup Guide

### Step 1: Run Database Migration

```bash
cd /Users/ned.rhinelander/Developer/photocat
alembic upgrade head
```

This adds `storage_bucket` and `thumbnail_bucket` columns to the tenants table.

### Step 2: Create Buckets for a Tenant

Use the provided setup script:

```bash
python scripts/setup_tenant_buckets.py --tenant-id demo
```

This will:
1. Create `{project-id}-{tenant-id}-images` bucket (private)
2. Create `{project-id}-{tenant-id}-thumbnails` bucket (public)
3. Update the tenant record in the database with bucket names

**Options:**
- `--public-images`: Also make the images bucket public (not recommended unless needed)

### Step 3: Verify Configuration

Check that the tenant has bucket names configured:

```bash
psql $DATABASE_URL -c "SELECT id, name, storage_bucket, thumbnail_bucket FROM tenants WHERE id='demo';"
```

### Step 4: Test Image Upload

Upload an image via the UI or CLI:

```bash
photocat ingest --tenant-id demo ~/Pictures/test
```

The CLI will show which buckets it's using:
```
Using tenant: Demo Tenant
  Storage bucket: photocat-483622-demo-images
  Thumbnail bucket: photocat-483622-demo-thumbnails
```

### Step 5: Verify URLs

Check that thumbnail URLs use the tenant-specific bucket:
1. Open PhotoCat in browser
2. Select the tenant
3. View an image
4. Check browser network tab - thumbnail URLs should be:
   `https://storage.googleapis.com/photocat-483622-demo-thumbnails/{path}`

## Bucket Permissions

### Thumbnail Bucket (Public)

```bash
gsutil iam ch allUsers:objectViewer gs://{bucket-name}
```

Or via the setup script (automatically done):
```python
policy = bucket.get_iam_policy(requested_policy_version=3)
policy.bindings.append({
    "role": "roles/storage.objectViewer",
    "members": {"allUsers"}
})
bucket.set_iam_policy(policy)
```

### Storage Bucket (Private)

Keep default permissions - only your app service account needs access.

Your Cloud Run/App Engine service account automatically has access via:
- `roles/storage.objectAdmin` on project level, or
- `roles/storage.objectCreator` + `roles/storage.objectViewer` on bucket level

## Migration from Shared Buckets

If you have existing tenants using shared buckets, you can migrate gradually:

### Option A: Keep Existing Data in Shared Buckets

Leave existing data where it is. New uploads will use tenant-specific buckets. The app will continue serving old images from the shared bucket (paths are stored in database).

### Option B: Copy Data to Tenant Buckets

1. Create new tenant buckets
2. Copy existing data:
   ```bash
   gsutil -m cp -r \
     gs://photocat-483622-images/tenant-demo/* \
     gs://photocat-483622-demo-images/

   gsutil -m cp -r \
     gs://photocat-483622-images/tenant-demo/* \
     gs://photocat-483622-demo-thumbnails/
   ```

3. Update image paths in database:
   ```sql
   UPDATE image_metadata
   SET thumbnail_path = REPLACE(thumbnail_path, 'tenant-demo/', '')
   WHERE tenant_id = 'demo';
   ```

4. Update tenant configuration
5. Delete old data from shared bucket

## Managing Bucket Costs

### Storage Costs
- Standard storage: $0.020 per GB/month
- Nearline (30-day): $0.010 per GB/month
- Coldline (90-day): $0.004 per GB/month

Consider lifecycle policies for older images:

```bash
gsutil lifecycle set lifecycle.json gs://{bucket-name}
```

Example `lifecycle.json`:
```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {"age": 90}
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "COLDLINE"},
        "condition": {"age": 365}
      }
    ]
  }
}
```

### Network Costs
- Egress to internet: $0.12 per GB (first 1TB per month)
- Google's edge caching reduces egress costs by caching popular images closer to users

## Troubleshooting

### Images not loading

1. Check bucket exists:
   ```bash
   gsutil ls gs://{bucket-name}
   ```

2. Check bucket permissions:
   ```bash
   gsutil iam get gs://{bucket-name}
   ```

3. Check tenant configuration:
   ```sql
   SELECT * FROM tenants WHERE id='demo';
   ```

### Bucket creation fails

Ensure your service account has permission to create buckets:
```bash
gcloud projects add-iam-policy-binding photocat-483622 \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT" \
  --role="roles/storage.admin"
```

### Wrong bucket being used

The app uses this priority:
1. `tenant.thumbnail_bucket` (if set)
2. `tenant.storage_bucket` (if set)
3. `settings.thumbnail_bucket` (global fallback)
4. `settings.storage_bucket_name` (global fallback)

Check that the tenant record has the correct bucket names configured.

## Advanced: Cloud CDN

If you need more control over caching behavior or want a custom domain, you can set up Cloud CDN:

1. Create Load Balancer
2. Add Backend Bucket pointing to your tenant bucket
3. Configure CDN policy
4. Update app to use Load Balancer URL instead of storage.googleapis.com

This is more complex but offers:
- Custom domain support (cdn.photocat.com)
- Advanced cache control
- Detailed analytics
- Signed URLs for private content

See [Cloud CDN documentation](https://cloud.google.com/cdn/docs/setting-up-cdn-with-bucket) for details.

## Code Changes Summary

Files modified for per-tenant storage:

1. **alembic/versions/2026_01_09_1400-add_tenant_storage_buckets.py**: Database migration
2. **src/photocat/tenant/__init__.py**: Added storage_bucket and thumbnail_bucket fields, helper methods
3. **src/photocat/api.py**:
   - Updated `get_tenant()` to load buckets from database
   - Updated thumbnail URL generation to use tenant buckets
   - Updated all storage client calls to use tenant buckets
   - Added bucket fields to admin API responses
4. **src/photocat/cli.py**: Updated ingest command to load tenant from database and use tenant buckets
5. **scripts/setup_tenant_buckets.py**: New script to create and configure tenant buckets

All changes are backward compatible - tenants without custom buckets will continue using global settings.
