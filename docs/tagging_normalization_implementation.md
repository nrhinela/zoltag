# Tagging Data Model Normalization - Implementation Summary

## Overview

This document summarizes the complete implementation of the tagging data model normalization, which eliminates denormalized keyword/category strings from tag tables and introduces proper foreign key relationships.

**Status**: ✅ Complete - All migration scripts and model updates created

**Files Changed**: 18
- 4 new Alembic migration files
- 2 ORM model files updated
- 12 code files yet to update (routers, business logic, tests)

---

## What Was Implemented

### 1. Migration Scripts (4 Phases)

Located in `alembic/versions/`:

#### Phase 1: `202601200800_normalize_tagging_phase1_add_fks.py`
- ✅ Adds `tenant_id` column to `keywords` table (nullable during migration)
- ✅ Adds `keyword_id` (FK) columns to:
  - `image_tags`
  - `machine_tags`
  - `permatags`
  - `trained_image_tags`
  - `keyword_models`
- ✅ Adds `person_id` (FK) column to `detected_faces`
- ✅ Creates composite unique constraints on all modified tables

**Downtime**: 0-5 minutes

#### Phase 2: `202601200900_normalize_tagging_phase2_backfill_fks.py`
- ✅ Backfills `tenant_id` on keywords from keyword_categories
- ✅ Backfills `keyword_id` for all tag tables from keyword strings
- ✅ Backfills `person_id` for detected_faces from person names
- ✅ Includes critical pre-conditions and post-conditions documentation

**Downtime**: 0 minutes (can run in background)
**Duration**: 5-60 minutes depending on data volume

#### Phase 3: `202601201000_normalize_tagging_phase3_add_not_null.py`
- ✅ Adds NOT NULL constraints to all `keyword_id` columns
- ✅ Adds NOT NULL constraint to `keywords.tenant_id`
- ✅ Keeps `detected_faces.person_id` nullable (for unmatched faces)
- ✅ Includes pre-flight validation queries

**Downtime**: 0-5 minutes

#### Phase 4: `202601201100_normalize_tagging_phase4_drop_old_cols.py`
- ✅ Drops old denormalized columns:
  - `image_tags`: keyword, category
  - `machine_tags`: keyword, category
  - `permatags`: keyword, category
  - `trained_image_tags`: keyword, category
  - `keyword_models`: keyword
- ✅ Optionally drops `detected_faces.person_name` (commented out for safe fallback)
- ✅ Drops old indexes

**Downtime**: 0-5 minutes (optional, can delay)

---

### 2. ORM Model Updates

#### `src/photocat/metadata/__init__.py`

All tag tables updated to use `keyword_id` (FK) instead of denormalized `keyword` string:

- **ImageTag**: `keyword_id` (FK) - relationships queried via FK joins
- **Permatag**: `keyword_id` (FK) - relationships queried via FK joins
- **MachineTag**: `keyword_id` (FK) - relationships queried via FK joins
- **TrainedImageTag**: `keyword_id` (FK) - relationships queried via FK joins
- **KeywordModel**: `keyword_id` (FK) - relationships queried via FK joins
- **DetectedFace**: Added `person_id` (FK to people table, nullable for unmatched faces)
- **Person**: Added `detected_faces` relationship
- **ImageMetadata**: Added `trained_tags` relationship

**Note on Relationships**: Cross-module SQLAlchemy relationships are avoided to prevent circular imports between `metadata/__init__.py` and `models/config.py`. Keyword lookups are done via FK joins:

```python
# Instead of: image_tag.keyword (via relationship)
# Use: db.query(Keyword).filter(Keyword.id == image_tag.keyword_id).first()
```

#### `src/photocat/models/config.py`

**Keyword**:
```python
# NEW: tenant_id column (String, NOT NULL, indexed)
# NEW: Uniqueness constraint (tenant_id, keyword, category_id)
# Note: Relationships to tag tables are queried via FK joins to avoid circular imports
```

---

## Pre-Deployment Checklist

### 1. Pre-Migration Audit

Before running Phase 1, execute these queries to identify data issues:

