# ORM Relationships After Tagging Normalization

## Overview

After the tagging normalization migration, the ORM models use foreign key relationships to `Keyword` and `Person` tables. However, due to the structure of the PhotoCat codebase (multiple declarative bases in different modules), SQLAlchemy relationships are NOT defined across modules to avoid circular imports.

Instead, relationships are handled via explicit FK joins at query time.

---

## Pattern: Querying Related Records

### Finding Keywords for a Tag

```python
from photocat.metadata import ImageTag
from photocat.models.config import Keyword
from sqlalchemy.orm import Session

def get_image_tag_with_keyword(db: Session, image_tag_id: int):
    """Get ImageTag with its associated Keyword."""
    tag = db.query(ImageTag).filter(ImageTag.id == image_tag_id).first()
    if tag:
        keyword = db.query(Keyword).filter(Keyword.id == tag.keyword_id).first()
        return {
            "tag_id": tag.id,
            "image_id": tag.image_id,
            "keyword": keyword.keyword if keyword else None,
            "category_id": keyword.category_id if keyword else None,
        }
    return None
```

### Finding All Tags for a Keyword

```python
from photocat.metadata import ImageTag, MachineTag, Permatag
from photocat.models.config import Keyword
from sqlalchemy.orm import Session

def get_all_tags_for_keyword(db: Session, keyword_id: int, tag_type: str = 'all'):
    """Get all tags for a keyword (across all tag types)."""
    results = {}

    if tag_type in ['image', 'all']:
        results['image_tags'] = db.query(ImageTag).filter(
            ImageTag.keyword_id == keyword_id
        ).all()

    if tag_type in ['machine', 'all']:
        results['machine_tags'] = db.query(MachineTag).filter(
            MachineTag.keyword_id == keyword_id
        ).all()

    if tag_type in ['permatag', 'all']:
        results['permatags'] = db.query(Permatag).filter(
            Permatag.keyword_id == keyword_id
        ).all()

    return results
```

### Finding Detected Faces for a Person

```python
from photocat.metadata import DetectedFace
from photocat.models.config import Keyword  # This is now Person, adjust import
from sqlalchemy.orm import Session

def get_detected_faces_for_person(db: Session, person_id: int):
    """Get all detected faces for a person."""
    # This one CAN use the relationship since both are in metadata/__init__.py
    faces = db.query(DetectedFace).filter(
        DetectedFace.person_id == person_id
    ).all()
    return faces
```

---

## Best Practices

### 1. Always Use Explicit FK Joins

When querying across `metadata` and `models.config` modules:

```python
# ✅ GOOD: Explicit FK join
keyword = db.query(Keyword).filter(Keyword.id == image_tag.keyword_id).first()

# ❌ BAD: Would not work (no relationship defined)
# keyword = image_tag.keyword  # AttributeError!
```

### 2. Use Joins for Complex Queries

For queries that span multiple tables:

```python
from sqlalchemy import and_

# Find all machine tags for a specific keyword in a tenant
tags = db.query(MachineTag).join(
    Keyword, Keyword.id == MachineTag.keyword_id
).filter(
    and_(
        Keyword.tenant_id == 'demo',
        Keyword.keyword == 'sunset'
    )
).all()
```

### 3. Eager Loading with Explicit Joins

```python
from sqlalchemy.orm import joinedload

# Load tags with their keywords in one query
tags = db.query(ImageTag).join(
    Keyword, Keyword.id == ImageTag.keyword_id
).options(
    joinedload(ImageTag.image)  # This relationship IS defined
).all()

for tag in tags:
    print(f"Tag: {tag.keyword_id}, Image: {tag.image.filename}")
```

### 4. Avoid N+1 Query Problem

Use explicit joins to avoid fetching keywords one-at-a-time:

```python
# ❌ BAD: N+1 queries
tags = db.query(ImageTag).all()
for tag in tags:
    keyword = db.query(Keyword).filter(Keyword.id == tag.keyword_id).first()
    print(keyword.keyword)

# ✅ GOOD: Single query with join
tags = db.query(ImageTag).join(
    Keyword, Keyword.id == ImageTag.keyword_id
).all()

# Or use eager loading with subqueries
from sqlalchemy.orm import contains_eager
tags = db.query(ImageTag).join(Keyword).options(
    contains_eager(ImageTag.image),  # If you also need images
).all()
```

---

## Module Structure Reference

