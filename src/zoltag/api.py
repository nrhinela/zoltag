"""FastAPI application entry point."""

import logging
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional

from zoltag.database import SessionLocal
from zoltag.dependencies import get_db, get_tenant
from zoltag.tenant import Tenant
from zoltag.metadata import Tenant as TenantModel
from zoltag.settings import settings
from zoltag.auth.dependencies import require_super_admin
from zoltag.auth.models import UserProfile
from zoltag.ratelimit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Import all routers
from zoltag.routers import (
    auth,
    admin_users,
    keywords,
    lists,
    images,
    people,
    admin_people,
    admin_tenants,
    admin_keywords,
    admin_integrations,
    dropbox,
    gdrive,
    sync,
    config,
    nl_search,
    jobs,
    keyword_thresholds,
)

app = FastAPI(
    title="Zoltag",
    description="Multi-tenant image organization and search utility",
    version="0.1.0"
)
logger = logging.getLogger(__name__)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.on_event("startup")
async def warm_jwks_cache():
    """Pre-fetch JWKS on startup so the first real request isn't blocked."""
    try:
        from zoltag.auth.jwt import get_jwks
        await get_jwks()
    except Exception:
        pass  # Non-fatal: requests will fetch on demand if this fails


@app.on_event("startup")
async def start_worker_mode():
    """Start background queue worker when service runs in worker mode."""
    if not settings.worker_mode:
        return
    try:
        from zoltag.worker import start_background_worker_thread

        start_background_worker_thread()
    except Exception:
        # Keep API process alive even if worker startup fails.
        logger.exception("Failed to start worker mode thread")


@app.on_event("shutdown")
async def stop_worker_mode():
    """Stop background queue worker when service shuts down."""
    if not settings.worker_mode:
        return
    try:
        from zoltag.worker import stop_background_worker_thread

        stop_background_worker_thread()
    except Exception:
        logger.exception("Failed to stop worker mode thread")

# Add CORS middleware
# In production the frontend is served from the same origin as the API, so no
# cross-origin request is made. We still configure CORS explicitly to support
# local development (Vite dev server on a different port).
_allowed_origins = [settings.app_url]
if settings.is_development:
    # Allow any localhost port during local development
    _allowed_origins += [
        "http://localhost:5173",  # Vite default
        "http://localhost:8080",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8080",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
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
app.include_router(admin_integrations.router)
app.include_router(dropbox.router)
app.include_router(gdrive.router)
app.include_router(sync.router)
app.include_router(config.router)
app.include_router(nl_search.router)
app.include_router(jobs.router)
app.include_router(keyword_thresholds.router)

# Static file paths
static_dir = Path(__file__).parent / "static"
dist_dir = static_dir / "dist"

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint with DB connectivity verification."""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")
    finally:
        db.close()

# List all tenants (super admin only)
@app.get("/api/v1/tenants")
async def list_tenants(
    db: Session = Depends(get_db),
    _user: UserProfile = Depends(require_super_admin),
):
    """List all tenants. Restricted to super admins."""
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
    return HTMLResponse(content="<h1>Zoltag</h1><p>Frontend not built</p>", status_code=200)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "zoltag.api:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        reload=settings.debug
    )
