"""FastAPI dependencies for authentication and authorization."""

from typing import Optional, Callable
from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session
from jose import JWTError
from datetime import datetime

from photocat.database import get_db
from photocat.auth.jwt import verify_supabase_jwt, get_supabase_uid_from_token
from photocat.auth.models import UserProfile, UserTenant
from photocat.metadata import Tenant as TenantModel


async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> UserProfile:
    """Verify JWT token and return current authenticated user.

    This dependency:
    1. Extracts the Bearer token from Authorization header
    2. Verifies the JWT signature using Supabase JWKS
    3. Loads the user profile from the database
    4. Checks that the user is active (approved)
    5. Updates last_login_at timestamp

    Args:
        authorization: Authorization header (should be "Bearer <token>")
        db: Database session

    Returns:
        UserProfile: The authenticated user

    Raises:
        HTTPException 401: Invalid or missing token
        HTTPException 403: User account not approved
        HTTPException 404: User profile not found
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[7:]  # Remove "Bearer " prefix

    try:
        supabase_uid = await get_supabase_uid_from_token(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Fetch user profile from database
    user = db.query(UserProfile).filter(
        UserProfile.supabase_uid == supabase_uid
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found. Please complete registration."
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account pending admin approval"
        )

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    db.commit()

    return user


async def get_optional_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Optional[UserProfile]:
    """Get current user if authenticated, None otherwise.

    Useful for endpoints that work with or without authentication.

    Args:
        authorization: Authorization header
        db: Database session

    Returns:
        UserProfile or None: User if authenticated, None otherwise
    """
    if not authorization:
        return None

    try:
        return await get_current_user(authorization, db)
    except HTTPException:
        return None


def require_super_admin(
    user: UserProfile = Depends(get_current_user)
) -> UserProfile:
    """Require super admin role.

    Used on endpoints that only super admins can access.

    Args:
        user: Current authenticated user

    Returns:
        UserProfile: The user (guaranteed to be super admin)

    Raises:
        HTTPException 403: User is not a super admin
    """
    if not user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin role required"
        )
    return user


def require_tenant_access(tenant_id: str) -> Callable:
    """Dependency factory to check user has access to specific tenant.

    Creates a dependency that checks if the authenticated user is a member
    of the specified tenant. Super admins automatically pass the check.

    Args:
        tenant_id: The tenant ID to check access for

    Returns:
        Callable: Dependency function

    Usage:
        @app.get("/api/v1/images")
        async def get_images(
            tenant_id: str = Query(...),
            user: UserProfile = Depends(require_tenant_access(tenant_id))
        ):
            # User is guaranteed to have access to tenant_id
    """
    async def check_access(
        user: UserProfile = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> UserProfile:
        # Super admins have access to all tenants
        if user.is_super_admin:
            return user

        # Check if user is a member of the tenant
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == tenant_id,
            UserTenant.accepted_at.isnot(None)  # Must have accepted invitation
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No access to tenant {tenant_id}"
            )

        return user

    return check_access


def require_tenant_role(tenant_id: str, required_role: str = "user") -> Callable:
    """Dependency factory to check user has specific role in tenant.

    Creates a dependency that checks if the authenticated user has at least
    the specified role in the tenant. Supports role hierarchy:
    - 'admin' is higher than 'user'
    - Super admins automatically pass the check

    Args:
        tenant_id: The tenant ID to check
        required_role: Minimum required role ('user' or 'admin')

    Returns:
        Callable: Dependency function

    Usage:
        @app.post("/api/v1/admin/invitations")
        async def create_invitation(
            tenant_id: str,
            user: UserProfile = Depends(require_tenant_role(tenant_id, "admin"))
        ):
            # User is guaranteed to be an admin in tenant_id
    """
    async def check_role(
        user: UserProfile = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> UserProfile:
        # Super admins bypass role checks
        if user.is_super_admin:
            return user

        # Check membership and role
        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == tenant_id,
            UserTenant.accepted_at.isnot(None)
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No access to tenant {tenant_id}"
            )

        # Check role hierarchy: admin > user
        if required_role == "admin" and membership.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin role required in this tenant"
            )

        return user

    return check_role


def require_tenant_role_from_header(required_role: str = "admin") -> Callable:
    """Dependency factory to check tenant role using X-Tenant-ID header."""
    async def check_role(
        x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
        user: UserProfile = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> UserProfile:
        if user.is_super_admin:
            return user

        membership = db.query(UserTenant).filter(
            UserTenant.supabase_uid == user.supabase_uid,
            UserTenant.tenant_id == x_tenant_id,
            UserTenant.accepted_at.isnot(None)
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No access to tenant {x_tenant_id}"
            )

        if required_role == "admin" and membership.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin role required in this tenant"
            )

        return user

    return check_role
