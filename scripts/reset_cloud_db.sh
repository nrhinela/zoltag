#!/bin/bash
# Quick script to reset the Cloud SQL database
# Assumes Cloud SQL Proxy is already running

set -e

# Get environment from argument or default to dev
ENV="${1:-dev}"

if [ "$ENV" != "dev" ] && [ "$ENV" != "prod" ]; then
    echo "Usage: $0 [dev|prod]"
    echo "  dev  - Reset photocat_dev database (default)"
    echo "  prod - Reset photocat_prod database"
    exit 1
fi

DATABASE_NAME="photocat_${ENV}"
DB_USER="photocat-user"

echo "=== Reset Cloud SQL Database ==="
echo "Environment: $ENV"
echo "Database: $DATABASE_NAME"
echo ""
echo "⚠️  This will DROP and recreate the '$DATABASE_NAME' database"
echo "⚠️  All data will be lost!"
echo ""
read -p "Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

echo ""
read -s -p "Enter password for $DB_USER: " DB_PASSWORD
echo ""
echo ""

export PGPASSWORD="$DB_PASSWORD"

# Check if proxy is accessible
echo "Checking connection to Cloud SQL Proxy..."
if ! psql -h 127.0.0.1 -U $DB_USER -d postgres -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Cannot connect to database."
    echo ""
    echo "Make sure Cloud SQL Proxy is running:"
    echo "  ./scripts/start_cloud_sql_proxy.sh"
    echo ""
    exit 1
fi

echo "✓ Connection successful"
echo ""

# Drop and recreate
echo "Dropping database..."
psql -h 127.0.0.1 -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DATABASE_NAME;"

echo "Creating database..."
psql -h 127.0.0.1 -U $DB_USER -d postgres -c "CREATE DATABASE $DATABASE_NAME;"

echo "✓ Database recreated"
echo ""

# Run migrations
echo "Running migrations..."
cd "$(dirname "$0")/.."

# Export DATABASE_URL for alembic
export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DATABASE_NAME"

python3 -m alembic upgrade head

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Database '$DATABASE_NAME' is ready for use."
echo ""
echo "Add this to your .env file:"
echo "  ENVIRONMENT=$ENV"
echo "  DATABASE_URL=postgresql://$DB_USER:PASSWORD@127.0.0.1:5432/$DATABASE_NAME"
echo ""
echo "Note: Replace PASSWORD with your actual database password"
echo ""
