# Tagging Data Model Normalization Design

## Executive Summary

The current tagging system stores keyword and category information redundantly across multiple tables (`image_tags`, `machine_tags`, `permatags`, `trained_image_tags`, `detected_faces`, `keyword_models`). This design duplicates data and violates database normalization principles.

This document outlines a comprehensive refactoring to normalize the tagging schema by introducing proper foreign key relationships to `keywords` and `keyword_categories` tables, eliminating denormalized string storage of keyword/category names.

**Impact**: ~15 tables/migration scripts, ~8 API/business logic modules, significant query optimization opportunity

---

## Current State Analysis

### Tables Storing Denormalized Keywords/Categories

| Table | Stores | Issue |
|-------|--------|-------|
| `image_tags` | `keyword` (string), `category` (string) | Manual tags, duplicates category hierarchy |
| `machine_tags` | `keyword` (string), `category` (string) | Auto-generated tags, duplicates hierarchy |
| `permatags` | `keyword` (string), `category` (string) | Human-verified tags, duplicates hierarchy |
| `trained_image_tags` | `keyword` (string), `category` (string) | ML model output, duplicates hierarchy |
| `keyword_models` | `keyword` (string) | Trained model metadata, no relationship to keywords table |
| `detected_faces` | `person_name` (string) | Facial recognition, duplicates people table |

### Keyword/Category Authority Tables

| Table | Purpose | Structure |
|-------|---------|-----------|
| `keyword_categories` | Category hierarchy | id, tenant_id, name, parent_id |
| `keywords` | Individual keywords | id, category_id, keyword, prompt |
| `people` | Known people for facial recognition | id, tenant_id, name, aliases |

### Current Problem: Denormalization Examples

```sql
-- Current: Storing full category path + keyword
INSERT INTO image_tags (image_id, keyword, category)
VALUES (123, 'sunset', 'Photography/Landscapes');

-- Problem: If "Photography/Landscapes" is renamed or restructured,
-- you must update all image_tags records
-- Also: "Photography/Landscapes" is computed from keyword_categories hierarchy
```

### Query Patterns Affected

1. **Finding all keywords in a category**: Must parse `category` string or query `keyword_categories`
2. **Changing keyword hierarchy**: Requires updating multiple tag tables
3. **Analytics**: Requires JOIN on keyword name instead of ID
4. **Soft-deletes**: Can't easily mark categories/keywords as deprecated
5. **Audit trail**: No relationship tracking for when keywords change

---

## Proposed Solution: Full Normalization

### Schema Changes

#### 1. Rename/Reorganize Keyword Authority Tables

Create a consistent naming convention:

```python
# Current: models/config.py defines KeywordCategory and Keyword
# New: Define central models in metadata/__init__.py alongside other tag models

class KeywordCategory(Base):
    __tablename__ = "keyword_categories"
    id: int (PK)
    tenant_id: str (FK)
    name: str
    parent_id: int (FK to self, nullable)
    sort_order: int
    created_at, updated_at

class Keyword(Base):
    __tablename__ = "keywords"
    id: int (PK)
    category_id: int (FK to keyword_categories)
    tenant_id: str (FK) [ADD]
    keyword: str
    prompt: str (nullable, for custom tagging prompts)
    sort_order: int
    created_at, updated_at
```

**Change**: Add `tenant_id` to `keywords` table for direct tenant filtering (currently inferred via category)

