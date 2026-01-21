# Tagging Normalization Migration - Pre-Deployment Checklist

**CRITICAL**: Complete ALL items in this checklist before running Phase 1 migration.

---

## 1. Data Audit Queries

Run these queries on your database to identify data issues that must be resolved first.

### 1.1: Check for Duplicate Keywords (MUST FIX)

```sql
-- Find keywords that appear in multiple categories per tenant
SELECT
    tenant_id,
    keyword,
    category_id,
    COUNT(*) as count
FROM keywords
GROUP BY tenant_id, keyword, category_id
HAVING COUNT(*) > 1;
```

**If any rows returned**:
- You have duplicate keywords in the same category (shouldn't happen with current unique constraint)
- Investigate and fix before proceeding

### 1.2: Check for Keywords Duplicated Across Categories (CRITICAL FIX)

```sql
-- Find keywords that appear in MULTIPLE categories within the same tenant
SELECT
    tenant_id,
    keyword,
    COUNT(DISTINCT category_id) as category_count,
    STRING_AGG(DISTINCT category_id::text, ', ') as category_ids
FROM keywords
GROUP BY tenant_id, keyword
HAVING COUNT(DISTINCT category_id) > 1;
```

**If any rows returned**:
- This is the main issue that can cause ambiguous backfill
- For each row, you must either:
  - **Option A (Recommended)**: Rename one of the duplicate keywords to be unique (e.g., "sunset" → "sunset_travel")
  - **Option B**: Merge both keyword variants into one category
- After fixing, re-run this query to confirm all are resolved

**Example fix**:
```sql
-- Rename duplicate keyword to be unique
UPDATE keywords
SET keyword = 'sunset_travel'
WHERE tenant_id = 'demo'
AND keyword = 'sunset'
AND category_id = 2;  -- The Travel category
```

### 1.3: Check for Orphaned Keywords in Tags

```sql
-- Find keywords referenced in tags but NOT in keywords table
SELECT 'image_tags' as source, COUNT(*) as orphaned_count FROM image_tags it
WHERE NOT EXISTS (
    SELECT 1 FROM keywords k
    WHERE k.keyword = it.keyword
    AND k.tenant_id = it.tenant_id
)
UNION ALL
SELECT 'machine_tags', COUNT(*) FROM machine_tags mt
WHERE NOT EXISTS (
    SELECT 1 FROM keywords k
    WHERE k.keyword = mt.keyword
    AND mt.tenant_id = k.tenant_id
)
UNION ALL
SELECT 'permatags', COUNT(*) FROM permatags p
WHERE NOT EXISTS (
    SELECT 1 FROM keywords k
    WHERE k.keyword = p.keyword
    AND p.tenant_id = k.tenant_id
)
UNION ALL
SELECT 'trained_image_tags', COUNT(*) FROM trained_image_tags tit
WHERE NOT EXISTS (
    SELECT 1 FROM keywords k
    WHERE k.keyword = tit.keyword
    AND tit.tenant_id = k.tenant_id
);
```

**If any rows have count > 0**:
- You have tags referencing keywords that don't exist in keywords table
- This is a data consistency issue

**How to fix**:
```sql
-- Option 1: Find the orphaned keywords
SELECT DISTINCT keyword FROM image_tags it
WHERE NOT EXISTS (
    SELECT 1 FROM keywords k
    WHERE k.keyword = it.keyword
    AND k.tenant_id = it.tenant_id
);

-- Option 2a: INSERT missing keywords (if you want to keep the tags)
INSERT INTO keywords (category_id, keyword, sort_order, created_at, updated_at)
SELECT kc.id, '<keyword_name>', 0, NOW(), NOW()
FROM keyword_categories kc
WHERE kc.tenant_id = '<tenant_id>'
AND kc.parent_id IS NULL  -- Choose root category
LIMIT 1;

-- Option 2b: DELETE orphaned tags (if you don't need them)
DELETE FROM image_tags WHERE keyword NOT IN (SELECT keyword FROM keywords);
```

### 1.4: Check for Orphaned People in Detected Faces

```sql
-- Find people names in detected_faces but NOT in people table
SELECT
    df.tenant_id,
    df.person_name,
    COUNT(*) as face_count
FROM detected_faces df
WHERE df.person_name IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM people p
    WHERE p.name = df.person_name
    AND p.tenant_id = df.tenant_id
)
GROUP BY df.tenant_id, df.person_name;
```

**If any rows returned**:
- You have detected faces with person names that don't exist in people table
- These faces will get `person_id = NULL` during backfill (which is OK)
- No action required, but good to know

---

## 2. Backup Database

```bash
# Backup production database BEFORE migrations
make db-backup-prod

# Verify backup exists
ls -lh backups/photocat-prod-*.sql
```

---

## 3. Test on Dev Environment

```bash
# Reset dev database to fresh state (with current production data if possible)
make db-reset-dev

# Run all phases of migration
alembic upgrade 202601200800  # Phase 1
alembic upgrade 202601200900  # Phase 2
alembic upgrade 202601201000  # Phase 3
alembic upgrade 202601201100  # Phase 4 (optional)

# Verify data integrity after migration
psql dev_database -c "
SELECT 'image_tags' as table_name, COUNT(*) as null_keyword_id_count FROM image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'machine_tags', COUNT(*) FROM machine_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'permatags', COUNT(*) FROM permatags WHERE keyword_id IS NULL
UNION ALL
SELECT 'trained_image_tags', COUNT(*) FROM trained_image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'keyword_models', COUNT(*) FROM keyword_models WHERE keyword_id IS NULL;
"

# Result should be:
# table_name     | null_keyword_id_count
# ---------------+----------------------
# image_tags     | 0
# machine_tags   | 0
# permatags      | 0
# trained_image_tags | 0
# keyword_models | 0
```

**If any count > 0**: Stop! Do not proceed to production. Investigate orphaned tags.

---

## 4. Test on Staging Environment

```bash
# Deploy to staging database
make db-migrate-staging

# Run smoke tests
make test-staging

# Verify API endpoints work
curl https://staging.photocat.example.com/api/v1/admin/keywords/categories

# Check logs for FK constraint errors
grep -i "foreign key\|constraint" staging-logs.txt

# Monitor resource usage during backfill
watch -n 1 'psql staging_database -c "SELECT count(*) FROM image_tags WHERE keyword_id IS NULL;"'
```

---

## 5. Determine Deployment Strategy

### Strategy A: Brief Downtime (Recommended)
- **Downtime**: 10-70 minutes (depending on data volume)
- **Complexity**: Low
- **Rollback**: Easy (each phase has downgrade)
- **Duration of Phase 2**: 5-60 minutes depending on:
  - Total number of tags across all tables
  - Database hardware performance
  - Index efficiency

**Use this if**: You can tolerate brief downtime for maintenance

### Strategy B: Zero-Downtime (Advanced)
- **Downtime**: 0-5 minutes (only Phase 3)
- **Complexity**: High (requires dual-write code changes)
- **Rollback**: Complex (dual-write logic must be reverted)

**Use this if**: Downtime would cause significant business impact

---

## 6. Pre-Migration Communication

If using Strategy A (brief downtime):

- [ ] Notify users of planned maintenance window
- [ ] Schedule during low-traffic period (late night, weekend, etc.)
- [ ] Post maintenance notification to status page
- [ ] Have on-call engineer ready for rollback

---

## 7. Phase 1: Add Columns (0-5 min downtime)

```bash
# Stop application (or enable read-only mode)
make stop-app

# Run Phase 1 migration
alembic upgrade 202601200800

# Verify columns added
psql production_database -c "\d keywords" | grep tenant_id
psql production_database -c "\d image_tags" | grep keyword_id
```

**If migration fails**:
```bash
alembic downgrade 202601171500  # Rollback to previous version
make start-app
# Investigate error, fix data issues, try again
```

---

## 8. Phase 2: Backfill (5-60 min, can continue with app stopped or read-only)

```bash
# Run Phase 2 migration (this populates the new FK columns)
alembic upgrade 202601200900

# Monitor backfill progress
psql production_database -c "
SELECT
    COUNT(*) as total_tags,
    SUM(CASE WHEN keyword_id IS NULL THEN 1 ELSE 0 END) as missing_keyword_ids
FROM image_tags;
"

# Repeat for all tag tables to verify backfill progress
```

**Expected result** after Phase 2:
- All keyword_id columns should be populated (no NULLs)
- All person_id columns for matched faces should be populated

**If NULLs remain**:
```bash
# Investigate which keywords are missing
SELECT DISTINCT keyword FROM image_tags WHERE keyword_id IS NULL LIMIT 10;

# Either INSERT missing keywords or DELETE orphaned tags
# Then re-run Phase 2 (safe to run multiple times)
```

---

## 9. Phase 2 Post-Backfill Verification (MUST PASS)

```bash
-- Execute this BEFORE moving to Phase 3
SELECT 'image_tags' as table_name, COUNT(*) as null_count FROM image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'machine_tags', COUNT(*) FROM machine_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'permatags', COUNT(*) FROM permatags WHERE keyword_id IS NULL
UNION ALL
SELECT 'trained_image_tags', COUNT(*) FROM trained_image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'keyword_models', COUNT(*) FROM keyword_models WHERE keyword_id IS NULL;
```

**CRITICAL**: All counts must be 0 before proceeding to Phase 3.

If any NULLs exist:
```bash
# DO NOT proceed to Phase 3
# Instead, resolve the orphaned keywords:

# Find what keywords are orphaned
SELECT DISTINCT keyword FROM image_tags WHERE keyword_id IS NULL;

# For each keyword, either:
# 1. INSERT it into keywords table
# 2. Or DELETE the orphaned tags

# Then manually backfill:
UPDATE image_tags it
SET keyword_id = k.id
FROM keywords k
WHERE k.keyword = it.keyword
AND it.tenant_id = k.tenant_id
AND it.keyword_id IS NULL;

# Verify again before Phase 3
```

---

## 10. Phase 3: Add NOT NULL Constraints (0-5 min downtime)

Only proceed if Phase 9 verification passes (all NULL counts are 0).

```bash
# Run Phase 3 migration
alembic upgrade 202601201000

# This adds NOT NULL constraints and uniqueness constraint on keywords
# If Phase 2 backfill is incomplete, this will FAIL
```

**If this fails**:
```bash
# Roll back and investigate Phase 2 backfill
alembic downgrade 202601200900
# Fix orphaned tags, re-run Phase 2
```

---

## 11. Deploy Updated Code

After Phase 3 is complete:

```bash
# Deploy code that uses keyword_id instead of keyword strings
git pull origin main
npm run build
docker build -t photocat:latest .
docker push photocat:latest

# Deploy to production
make deploy-api
```

**Code should**:
- Query by `keyword_id` instead of `keyword` string
- Resolve keyword strings to `keyword_id` before inserting tags
- Include `keyword_id` in API responses (alongside `keyword` for backward compat)

---

## 12. Restart Application

```bash
# Restart application (if using Strategy A with downtime)
make start-app

# Or restart with rolling deployment (if using Strategy B)
make rolling-restart-app

# Monitor logs for FK constraint errors
tail -f production.log | grep -i "constraint\|foreign key"

# Health checks
curl https://photocat.example.com/health
```

---

## 13. Phase 4: Drop Old Columns (Optional, can delay weeks)

This is optional and can be run weeks/months later after you're confident:

```bash
# Run Phase 4 migration
alembic upgrade 202601201100

# Verify old columns dropped
psql production_database -c "\d image_tags"  # Should NOT have 'keyword' or 'category' columns
```

**Why delay Phase 4**:
- Provides rollback window if issues arise
- Old columns can be useful for debugging
- No performance penalty to keep them
- Can be done during next maintenance window

---

## Rollback Procedures

### If Phase 1 Fails
```bash
alembic downgrade 202601171500
make start-app
# Investigate, fix issues, start over
```

### If Phase 2 Fails (Backfill)
```bash
alembic downgrade 202601200800
make start-app
# Investigate orphaned data, fix, start over
```

### If Phase 3 Fails
```bash
alembic downgrade 202601200900
# Phase 2 backfill incomplete - resolve orphaned tags
# Re-run Phase 2, then Phase 3
```

### If Phase 4 Fails (Not Critical)
```bash
alembic downgrade 202601201000
# Re-add old columns from backup if needed
# No data loss - can try again later
```

---

## Post-Migration Verification

After successful migration:

```bash
-- Verify relationships work
SELECT i.id, k.keyword, COUNT(*)
FROM image_tags i
JOIN keywords k ON i.keyword_id = k.id
GROUP BY i.id, k.keyword
LIMIT 10;

-- Verify uniqueness constraint
SELECT COUNT(*) FROM (
    SELECT tenant_id, keyword, category_id, COUNT(*) as cnt
    FROM keywords
    GROUP BY tenant_id, keyword, category_id
    HAVING COUNT(*) > 1
) t;
-- Should return 0 rows

-- Verify no orphaned tags
SELECT COUNT(*) FROM image_tags WHERE keyword_id IS NULL;
-- Should return 0 rows
```

---

## Monitoring During Backfill (Phase 2)

Watch these metrics:

```sql
-- Query execution time (should complete within minutes, not hours)
SELECT now() - pg_postmaster_start_time() as uptime;

-- Disk usage (backfill may cause temporary spike)
SELECT pg_database_size(current_database());

-- Index bloat (optional: analyze indexes after backfill)
ANALYZE keywords;
ANALYZE image_tags;

-- Foreign key constraint violations (should be 0)
SELECT COUNT(*) FROM image_tags WHERE keyword_id NOT IN (SELECT id FROM keywords);
```

---

## Support / Rollback Contact

If issues occur during migration:

1. **Immediate**: Rollback using procedures above
2. **Investigation**: Check `alembic/alembic.log` for migration errors
3. **Database**: Contact DBA if needed for backup/restore
4. **Code**: Revert code deployments if needed

---

## Sign-Off Checklist

- [ ] All data audit queries (1.1-1.4) passed
- [ ] Database backed up
- [ ] Migration tested on dev environment
- [ ] Migration tested on staging environment
- [ ] Deployment strategy chosen (A or B)
- [ ] Team notified of maintenance window (if Strategy A)
- [ ] On-call engineer assigned
- [ ] Rollback procedures reviewed
- [ ] Updated code ready for deployment

**Only proceed to Phase 1 after ALL items are checked.**

