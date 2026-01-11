#!/bin/bash
# Setup Cloud SQL for development
# This script will:
# 1. Start Cloud SQL Proxy
# 2. Drop and recreate the database
# 3. Run migrations to create fresh schema

set -e

PROJECT_ID="photocat-483622"
INSTANCE_NAME="photocat-db"
REGION="us-central1"
DATABASE_NAME="photocat"
DB_USER="photocat-user"

echo "=== PhotoCat Cloud SQL Development Setup ==="
echo "Project: $PROJECT_ID"
echo "Instance: $INSTANCE_NAME"
echo "Database: $DATABASE_NAME"
echo ""

# Check if Cloud SQL Proxy is installed
if ! command -v cloud-sql-proxy &> /dev/null; then
    echo "❌ Cloud SQL Proxy is not installed."
    echo "Install it with:"
    echo "  brew install cloud-sql-proxy"
    echo "  or download from: https://cloud.google.com/sql/docs/postgres/sql-proxy"
    exit 1
fi

# Get the connection name
INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe $INSTANCE_NAME \
    --project=$PROJECT_ID \
    --format="value(connectionName)")

echo "Connection name: $INSTANCE_CONNECTION_NAME"
echo ""

# Check if proxy is already running
if pgrep -f "cloud-sql-proxy.*$INSTANCE_CONNECTION_NAME" > /dev/null; then
    echo "✓ Cloud SQL Proxy is already running"
else
    echo "Starting Cloud SQL Proxy in the background..."
    cloud-sql-proxy $INSTANCE_CONNECTION_NAME &
    PROXY_PID=$!
    echo "✓ Cloud SQL Proxy started (PID: $PROXY_PID)"
    echo "  Waiting for proxy to be ready..."
    sleep 3
fi

echo ""
echo "⚠️  WARNING: This will DROP the existing database and recreate it."
echo "⚠️  All data will be lost!"
echo ""
read -p "Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "Getting database password from Secret Manager..."
DB_PASSWORD=$(gcloud secrets versions access latest \
    --secret="photocat-db-password" \
    --project=$PROJECT_ID 2>/dev/null || echo "")

if [ -z "$DB_PASSWORD" ]; then
    echo "❌ Could not retrieve password from Secret Manager."
    echo "Please set the database password:"
    read -s -p "Password for $DB_USER: " DB_PASSWORD
    echo ""
fi

# Connection string for Cloud SQL Proxy
export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DATABASE_NAME"

echo ""
echo "Connecting to Cloud SQL via proxy..."

# Drop and recreate database
echo "Dropping existing database..."
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DATABASE_NAME;" || {
    echo "❌ Failed to drop database. Make sure the proxy is running and credentials are correct."
    exit 1
}

echo "Creating fresh database..."
PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U $DB_USER -d postgres -c "CREATE DATABASE $DATABASE_NAME;"

echo "✓ Database recreated successfully"
echo ""

echo "Running migrations to create schema..."
cd "$(dirname "$0")/.."
python3 -m alembic upgrade head

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Database connection details:"
echo "  Host: 127.0.0.1 (via Cloud SQL Proxy)"
echo "  Port: 5432"
echo "  Database: $DATABASE_NAME"
echo "  User: $DB_USER"
echo ""
echo "Add this to your .env file:"
echo "  DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DATABASE_NAME"
echo ""
echo "To keep the proxy running, either:"
echo "  1. Leave this terminal open, or"
echo "  2. Start it manually: cloud-sql-proxy $INSTANCE_CONNECTION_NAME"
echo ""