**IMPORTANT**: Add uniqueness constraint `(tenant_id, keyword, category_id)` to prevent the same keyword string from appearing in multiple categories within a tenant. This is critical for:
- Unambiguous backfill during migration (JOIN on keyword text won't mis-assign)
- Predictable lookups (keyword + tenant → unique keyword_id)
- Preventing user confusion (keyword "sunset" should not exist in both "Photography" and "Travel" categories)

**Implementation**: Add to Keyword model:
```python
__table_args__ = (
    Index("idx_keywords_tenant_keyword_category", "tenant_id", "keyword", "category_id", unique=True),
)
```

This constraint should be enforced **before** Phase 1 migration. If existing keywords violate this, merge duplicates or rename one variant.

#### 2. Normalize Tag Tables

**Before**:
```python
class ImageTag(Base):
    image_id: int (FK)
    keyword: str  # ← Denormalized
    category: str # ← Denormalized
    confidence: float
    manual: bool
```

**After**:
```python
class ImageTag(Base):
    image_id: int (FK to image_metadata)
    keyword_id: int (FK to keywords) # ← Normalized
    confidence: float
    manual: bool  # Keep as-is for backward compatibility
```

**Note on `manual` field**: The existing `manual: bool` field indicates whether a tag was user-applied vs. AI-generated. Do NOT add a redundant `source` field—reuse the existing boolean. If in the future you need more granular sourcing (e.g., "manual", "siglip", "clip"), refactor to a dedicated `source: str` field and migrate data accordingly, but for now keep the existing schema.

Similar changes for:
- `machine_tags`: Replace `keyword`, `category` with `keyword_id`
- `permatags`: Replace `keyword`, `category` with `keyword_id`
- `trained_image_tags`: Replace `keyword`, `category` with `keyword_id`

#### 3. Normalize Facial Recognition

**Before**:
```python
class DetectedFace(Base):
    person_name: str # ← Denormalized
```

**After**:
```python
class DetectedFace(Base):
    person_id: int (FK to people, nullable) # ← Normalized, nullable for unmatched faces
    person_name: str # ← Fallback for unmatched detections
```

#### 4. Normalize Keyword Models

**Before**:
```python
class KeywordModel(Base):
    keyword: str # ← Denormalized
```

**After**:
```python
class KeywordModel(Base):
    keyword_id: int (FK to keywords) # ← Normalized
```

---

## Migration Strategy

### Phase 1: Add New Columns (No Deletions)

Create a migration script `alembic/versions/202601XX_normalize_tagging_add_fks.py`:

```python
def upgrade():
    # Add tenant_id to keywords (if not already present)
    op.add_column('keywords', sa.Column('tenant_id', sa.String(255), nullable=True))
    op.create_index('idx_keywords_tenant_id', 'keywords', ['tenant_id'])

    # Add keyword_id columns to tag tables
    op.add_column('image_tags', sa.Column('keyword_id', sa.Integer,
                  sa.ForeignKey('keywords.id'), nullable=True))
    op.add_column('machine_tags', sa.Column('keyword_id', sa.Integer,
                  sa.ForeignKey('keywords.id'), nullable=True))
    op.add_column('permatags', sa.Column('keyword_id', sa.Integer,
                  sa.ForeignKey('keywords.id'), nullable=True))
    op.add_column('trained_image_tags', sa.Column('keyword_id', sa.Integer,
                  sa.ForeignKey('keywords.id'), nullable=True))

    # Add person_id to detected_faces
    op.add_column('detected_faces', sa.Column('person_id', sa.Integer,
                  sa.ForeignKey('people.id'), nullable=True))

    # Add keyword_id to keyword_models
    op.add_column('keyword_models', sa.Column('keyword_id', sa.Integer,
                  sa.ForeignKey('keywords.id'), nullable=True))

    # Create composite unique constraints
    op.create_unique_constraint(
        'uq_image_tags_normalized',
        'image_tags',
        ['image_id', 'keyword_id']
    )

    # Similar constraints for other tag tables
    op.create_unique_constraint(
        'uq_machine_tags_normalized',
        'machine_tags',
        ['image_id', 'keyword_id', 'tag_type', 'model_name']
    )

    op.create_unique_constraint(
        'uq_trained_image_tags_normalized',
        'trained_image_tags',
        ['image_id', 'keyword_id', 'model_name']
    )

    op.create_unique_constraint(
        'uq_permatags_normalized',
        'permatags',
        ['image_id', 'keyword_id']  # Implicit: only one approval/rejection state per image-keyword pair
    )
```

**Rationale**: These constraints prevent duplicate tags during and after migration. They're critical if:
- Application does dual-write (writes to both old keyword string and new keyword_id)
- Backfill is re-run
- Manual SQL repairs occur

**Existing constraints to preserve**: The `machine_tags` table already has a unique constraint on `(tenant_id, image_id, keyword, tag_type, model_name)`. After migration, this becomes redundant with the new PK constraint, and can be dropped in Phase 4.

### Phase 2: Backfill Foreign Keys

Create script `alembic/versions/202601XX_normalize_tagging_backfill_fks.py`:

```python
def upgrade():
    # Populate keyword_id for image_tags
    op.execute("""
    UPDATE image_tags it
    SET keyword_id = k.id
    FROM keywords k
    WHERE k.keyword = it.keyword
    AND it.tenant_id = k.tenant_id
    """)

    # Populate keyword_id for machine_tags
    # **CRITICAL**: This join only matches on keyword text + tenant.
    # If the same keyword exists in multiple categories (which should not happen
    # with the new uniqueness constraint), the JOIN will be ambiguous.
    #
    # Remediation:
    # 1. Before Phase 1 migration, add uniqueness constraint to keywords table
    # 2. Audit existing keywords: find duplicates with `SELECT keyword, COUNT(*) FROM keywords
    #    GROUP BY tenant_id, keyword HAVING COUNT(*) > 1`
    # 3. If found: rename one or merge into single category
    #
    op.execute("""
    UPDATE machine_tags mt
    SET keyword_id = k.id
    FROM keywords k
    WHERE k.keyword = mt.keyword
    AND mt.tenant_id = k.tenant_id
    """)

    # Similar for permatags, trained_image_tags, keyword_models

    # Populate person_id for detected_faces
    op.execute("""
    UPDATE detected_faces df
    SET person_id = p.id
    FROM people p
    WHERE p.name = df.person_name
    AND df.tenant_id = p.tenant_id
    """)

    # Backfill tenant_id for keywords
    op.execute("""
    UPDATE keywords k
    SET tenant_id = kc.tenant_id
    FROM keyword_categories kc
    WHERE k.category_id = kc.id
    """)
```

### Phase 3: Add NOT NULL Constraints

Create script `alembic/versions/202601XX_normalize_tagging_add_not_null.py`:

```python
def upgrade():
    # Make foreign keys NOT NULL
    op.alter_column('image_tags', 'keyword_id', existing_type=sa.Integer(), nullable=False)
    op.alter_column('machine_tags', 'keyword_id', existing_type=sa.Integer(), nullable=False)
    # ... etc

    # Make tenant_id NOT NULL on keywords
    op.alter_column('keywords', 'tenant_id', existing_type=sa.String(), nullable=False)
```

**CRITICAL PRE-CONDITION FOR PHASE 3**:
Before running this phase, verify that ALL rows have been successfully backfilled:
```sql
-- Check for NULL keyword_id in each table
SELECT 'image_tags' as table_name, COUNT(*) as null_count FROM image_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'machine_tags', COUNT(*) FROM machine_tags WHERE keyword_id IS NULL
UNION ALL
SELECT 'permatags', COUNT(*) FROM permatags WHERE keyword_id IS NULL
UNION ALL
SELECT 'trained_image_tags', COUNT(*) FROM trained_image_tags WHERE keyword_id IS NULL;
```

If any NULL values remain:
- **Option A (Recommended)**: Identify the keyword string in that row and INSERT it into the `keywords` table if missing, then re-run the Phase 2 backfill UPDATE
- **Option B**: DELETE rows with NULL keyword_id (will lose those tags, but ensures data integrity)
- **Option C**: Add a manual step in Phase 2 to review and resolve orphaned tags before proceeding to Phase 3

Do NOT proceed to Phase 3 if any NULL keyword_ids exist—the ALTER COLUMN will fail and roll back the migration.

### Phase 4: Drop Old Columns

Create script `alembic/versions/202601XX_normalize_tagging_drop_old_cols.py`:

```python
def upgrade():
    # Drop old denormalized columns
    op.drop_column('image_tags', 'keyword')
    op.drop_column('image_tags', 'category')
    op.drop_column('machine_tags', 'keyword')
    op.drop_column('machine_tags', 'category')
    # ... etc

    # Update detected_faces to drop person_name if all backfilled
    # Or keep person_name as fallback for unmatched faces
```

---

## Code Changes Required

### 1. ORM Model Updates (`src/photocat/metadata/__init__.py`)

**ImageTag**:
```python
class ImageTag(Base):
    __tablename__ = "image_tags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=False)  # NEW
    confidence = Column(Float)
    manual = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    image = relationship("ImageMetadata", back_populates="tags")
    keyword = relationship("Keyword", back_populates="image_tags")  # NEW
```

**MachineTag**:
```python
class MachineTag(Base):
    __tablename__ = "machine_tags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=False)  # NEW
    confidence = Column(Float, nullable=False)
    tag_type = Column(String(50), nullable=False, index=True)
    model_name = Column(String(100), nullable=False)
    model_version = Column(String(50))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    image = relationship("ImageMetadata", back_populates="machine_tags")
    keyword = relationship("Keyword", back_populates="machine_tags")  # NEW
```

**Permatag**:
```python
class Permatag(Base):
    __tablename__ = "permatags"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id", ondelete="CASCADE"), nullable=False)
    keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=False)  # NEW
    signum = Column(Integer, nullable=False)  # -1 = rejected, 1 = approved
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255))

    # Relationships
    image = relationship("ImageMetadata", back_populates="permatags")
    keyword = relationship("Keyword", back_populates="permatags")  # NEW
