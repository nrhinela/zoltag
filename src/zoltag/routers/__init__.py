"""Zoltag API routers package."""

from . import auth
from . import admin_users
from . import keywords
from . import lists
from . import images
from . import admin_people
from . import admin_tenants
from . import admin_keywords
from . import admin_integrations
from . import admin_database
from . import admin_roles
from . import dropbox
from . import gdrive
from . import sync
from . import config
from . import people
from . import nl_search
from . import jobs

__all__ = [
    "auth",
    "admin_users",
    "keywords",
    "lists",
    "images",
    "admin_people",
    "admin_tenants",
    "admin_keywords",
    "admin_integrations",
    "admin_database",
    "admin_roles",
    "people",
    "dropbox",
    "gdrive",
    "sync",
    "config",
    "nl_search",
    "jobs",
]
