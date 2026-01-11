#!/bin/bash
# Setup shared GCS buckets for DEV and PROD environments
# Usage: ./scripts/setup_shared_buckets.sh

set -e

PROJECT_ID="photocat-483622"
REGION="us-central1"

echo "=== PhotoCat Shared Bucket Setup ==="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Function to setup a bucket
setup_bucket() {
    local BUCKET_NAME=$1
    local ENV=$2

    echo ""
    echo "=== Setting up shared bucket for $ENV environment ==="
    echo "Bucket name: $BUCKET_NAME"
    echo ""

    # Create bucket if it doesn't exist
    if gsutil ls -b gs://$BUCKET_NAME 2>/dev/null; then
        echo "✓ Bucket $BUCKET_NAME already exists"
    else
        echo "Creating bucket $BUCKET_NAME..."
        gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
        echo "✓ Created bucket $BUCKET_NAME"
    fi

    # Make bucket publicly readable
    echo "Configuring public read access..."
    gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME
    echo "✓ Configured public read access"

    # Set CORS configuration
    echo "Configuring CORS..."
    cat > /tmp/cors-config.json <<EOF
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF
    gsutil cors set /tmp/cors-config.json gs://$BUCKET_NAME
    rm /tmp/cors-config.json
    echo "✓ Configured CORS"

    echo ""
    echo "✓ Shared bucket $BUCKET_NAME is ready!"
    echo "  Public URL: https://storage.googleapis.com/$BUCKET_NAME/{path}"
    echo "  Example: https://storage.googleapis.com/$BUCKET_NAME/demo/thumbnails/image_thumb.jpg"
}

# Confirm with user
echo "This will create/configure shared buckets for DEV and PROD environments."
read -p "Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

# Setup DEV bucket (lowercase!)
setup_bucket "${PROJECT_ID}-dev-shared" "DEV"

# Setup PROD bucket (lowercase!)
setup_bucket "${PROJECT_ID}-prod-shared" "PROD"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Created buckets:"
echo "  - ${PROJECT_ID}-DEV-shared"
echo "  - ${PROJECT_ID}-PROD-shared"
echo ""
echo "Next steps:"
echo "1. New uploads will automatically use the appropriate shared bucket"
echo "2. To create dedicated tenant buckets, use:"
echo "   python scripts/setup_tenant_buckets.py --tenant-id <tenant_id>"
echo ""
echo "Bucket naming convention:"
echo "  - Shared: {project}-{ENV}-shared"
echo "  - Dedicated: {project}-{ENV}-{tenant_id}"
echo "  - Paths always include tenant ID: {tenant_id}/thumbnails/{filename}"