```

**DetectedFace**:
```python
class DetectedFace(Base):
    __tablename__ = "detected_faces"

    id = Column(Integer, primary_key=True)
    image_id = Column(Integer, ForeignKey("image_metadata.id"), nullable=False)
    person_id = Column(Integer, ForeignKey("people.id"), nullable=True)  # NEW (nullable for unmatched)
    confidence = Column(Float)
    bbox_top, bbox_right, bbox_bottom, bbox_left = Column(Integer) # ...
    face_encoding = Column(ARRAY(Float))
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    image = relationship("ImageMetadata", back_populates="faces")
    person = relationship("Person", back_populates="detected_faces")  # NEW
```

**Keyword** (`models/config.py` → `metadata/__init__.py`):
```python
class Keyword(Base):
    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey('keyword_categories.id'), nullable=False, index=True)
    tenant_id = Column(String(255), nullable=False, index=True)  # ADD
    keyword = Column(String(100), nullable=False)
    prompt = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    category = relationship("KeywordCategory", back_populates="keywords")
    image_tags = relationship("ImageTag", back_populates="keyword")  # NEW
    machine_tags = relationship("MachineTag", back_populates="keyword")  # NEW
    permatags = relationship("Permatag", back_populates="keyword")  # NEW
    trained_tags = relationship("TrainedImageTag", back_populates="keyword")  # NEW
    keyword_models = relationship("KeywordModel", back_populates="keyword")  # NEW
