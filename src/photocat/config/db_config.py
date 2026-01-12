"""Database-backed configuration manager with YAML fallback."""

from pathlib import Path
from typing import List, Dict, Optional
import yaml

from sqlalchemy.orm import Session

from photocat.models.config import KeywordCategory as DBKeywordCategory, Keyword as DBKeyword
from photocat.metadata import Person as DBPerson
from photocat.config import TenantConfig as YAMLConfig, KeywordCategory, Person


class ConfigManager:
    """Manage tenant configuration with database primary, YAML fallback."""
    
    def __init__(self, session: Session, tenant_id: str):
        """Initialize config manager."""
        self.session = session
        self.tenant_id = tenant_id
        self._config_dir = Path("config")
    
    def get_all_keywords(self) -> List[dict]:
        """Get all keywords from database or YAML fallback."""
        # Try database first
        db_keywords = self._get_keywords_from_db()
        if db_keywords:
            return db_keywords
        
        # Fallback to YAML
        yaml_config = self._load_yaml_fallback()
        return yaml_config.get_all_keywords() if yaml_config else []
    
    def get_people(self) -> List[dict]:
        """Get all people from database or YAML fallback."""
        # Try database first
        db_people = self._get_people_from_db()
        if db_people:
            return db_people
        
        # Fallback to YAML
        yaml_config = self._load_yaml_fallback()
        if yaml_config:
            return [{"id": None, "name": p.name, "aliases": p.aliases} for p in yaml_config.people]
        return []
    
    def get_person_by_name(self, name: str) -> Optional[dict]:
        """Find person by name or alias."""
        name_lower = name.lower()
        
        # Try database first
        person = self.session.query(DBPerson).filter(
            DBPerson.tenant_id == self.tenant_id,
            DBPerson.name.ilike(name)
        ).first()
        
        if person:
            return person.to_dict()
        
        # Check aliases in database
        people = self.session.query(DBPerson).filter(
            DBPerson.tenant_id == self.tenant_id
        ).all()
        
        for person in people:
            if person.aliases and any(alias.lower() == name_lower for alias in person.aliases):
                return person.to_dict()
        
        # Fallback to YAML
        yaml_config = self._load_yaml_fallback()
        if yaml_config:
            person = yaml_config.get_person_by_name(name)
            if person:
                return {"id": None, "name": person.name, "aliases": person.aliases}
        
        return None
    
    def save_keywords(self, categories_data: List[dict]) -> None:
        """Save keyword structure to database."""
        # Delete existing keywords for tenant
        self.session.query(DBKeywordCategory).filter(
            DBKeywordCategory.tenant_id == self.tenant_id
        ).delete()
        
        # Create new structure
        for cat_data in categories_data:
            self._create_category(cat_data, None)
        
        self.session.commit()
    
    def save_people(self, people_data: List[dict]) -> None:
        """Save people to database."""
        # Delete existing people for tenant
        self.session.query(DBPerson).filter(
            DBPerson.tenant_id == self.tenant_id
        ).delete()
        
        # Create new people
        for person_data in people_data:
            person = DBPerson(
                tenant_id=self.tenant_id,
                name=person_data['name'],
                aliases=person_data.get('aliases', []),
                face_embedding_ref=person_data.get('face_embedding_ref')
            )
            self.session.add(person)
        
        self.session.commit()
    
    def migrate_from_yaml(self) -> bool:
        """Migrate YAML configuration to database."""
        yaml_config = self._load_yaml_fallback()
        if not yaml_config:
            return False
        
        # Migrate keywords
        categories_data = []
        for category in yaml_config.keywords:
            categories_data.append(self._category_to_dict(category))
        
        self.save_keywords(categories_data)
        
        # Migrate people
        people_data = [
            {
                "name": p.name,
                "aliases": p.aliases,
                "face_embedding_ref": p.face_embedding_ref
            }
            for p in yaml_config.people
        ]
        self.save_people(people_data)
        
        return True
    
    def _get_keywords_from_db(self) -> List[dict]:
        """Fetch keywords from database."""
        categories = self.session.query(DBKeywordCategory).filter(
            DBKeywordCategory.tenant_id == self.tenant_id,
            DBKeywordCategory.parent_id == None
        ).order_by(DBKeywordCategory.sort_order).all()
        
        if not categories:
            return []
        
        result = []
        for category in categories:
            self._extract_keywords_recursive(category, "", result)
        
        return result
    
    def _extract_keywords_recursive(self, category: DBKeywordCategory, parent_path: str, result: List[dict]):
        """Recursively extract keywords with category paths."""
        category_path = f"{parent_path}/{category.name}" if parent_path else category.name
        
        for keyword in sorted(category.keywords, key=lambda k: k.sort_order):
            result.append({
                'keyword': keyword.keyword,
                'category': category_path,
                'prompt': keyword.prompt
            })
        
        for subcat in sorted(category.subcategories, key=lambda c: c.sort_order):
            self._extract_keywords_recursive(subcat, category_path, result)
    
    def _get_people_from_db(self) -> List[dict]:
        """Fetch people from database."""
        people = self.session.query(DBPerson).filter(
            DBPerson.tenant_id == self.tenant_id
        ).all()
        
        return [p.to_dict() for p in people]
    
    def _load_yaml_fallback(self) -> Optional[YAMLConfig]:
        """Load YAML configuration as fallback."""
        try:
            return YAMLConfig.load(self.tenant_id, self._config_dir)
        except FileNotFoundError:
            return None
    
    def _create_category(self, cat_data: dict, parent_id: Optional[int]) -> DBKeywordCategory:
        """Recursively create category and keywords."""
        category = DBKeywordCategory(
            tenant_id=self.tenant_id,
            name=cat_data['name'],
            parent_id=parent_id,
            sort_order=cat_data.get('sort_order', 0)
        )
        self.session.add(category)
        self.session.flush()  # Get ID for children
        
        # Create keywords
        for i, kw_data in enumerate(cat_data.get('keywords', [])):
            if isinstance(kw_data, str):
                keyword = DBKeyword(
                    category_id=category.id,
                    keyword=kw_data,
                    sort_order=i
                )
            else:
                keyword = DBKeyword(
                    category_id=category.id,
                    keyword=kw_data['keyword'],
                    prompt=kw_data.get('prompt'),
                    sort_order=i
                )
            self.session.add(keyword)
        
        # Create subcategories
        for subcat_data in cat_data.get('subcategories', []):
            self._create_category(subcat_data, category.id)
        
        return category
    
    def _category_to_dict(self, category: KeywordCategory) -> dict:
        """Convert YAML category to dict format."""
        return {
            'name': category.name,
            'keywords': category.keywords,
            'subcategories': [self._category_to_dict(sub) for sub in category.subcategories]
        }
