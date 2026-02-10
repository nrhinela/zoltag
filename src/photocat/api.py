"""FastAPI application entry point."""

from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from typing import Optional

from photocat.database import SessionLocal
from photocat.dependencies import get_db, get_tenant
from photocat.tenant import Tenant
from photocat.metadata import Tenant as TenantModel
from photocat.settings import settings

# Import all routers
from photocat.routers import (
    auth,
    admin_users,
    keywords,
    lists,
    images,
    people,
    admin_people,
    admin_tenants,
    admin_keywords,
    dropbox,
    gdrive,
    sync,
    config,
    nl_search
)

app = FastAPI(
    title="PhotoCat",
    description="Multi-tenant image organization and search utility",
    version="0.1.0"
)


@app.on_event("startup")
async def warm_jwks_cache():
    """Pre-fetch JWKS on startup so the first real request isn't blocked."""
    try:
        from photocat.auth.jwt import get_jwks
        await get_jwks()
    except Exception:
        pass  # Non-fatal: requests will fetch on demand if this fails

# Add CORS middleware (single consolidated block)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
# Auth routers (no tenant required for register/login/me endpoints)
app.include_router(auth.router)
app.include_router(admin_users.router)

# Content routers (require authentication and tenant access)
app.include_router(keywords.router)
app.include_router(lists.router)
app.include_router(images.router)
app.include_router(people.router)
app.include_router(admin_people.router)
app.include_router(admin_tenants.router)
app.include_router(admin_keywords.router)
app.include_router(dropbox.router)
app.include_router(gdrive.router)
app.include_router(sync.router)
app.include_router(config.router)
app.include_router(nl_search.router)

# Static file paths
static_dir = Path(__file__).parent / "static"
dist_dir = static_dir / "dist"

# Health check endpoint
@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy"}

# List all tenants (utility endpoint, not admin CRUD)
@app.get("/api/v1/tenants")
async def list_tenants(db: Session = Depends(get_db)):
    """List all tenants (for system health checks)."""
    tenants = db.query(TenantModel).all()
    return [{
        "id": t.id,
        "name": t.name,
        "active": t.active
    } for t in tenants]

# Mount static files for assets (JS, CSS, images) but NOT as SPA catch-all
# The catch-all route below handles SPA routing
if dist_dir.exists():
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Admin page route
@app.get("/admin")
async def admin_page():
    """Serve the admin application."""
    admin_file = dist_dir / "admin.html"
    if admin_file.exists():
        return HTMLResponse(content=admin_file.read_text())
    # Fallback to static admin if no dist
    admin_file = static_dir / "admin.html"
    if admin_file.exists():
        return HTMLResponse(content=admin_file.read_text())
    return HTMLResponse(content="<h1>Admin Interface</h1><p>Admin page not built</p>", status_code=200)

# SPA catch-all route - must be LAST route defined
# This serves index.html for any unmatched GET requests (client-side routing)
@app.get("/{full_path:path}")
async def spa_catch_all(full_path: str):
    """Serve the SPA for any unmatched routes.

    Note: API routes are defined with higher priority via include_router()
    and will be matched before this catch-all. This only catches routes
    that don't match any defined API endpoint.
    """
    # Serve index.html from dist for SPA routing
    index_file = dist_dir / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text())
    # Fallback to static index if no dist
    index_file = static_dir / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text())
    return HTMLResponse(content="<h1>PhotoCat</h1><p>Frontend not built</p>", status_code=200)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "photocat.api:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        reload=settings.debug
    )