```

**Person** (add back_populates):
```python
class Person(Base):
    __tablename__ = "people"

    # ... existing fields ...

    # Relationships
    tenant = relationship("Tenant", back_populates="people")
    detected_faces = relationship("DetectedFace", back_populates="person")  # NEW
```

### 2. Router Updates

**`src/photocat/routers/images/tagging.py`**:
- Change: Query keywords by keyword_id instead of keyword string
- Change: When applying tags, look up keyword_id from keyword table first
- Change: Response serialization now includes keyword name via relationship

```python
# Before
tag_results = [{
    "keyword": keyword,  # string
    "category": category_path,  # string
    "confidence": conf
}]

# After
tag_results = [{
    "keyword_id": kw.id,  # FK
    "keyword": kw.keyword,  # string (from relationship)
    "category": category_path,  # string (computed from relationship)
    "confidence": conf
}]
```

**`src/photocat/routers/images/permatags.py`**:
- Change: `add_permatag()` now looks up keyword_id by keyword string + tenant
- Change: `get_permatags()` returns keyword details via relationship

```python
# Before
permatag = Permatag(
    image_id=image_id,
    keyword=keyword,  # string
    category=category
)

# After
kw = db.query(Keyword).filter(
    Keyword.tenant_id == tenant.id,
    Keyword.keyword == keyword
).first()
if not kw:
    raise HTTPException(status_code=400, detail="Keyword not found")

permatag = Permatag(
    image_id=image_id,
    keyword_id=kw.id  # FK
)
```

**`src/photocat/routers/filtering.py`**:
- Change: Filtering by keyword now uses keyword_id instead of string matching
- Change: Example:

```python
# Before
def filter_by_keyword(...):
    return db.query(ImageMetadata.id).filter(
        MachineTag.keyword == keyword_str
    )

# After
def filter_by_keyword(db, tenant, keyword_str):
    kw = db.query(Keyword).filter_by(tenant_id=tenant.id, keyword=keyword_str).first()
    if not kw:
        return set()
    return db.query(ImageMetadata.id).join(MachineTag).filter(
        MachineTag.keyword_id == kw.id
    )
