# Authentication Architecture for PhotoCat

## Executive Summary

This document defines the authentication system for PhotoCat using **Firebase Auth** as the identity provider. The architecture supports:
- OAuth2 providers (Google, with extensibility for others)
- Direct email/password signup
- Multi-tenant user membership
- Role-based access control (super-admin, admin, user)
- Admin approval/invitation workflow

## Current State

### Existing Authentication
- **Method**: X-Tenant-ID header (no user authentication)
- **Tenant Resolution**: Header-based lookup in `tenants` table
- **Authorization**: None - any request with valid tenant ID is allowed

### Existing Models
- `Tenant`: Organization/workspace with settings, Dropbox integration
- `TenantContext`: Thread-local context for request isolation

## Architecture Overview

### Why Firebase Auth

Firebase Auth is the chosen identity provider because PhotoCat already uses GCP services:
- Cloud Run (compute)
- PostgreSQL database (Supabase)
- Cloud Storage
- Secret Manager

Firebase Auth provides:
- Battle-tested security (Google manages password hashing, OAuth flows, etc.)
- Native GCP integration
- Generous free tier (50k MAU)
- Built-in support for Google OAuth and email/password
- SDK for both frontend (JavaScript) and backend (Admin SDK)

### Hybrid Architecture

Firebase handles identity (authentication), while PostgreSQL handles authorization (roles, tenant membership):

```
┌─────────────────────────────────────────────────────────────────┐
│                        Firebase Auth                             │
│  - User credentials (email/password)                            │
│  - OAuth tokens (Google, etc.)                                  │
│  - Email verification                                           │
│  - Password reset                                               │
│  - ID tokens (JWT)                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Firebase UID
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL (PhotoCat DB)                     │
│  - user_profiles (synced from Firebase)                         │
│  - user_tenants (roles, membership)                             │
│  - invitations                                                  │
│  - All existing tenant/image data                               │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Identity Provider | **Firebase Auth** | Managed auth, GCP native, handles OAuth/passwords |
| Backend Verification | **firebase-admin** | Verify ID tokens server-side |
| Frontend Auth | **Firebase JS SDK** | Handle login UI, token refresh |
| Local User Data | **PostgreSQL** | Tenant roles, approval status, profile sync |

## Data Model

### New Tables

```sql
-- User profiles (synced from Firebase)
CREATE TABLE user_profiles (
    firebase_uid VARCHAR(128) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    -- REVIEW (Codex): Consider a UNIQUE constraint on email (or confirm Firebase enforces one-account-per-email).
    email_verified BOOLEAN DEFAULT FALSE,
    display_name VARCHAR(255),
    photo_url TEXT,
    is_active BOOLEAN DEFAULT FALSE,  -- Requires admin approval
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_user_profiles_email ON user_profiles(email);
-- REVIEW (Codex): If you need strong uniqueness, make this a UNIQUE index instead.

-- User-Tenant membership (many-to-many)
CREATE TABLE user_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid VARCHAR(128) NOT NULL REFERENCES user_profiles(firebase_uid) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'user',  -- 'admin', 'user'
    -- REVIEW (Codex): Add a CHECK constraint or enum to prevent unexpected role values.
    invited_by VARCHAR(128) REFERENCES user_profiles(firebase_uid),
    invited_at TIMESTAMP WITH TIME ZONE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    -- REVIEW (Codex): Ensure access checks require accepted_at IS NOT NULL.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(firebase_uid, tenant_id)
);

CREATE INDEX idx_user_tenants_firebase_uid ON user_tenants(firebase_uid);
CREATE INDEX idx_user_tenants_tenant_id ON user_tenants(tenant_id);

-- Invitations for new users
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    invited_by VARCHAR(128) NOT NULL REFERENCES user_profiles(firebase_uid),
    token VARCHAR(255) UNIQUE NOT NULL,
    -- REVIEW (Codex): Store a hash of the token (not plaintext) to reduce blast radius if DB leaks.
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token);
```

### Role Hierarchy

```
super-admin (system-wide)
    └── Can manage all tenants and users
    └── Can approve/reject user registrations
    └── Can assign tenant admins

