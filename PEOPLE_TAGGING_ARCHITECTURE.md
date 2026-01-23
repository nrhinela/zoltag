# People Tagging Architecture Proposal

**Goal**: Add ability to tag people to images, reusing existing keyword/tagging infrastructure where possible, while allowing for future ML-based person detection/recognition.

---

## 1. Problem Analysis

### Current State
- **Keywords infrastructure**: Fully built (categories, keywords, ML tagging via SigLIP/CLIP)
- **Person model**: Exists but only used for face detection (DetectedFace for bounding boxes)
- **Tagging infrastructure**: Highly generic (MachineTag with keyword_id FK)
- **Categories**: Only used for keywords, not extensible to people

### Key Constraints
1. Need to tag people in two categories: **Photo Author** and **People in Scene**
2. Should reuse keyword/tagging infrastructure (avoid duplication)
3. Need to support future ML models (face recognition, person detection)
4. Attributes per person: name, instagram_url

---

## 2. Proposed Architecture

### 2.1 Data Model Strategy

#### Approach: Hybrid Model Using Existing Keywords Infrastructure

**Reuse keywords infrastructure by treating people as a special keyword category.**

Instead of creating parallel tables/tagging, extend the existing system:

```
Person Entity
├── Attributes: id, name, instagram_url, person_category (enum)
└── Keywords Bridge: Each person generates keyword entries automatically

Keyword Entry
├── Type: "person" (new type flag)
├── Links to: Person.id
└── Integrates with: Existing MachineTag infrastructure
```

#### New Schema

**1. Extend Person model** (`src/photocat/metadata/__init__.py`):

```python
class Person(Base):
    """Known people for tagging and facial recognition."""

    __tablename__ = "people"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(255), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)

    # Attributes
    name = Column(String(255), nullable=False, index=True)
    instagram_url = Column(String(512), nullable=True)
    person_category = Column(String(50), nullable=False)  # 'photo_author' or 'people_in_scene'

    # Legacy face recognition (kept for backward compatibility)
    aliases = Column(JSONB, default=list)
    face_embedding_ref = Column(String(255))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="people")
    detected_faces = relationship("DetectedFace", back_populates="person")
    keyword = relationship("Keyword", back_populates="person", uselist=False)  # ONE-TO-ONE
```

**2. Extend Keyword model** (`src/photocat/models/config.py`):

```python
class Keyword(Base):
    """Individual keyword within a category."""

    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey('keyword_categories.id', ondelete='CASCADE'), nullable=False, index=True)

    keyword = Column(String(100), nullable=False)
    prompt = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)

    # NEW: Person linking (NULL for regular keywords)
    person_id = Column(Integer, ForeignKey('people.id', ondelete='CASCADE'), nullable=True, unique=True)

    # NEW: Tag type (default 'keyword', can be 'person', etc. for future expansion)
    tag_type = Column(String(20), nullable=False, server_default='keyword')

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    category = relationship("KeywordCategory", back_populates="keywords")
    person = relationship("Person", back_populates="keyword")

    __table_args__ = (
        Index("idx_keywords_tenant_keyword_category", "tenant_id", "keyword", "category_id", unique=True),
        Index("idx_keywords_person_id", "person_id"),
    )
```

**3. Introduce Person Categories** (`src/photocat/models/config.py`):

```python
class PersonCategory(Base):
    """Categories for organizing people (Photo Author, People in Scene, etc.)"""

    __tablename__ = "person_categories"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(50), nullable=False, index=True)

    name = Column(String(50), nullable=False)  # 'photo_author', 'people_in_scene', etc.
    display_name = Column(String(100), nullable=False)  # 'Photo Author', 'People in Scene'

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    people = relationship("Person", back_populates="category")
    keyword_category = relationship("KeywordCategory", back_populates="person_category", uselist=False)

    __table_args__ = (
        Index("idx_person_categories_tenant_name", "tenant_id", "name", unique=True),
    )
```

**4. Link PersonCategory to KeywordCategory**:

```python
class KeywordCategory(Base):
    """Keyword category for organizing tags hierarchically."""

    __tablename__ = "keyword_categories"

    # ... existing fields ...

    # NEW: Link to person category (NULL for regular keyword categories)
    person_category_id = Column(Integer, ForeignKey('person_categories.id', ondelete='CASCADE'), nullable=True, unique=True)

    # NEW: Mark if this is a people category
    is_people_category = Column(Boolean, nullable=False, server_default=text('false'))

    # Relationships
    person_category = relationship("PersonCategory", back_populates="keyword_category")
```

