# Migrations Required for Refactoring Plan

## Summary

**The core refactoring (Phases 1-4) requires NO database schema changes.**

However:
- **Optional index creation** in Phase 2 (performance optimization)
- **Auth Foundation Sprint** requires 1 migration (if you proceed with auth)

---

## Phase 1: Foundation (No migrations)
✅ **No database changes**

- Extract db_utils.py (utilities only, no schema changes)
- Split api.js (frontend, no schema changes)
- Extract filters.js (frontend, no schema changes)
- Extract exif_helpers.py (library code, no schema changes)

---

## Phase 2: Backend Refactoring (Optional indexes)
⚠️ **Optional: Index creation migration**

**Why indexes might be needed**:
The refactored query builder (Phase 2.2) uses SQL subqueries instead of Python set operations. Performance depends on proper indexing:

```python
# These columns will be frequently queried in WHERE clauses
- Keyword.tenant_id (already indexed?)
- PhotoListItem.list_id
- MachineTag.keyword_id
- ImageMetadata.id (for count queries)
```

**Recommendation**: Create migration if not already indexed

**Migration would look like**:
```python
# alembic/versions/202601210000_add_refactoring_indexes.py
def upgrade():
    op.create_index('idx_photo_list_item_list_id', 'photo_list_item', ['list_id'])
    op.create_index('idx_machine_tag_keyword_id', 'machine_tag', ['keyword_id'])
    op.create_index('idx_image_metadata_id', 'image_metadata', ['id'])
    # Only if list_id queries are slow

def downgrade():
    op.drop_index('idx_photo_list_item_list_id')
    op.drop_index('idx_machine_tag_keyword_id')
    op.drop_index('idx_image_metadata_id')
```

**When to run**: After Phase 2 is complete, before deploying to production

**Status**: Optional but recommended for performance

---

## Phase 3: Frontend Refactoring (No migrations)
✅ **No database changes**

- Decompose photocat-app.js (frontend only)
- Extract filter helpers (frontend only)
- Consolidate image editor (frontend only)

---

## Phase 4: Polish & Optimization (No migrations)
✅ **No database changes**

- Add tests (application code, no schema changes)
- Update documentation (no schema changes)
- Performance benchmarking (no schema changes)

---

## Auth Foundation Sprint (1 migration - Optional)
⚠️ **Required ONLY if adding authentication post-refactoring**

**What would be added**:

Create migration `alembic/versions/202602010000_add_auth_tables.py`:

```python
from alembic import op
import sqlalchemy as sa

def upgrade():
    # User profiles (synced from Firebase)
    op.create_table(
        'user_profiles',
        sa.Column('firebase_uid', sa.String(128), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('email_verified', sa.Boolean, default=False),
        sa.Column('display_name', sa.String(255)),
        sa.Column('photo_url', sa.Text),
        sa.Column('is_active', sa.Boolean, default=False),  # Requires admin approval
        sa.Column('is_super_admin', sa.Boolean, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), default=sa.func.now()),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('idx_user_profiles_email', 'user_profiles', ['email'])

    # User-Tenant membership (many-to-many)
    op.create_table(
        'user_tenants',
        sa.Column('id', sa.UUID, primary_key=True, default=sa.func.gen_random_uuid()),
        sa.Column('firebase_uid', sa.String(128), sa.ForeignKey('user_profiles.firebase_uid', ondelete='CASCADE'), nullable=False),
        sa.Column('tenant_id', sa.String(255), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(50), default='user'),  # 'admin', 'user'
        sa.Column('invited_by', sa.String(128), sa.ForeignKey('user_profiles.firebase_uid'), nullable=True),
        sa.Column('invited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), default=sa.func.now()),
        sa.UniqueConstraint('firebase_uid', 'tenant_id'),
    )
    op.create_index('idx_user_tenants_firebase_uid', 'user_tenants', ['firebase_uid'])
    op.create_index('idx_user_tenants_tenant_id', 'user_tenants', ['tenant_id'])

    # Invitations for new users
    op.create_table(
        'invitations',
        sa.Column('id', sa.UUID, primary_key=True, default=sa.func.gen_random_uuid()),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('tenant_id', sa.String(255), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(50), default='user'),
        sa.Column('invited_by', sa.String(128), sa.ForeignKey('user_profiles.firebase_uid'), nullable=False),
        sa.Column('token', sa.String(255), unique=True, nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), default=sa.func.now()),
    )
    op.create_index('idx_invitations_email', 'invitations', ['email'])
    op.create_index('idx_invitations_token', 'invitations', ['token'])

def downgrade():
    op.drop_table('invitations')
    op.drop_table('user_tenants')
    op.drop_table('user_profiles')
```

**When to run**: After Phase 1 completes, before Phase 2 starts (in Auth Foundation Sprint)

**Status**: Optional - only if you're adding authentication

