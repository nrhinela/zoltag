#!/bin/bash
# Set up Cloud CDN for thumbnail delivery

set -e

PROJECT_ID=${1:-"photocat-483622"}
BUCKET_NAME="${PROJECT_ID}-thumbnails"

echo "🌐 Setting up Cloud CDN for thumbnails..."
echo "Project: $PROJECT_ID"
echo "Bucket: $BUCKET_NAME"
echo ""

# Create backend bucket
echo "📦 Creating backend bucket..."
gcloud compute backend-buckets create zoltag-thumbnails-backend \
    --gcs-bucket-name=$BUCKET_NAME \
    --enable-cdn \
    --cache-mode=CACHE_ALL_STATIC \
    --default-ttl=86400 \
    --max-ttl=31536000 \
    --project=$PROJECT_ID || echo "Backend bucket already exists"

# Create URL map
echo "🗺️  Creating URL map..."
gcloud compute url-maps create zoltag-cdn-map \
    --default-backend-bucket=zoltag-thumbnails-backend \
    --project=$PROJECT_ID || echo "URL map already exists"

# Create SSL certificate (managed)
echo "🔒 Creating SSL certificate..."
gcloud compute ssl-certificates create zoltag-cdn-cert \
    --domains=cdn.zoltag.com \
    --global \
    --project=$PROJECT_ID || echo "Certificate already exists (or use your own domain)"

# Create target HTTPS proxy
echo "🎯 Creating target proxy..."
gcloud compute target-https-proxies create zoltag-cdn-proxy \
    --url-map=zoltag-cdn-map \
    --ssl-certificates=zoltag-cdn-cert \
    --project=$PROJECT_ID || echo "Proxy already exists"

# Reserve static IP
echo "📍 Reserving static IP..."
gcloud compute addresses create zoltag-cdn-ip \
    --ip-version=IPV4 \
    --global \
    --project=$PROJECT_ID || echo "IP already exists"

# Get the IP address
CDN_IP=$(gcloud compute addresses describe zoltag-cdn-ip --global --format="value(address)" --project=$PROJECT_ID)
echo "✅ Static IP: $CDN_IP"

# Create forwarding rule
echo "📡 Creating forwarding rule..."
gcloud compute forwarding-rules create zoltag-cdn-rule \
    --address=zoltag-cdn-ip \
    --global \
    --target-https-proxy=zoltag-cdn-proxy \
    --ports=443 \
    --project=$PROJECT_ID || echo "Forwarding rule already exists"

echo ""
echo "🎉 Cloud CDN setup complete!"
echo ""
echo "Next steps:"
echo "  1. Point your domain (cdn.zoltag.com) to: $CDN_IP"
echo "  2. Wait for SSL certificate provisioning (~15 minutes)"
echo "  3. Update application to use CDN URLs"
echo ""
echo "Simpler alternative (no custom domain):"
echo "  Use direct GCS URLs: https://storage.googleapis.com/$BUCKET_NAME/..."
echo "  This works immediately, but without CDN caching"
