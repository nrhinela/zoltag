"""Database-backed configuration manager."""

from typing import List, Dict, Optional

from sqlalchemy.orm import Session

from photocat.models.config import KeywordCategory as DBKeywordCategory, Keyword as DBKeyword
from photocat.metadata import Person as DBPerson


class ConfigManager:
    """Manage tenant configuration in the database."""
    
    def __init__(self, session: Session, tenant_id: str):
        """Initialize config manager."""
        self.session = session
        self.tenant_id = tenant_id
    
    def get_all_keywords(self) -> List[dict]:
        """Get all keywords from database."""
        return self._get_keywords_from_db()
    
    def get_people(self) -> List[dict]:
        """Get all people from database."""
        return self._get_people_from_db()
    
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
        """Recursively extract keywords with category paths.

        Excludes 'person' type keywords since those are for manual people tagging,
        not for ML model classification.
        """
        category_path = f"{parent_path}/{category.name}" if parent_path else category.name

        for keyword in sorted(category.keywords, key=lambda k: k.sort_order):
            # Skip person keywords - they're for manual tagging, not ML
            if getattr(keyword, 'tag_type', 'keyword') == 'person':
                continue
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
    
    def _category_to_dict(self, category: dict) -> dict:
        """Convert category input to dict format."""
        return {
            'name': category.get('name'),
            'keywords': category.get('keywords', []),
            'subcategories': [self._category_to_dict(sub) for sub in category.get('subcategories', [])]
        }