admin (tenant-scoped)
    └── Can manage tenant settings
    └── Can invite users to tenant
    └── Can manage user roles within tenant
    └── Full access to tenant data

user (tenant-scoped)
    └── Can view and manage assigned data
    └── Cannot invite users or change settings
```

## Authentication Flows

### 1. User Registration (Email/Password)

```
┌──────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────┐
│ Frontend │      │ Firebase Auth│      │ PhotoCat API │      │ PostgreSQL│
└────┬─────┘      └──────┬───────┘      └──────┬───────┘      └────┬─────┘
     │                   │                     │                   │
     │ 1. createUserWithEmailAndPassword()     │                   │
     │──────────────────>│                     │                   │
     │                   │                     │                   │
     │ 2. Return Firebase UID + ID token       │                   │
     │<──────────────────│                     │                   │
     │                   │                     │                   │
     │ 3. POST /auth/register (ID token)       │                   │
     │─────────────────────────────────────────>                   │
     │                   │                     │                   │
     │                   │  4. Verify ID token │                   │
     │                   │<────────────────────│                   │
     │                   │                     │                   │
     │                   │                     │ 5. Create user_profile
     │                   │                     │   (is_active=FALSE)
     │                   │                     │──────────────────>│
     │                   │                     │                   │
     │ 6. Return "pending approval"            │                   │
     │<─────────────────────────────────────────                   │
```

### 2. User Login (Existing User)

```
┌──────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────┐
│ Frontend │      │ Firebase Auth│      │ PhotoCat API │      │ PostgreSQL│
└────┬─────┘      └──────┬───────┘      └──────┬───────┘      └────┬─────┘
     │                   │                     │                   │
     │ 1. signInWithEmailAndPassword()         │                   │
     │──────────────────>│                     │                   │
     │                   │                     │                   │
     │ 2. Return ID token                      │                   │
     │<──────────────────│                     │                   │
     │                   │                     │                   │
     │ 3. GET /auth/me (Authorization: Bearer <ID token>)          │
     │─────────────────────────────────────────>                   │
     │                   │                     │                   │
     │                   │  4. Verify ID token │                   │
     │                   │<────────────────────│                   │
     │                   │                     │                   │
     │                   │                     │ 5. Fetch user_profile
     │                   │                     │    + user_tenants
     │                   │                     │──────────────────>│
     │                   │                     │                   │
     │                   │                     │ 6. Check is_active│
     │                   │                     │<──────────────────│
     │                   │                     │                   │
     │ 7. Return user info + tenants (or 403 if not active)        │
     │<─────────────────────────────────────────                   │
```

### 3. OAuth Login (Google)

```
┌──────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────┐
│ Frontend │      │ Firebase Auth│      │ PhotoCat API │      │ PostgreSQL│
└────┬─────┘      └──────┬───────┘      └──────┬───────┘      └────┬─────┘
     │                   │                     │                   │
     │ 1. signInWithPopup(GoogleAuthProvider)  │                   │
     │──────────────────>│                     │                   │
     │                   │                     │                   │
     │ 2. Google OAuth flow (handled by Firebase)                  │
     │<─────────────────>│                     │                   │
     │                   │                     │                   │
     │ 3. Return Firebase UID + ID token       │                   │
     │<──────────────────│                     │                   │
     │                   │                     │                   │
     │ 4. POST /auth/login (ID token)          │                   │
     │─────────────────────────────────────────>                   │
     │                   │                     │                   │
     │                   │  5. Verify ID token │                   │
     │                   │<────────────────────│                   │
     │                   │                     │                   │
     │                   │                     │ 6. Upsert user_profile
     │                   │                     │──────────────────>│
     │                   │                     │                   │
     │ 7. Return user info + tenants           │                   │
     │<─────────────────────────────────────────                   │
