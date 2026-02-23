# Shared Lists - Guest Authentication Flow (Implemented)

**Date**: 2026-02-20  
**Status**: Implemented (Phase I)  
**Related**: [SHARED_LISTS_DESIGN.md](./SHARED_LISTS_DESIGN.md)

## Overview

This document describes the **implemented** guest authentication flow for Zoltag's Phase I Shared Lists feature. This is a simplified, user-friendly flow where guests enter their email directly on the `/guest` page to receive a magic link.

## Architecture: Direct Email Input Flow

### Key Design Principle

> Email sends users to `/guest`, which handles all authentication via an email input form.

**Why this approach?**
- **User-friendly**: Clear, guided UX starting from email input
- **No URL complexity**: Avoids Supabase redirect URL encoding issues
- **Flexible authentication**: Supports both magic links and future OTP codes
- **Self-service**: Users can request new links without contacting support

### What We Built

1. **Invitation Email** → Simple link to `/guest?tenant_id=<uuid>`
2. **Guest Landing** → Email input form ("Send Magic Link")
3. **Email Validation** → Check if email has active shares
4. **Magic Link Email** → Supabase magic link + (future) OTP code
5. **Authentication** → Supabase handles token exchange
6. **List Access** → Show accessible lists or direct list view

## System Components

### 1. Backend API

#### Invitation Endpoint

```
POST /api/v1/lists/{list_id}/share
Body: { "emails": ["guest@example.com"], ... }

Steps:
1. Create Supabase guest user (app_metadata.role = 'guest')
2. Create ListShare record
3. Send invitation email with link to /guest?tenant_id={uuid}
```

**File**: `src/zoltag/routers/sharing.py`  
**Key Code** (lines 140-176):
```python
# Create Supabase guest user
from zoltag.supabase_admin import create_guest_user
user_data = await create_guest_user(email_str, str(tenant.id))
guest_uid = uuid.UUID(user_data["id"])

# Create simple invite link
invite_link = f"{app_url}/guest?tenant_id={tenant.id}"

# Send invite email via Resend
from zoltag.email import send_guest_invite_email
email_sent = send_guest_invite_email(
    to_email=email_str,
    invite_link=invite_link,
    list_name=list_name,
    inviter_name=inviter_name,
)
```

#### Magic Link Request Endpoint

```
POST /api/v1/guest/auth/request-link
Body: { "email": "guest@example.com", "tenant_id": "uuid" }

Steps:
1. Validate email has active shares in tenant (ListShare.guest_email)
2. Generate Supabase magic link via Admin API
3. Send email with magic link (and future: OTP code)
4. Return success/error message

Security:
- Always returns 200 (prevents user enumeration)
- Generic error message if email not found
- Validates share is active (not revoked, not expired)
```

**File**: `src/zoltag/routers/guest.py`  
**Key Code** (lines 379-433):
```python
class RequestLinkRequest(BaseModel):
    email: str
    tenant_id: str

@router.post("/auth/request-link", status_code=status.HTTP_200_OK)
async def request_magic_link(
    body: RequestLinkRequest,
    db: Session = Depends(get_db),
):
    email = body.email.strip().lower()
    tenant_id_uuid = uuid.UUID(body.tenant_id)

    # Check if email has any active shares in this tenant
    has_shares = (
        db.query(ListShare)
        .filter(
            ListShare.tenant_id == tenant_id_uuid,
            ListShare.guest_email == email,
            ListShare.revoked_at.is_(None),
        )
        .first()
    )

    if not has_shares:
        return {
            "success": False,
            "message": "We couldn't find any shared collections for this email address.",
        }

    # Generate magic link
    from zoltag.supabase_admin import generate_magic_link
    link_data = await generate_magic_link(email, f"{app_url}/guest")

    # Send email
    from zoltag.email import send_guest_magic_link_email
    await send_guest_magic_link_email(
        to_email=email,
        magic_link=link_data.get("action_link"),
        otp_code=None,  # Future: OTP code support
    )

    return {
        "success": True,
        "message": "A sign-in link has been sent to your email.",
    }
```

### 2. Supabase Admin Functions

