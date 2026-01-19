# Authentication Architecture for PhotoCat

## Executive Summary

This document proposes an authentication system for PhotoCat that supports:
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

## Proposed Architecture

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| OAuth2 Client | **Authlib** | Battle-tested, supports OIDC, clean FastAPI integration |
| Password Hashing | **passlib[bcrypt]** | Industry standard, bcrypt algorithm |
| Session/Token | **JWT (python-jose)** | Stateless, scalable, standard |
| Session Storage | **Redis** (optional) | Token revocation, refresh token storage |

// COMMENT (Codex): Consider whether you need Redis for MVP. JWT alone
// with short expiry + refresh tokens stored in DB could simplify initial deployment.

### Alternative Stack Options

**Option A: Authlib + JWT (Recommended)**
- Pros: Full control, lightweight, no external dependencies
- Cons: More code to write

**Option B: FastAPI-Users**
- Pros: Pre-built auth system, less code
- Cons: Opinionated, may conflict with existing patterns

**Option C: Auth0/Clerk/Supabase Auth (Managed)**
- Pros: Zero auth code, enterprise features
- Cons: Vendor lock-in, cost, external dependency

// COMMENT (Codex): What's your preference? Option A gives most flexibility,
// Option C is fastest to production. Option B is middle ground.

## Data Model

### New Tables

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(255),  -- NULL for OAuth-only users
    full_name VARCHAR(255),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT FALSE,  -- Requires admin approval
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- OAuth accounts linked to users
CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- 'google', 'github', etc.
    provider_user_id VARCHAR(255) NOT NULL,
    provider_email VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- User-Tenant membership (many-to-many)
CREATE TABLE user_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'user',  -- 'admin', 'user'
    invited_by UUID REFERENCES users(id),
    invited_at TIMESTAMP WITH TIME ZONE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, tenant_id)
);

-- Invitations for new users
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    invited_by UUID NOT NULL REFERENCES users(id),
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Refresh tokens (for token revocation)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
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

// COMMENT (Codex): Should super-admin be per-tenant or truly global?
// Current design has is_super_admin on User model (global).
// Alternative: Add 'super-admin' as a role in user_tenants for per-tenant super admins.

## Authentication Flows

### 1. OAuth2 Login (Google)

```
┌─────────┐     ┌─────────────┐     ┌──────────┐     ┌──────────┐
│ Browser │────>│ PhotoCat API│────>│  Google  │────>│ Callback │
└─────────┘     └─────────────┘     └──────────┘     └──────────┘
     │                                                     │
     │  1. Click "Login with Google"                       │
     │  2. Redirect to Google OAuth                        │
     │  3. User authenticates                              │
     │  4. Google redirects with code                      │
     │  5. Exchange code for tokens                        │
     │  6. Fetch user info                                 │
     │  7. Create/update user + oauth_account              │
     │  8. If new user && no invitation: PENDING status    │
     │  9. If invited or approved: issue JWT               │
     └─────────────────────────────────────────────────────┘
```

### 2. Email/Password Registration

```
1. User submits email + password
2. Validate email format, password strength
3. Check if email exists (return generic error if so)
4. Hash password with bcrypt
5. Create user with is_active=FALSE
6. Send verification email (optional for MVP)
7. Return "pending approval" message
8. Admin approves user
9. User can now login
```

### 3. Invitation Flow

```
1. Admin clicks "Invite User"
2. System creates invitation with token (24h expiry)
3. System sends email with invitation link
4. User clicks link, lands on registration page
5. User completes registration (OAuth or password)
6. User automatically approved and added to tenant
7. Invitation marked as accepted
```

## API Endpoints

### Authentication Routes

```python
# POST /auth/register
# Body: { email, password, full_name }
# Response: { message: "Registration pending approval" }

# POST /auth/login
# Body: { email, password }
# Response: { access_token, refresh_token, token_type, expires_in }

# GET /auth/google/authorize
# Redirects to Google OAuth

# GET /auth/google/callback
# Handles OAuth callback, returns JWT or redirect

# POST /auth/refresh
# Body: { refresh_token }
# Response: { access_token, expires_in }

# POST /auth/logout
# Revokes refresh token

# GET /auth/me
# Returns current user info with tenant memberships
```

### User Management Routes (Admin)