### `src/photocat/metadata/__init__.py` (Declarative Base 1)
- `ImageTag`
- `MachineTag`
- `TrainedImageTag`
- `Permatag`
- `DetectedFace` (CAN use relationship to `Person`)
- `Person` (CAN use relationship to `DetectedFace`)
- `ImageMetadata` (CAN use relationships to image tags)

**Relationships within this module work normally.**

### `src/photocat/models/config.py` (Declarative Base 2)
- `Keyword`
- `KeywordCategory`
- `PhotoList`
- `PhotoListItem`

**Relationships within this module work normally.**

### Cross-Module Relationships
**❌ NOT DEFINED** to avoid circular imports and import-time errors:
- `Keyword` → `ImageTag` / `MachineTag` / `Permatag` / `TrainedImageTag` / `KeywordModel`
- `ImageTag` / `MachineTag` / etc. → `Keyword`

**✅ Use explicit FK joins instead** (see examples above).

---

## Migration Impact on Existing Queries

### Before Normalization

```python
# Old way (using denormalized strings)
tags = db.query(ImageTag).filter(ImageTag.keyword == 'sunset').all()
```

### After Normalization

```python
# New way (using keyword_id FK)
sunset_kw = db.query(Keyword).filter(Keyword.keyword == 'sunset').first()
tags = db.query(ImageTag).filter(ImageTag.keyword_id == sunset_kw.id).all()

# Or in one query with join
tags = db.query(ImageTag).join(
    Keyword, Keyword.id == ImageTag.keyword_id
).filter(Keyword.keyword == 'sunset').all()
```

---

## Performance Considerations

### Index Efficiency

The new schema includes indexes on all `keyword_id` columns:
```sql
-- Automatically created by migrations
idx_image_tags_keyword_id: (keyword_id)
idx_machine_tags_keyword_id: (keyword_id)
idx_permatags_keyword_id: (keyword_id)
idx_trained_image_tags_keyword_id: (keyword_id)
idx_keyword_models_keyword_id: (keyword_id)
```

This makes FK joins efficient (integer comparisons instead of string matching).

### Composite Indexes

Use these for common query patterns:

```python
# Query: All machine tags for a keyword in a tenant
# Index: (tenant_id, keyword_id, tag_type)
tags = db.query(MachineTag).filter(
    and_(
        MachineTag.tenant_id == 'demo',
        MachineTag.keyword_id == 42,
        MachineTag.tag_type == 'siglip'
    )
).all()
```

---

## Troubleshooting

### Error: "ImageTag has no attribute 'keyword'"

```python
# ❌ This will fail after normalization
keyword = image_tag.keyword

# ✅ Use FK lookup instead
keyword = db.query(Keyword).filter(Keyword.id == image_tag.keyword_id).first()
```

### Error: "Foreign Key Constraint Violation"

If you get FK constraint errors during data operations:

1. Ensure `keyword_id` is populated (not NULL)
2. Ensure referenced `Keyword.id` actually exists
3. Check uniqueness constraint on `(tenant_id, keyword, category_id)` isn't violated

```python
# Validate FK exists before insert
keyword = db.query(Keyword).filter(Keyword.id == keyword_id).first()
if not keyword:
    raise ValueError(f"Keyword {keyword_id} does not exist")

# Then insert
tag = ImageTag(image_id=img_id, keyword_id=keyword_id)
db.add(tag)
db.commit()
```

---

## Testing

When writing tests for FK-based queries:

```python
import pytest
from sqlalchemy.orm import Session
from photocat.metadata import ImageTag
from photocat.models.config import Keyword

def test_image_tag_with_keyword(db: Session):
    """Test querying ImageTag with its Keyword."""
    # Setup
    keyword = Keyword(tenant_id='test', category_id=1, keyword='sunset')
    db.add(keyword)
    db.flush()  # Ensure keyword.id is populated

    tag = ImageTag(image_id=1, keyword_id=keyword.id)
    db.add(tag)
    db.commit()

    # Query with FK join
    result = db.query(ImageTag).join(
        Keyword, Keyword.id == ImageTag.keyword_id
    ).filter(Keyword.keyword == 'sunset').first()

    assert result is not None
    assert result.keyword_id == keyword.id
```

---

## Further Reading

- [SQLAlchemy Relationships Docs](https://docs.sqlalchemy.org/en/20/orm/relationships.html)
- [Declarative Base](https://docs.sqlalchemy.org/en/20/orm/declarative_config.html)
- [Query Performance](https://docs.sqlalchemy.org/en/20/orm/session_basics.html#selecting-rows-with-select)