```

### 4. Invitation Flow

```
1. Admin clicks "Invite User" in tenant settings
2. System creates invitation record with token (24h expiry)
3. System sends email with invitation link
4. User clicks link, lands on registration page with token in URL
5. User signs up via Firebase (Google OAuth or email/password)
6. Frontend calls POST /auth/accept-invitation with ID token + invitation token
7. Backend verifies both tokens, creates user_profile (is_active=TRUE)
8. Backend creates user_tenants entry with invited role
9. Invitation marked as accepted
```

## API Endpoints

### Authentication Routes

```python
# POST /auth/register
# Headers: Authorization: Bearer <firebase_id_token>
# Body: { display_name }
# Creates user_profile with is_active=FALSE
# Response: { message: "Registration pending approval", user_id }

# POST /auth/login
# Headers: Authorization: Bearer <firebase_id_token>
# Upserts user_profile, returns user info if active
# Response: { user, tenants } or 403 if not active

# GET /auth/me
# Headers: Authorization: Bearer <firebase_id_token>
# Returns current user info with tenant memberships
# Response: { user, tenants }

# POST /auth/accept-invitation
# Headers: Authorization: Bearer <firebase_id_token>
# Body: { invitation_token }
# Accepts invitation, creates user with is_active=TRUE
# Response: { user, tenant }

# POST /auth/select-tenant
# Headers: Authorization: Bearer <firebase_id_token>
# Body: { tenant_id }
# Sets active tenant for session (stored in response cookie or returned for client storage)
# Response: { tenant }
# REVIEW (Codex): Use a signed, httpOnly cookie or server-side session; never trust client-stored tenant_id without re-validating membership.
```

### User Management Routes (Admin)

```python
# GET /admin/users
# List users (super-admin: all, admin: own tenant)
# Query params: ?tenant_id=xxx&status=pending|active|all

# GET /admin/users/pending
# List users pending approval

# POST /admin/users/{firebase_uid}/approve
# Approve pending user, optionally assign to tenant
# Body: { tenant_id, role }

# POST /admin/users/{firebase_uid}/reject
# Reject pending user (deletes user_profile)

# PATCH /admin/users/{firebase_uid}
# Update user (is_super_admin, is_active)

# POST /admin/invitations
# Body: { email, tenant_id, role }
# Create and send invitation

# GET /admin/invitations
# List invitations for tenant

# DELETE /admin/invitations/{invitation_id}
# Cancel invitation
```

## Security Considerations

### Token Verification

All API requests must include Firebase ID token in Authorization header:

```python
from firebase_admin import auth