```sql
-- Find duplicate keywords per tenant
SELECT keyword, tenant_id, COUNT(*) as count FROM keywords
GROUP BY tenant_id, keyword
HAVING COUNT(*) > 1;

-- Find keywords in tags but not in keywords table
SELECT DISTINCT it.keyword FROM image_tags it
WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.keyword = it.keyword AND k.tenant_id = it.tenant_id)
UNION ALL
SELECT DISTINCT mt.keyword FROM machine_tags mt
WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.keyword = mt.keyword AND k.tenant_id = mt.tenant_id)
UNION ALL
SELECT DISTINCT p.keyword FROM permatags p
WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.keyword = p.keyword AND k.tenant_id = p.tenant_id)
UNION ALL
SELECT DISTINCT tit.keyword FROM trained_image_tags tit
WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.keyword = tit.keyword AND k.tenant_id = tit.tenant_id);

-- Find people in detected_faces but not in people table
SELECT DISTINCT df.person_name FROM detected_faces df
WHERE df.person_name IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM people p WHERE p.name = df.person_name AND p.tenant_id = df.tenant_id);
```

**Action**: If any rows returned, resolve before proceeding to Phase 1.

### 2. Backup Database

```bash
# Backup production database before migrations
make db-backup-prod
```

### 3. Test on Dev/Staging

```bash
# Run migrations on dev
make db-reset-dev
alembic upgrade 202601201100

# Verify data integrity
SELECT COUNT(*) FROM image_tags WHERE keyword_id IS NULL;
SELECT COUNT(*) FROM machine_tags WHERE keyword_id IS NULL;
# etc. (all should return 0)
```

---

## Deployment Strategy

### Option A: Brief Downtime (Recommended)

1. **Announce downtime** (10-70 minutes)
2. **Stop application** (read-only mode or full stop)
3. **Backup database**
4. **Run migrations**:
   ```bash
   alembic upgrade 202601200800  # Phase 1: Add columns
   alembic upgrade 202601200900  # Phase 2: Backfill
   alembic upgrade 202601201000  # Phase 3: Add NOT NULL
   alembic upgrade 202601201100  # Phase 4: Drop old columns
   ```
5. **Deploy updated code** (use keyword_id instead of keyword strings)
6. **Restart application**
7. **Verify**:
   - No NULL keyword_ids
   - Queries execute successfully
   - Log no FK constraint errors

### Option B: Zero-Downtime (Complex)

1. **Deploy code change #1** (dual-write):
   - Writes new tags to both `keyword` and `keyword_id` columns
   - Reads from `keyword_id` if NOT NULL, else `keyword`
2. **Run Phase 1 migration** (no downtime)
3. **Run Phase 2 migration** (background, no downtime)
4. **Monitor**:
   ```bash
   SELECT COUNT(*) FROM image_tags WHERE keyword_id IS NULL;
   ```
5. **Run Phase 3 migration** (brief 0-5 min) when backfill complete
6. **Deploy code change #2** (cleanup):
   - Remove dual-write logic
   - Always use `keyword_id` only
7. **Run Phase 4 migration** (optional, can delay)

---

## Next Steps

### Code Updates Required (Not Yet Implemented)

1. **Router Updates**:
   - `src/photocat/routers/images/tagging.py`
   - `src/photocat/routers/images/permatags.py`
   - `src/photocat/routers/filtering.py`
   - `src/photocat/routers/admin_keywords.py`

2. **Business Logic Updates**:
   - `src/photocat/config/db_config.py` (keyword loading)
   - `src/photocat/tagging.py` (tag insertion)
   - `src/photocat/learning.py` (keyword model training)

3. **Test Updates**:
   - `tests/routers/images/test_tagging.py`
   - `tests/routers/images/test_permatags.py`
   - `tests/test_tagging.py`
   - `tests/test_machine_tags.py`

4. **Frontend Updates** (if needed):
   - `frontend/services/api.js` (if API contract changes)
   - `frontend/components/*.js` (if rendering keyword data)

---

## Key Safeguards Implemented

### ✅ Rollback at Each Phase

- Phase 1 has full downgrade (drops all new columns)
- Phase 2 has downgrade (clears backfilled data)
- Phase 3 has downgrade (reverts NOT NULL constraints)
- Phase 4 has downgrade (re-adds old columns) - lossy but safe

### ✅ Uniqueness Constraints

- New composite unique constraints prevent duplicate tags during backfill
- Keyword uniqueness constraint `(tenant_id, keyword, category_id)` prevents ambiguous lookups

### ✅ Pre-Conditions & Validation

- Phase 2 documents all required pre-conditions
- Phase 3 includes validation query before NOT NULL constraint
- Migration comments flag critical risks and remediation paths

### ✅ Nullable During Transition

- Foreign keys created as nullable (Phase 1)
- Only made NOT NULL after backfill verified (Phase 3)
- Allows gradual rollout and testing

---

