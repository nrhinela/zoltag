"""PhotoCat API routers package."""

from . import keywords
from . import lists
from . import images
from . import admin_people
from . import admin_tenants
from . import admin_keywords
from . import dropbox
from . import sync
from . import config

__all__ = [
    "keywords",
    "lists",
    "images",
    "admin_people",
    "admin_tenants",
    "admin_keywords",
    "dropbox",
    "sync",
    "config",
]