```python
# GET /admin/users
# List users (super-admin: all, admin: own tenant)

# GET /admin/users/pending
# List users pending approval

# POST /admin/users/{user_id}/approve
# Approve pending user

# POST /admin/users/{user_id}/reject
# Reject and delete pending user

# POST /admin/invitations
# Body: { email, tenant_id, role }
# Create and send invitation

# DELETE /admin/invitations/{invitation_id}
# Cancel invitation
```

## Security Considerations

### JWT Configuration

```python
JWT_CONFIG = {
    "algorithm": "HS256",  # Or RS256 for asymmetric
    "access_token_expire_minutes": 15,
    "refresh_token_expire_days": 7,
    "issuer": "photocat",
    "audience": "photocat-api",
}
```

### Token Payload

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "tenants": [
    {"id": "tenant1", "role": "admin"},
    {"id": "tenant2", "role": "user"}
  ],
  "is_super_admin": false,
  "iat": 1234567890,
  "exp": 1234568790,
  "iss": "photocat",
  "aud": "photocat-api"
}
```

// COMMENT (Codex): Including tenants in JWT means role changes require
// re-login or token refresh. Consider fetching tenant roles from DB
// on each request for real-time permission changes (slight performance cost).

### Password Requirements

- Minimum 8 characters
- At least one uppercase, one lowercase, one digit
- Check against common password list (optional)

### Rate Limiting

- Login: 5 attempts per minute per IP
- Registration: 3 attempts per minute per IP
- Password reset: 3 attempts per hour per email

## Migration Path

### Phase 1: Core Authentication (MVP)
1. Create User, OAuthAccount, UserTenant models
2. Implement JWT token generation/validation
3. Implement Google OAuth flow
4. Add password registration with bcrypt
5. Create new `get_current_user` dependency
6. Keep X-Tenant-ID header for backward compatibility

### Phase 2: Authorization
1. Add role-based permission checks
2. Update existing endpoints with auth requirements
3. Implement admin approval workflow
4. Create admin UI for user management

### Phase 3: Invitations
1. Implement invitation system
2. Email integration for invitations
3. Self-service tenant switching in UI

### Phase 4: Hardening
1. Add rate limiting
2. Add refresh token rotation
3. Add session management (view/revoke sessions)
4. Security audit

## Frontend Changes

### New Pages/Components
- Login page (email/password + OAuth buttons)
- Registration page
- Tenant selector (for users with multiple tenants)
- Admin: User management panel
- Admin: Invitation management

### Auth State Management
- Store JWT in memory (not localStorage for security)
- Use refresh token in httpOnly cookie
- Add auth context/provider for React state

## Environment Variables

```bash
# JWT
JWT_SECRET_KEY=<secure-random-string>
JWT_ALGORITHM=HS256

# Google OAuth
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
GOOGLE_REDIRECT_URI=https://app.photocat.com/auth/google/callback

# Optional: Redis for token blacklist
REDIS_URL=redis://localhost:6379/0
```

## Open Questions

1. **Email verification**: Required before approval, or optional?
2. **Password reset**: Email-based flow needed for MVP?
3. **Remember me**: Extend refresh token lifetime option?
4. **Session management**: Allow users to view/revoke sessions?
5. **API keys**: Needed for programmatic access?
6. **MFA**: Required for MVP or future phase?

## File Structure

```
src/photocat/
├── auth/
│   ├── __init__.py
│   ├── config.py          # JWT settings, OAuth config
│   ├── dependencies.py    # get_current_user, require_role
│   ├── models.py          # User, OAuthAccount, UserTenant, etc.
│   ├── oauth.py           # OAuth provider integrations
│   ├── passwords.py       # Password hashing utilities
│   ├── tokens.py          # JWT creation/validation
│   └── schemas.py         # Pydantic models for auth
├── routers/
│   ├── auth.py            # Auth endpoints
│   └── admin_users.py     # User management endpoints
```

## Estimated Implementation Effort

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1: Core Auth | Models, JWT, OAuth, Password | 2-3 days |
| Phase 2: Authorization | Role checks, admin workflow | 1-2 days |
| Phase 3: Invitations | Email, invitation flow | 1 day |
| Phase 4: Hardening | Rate limiting, security | 1 day |
| Frontend Integration | Login UI, auth state | 2-3 days |
| **Total** | | **7-10 days** |

## References

- [Authlib Documentation](https://docs.authlib.org/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [OWASP Authentication Cheatsheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [JWT Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
