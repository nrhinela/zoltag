# People Tagging - Quick Start Guide

## Overview

People tagging allows you to tag individuals in photos. Each person is automatically integrated with PhotoCat's existing tagging infrastructure through the keyword system.

## Key Concepts

**Person**: Individual with name, instagram URL, and category (Photo Author or People in Scene)

**Keyword**: Bridge connecting Person to MachineTag (existing tagging system)

**Tag**: Manual assignment of a person to an image with confidence score

**Tag Type**: `manual_person` = manually tagged, `detected_face` = detected by ML (future)

## API Quick Reference

### Initialize Default Categories

```bash
POST /api/v1/config/people/categories/initialize
```

Call once per tenant to create:
- `photo_author`: Person who took the photo
- `people_in_scene`: People appearing in photo

---

### Person Management

#### Create Person

```bash
POST /api/v1/people
{
    "name": "Alice Smith",
    "instagram_url": "https://instagram.com/alice",
    "person_category": "photo_author"
}
```

Returns: Person object with auto-created keyword_id

#### List People

```bash
GET /api/v1/people?person_category=photo_author&limit=50&skip=0
```

Returns: Array of PersonResponse objects

#### Get Person Details

```bash
GET /api/v1/people/{person_id}
```

Returns: Single PersonResponse with tag_count

#### Update Person

```bash
PUT /api/v1/people/{person_id}
{
    "instagram_url": "https://instagram.com/alice_new"
}
```

Returns: Updated PersonResponse

#### Delete Person

```bash
DELETE /api/v1/people/{person_id}
```

Returns: `{"status": "deleted", "person_id": 5}`

#### Get Statistics

```bash
GET /api/v1/people/{person_id}/stats
```

Returns: PersonStatsResponse (images tagged, dates, etc.)

---

### Image Tagging

#### Tag Person on Image

```bash
POST /api/v1/images/{image_id}/people
{
    "person_id": 5,
    "confidence": 1.0
}
```

**Note**: Confidence 1.0 = manual tag, lower values for uncertain tags

Returns: PersonTagResponse with tag details

#### Get People Tags on Image

```bash
GET /api/v1/images/{image_id}/people
```

Returns: ImagePeopleTagsResponse with all people tagged

#### Remove Person Tag

```bash
DELETE /api/v1/images/{image_id}/people/{person_id}
```

Returns: `{"status": "deleted", "person_id": 5, "deleted_count": 1}`

#### Update Tag Confidence

```bash
PUT /api/v1/images/{image_id}/people/{person_id}
{
    "confidence": 0.95
}
```

Returns: Updated PersonTagResponse

---

### Configuration

#### List Person Categories

```bash
GET /api/v1/config/people/categories
```

Returns: Array of PersonCategoryResponse objects

#### Initialize Categories

```bash
POST /api/v1/config/people/categories/initialize
```

Safe to call multiple times (idempotent)

---

## Common Workflows

### 1. Set Up People Tagging (One Time)

```bash
# Initialize default categories
curl -X POST http://localhost:8000/api/v1/config/people/categories/initialize \
  -H "X-Tenant-ID: my-tenant"

# Create people
curl -X POST http://localhost:8000/api/v1/people \
  -H "X-Tenant-ID: my-tenant" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "instagram_url": "https://instagram.com/alice",
    "person_category": "photo_author"
  }'
```

### 2. Tag People in Batch

```bash
# Get all people
PEOPLE=$(curl http://localhost:8000/api/v1/people -H "X-Tenant-ID: my-tenant")

# For each image, tag relevant people
for PERSON_ID in 5 6 7; do
  curl -X POST http://localhost:8000/api/v1/images/123/people \
    -H "X-Tenant-ID: my-tenant" \
    -H "Content-Type: application/json" \
    -d "{\"person_id\": $PERSON_ID, \"confidence\": 1.0}"
done
```

### 3. Find Images with Specific Person

```bash
# Step 1: Get person's keyword_id
curl http://localhost:8000/api/v1/people/5 -H "X-Tenant-ID: my-tenant"
# Response includes keyword_id

# Step 2: Search using existing search API
# (Already works! Uses standard keyword search)
```

### 4. Update Person Information

```bash
# Update name and instagram URL
curl -X PUT http://localhost:8000/api/v1/people/5 \
  -H "X-Tenant-ID: my-tenant" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Smith",
    "instagram_url": "https://instagram.com/alice_smith"
  }'

# Note: Keyword name auto-syncs with person name
```

### 5. Remove All Tags for a Person

```bash
# Get all images with person tagged
# For each image: DELETE /api/v1/images/{id}/people/{person_id}

# Or delete the person entirely (cascades to all tags)
curl -X DELETE http://localhost:8000/api/v1/people/5 \
  -H "X-Tenant-ID: my-tenant"
```

---

## Database Schema