```

**`src/photocat/config/db_config.py`**:
- Change: `get_all_keywords()` now returns keyword_id alongside keyword/category
- Change: Ensure keywords are fetched with category path computation

### 3. Image Processing Logic

**`src/photocat/image/__init__.py`** and **`src/photocat/learning.py`** (if tagging code):
- Change: When inserting machine_tags, resolve keyword string → keyword_id
- Change: When training keyword models, use keyword_id

### 4. Tests

**`tests/routers/images/test_tagging.py`**:
- Update all tag assertions to check keyword_id instead of keyword string
- Update mock data to use keyword_id

**`tests/routers/images/test_permatags.py`**:
- Similar updates to assertions

**`tests/test_tagging.py`**:
- Update test fixtures to use normalized schema

---

## Affected Files

### Schema/Migrations
- ✏️ Create: `alembic/versions/202601XX_normalize_tagging_add_fks.py`
- ✏️ Create: `alembic/versions/202601XX_normalize_tagging_backfill_fks.py`
- ✏️ Create: `alembic/versions/202601XX_normalize_tagging_add_not_null.py`
- ✏️ Create: `alembic/versions/202601XX_normalize_tagging_drop_old_cols.py`

### Python Models
- ✏️ `src/photocat/metadata/__init__.py` (move + enhance keyword models, add relationships)
- ✏️ `src/photocat/models/config.py` (remove or keep for backward compat, import from metadata)

### Routers
- ✏️ `src/photocat/routers/images/tagging.py`
- ✏️ `src/photocat/routers/images/permatags.py`
- ✏️ `src/photocat/routers/filtering.py`
- ✏️ `src/photocat/routers/admin_keywords.py`

### Business Logic
- ✏️ `src/photocat/config/db_config.py` (update keyword loading)
- ✏️ `src/photocat/image/__init__.py` (if tagging happens here)
- ✏️ `src/photocat/learning.py` (update keyword model training)
- ✏️ `src/photocat/tagging.py` (update tag insertion logic)

### Tests
- ✏️ `tests/routers/images/test_tagging.py`
- ✏️ `tests/routers/images/test_permatags.py`
- ✏️ `tests/test_tagging.py`
- ✏️ `tests/test_machine_tags.py`

### Frontend (if consuming keyword data)
- ✏️ `frontend/components/*.js` (if rendering keyword strings, may need keyword_id)
- ✏️ `frontend/services/api.js` (if API contracts change)

---

## Benefits

### Correctness
- ✅ Single source of truth for keywords/categories
- ✅ Enforced referential integrity at database level
- ✅ Eliminates keyword/category mismatches

### Maintainability
- ✅ Renaming keyword/category updates in one place
- ✅ Deleting unused keywords (soft-delete) prevents orphaned tags
- ✅ Cleaner ORM relationships for lazy loading

### Performance
- ✅ Smaller storage footprint (int ID vs repeated strings)
- ✅ Faster filtering by keyword_id (int comparison vs string)
- ✅ Can add keyword indexing strategies (e.g., popularity, deprecation flags)
- ✅ Easier to implement soft-deletes on keywords

### Future Capabilities
- ✅ Add keyword lifecycle (active/deprecated/archived)
- ✅ Track keyword history/renames
- ✅ Implement keyword deprecation with automatic remapping
- ✅ Add keyword synonyms with proper normalization

---

## Critical Design Decisions & Gotchas

### 1. Keyword Uniqueness Per Tenant & Category

**Decision**: Add uniqueness constraint `(tenant_id, keyword, category_id)` on the keywords table.

**Why**: Without it, the same keyword string can exist in multiple categories, making backfill ambiguous. For example, if "sunset" appears in both "Photography/Landscapes" and "Travel/Sunsets", a JOIN on keyword text alone cannot determine which keyword_id to assign to a tag.

**Action Required Before Phase 1**:
- Audit existing keywords for duplicates:
  ```sql
  SELECT keyword, COUNT(*) as count FROM keywords
  GROUP BY tenant_id, keyword
  HAVING COUNT(*) > 1;
  ```
- If found, resolve by merging or renaming duplicates
- Only then add the uniqueness constraint
- Enforce in application logic: reject attempts to create keywords with duplicate names in a tenant

### 2. Backfill Ambiguity & Orphaned Tags

**Risk**: If a tag references a keyword that doesn't exist in the keywords table (data inconsistency), the backfill UPDATE will leave `keyword_id` as NULL.

**Example**: A tag has `keyword="sunset"` but no `Keyword(keyword="sunset")` exists in the keywords table.

**Prevention**:
1. Before Phase 1, validate that every distinct (keyword, category) pair referenced in tag tables has a corresponding row in keywords table
2. If gaps exist: either INSERT missing keywords or DELETE orphaned tags
3. Automate this check:
   ```sql
   -- Find keywords in tags but not in keywords table
   SELECT DISTINCT mt.keyword FROM machine_tags mt
   WHERE NOT EXISTS (SELECT 1 FROM keywords k WHERE k.keyword = mt.keyword AND k.tenant_id = mt.tenant_id);
   ```

**Remediation During Phase 3**: Before making keyword_id NOT NULL, query for NULL keyword_id and either:
- Backfill the missing keywords and re-run Phase 2 UPDATE, OR
- Delete the orphaned tags

Do not proceed with Phase 3 if NULLs remain.

### 3. Application Writes During Phase 2 Backfill

**Risk**: If the app writes new tags while Phase 2 is running, those new rows will have `keyword_id = NULL` (they bypass the backfill UPDATE).

**Solution**:
- **Option A (Recommended)**: Stop writes during Phase 2 (enable read-only mode or stop application)
- **Option B**: Implement dual-write logic: code writes to both `keyword` and `keyword_id` columns, allowing backfill and new writes to coexist

See "Deployment" section for detailed strategies.

---

## Risk Mitigation

### Risk 1: Migration Complexity
**Mitigation**: Four-phase migration allows rollback at each stage. Phase 2 (backfill) can be tested in non-prod first.

### Risk 2: Query Performance During Migration
**Mitigation**: Phase 3 (NOT NULL) only occurs after backfill completes. Dual-column queries work during transition.

### Risk 3: API Breaking Changes
**Mitigation**: Response format change (keyword string → keyword_id + keyword string). Frontend can ignore new id field if not needed.

### Risk 4: Unmatched Keywords During Backfill
**Mitigation**: If a tag references a keyword that doesn't exist in keyword table, backfill leaves keyword_id as NULL. Manual review needed; can INSERT missing keywords or DELETE orphaned tags.

---

## Rollout Plan

### Pre-Deployment
1. Backup production database
2. Test migration on dev environment
3. Test migration on staging environment
4. Measure backfill performance (if >1M tags, may need batch processing)

### Deployment

**Important**: If the application writes tags during Phase 2 backfill, you MUST use one of these strategies:

#### Strategy A: No Writes During Phase 2 (Safest)
1. Stop application / enable read-only mode
2. Run Phase 1 migration (add columns) - ~0-5 min
3. Run Phase 2 migration (backfill) - ~5-60 min
4. Re-start application
5. Deploy updated code that uses keyword_id
6. Run Phase 3 migration (add NOT NULL) - ~0-5 min
7. Run Phase 4 migration (drop old columns) - ~0-5 min (optional, can delay)

**Total downtime**: ~10-70 min

#### Strategy B: Dual-Write (If Downtime Unacceptable)
1. Deploy **code change ONLY** (no migrations yet): Write new tags to BOTH `keyword` and `keyword_id` columns
   - When inserting a tag, resolve keyword string → keyword_id and write both
   - Read queries use keyword_id if NOT NULL, else fall back to keyword string
2. Run Phase 1 migration (add columns) - no downtime
3. Run Phase 2 migration (backfill existing rows) - ~5-60 min, runs in background
4. Run Phase 3 migration (add NOT NULL) - ~0-5 min, only happens after backfill is verified complete
5. Deploy code cleanup (remove dual-write logic, use keyword_id only)
6. Run Phase 4 migration (drop old columns) - ~0-5 min

**Total downtime**: ~0-5 min (only Phase 3)

**Risk**: If dual-write code has a bug, keyword_id may diverge from keyword string, causing confusion. Mitigation: Add checksums and monitoring to verify sync.

**Recommendation**: Use **Strategy A** unless downtime is a hard constraint. The additional complexity of Strategy B rarely justifies the risk.

### Monitoring
- Alert on queries with NULL keyword_id
- Monitor response times for tag queries
- Track backfill completion status

---

## Implementation Order

1. **Design review** (this document)
2. **Phase 1-2 migrations** (add FKs, backfill)
3. **ORM model updates** (add relationships)
4. **Router updates** (tagging.py, permatags.py, filtering.py)
5. **Business logic updates** (config manager, learning)
6. **Test updates** (fix assertions)
7. **Phase 3-4 migrations** (NOT NULL, drop old columns)
8. **Deployment** (staging → production)
9. **Frontend updates** (if needed)

---

## Backward Compatibility Notes

- API responses can include both `keyword` (string) and `keyword_id` during transition
- Consumers can ignore `keyword_id` field if not ready to migrate
- Internal filters should migrate to keyword_id-based queries immediately