### 2.2 Tagging Workflow

#### Workflow 1: Manual People Tagging

```
User selects people in UI
    ↓
API: POST /images/{id}/tags
    ├── Tag type: "person"
    ├── Person ID: <person_id>
    └── Category: "manual" or "permatag"
    ↓
Backend:
    1. Look up Person → Get keyword_id
    2. Create MachineTag with:
       - keyword_id: <from person's keyword>
       - tag_type: "manual_person"
       - image_id, tenant_id, confidence
    3. Update image.tags_applied = true
    ↓
Frontend: Display people tags with person avatar/name
```

#### Workflow 2: ML-Based Face Detection (Future)

```
Image uploaded
    ↓
Face detection model (DeepFace, InsightFace, etc.)
    ↓
For each detected face:
    1. Extract face encoding
    2. Compare against known person encodings
    3. If match: Create DetectedFace + MachineTag
       - tag_type: "detected_face" (or "facerecognition")
       - person_id → keyword_id → MachineTag.keyword_id
    4. Store with confidence score
    ↓
User can: confirm, reject, or assign to different person
```

#### Workflow 3: Hybrid Training (Future)

```
User has manually tagged many images with people
    ↓
Build person-specific ML model:
    1. Gather face encodings from DetectedFace records
    2. Train lightweight classifier for each person
    3. Store trained embeddings in Person.face_embedding_ref
    ↓
Reapply to new images:
    1. Extract face from image
    2. Compare to all trained person embeddings
    3. Create MachineTag if confident match
```

### 2.3 Database Schema Changes (Migration)

```sql
-- New table: person_categories
CREATE TABLE person_categories (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    name VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, name),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Alter keyword_categories table
ALTER TABLE keyword_categories
ADD COLUMN person_category_id INTEGER REFERENCES person_categories(id) ON DELETE CASCADE,
ADD COLUMN is_people_category BOOLEAN DEFAULT FALSE,
ADD UNIQUE(person_category_id);

-- Alter keywords table
ALTER TABLE keywords
ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
ADD COLUMN tag_type VARCHAR(20) DEFAULT 'keyword',
ADD UNIQUE(person_id),
ADD INDEX idx_keywords_person_id(person_id);

-- Alter people table
ALTER TABLE people
ADD COLUMN instagram_url VARCHAR(512),
ADD COLUMN person_category VARCHAR(50) NOT NULL DEFAULT 'people_in_scene';

-- Ensure MachineTag can store person tags (already flexible)
-- No changes needed - tag_type already supports extensibility
```

---

## 3. API Design

### 3.1 People Management Endpoints

```python
# Create person
POST /api/v1/people
{
    "name": "Alice Smith",
    "instagram_url": "https://instagram.com/alice",
    "person_category": "photo_author"  # or "people_in_scene"
}
→ 201 { id, name, instagram_url, person_category, keyword_id, created_at }

# List people
GET /api/v1/people?person_category=photo_author
→ 200 [{ id, name, instagram_url, person_category, tag_count, ... }]

# Get person details
GET /api/v1/people/{id}
→ 200 { id, name, instagram_url, person_category, aliases, face_embedding_ref, keyword_id, ... }

# Update person
PUT /api/v1/people/{id}
{
    "name": "Alice Smith",
    "instagram_url": "https://instagram.com/alice_smith"
}
→ 200 { id, name, instagram_url, person_category, ... }

# Delete person
DELETE /api/v1/people/{id}
→ 204

# Get person statistics
GET /api/v1/people/{id}/stats
→ 200 { total_images, manual_tags, detected_faces, last_tagged_at, ... }
```

### 3.2 Image Tagging with People

```python
# Tag image with person (manual)
POST /api/v1/images/{id}/people
{
    "person_id": 123,
    "category": "manual"  # or "permatag"
}
→ 201 { machine_tag_id, keyword_id, person_id, confidence: 1.0, tag_type: "manual_person" }

# Tag image with detected face (future)
POST /api/v1/images/{id}/people
{
    "detected_face_id": 456,
    "person_id": 123,
    "action": "confirm"  # or "assign", "reject"
}

# Get people tags for image
GET /api/v1/images/{id}/people
→ 200 {
    "photo_author": [
        { id, person_id, name, instagram_url, confidence, tag_type, ... }
    ],
    "people_in_scene": [
        { id, person_id, name, instagram_url, confidence, tag_type, ... }
    ]
}

# Remove person tag
DELETE /api/v1/images/{id}/people/{person_id}
→ 204
```

