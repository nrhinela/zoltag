# People Tagging Architecture - Quick Reference

## Core Concept: Treat People as Special Keywords

```
Person Entity (name, instagram_url, category)
    ↓
Keyword Entry (person_id → keyword_id)
    ↓
MachineTag (tag_type: "manual_person", "detected_face", etc.)
    ↓
Searchable/Filterable Like Regular Keywords
```

---

## Data Model (Simplified)

```
┌─────────────────────────────────────────────────────────┐
│ Person                                                  │
├─────────────────────────────────────────────────────────┤
│ id                                                      │
│ tenant_id                                               │
│ name                                 ← NEW FIELD        │
│ instagram_url                         ← NEW FIELD        │
│ person_category (photo_author|people_in_scene)         │
│ aliases                               (existing)        │
│ face_embedding_ref                    (existing)        │
├─────────────────────────────────────────────────────────┤
│ ↓ ONE-TO-ONE                                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Keyword                                                 │
├─────────────────────────────────────────────────────────┤
│ id                                                      │
│ tenant_id                                               │
│ category_id (FK → KeywordCategory)                      │
│ keyword (person's name in this case)                    │
│ person_id (FK → Person)               ← NEW FIELD       │
│ tag_type ('keyword' | 'person')       ← NEW FIELD       │
├─────────────────────────────────────────────────────────┤
│ ↓ MANY-TO-ONE                                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ MachineTag                                              │
├─────────────────────────────────────────────────────────┤
│ id                                                      │
│ image_id (FK → ImageMetadata)                           │
│ keyword_id (FK → Keyword)   ← Can be person or keyword │
│ tag_type ('manual_person', 'detected_face', 'siglip')  │
│ confidence [0-1]                                        │
│ ... existing fields ...                                 │
└─────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| People → Keywords bridge | Reuse 90% of tagging infrastructure |
| One keyword per person | Simplifies queries, maintains uniqueness |
| tag_type field | Extensible for future (face_detection, etc.) |
| PersonCategory table | Organize people hierarchically |
| Reuse MachineTag | Unified tagging system |

---

## API Examples

### Create Person
```bash
POST /api/v1/people
{
    "name": "Alice Smith",
    "instagram_url": "https://instagram.com/alice",
    "person_category": "photo_author"
}
→ Returns: person_id, keyword_id (auto-created)
```

### Tag Image with Person
```bash
POST /api/v1/images/{id}/people
{
    "person_id": 5
}
→ Creates MachineTag linking image to person's keyword
```

### Search Images by Person
```bash
GET /api/v1/images?filter_people=alice_smith
→ Queries MachineTag where keyword_id = alice's keyword
```

---

## Frontend Components

```
┌─────────────────────────────────────────────┐
│ Admin Panel                                 │
├─────────────────────────────────────────────┤
│ [person-manager.js]                         │
│  ├─ List all people                         │
│  ├─ Create/edit/delete                      │
│  └─ View statistics                         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Image Viewer                                │
├─────────────────────────────────────────────┤
│ [people-tagger.js] (NEW TAB)                │
│  ├─ Photo Author: [Alice ▼]                 │
│  ├─ People in Scene: [Bob, Charlie ▼]      │
│  └─ + Add Person                            │
│                                             │
│ [people-filter-controls.js]                 │
│  └─ Filter by people + category             │
└─────────────────────────────────────────────┘
```

---

## Implementation Timeline

| Phase | Work | Days |
|-------|------|------|
| 1 | Schema + API | 4-6 |
| 2 | Admin UI | 2-3 |
| 3 | Tagging UI | 3-4 |
| 4 | CLI | 1-2 |
| 5 | ML Integration (future) | 5-7 |

---

## What Makes This Elegant

1. **Reuses Everything**
   - Search/filter logic works without changes
   - Tagging UI patterns reusable
   - ML confidence scoring ready to go

2. **Clean Bridge**
   - Person ← [1:1] → Keyword ← [M:1] → MachineTag
   - No table duplication
   - All tags in one place

3. **Extensible**
   - tag_type field handles future detection methods
   - Can add "Location", "Event", "Brand" later
   - Same architectural pattern

4. **Backward Compatible**
   - Old Person/DetectedFace tables still work
   - Keywords unchanged
   - New fields optional

---

## Future Enhancements (Easy)

Once Phase 1-3 complete, easily add:

```
ML Face Detection:
  - Add tag_type: "detected_face"
  - Store in existing MachineTag
  - No schema changes needed

Face Recognition Training:
  - Use existing Person.face_embedding_ref
  - Train from tagged images
  - Apply automatically

Other Entities (Locations, Events):
  - Create Location table
  - Link to Keyword
  - Same tagging pattern
```

---

## Key Files to Modify

```
Backend:
  src/photocat/models/config.py          (+Keyword.person_id, +Keyword.tag_type, +PersonCategory)
  src/photocat/metadata/__init__.py      (+Person.instagram_url, +Person.person_category)
  src/photocat/routers/people.py         (NEW - CRUD + tagging)
  src/photocat/api.py                    (Register router)
  migrations/                             (NEW - schema changes)

Frontend:
  frontend/components/person-manager.js  (NEW)
  frontend/components/people-tagger.js   (NEW)
  frontend/components/person-card.js     (NEW)
  frontend/services/api.js               (Add people endpoints)
  frontend/components/image-modal.js     (Integrate people-tagger tab)

Tests:
  tests/routers/test_people.py           (NEW)
  tests/models/test_person_keyword.py    (NEW)
```

---

## Validation Questions for User

1. ✅ Should person names be unique per tenant? (YES recommended)
2. ✅ Should we auto-sync people from config files? (YES, Phase 4)
3. ✅ Any other person attributes beyond name + instagram? (Add to list)
4. ✅ Face detection in Phase 1 or defer to Phase 5? (Recommend Phase 5)
5. ✅ Support multiple people same category per image? (YES)

---

## Success Metrics

- ✅ People tagged like keywords (manual UI works)
- ✅ People visible in search/filters
- ✅ No keyword regression
- ✅ <500 LOC new code (thanks to reuse!)
- ✅ Ready for future ML