async def get_current_user(
    authorization: str = Header(...),
    db: Session = Depends(get_db)
) -> UserProfile:
    """Verify Firebase ID token and return user profile."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid authorization header")

    id_token = authorization[7:]

    try:
        decoded_token = auth.verify_id_token(id_token)
        # REVIEW (Codex): Consider check_revoked=True and handle disabled accounts to force logout promptly.
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    firebase_uid = decoded_token["uid"]

    user = db.query(UserProfile).filter_by(firebase_uid=firebase_uid).first()
    if not user:
        raise HTTPException(404, "User not found")
    if not user.is_active:
        raise HTTPException(403, "Account pending approval")

    return user
```

### Role-Based Access Control

```python
def require_role(allowed_roles: list[str], tenant_id: str = None):
    """Dependency to check user has required role."""
    async def check_role(
        user: UserProfile = Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        if user.is_super_admin:
            return user  # Super admins can do anything

        if tenant_id:
            membership = db.query(UserTenant).filter_by(
                firebase_uid=user.firebase_uid,
                tenant_id=tenant_id
            ).first()

            if not membership or membership.role not in allowed_roles:
                raise HTTPException(403, "Insufficient permissions")

        return user

    return check_role
    # REVIEW (Codex): Ensure tenant_id comes from a trusted source (path/DB), not client input.
```

### Rate Limiting

Firebase Auth handles rate limiting for authentication attempts. For API endpoints:
- Use Cloud Run's built-in request limiting
- Consider adding application-level rate limiting for sensitive endpoints
<!-- REVIEW (Codex): Cloud Run concurrency is not per-IP/user rate limiting; use API Gateway/Cloud Armor for enforcement. -->

## Migration Path

### Phase 1: Firebase Setup & Core Auth
1. Create Firebase project (or add to existing GCP project)
2. Enable Email/Password and Google sign-in providers
3. Add firebase-admin to backend dependencies
4. Create user_profiles and user_tenants tables (Alembic migration)
5. Implement token verification dependency
6. Create /auth/register, /auth/login, /auth/me endpoints
7. Keep X-Tenant-ID header working for backward compatibility

### Phase 2: Frontend Integration
1. Add Firebase JS SDK to frontend
2. Create login page component (email/password + Google button)
3. Create registration page component
4. Add auth state management (store user + token)
5. Update API service to include Authorization header
6. Add tenant selector for multi-tenant users

### Phase 3: Authorization & Admin
1. Add role-based permission checks to existing endpoints
2. Create admin user management UI
3. Implement invitation system
4. Add email sending for invitations (SendGrid, Mailgun, or Firebase Extensions)

### Phase 4: Deprecate X-Tenant-ID
1. Require authentication on all endpoints
2. Derive tenant from user's membership or explicit selection
3. Remove X-Tenant-ID header support

## Frontend Integration

### Firebase SDK Setup

```javascript
// services/firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "...",
  authDomain: "photocat-483622.firebaseapp.com",
  projectId: "photocat-483622",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
```

### Auth State Management

```javascript
// services/auth.js
import { auth } from './firebase.js';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged
} from 'firebase/auth';

export async function loginWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
```

### API Service Updates

```javascript
// services/api.js
import { getIdToken } from './auth.js';

async function fetchWithAuth(url, options = {}) {
  const token = await getIdToken();

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': token ? `Bearer ${token}` : undefined,
      'X-Tenant-ID': getCurrentTenantId(), // Keep for backward compat
      // REVIEW (Codex): Once auth is enabled, avoid trusting X-Tenant-ID without membership checks.
    },
  });
}
```

## Environment Variables

### Backend

```bash
# Firebase Admin SDK (uses Application Default Credentials on GCP)
# For local development, set path to service account key:
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Or store Firebase service account in Secret Manager:
FIREBASE_SERVICE_ACCOUNT_SECRET=firebase-admin-key
```

### Frontend

```bash
# Firebase client config (public, safe to expose)
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=photocat-483622.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=photocat-483622
```

## File Structure

```
src/photocat/
├── auth/
│   ├── __init__.py
│   ├── config.py          # Firebase Admin SDK initialization
│   ├── dependencies.py    # get_current_user, require_role, require_tenant
│   ├── models.py          # UserProfile, UserTenant, Invitation
│   └── schemas.py         # Pydantic models for auth requests/responses
├── routers/
│   ├── auth.py            # Auth endpoints (/auth/*)
│   └── admin_users.py     # User management endpoints (/admin/*)

frontend/
├── services/
│   ├── firebase.js        # Firebase SDK initialization
│   ├── auth.js            # Auth functions (login, logout, etc.)
│   └── api.js             # Updated with auth headers
├── components/
│   ├── login-page.js      # Login form + OAuth buttons
│   ├── register-page.js   # Registration form
│   └── tenant-selector.js # Multi-tenant switcher
```

## Open Questions

1. **Email verification**: Should Firebase email verification be required before admin approval?
2. **Password reset**: Firebase handles this - should we customize the email template?
3. **Session duration**: Firebase tokens expire in 1 hour by default, auto-refresh is handled by SDK
4. **First super-admin**: How to bootstrap the first super-admin user?

## References

- [Firebase Auth Documentation](https://firebase.google.com/docs/auth)
- [Firebase Admin SDK (Python)](https://firebase.google.com/docs/admin/setup)
- [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
