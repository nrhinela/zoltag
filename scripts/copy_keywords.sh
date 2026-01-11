#!/bin/bash
# Copy keywords from photocat database to photocat-dev database
# Assumes Cloud SQL Proxy is running

set -e

SOURCE_DB="photocat"
TARGET_DB="photocat-dev"
DB_USER="photocat-user"

echo "=== Copy Keywords Between Databases ==="
echo "Source: $SOURCE_DB"
echo "Target: $TARGET_DB"
echo ""
read -s -p "Enter password for $DB_USER: " DB_PASSWORD
echo ""
echo ""

export PGPASSWORD="$DB_PASSWORD"

# Check connection
echo "Checking connection..."
if ! psql -h 127.0.0.1 -U $DB_USER -d $SOURCE_DB -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Cannot connect to source database $SOURCE_DB"
    exit 1
fi
if ! psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Cannot connect to target database $TARGET_DB"
    exit 1
fi
echo "✓ Connection successful"
echo ""

# Create temp directory
mkdir -p /tmp/photocat_migration

# Step 1: Copy keyword_categories (with tenant mapping)
echo "Step 1: Copying keyword categories..."
psql -h 127.0.0.1 -U $DB_USER -d $SOURCE_DB -c "
COPY (
  SELECT id, tenant_id, name, parent_id, sort_order, created_at, updated_at
  FROM keyword_categories
  ORDER BY id
) TO STDOUT" > /tmp/photocat_migration/categories.tsv

# Import categories
psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c "
COPY keyword_categories (id, tenant_id, name, parent_id, sort_order, created_at, updated_at)
FROM STDIN" < /tmp/photocat_migration/categories.tsv

echo "✓ Copied $(wc -l < /tmp/photocat_migration/categories.tsv) categories"

# Step 2: Update sequence for categories
echo "Step 2: Updating category sequence..."
psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c "
SELECT setval('keyword_categories_id_seq', (SELECT MAX(id) FROM keyword_categories));"

# Step 3: Copy keywords
echo "Step 3: Copying keywords..."
psql -h 127.0.0.1 -U $DB_USER -d $SOURCE_DB -c "
COPY (
  SELECT id, category_id, keyword, prompt, sort_order, created_at, updated_at
  FROM keywords
  ORDER BY id
) TO STDOUT" > /tmp/photocat_migration/keywords.tsv

# Import keywords
psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c "
COPY keywords (id, category_id, keyword, prompt, sort_order, created_at, updated_at)
FROM STDIN" < /tmp/photocat_migration/keywords.tsv

echo "✓ Copied $(wc -l < /tmp/photocat_migration/keywords.tsv) keywords"

# Step 4: Update sequence for keywords
echo "Step 4: Updating keyword sequence..."
psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c "
SELECT setval('keywords_id_seq', (SELECT MAX(id) FROM keywords));"

# Cleanup
rm -rf /tmp/photocat_migration

echo ""
echo "=== Migration Complete! ==="
echo ""
echo "Verify the migration:"
echo "  psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c \"SELECT COUNT(*) FROM keyword_categories;\""
echo "  psql -h 127.0.0.1 -U $DB_USER -d $TARGET_DB -c \"SELECT COUNT(*) FROM keywords;\""
echo ""