### 3.3 Configuration Endpoints

```python
# Get person categories configuration
GET /api/v1/config/people/categories
→ 200 [
    {
        "id": 1,
        "name": "photo_author",
        "display_name": "Photo Author",
        "keyword_category_id": 10,
        "people_count": 25
    }
]

# Initialize default person categories (admin only)
POST /api/v1/admin/tenants/{id}/init-people-categories
→ 201 { created: ["photo_author", "people_in_scene"] }
```

---

## 4. Frontend Components

### 4.1 New Lit Components

**1. person-manager.js** (Admin-only)
- List all people for tenant
- Create/edit/delete people
- Manage person categories
- View tagging statistics

**2. people-tagger.js** (In image viewer)
- Autocomplete search for people
- Tag people to images
- Support for multiple people per category
- Quick-add new person dialog
- Face detection UI (future)

**3. person-card.js** (Reusable)
- Display person name, avatar, instagram link
- Remove tag button
- Confidence indicator (for ML tags)

**4. people-filter-controls.js** (In image gallery)
- Filter by people tags
- Search by person name
- Category filters (photo_author, people_in_scene)

### 4.2 UI Integration Points

**In existing image-modal.js**:
```javascript
// Add tab: "Tags" (existing)
// Add tab: "People" (new)
// Content:
// - Person categories with chips
// - Add person dropdown
// - Remove person buttons
// - ML confidence badges (future)
```

**In existing filter-controls.js**:
```javascript
// Add new filter section:
// "People in Scene" - autocomplete search
// "Photo Author" - autocomplete search
// Apply AND/OR logic to search
```

---

## 5. Implementation Phases

### Phase 1: Data Model & Backend API (4-6 days)
- [x] Design Person schema extensions
- [ ] Create database migrations
- [ ] Implement CRUD endpoints for people
- [ ] Implement people tagging endpoints
- [ ] Add configuration endpoints
- [ ] Tests for API

### Phase 2: Frontend - Person Management (2-3 days)
- [ ] person-manager.js component
- [ ] person-card.js component
- [ ] Admin UI for people management
- [ ] Integration with admin-app.js

### Phase 3: Frontend - Image Tagging (3-4 days)
- [ ] people-tagger.js component
- [ ] Integration into image-modal.js
- [ ] peoples-filter-controls.js
- [ ] Filter logic and search

### Phase 4: CLI Integration (1-2 days)
- [ ] `retag` command support for people
- [ ] `recompute-trained-tags` for people
- [ ] Export/backup people data

### Phase 5: ML Enhancements (Future, 5-7 days each)
- [ ] Face detection model integration
- [ ] Face recognition training
- [ ] Automatic face-to-person matching

---

## 6. Reusability Strategy

### What We Reuse
1. **MachineTag table** - Unified tagging with tag_type field
2. **KeywordCategory** - Organizational hierarchy (now supports people categories)
3. **ML tagging pipeline** - SigLIP/CLIP infrastructure (extensible for people)
4. **Tagging UI patterns** - Filter, search, apply tags pattern
5. **Confidence scoring** - Existing MachineTag.confidence field
6. **Training infrastructure** - Can repurpose for person-specific models

### What's New
1. **Person entity** - Extends metadata with name, instagram_url
2. **PersonCategory** - New level of organization
3. **tag_type extension** - "manual_person", "detected_face", etc.
4. **Person-keyword linking** - Bridge between people and tagging system

### Future Extensibility
- Easy to add other entity types: "Location", "Event", "Brand"
- Just add new tables and link via Keyword
- Reuse entire tagging pipeline

---

## 7. Backward Compatibility

✅ **No breaking changes**:
- Existing keywords still work unchanged
- MachineTag remains generic (tag_type is already flexible)
- All new fields are optional/nullable
- Person detection continues to work for faces

---

## 8. Data Flow Examples

### Example 1: Manual Tagging

```
User Interface:
  Image viewer shows photo
  → User clicks "Add People"
  → Autocomplete search shows "Alice Smith"
  → User selects "Photo Author" category
  → Click "Add"

Backend:
  1. POST /images/123/people { person_id: 5 }
  2. Lookup: Person(5) → keyword_id: 42
  3. Create MachineTag(
       image_id=123,
       keyword_id=42,
       tag_type="manual_person",
       confidence=1.0,
       category="photo_author"  # from person's category
     )
  4. Return { person_id: 5, name: "Alice Smith", ... }

Display:
  Image shows badge: "Alice Smith" [instagram icon] [delete button]
  Tag appears in "Photo Author" section
```