#### create_guest_user()

Creates or updates guest user with `role='guest'` metadata.

**File**: `src/zoltag/supabase_admin.py`  
**Key Code** (lines 24-62):
```python
async def create_guest_user(email: str, tenant_id: str) -> dict:
    """Create a guest user in Supabase (or update if exists).
    
    Sets app_metadata.role = 'guest' and adds tenant_id to tenant_ids list.
    """
    url = f"{_base_url()}/auth/v1/admin/users"
    payload = {
        "email": email,
        "email_confirm": True,  # Auto-confirm - they'll use magic link
        "app_metadata": {
            "role": "guest",
            "tenant_ids": [tenant_id],
        },
    }
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())
    
    if resp.status_code == 422:
        # User exists - update metadata
        user_data = await _upsert_guest_metadata(email, tenant_id)
        return user_data
    
    return resp.json()
```

#### generate_magic_link()

Generates Supabase magic link for passwordless authentication.

**File**: `src/zoltag/supabase_admin.py`  
**Key Code** (lines 255-280):
```python
async def generate_magic_link(email: str, redirect_to: str) -> Optional[dict]:
    """Send a magic-link + OTP email to an existing guest.
    
    Returns dict with 'action_link' and 'hashed_token' if successful.
    The hashed_token can be used as the OTP code for verification.
    """
    url = f"{_base_url()}/auth/v1/admin/generate_link"
    payload = {
        "type": "magiclink",
        "email": email,
        "options": {"redirect_to": redirect_to},
    }
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, headers=_headers())
    
    if resp.status_code not in (200, 201):
        return None
    
    return resp.json()  # Contains action_link, hashed_token
```

### 3. Email Service

#### send_guest_invite_email()

Sends initial invitation with simple `/guest` link.

**File**: `src/zoltag/email.py`  
**Key Features**:
- **From**: `Zoltag <info@zoltag.com>` (verified domain)
- **Subject**: `"Invitation to view '{list_name}' on Zoltag"`
- **Content**: Personalized message, CTA button, simple link
- **Link**: `http://localhost:5173/guest?tenant_id={uuid}`

#### send_guest_magic_link_email()

Sends authentication email with magic link (+ future OTP code).

**File**: `src/zoltag/email.py`  
**Key Code** (lines 113-209):
```python
async def send_guest_magic_link_email(
    to_email: str,
    magic_link: str,
    otp_code: Optional[str] = None,
) -> bool:
    """Send a guest magic link authentication email via Resend."""
    
    # HTML includes:
    # - "Sign In to Zoltag" button
    # - Magic link URL (clickable + copyable)
    # - Future: Styled code box for OTP entry
    # - Expiration notice (60 minutes)
    
    html_body = f"""
    <a href="{magic_link}" class="button">Sign In to Zoltag</a>
    
    {"<div class='code-box'>" + otp_code + "</div>" if otp_code else ""}
    
    <p>This link will expire in 60 minutes for security purposes.</p>
    """
```

### 4. Frontend - Guest App

#### Component State Management

**File**: `frontend/components/guest-app.js`

**Properties**:
```javascript
static properties = {
  authenticated: { type: Boolean },
  loading: { type: Boolean },
  isGuest: { type: Boolean },
  error: { type: String },
  tenantId: { type: String },
  listId: { type: Number },
  // Auth flow state
  authEmail: { type: String },
  authLoading: { type: Boolean },
  authMessage: { type: String },
  authSuccess: { type: Boolean },
}
```

#### Unauthenticated Screen

Shows email input form when not authenticated:

**Key Code** (lines 322-406):
```javascript
// Not authenticated - show email input form
if (!this.authenticated) {
  return html`
    <div class="error-screen">
      <div class="error-card" style="max-width: 400px;">
        <h1>📸 Sign In to View Shared Photos</h1>

        ${this.authSuccess ? html`
          <div style="background: #10b981; color: white; ...">
            <p>✓ ${this.authMessage}</p>
            <p>Check your email and click the link or enter the code below.</p>
          </div>
        ` : html`
          <p>Enter your email address to receive a sign-in link.</p>
        `}

        ${!this.authSuccess ? html`
          <form @submit=${this._handleRequestNewLink}>
            <input
              type="email"
              placeholder="your.email@example.com"
              .value=${this.authEmail}
              @input=${this._handleEmailInput}
              required
              ?disabled=${this.authLoading}
            />
            <button type="submit" ?disabled=${this.authLoading}>
              ${this.authLoading ? 'Sending...' : 'Send Magic Link'}
            </button>

            ${this.authMessage && !this.authSuccess ? html`
              <p style="background: rgba(239, 68, 68, 0.2); ...">
                ${this.authMessage}
              </p>
            ` : ''}
          </form>
        ` : ''}
      </div>
    </div>
  `;
}
```

#### Magic Link Request Handler

**Key Code** (lines 287-331):
```javascript
async _handleRequestNewLink(e) {
  e.preventDefault();

  // Get tenant_id from URL
  const tenantIdParam = this.tenantId || 
    new URLSearchParams(window.location.search).get('tenant_id');

  if (!tenantIdParam) {
    this.authMessage = 'Unable to determine tenant. Please use the link from your invitation email.';
    return;
  }

  this.authLoading = true;

  const response = await fetch('/api/v1/guest/auth/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: this.authEmail.trim().toLowerCase(),
      tenant_id: tenantIdParam,
    }),
  });

  const data = await response.json();
  this.authSuccess = data.success || false;
  this.authMessage = data.message;
  this.authLoading = false;
}
```

## User Flow Diagram

```
Owner                Guest                Frontend           Backend          Supabase
  |                     |                      |                 |                 |
  |--Share List-------->|                      |                 |                 |
  |                     |                      |                 |                 |
  |                     |<--Invitation Email (link: /guest?tenant_id=uuid)---------|
  |                     |                      |                 |                 |
  |                     |--Click Link--------->|                 |                 |
  |                     |                      |                 |                 |
  |                     |         Shows email input form         |                 |
  |                     |                      |                 |                 |
  |                     |--Enter Email-------->|                 |                 |
  |                     |--Send Magic Link---->|                 |                 |
  |                     |                      |                 |                 |
  |                     |                      |--POST /request-link              |
  |                     |                      |  {email, tenant_id}              |
  |                     |                      |                 |                 |
  |                     |                      |                 |--Validate------>|
  |                     |                      |                 |  (ListShare)    |
  |                     |                      |                 |                 |
  |                     |                      |                 |--Generate Link->|
  |                     |                      |                 |<-Magic Link-----|
  |                     |                      |                 |                 |
  |                     |                      |                 |--Send Email---->|
  |                     |                      |<-Success Msg----|                 |
  |                     |                      |                 |                 |
  |                     |      Shows: "A sign-in link has been sent"              |
  |                     |                      |                 |                 |
  |                     |<--Magic Link Email (with link + future OTP code)---------|
  |                     |                      |                 |                 |
  |                     |--Click Magic Link--->|                 |                 |
  |                     |                      |                 |                 |
  |                     |                      |--Exchange Token----------------->|
  |                     |                      |<-Session (JWT with user_role='guest')
  |                     |                      |                 |                 |
  |                     |                      |--Validate JWT-->|                 |
  |                     |                      |<-Guest Access---|                 |
  |                     |                      |                 |                 |
  |                     |<--List View----------|                 |                 |
```

## Security Features

### 1. User Enumeration Prevention

- `/auth/request-link` always returns 200 OK
- Generic success message even if email not found
- Error message is vague: "We couldn't find any shared collections..."

### 2. Access Control Layers

**Guest User Creation**:
- `app_metadata.role = 'guest'` (injected into JWT via Custom Access Token Hook)
- `app_metadata.tenant_ids = [...]` (array of accessible tenants)

**Share Validation**:
- Active share required: `revoked_at IS NULL`
- Expiration check: `expires_at IS NULL OR expires_at > NOW()`
- Tenant match: `tenant_id` must be in JWT's `tenant_ids` array

**Asset Access**:
- `_assert_asset_in_list()` prevents blind asset enumeration
- Guest can only access assets in explicitly shared lists

