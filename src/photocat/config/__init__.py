"""Configuration models for tenant-specific settings."""

from typing import List
from pathlib import Path

from pydantic import BaseModel, Field
import yaml


class KeywordCategory(BaseModel):
    """Hierarchical keyword category."""
    
    name: str
    keywords: List[str | dict] = Field(default_factory=list)  # Can be string or dict with prompt
    subcategories: List["KeywordCategory"] = Field(default_factory=list)
    is_attribution: bool = False


class Person(BaseModel):
    """Person for facial recognition."""
    
    name: str
    aliases: List[str] = Field(default_factory=list)
    face_embedding_ref: str | None = None  # Reference to stored embedding


class TenantConfig(BaseModel):
    """In-memory tenant configuration."""

    keywords: List[KeywordCategory] = Field(default_factory=list)
    people: List[Person] = Field(default_factory=list)

    def get_all_keywords(self) -> List[dict]:
        """Flatten all keywords from hierarchical structure with category info."""
        result = []

        def extract_keywords(category: KeywordCategory, parent_path: str = "") -> None:
            category_path = f"{parent_path}/{category.name}" if parent_path else category.name
            for keyword in category.keywords:
                # Handle both string and dict formats
                if isinstance(keyword, str):
                    result.append({
                        'keyword': keyword,
                        'category': category_path
                    })
                elif isinstance(keyword, dict):
                    result.append({
                        'keyword': keyword['keyword'],
                        'category': category_path,
                        'prompt': keyword.get('prompt')
                    })
            for subcat in category.subcategories:
                extract_keywords(subcat, category_path)

        for category in self.keywords:
            extract_keywords(category)

        return result

    def get_person_by_name(self, name: str) -> Person | None:
        """Find person by name or alias."""
        name_lower = name.lower()
        for person in self.people:
            if person.name.lower() == name_lower:
                return person
            if any(alias.lower() == name_lower for alias in person.aliases):
                return person
        return None

    @classmethod
    def load(cls, tenant_id: str, config_root: Path) -> "TenantConfig":
        """Load tenant config from YAML files under <config_root>/<tenant_id>/."""
        tenant_dir = Path(config_root) / tenant_id
        if not tenant_dir.exists():
            raise FileNotFoundError(f"Tenant config directory not found: {tenant_dir}")

        keywords_path = tenant_dir / "keywords.yaml"
        people_path = tenant_dir / "people.yaml"

        keyword_payload = yaml.safe_load(keywords_path.read_text()) if keywords_path.exists() else []
        people_payload = yaml.safe_load(people_path.read_text()) if people_path.exists() else []

        def _parse_category(raw: dict) -> KeywordCategory:
            return KeywordCategory(
                name=raw.get("name", ""),
                keywords=raw.get("keywords", []) or [],
                subcategories=[_parse_category(sub) for sub in (raw.get("subcategories", []) or [])],
                is_attribution=bool(raw.get("is_attribution", False)),
            )

        keywords = [
            _parse_category(entry)
            for entry in (keyword_payload or [])
            if isinstance(entry, dict)
        ]
        people = [
            Person(
                name=entry.get("name", ""),
                aliases=entry.get("aliases", []) or [],
                face_embedding_ref=entry.get("face_embedding_ref"),
            )
            for entry in (people_payload or [])
            if isinstance(entry, dict)
        ]
        return cls(keywords=keywords, people=people)


# Enable forward references for recursive model
KeywordCategory.model_rebuild()