### Example 2: Face Detection (Future)

```
Image uploaded
  → Face detection model finds 2 faces
  → Extraction: 2 face encodings

For each face:
  1. Compare to Person.face_embedding_ref
  2. Best match: Bob (92% confidence)
  3. Create DetectedFace(image_id=123, person_id=6, bbox=...)
  4. Create MachineTag(
       image_id=123,
       keyword_id=43,  # Person(6).keyword_id
       tag_type="detected_face",
       confidence=0.92,
       category="people_in_scene"
     )

Display:
  Image shows box with person name
  User can: [Confirm] [Change Person] [Reject]
  If confirmed → Set MachineTag.tag_type = "manual_person"
```

### Example 3: Search & Filter

```
User UI:
  Filter panel: "People in Scene" = "Alice Smith"
  → API: GET /images?filter_people_in_scene=alice_smith

Backend:
  1. Get keyword_id for Alice in "people_in_scene" category
  2. Query images:
     SELECT DISTINCT i.* FROM image_metadata i
     JOIN machine_tags mt ON i.id = mt.image_id
     WHERE mt.keyword_id = ?
     AND mt.tag_type IN ('manual_person', 'detected_face', ...)

Display:
  Only images tagged with Alice Smith in "People in Scene"
```

---

## 9. Configuration File Integration

The existing config system can automatically sync people:

```yaml
# config/mytenant/config.yaml
people:
  - name: "Alice Smith"
    instagram_url: "https://instagram.com/alice"
    category: "photo_author"
  - name: "Bob Jones"
    instagram_url: "https://instagram.com/bob"
    category: "people_in_scene"

# CLI command to load:
# photocat init-people --tenant-id mytenant
```

---

## 10. Testing Strategy

### Unit Tests
- Person CRUD operations
- Keyword-Person linking
- Tag creation with people
- Category organization

### Integration Tests
- Full flow: Create person → Tag image → Search
- Face detection (mocked)
- Conflict resolution (same person, different categories)

### API Tests
- All endpoints (CRUD, tagging, search)
- Validation (duplicate names, invalid URLs)
- Permission checks (tenant isolation)

---

## 11. Success Criteria

✅ People can be created and managed
✅ Images can be tagged with people manually
✅ People appear as tags in keyword infrastructure
✅ People can be filtered/searched in gallery
✅ No impact on existing keyword tagging
✅ Architecture supports future ML enhancements
✅ Reuses 80%+ of existing tagging infrastructure

---

## 12. Comparison: Alternative Approaches

### ❌ Approach A: Parallel System (Rejected)
- Separate tables: ImagePerson (like Permatag)
- Pro: Clean separation
- Con: Duplicated tagging logic, separate UI, harder to unify

### ❌ Approach B: Generic Entity Tags (Rejected)
- Super-generic "EntityTag" table
- Pro: Maximum flexibility
- Con: Over-engineered, harder to optimize queries

### ✅ Approach C: Keywords-as-Bridge (Selected)
- Use Keyword as bridge between Person and MachineTag
- Pro: Reuses existing infrastructure (90% savings)
- Con: Slight schema complexity (mitigated by one-to-one relationship)

---

## 13. Migration Path from Face Detection to People

If we later want to phase out the old `Person` + `DetectedFace` approach:

```python
# Step 1: Create person-specific keywords (this proposal)
# Step 2: Migrate detected faces to MachineTag
# Step 3: Deprecate DetectedFace (keep for backward compat)
# Step 4: Remove DetectedFace in v2.0

Benefits:
- All data converges to unified MachineTag table
- Simpler queries
- Easier to consolidate with keywords
```

---

## Summary

This architecture:
- **Reuses 90% of existing infrastructure** (MachineTag, keyword tagging, search)
- **Keeps schemas lightweight** (person_id → keyword_id → machine_tags)
- **Enables future ML** (face recognition, person detection)
- **Maintains backward compatibility** (no breaking changes)
- **Scales cleanly** (can extend to locations, events, brands)
- **Integrates seamlessly** (people appear in existing search/filter)

The key insight: **Treat people as a special type of keyword category**, allowing them to be tagged exactly like keywords, while maintaining Person entity with rich metadata (instagram_url, etc.).