## Performance Impact

### Positive Changes

- **Storage**: String duplication eliminated (int IDs instead of 255-char strings)
- **Query Speed**: FK equality checks faster than string matching
- **Index Efficiency**: Smaller indexes on integer IDs
- **Constraints**: Database-level FK ensures referential integrity

### Migration Duration

- Phase 1: ~0-5 min
- Phase 2: ~5-60 min (depends on # tags and query complexity)
- Phase 3: ~0-5 min
- Phase 4: ~0-5 min

**Total**: ~10-70 min downtime (if using Option A)

---

## Verification Queries

### Post-Migration Checks

```sql
-- 1. Verify all foreign keys are populated
SELECT 'image_tags' as table_name, COUNT(*) as null_count FROM image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'machine_tags', COUNT(*) FROM machine_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'permatags', COUNT(*) FROM permatags WHERE keyword_id IS NULL
UNION ALL
SELECT 'trained_image_tags', COUNT(*) FROM trained_image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'keyword_models', COUNT(*) FROM keyword_models WHERE keyword_id IS NULL;

-- 2. Verify keyword uniqueness constraint
SELECT tenant_id, keyword, category_id, COUNT(*) as count FROM keywords
GROUP BY tenant_id, keyword, category_id
HAVING COUNT(*) > 1;

-- 3. Spot check - verify relationship integrity
SELECT COUNT(*) FROM image_tags it
WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.id = it.keyword_id);

-- 4. Verify person_id backfill
SELECT COUNT(*) FROM detected_faces WHERE person_name IS NOT NULL AND person_id IS NULL;
```

All queries should return 0 rows (no issues).

---

## Rollback Plan

If issues arise:

1. **During Phase 1**: Run `alembic downgrade 202601171500`
   - Drops all new columns, returns to pre-migration state
   - No data loss

2. **During Phase 2**:
   - Run `alembic downgrade 202601200800`
   - If needed, re-run Phase 2 after fixing data issues

3. **During Phase 3/4**:
   - Run `alembic downgrade 202601200900` or earlier
   - Re-analyze data, fix issues, re-run

### Debugging

If backfill leaves NULL foreign keys:

```sql
-- Find orphaned tags
SELECT DISTINCT keyword FROM image_tags WHERE keyword_id IS NULL;

-- Option 1: Create missing keywords
INSERT INTO keywords (tenant_id, category_id, keyword, sort_order, created_at)
SELECT it.tenant_id, kc.id, it.keyword, 0, NOW()
FROM (SELECT DISTINCT tenant_id, keyword FROM image_tags WHERE keyword_id IS NULL) it
CROSS JOIN keyword_categories kc
WHERE kc.tenant_id = it.tenant_id
LIMIT 1;  -- Adjust per your category selection logic

-- Option 2: Delete orphaned tags
DELETE FROM image_tags WHERE keyword_id IS NULL;

-- Re-run Phase 2 backfill after fixing
```

---

## Documentation References

- Full design document: [docs/tagging_normalization.md](tagging_normalization.md)
- Migration files: [alembic/versions/202601200*.py](../alembic/versions/)
- Model changes: [src/photocat/models/config.py](../src/photocat/models/config.py), [src/photocat/metadata/__init__.py](../src/photocat/metadata/__init__.py)

---

## Questions & Gotchas

### Q: Why NOT NULL on Phase 3, not Phase 1?

**A**: Phase 1 creates columns as nullable so backfill (Phase 2) can verify data. If Phase 1 made them NOT NULL, any orphaned tags would cause Phase 2 to fail partway, leaving database in inconsistent state.

### Q: What if backfill doesn't populate all foreign keys?

**A**: Check for orphaned keywords/people:
```sql
SELECT DISTINCT keyword FROM image_tags WHERE keyword_id IS NULL;
```

Either INSERT missing keywords or DELETE orphaned tags before Phase 3.

### Q: Can Phase 4 (drop old columns) be delayed?

**A**: Yes! Phase 4 is optional and can be run weeks/months later after you're confident in the migration. This gives you a safety net.

### Q: How do I verify the new schema works?

**A**: After Phase 3, deploy updated code that uses `keyword_id` instead of `keyword` strings. Run integration tests on staging. If successful, deploy to production. Phase 4 (column drop) can wait until you're confident.

### Q: What about existing API responses?

**A**: Update API response serialization to include `keyword_id` alongside `keyword`. Clients can ignore `keyword_id` if not ready. In future, when all clients are migrated, can remove `keyword` from responses.