---

## Migration Summary Table

| Phase | Migration | Type | Status | Impact |
|-------|-----------|------|--------|--------|
| 1: Foundation | None | - | ✅ Not needed | Zero |
| 2: Backend | Index creation | Optional | ⚠️ Recommended | Performance improvement 3-4x |
| 3: Frontend | None | - | ✅ Not needed | Zero |
| 4: Polish | None | - | ✅ Not needed | Zero |
| Auth Sprint | Auth tables | Optional | ⚠️ If doing auth | New user management system |

---

## Timeline Impact

### Refactoring Only (No Auth)
```
Phase 1 (3-4 days)
  ↓
Phase 2 (5-7 days) + optional index migration (0.5 day)
  ↓
Phase 3 (4-6 days)
  ↓
Phase 4 (2-3 days)
Total: 14-20 days
```

### Refactoring + Auth Foundation
```
Phase 1 (3-4 days)
  ↓
Auth Foundation (2-3 days) + auth migration (0.5 day)
  ↓
Phase 2 (5-7 days) + optional index migration (0.5 day)
  ↓
Phase 3 (4-6 days)
  ↓
Phase 4 (2-3 days)
Total: 16-23 days
```

---

## Deployment Strategy for Migrations

### If Creating Index Migration (Phase 2)

**Safe deployment approach**:
```bash
# 1. Create migration (non-blocking index creation)
make db-create-migration ENV=prod
# File: alembic/versions/202601210000_add_refactoring_indexes.py

# 2. Test on staging
make db-migrate-dev
make db-migrate-prod  # Will ask for confirmation

# 3. Deploy to production
# - PostgreSQL can create indexes online (non-blocking in PostgreSQL)
# - Monitor index creation (can take time for large tables)
# - Verify query plans improve with EXPLAIN ANALYZE
```

### If Creating Auth Migration (Auth Sprint)

**Safe deployment approach**:
```bash
# 1. Create migration
make db-create-migration ENV=prod
# File: alembic/versions/202602010000_add_auth_tables.py

# 2. Test on staging (create users, test flows)
make db-migrate-dev
# Manually test auth flows on staging

# 3. Deploy to production
make db-migrate-prod

# 4. Deploy auth code
# - API endpoints ready to accept auth
# - Frontend ready with login UI
```

---

## Checklist Before Deploying Migrations

### Phase 2 Index Migration
- [ ] Run EXPLAIN ANALYZE on current queries (baseline)
- [ ] Run index creation migration on staging
- [ ] Verify indexes were created: `SELECT * FROM pg_indexes WHERE tablename = 'photo_list_item'`
- [ ] Run EXPLAIN ANALYZE on same queries (should show index usage)
- [ ] Compare query times before/after (expect improvement)
- [ ] Production migration: run during low-traffic window
- [ ] Monitor index creation progress (for large tables)

### Auth Migration
- [ ] Create migration file with all 3 tables (user_profiles, user_tenants, invitations)
- [ ] Test migration on local dev database
- [ ] Test rollback: `alembic downgrade -1` (should drop tables cleanly)
- [ ] Test on staging database
- [ ] Manually test auth flows (registration, login, invitation)
- [ ] Production migration: run before deploying auth API + UI

---

## Current Alembic Setup

Your project already has Alembic configured:

```
alembic/
├── env.py
├── script.py.mako
├── versions/
│   ├── 202601111700_add_photo_lists.py
│   ├── 202601151800_add_keyword_models.py
│   ├── ...
│   └── 202601201100_normalize_tagging_phase4_drop_old_cols.py
└── alembic.ini
```

**To create a new migration**:
```bash
make db-create-migration ENV=prod
# Enter migration name: "add_refactoring_indexes"
# Or directly:
alembic revision --autogenerate -m "add_refactoring_indexes"
```

---

## Recommendations

### For Refactoring Only
- ✅ **Do create index migration** in Phase 2 (performance impact significant)
- Deploy after Phase 2 complete, before Phase 3 starts

### For Refactoring + Auth
- ✅ **Do create auth migration** in Auth Foundation Sprint
- Deploy after Phase 1 complete, before Phase 2 starts
- ✅ **Do create index migration** in Phase 2
- Deploy after Phase 2 complete

---

## Questions to Clarify

1. **Performance baseline**: Should we measure query performance before Phase 1 starts?
2. **Index creation**: Do you want automatic index creation during Phase 2, or manual review first?
3. **Auth timing**: Will you do Auth Foundation Sprint, or defer auth work?
4. **Staging validation**: Should index/auth migrations be tested on staging first?

---

## Related Documents

- REFACTORING_ROADMAP.md - Main refactoring plan
- AUTH_AND_REFACTORING_ROADMAP.md - Auth coordination strategy
- docs/DEPLOYMENT.md - Deployment procedures (includes migration commands)