### 3. Email Security

- Uses Resend with verified domain (`info@zoltag.com`)
- No auth tokens embedded in email body
- Magic links expire after 60 minutes
- Future: OTP codes as backup authentication method

## Configuration

### Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Email (Resend)
EMAIL_RESEND_API_KEY=re_your_key
EMAIL_FROM_ADDRESS=Zoltag <info@zoltag.com>

# Application
APP_URL=http://localhost:5173  # Frontend URL for links
```

### Supabase Setup

1. **Enable Custom Access Token Hook**:
   - Dashboard → Authentication → Hooks → Custom Access Token
   - Point to your SQL function that injects `user_role` and `tenant_ids`

2. **Verify Email Domain**:
   - Add `info@zoltag.com` to verified sender domains in Resend

## Testing Checklist

### Happy Path

- [ ] Share list with new guest email
- [ ] Receive invitation email with `/guest?tenant_id=` link
- [ ] Click link → see email input form
- [ ] Enter email → see "Sending..." state
- [ ] See success message: "A sign-in link has been sent"
- [ ] Receive magic link email
- [ ] Click magic link → authenticate successfully
- [ ] See list selection or direct list view

### Error Cases

- [ ] Enter invalid email format → validation error
- [ ] Enter email not in shares → "We couldn't find..." message
- [ ] Expired share → 403 error
- [ ] Revoked share → 403 error
- [ ] Missing tenant_id in URL → error message
- [ ] Regular user on /guest → "This link is for guest access only"

### Edge Cases

- [ ] Guest with multiple accessible lists → see selection screen
- [ ] Guest with one list → auto-select
- [ ] Request magic link twice quickly → second request succeeds
- [ ] Chrome incognito state → test with all windows closed

## Known Issues

### 1. Chrome Incognito State Sharing

**Problem**: Chrome incognito windows share state (cookies, localStorage)

**Workaround**: Close ALL incognito windows before testing, or use Chrome Guest mode

### 2. Hot Reload Not Picking Up Changes

**Problem**: Backend code changes may not trigger reload

**Solution**: Manually restart dev server after significant changes

### 3. Resend Test Mode Restrictions

**Problem**: Test mode only allows sending to verified email

**Solution**: Use verified domain (`info@zoltag.com`) instead of test domain (`onboarding@resend.dev`)

## Future Enhancements (Phase II)

### OTP Code Entry

**Goal**: Allow manual code entry as alternative to clicking magic link

**Implementation**:
1. Generate 6-digit OTP with magic link
2. Include OTP in email (styled code box)
3. Add code input field to guest-app.js (shown after success message)
4. New endpoint: `POST /api/v1/guest/auth/verify-otp`
5. Exchange OTP for session tokens

**Benefits**:
- Works when email clients block links
- Better mobile UX (copy-paste code)
- Accessibility improvement

### Progressive Enhancement Ideas

- Remember email in localStorage for returning guests
- Show "Check your spam folder" hint after 30 seconds
- Add "Resend link" button with cooldown timer
- Support passwordless phone number authentication

## Related Files

### Backend
- `src/zoltag/routers/sharing.py` - Invitation endpoint
- `src/zoltag/routers/guest.py` - Guest authentication & data endpoints
- `src/zoltag/supabase_admin.py` - Supabase Admin API helpers
- `src/zoltag/email.py` - Email templates via Resend
- `src/zoltag/models/sharing.py` - ListShare model

### Frontend
- `frontend/components/guest-app.js` - Main guest application
- `frontend/components/guest-list-view.js` - List display for guests
- `frontend/components/share-list-modal.js` - Share UI for owners
- `frontend/main.js` - Routes /guest to guest-app component

### Database
- `alembic/versions/202602171900_add_rbac_permissions_tables.py` - Migration

## Deployment Notes

1. Ensure `APP_URL` is set correctly for each environment (local/staging/prod)
2. Verify Resend domain in production
3. Enable Custom Access Token Hook in Supabase dashboard
4. Test magic link email delivery in production (check spam folders)
5. Monitor rate limiting on `/auth/request-link` endpoint
