#!/bin/bash
# Start Cloud SQL Proxy for local development

PROJECT_ID="photocat-483622"
INSTANCE_NAME="photocat-db"

# Get the connection name
INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe $INSTANCE_NAME \
    --project=$PROJECT_ID \
    --format="value(connectionName)")

echo "Starting Cloud SQL Proxy for: $INSTANCE_CONNECTION_NAME"
echo "PostgreSQL will be available at: 127.0.0.1:5432"
echo ""
echo "Press Ctrl+C to stop the proxy"
echo ""

# Run proxy in foreground
cloud-sql-proxy $INSTANCE_CONNECTION_NAME