```sql
-- New table
person_categories
├── id (PK)
├── tenant_id
├── name (unique per tenant)
└── display_name

-- Extended tables
people
├── ... (existing fields)
├── instagram_url (NEW, nullable)
└── person_category (NEW, defaults to 'people_in_scene')

keywords
├── ... (existing fields)
├── person_id (NEW, nullable, unique)
└── tag_type (NEW, defaults to 'keyword')
   └── Can be: 'keyword', 'person', 'detected_face', etc.

keyword_categories
├── ... (existing fields)
├── person_category_id (NEW, nullable, unique)
└── is_people_category (NEW, defaults to false)

-- Uses existing table (no changes)
machine_tags
├── ... (existing fields)
└── Connects to people via keyword
```

---

## Integration with Existing Features

### Search

```python
# Existing search finds people tags automatically!
# People tags are stored in machine_tags with tag_type='manual_person'
db.query(MachineTag).filter(
    MachineTag.keyword_id == person_keyword_id
).all()
```

### Filters

```python
# Filter by person (works with existing filters)
# tag_type='manual_person' distinguishes manual from detected

# Future ML detection can add:
# tag_type='detected_face' with confidence < 1.0
```

### Export

```python
# Person tags export like keyword tags
# Already integrated with existing export infrastructure
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| 404 Not Found | Person/image doesn't exist | Check IDs |
| 409 Conflict | Person already exists | Use different name or check existing person |
| 400 Bad Request | Invalid category pattern | Use `^[a-z_]+$` format |
| 500 Server Error | Database transaction failed | Check logs, retry |

### Status Codes

- `200 OK`: Successful GET/PUT
- `201 Created`: Successful POST (create endpoints return 200 for compatibility)
- `204 No Content`: Successful DELETE
- `400 Bad Request`: Invalid input
- `404 Not Found`: Resource not found
- `409 Conflict`: Duplicate person name
- `500 Internal Server Error`: Database error

---

## Testing

### Run Tests

```bash
# Test people CRUD
pytest tests/test_people_api.py -v

# Test image tagging
pytest tests/routers/images/test_people_tagging.py -v

# Run all with coverage
pytest tests/test_people_api.py tests/routers/images/test_people_tagging.py --cov
```

### Manual Testing

```bash
# Create person
curl -X POST http://localhost:8000/api/v1/people \
  -H "X-Tenant-ID: test" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","person_category":"people_in_scene"}'

# Tag on image (image_id=1, person_id=1)
curl -X POST http://localhost:8000/api/v1/images/1/people \
  -H "X-Tenant-ID: test" \
  -H "Content-Type: application/json" \
  -d '{"person_id":1,"confidence":1.0}'

# Get tags on image
curl http://localhost:8000/api/v1/images/1/people \
  -H "X-Tenant-ID: test"

# Remove tag
curl -X DELETE http://localhost:8000/api/v1/images/1/people/1 \
  -H "X-Tenant-ID: test"
```

---

## Best Practices

### Person Categories

Use snake_case for category names:
- ✅ `photo_author`
- ✅ `people_in_scene`
- ✅ `friend`
- ❌ `Photo Author` (invalid characters)
- ❌ `friend Of Photographer` (spaces)

### Confidence Scores

- `1.0` = Manual tag (certain)
- `0.8-0.99` = High confidence (confident but slightly uncertain)
- `0.5-0.79` = Medium confidence (might need review)
- `0.1-0.49` = Low confidence (probably uncertain, for ML detection)

### Performance

- Use pagination: `?limit=50&skip=0`
- Filter by category when possible
- Reuse person objects instead of creating duplicates
- Batch operations when possible

### Tenant Isolation

- Always provide `X-Tenant-ID` header
- No cross-tenant queries possible
- Data is strictly isolated per tenant
- Credentials stored securely per tenant

---

## Limitations & Roadmap

### Current Limitations

- Manual tagging only (ML face detection in Phase 5)
- No bulk import/export
- No tag history/audit trail
- No confidence score visualization

### Future Features (Roadmap)

- **Phase 5**: ML face detection with tag_type='detected_face'
- **Phase 6**: Frontend UI components (person manager, tagger)
- **Phase 7**: CLI integration
- **Phase 8**: Bulk import/export
- **Phase 9**: Tag history and audit trail
- **Phase 10**: Advanced search filters

---

## Support

### Where to Get Help

- **Architecture**: See `PEOPLE_TAGGING_ARCHITECTURE.md`
- **Implementation**: See `PEOPLE_TAGGING_IMPLEMENTATION.md`
- **Code**: See `src/photocat/routers/people.py`
- **Tests**: See `tests/test_people_api.py`

### Reporting Issues

When reporting issues, include:
- API endpoint used
- Request payload
- Response status code and body
- Tenant ID
- Steps to reproduce

---

## Summary

People tagging is fully integrated with PhotoCat's existing infrastructure. Use the `/api/v1/people/*` endpoints to manage people, and `/api/v1/images/{id}/people/*` to tag them on images.

All people tags work seamlessly with existing search, filter, and export features!
