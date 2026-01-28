# Supabase Authentication Setup Guide

## Overview

PhotoCat now uses Supabase for user authentication and authorization. This guide walks you through configuring your environment with Supabase credentials.

## Prerequisites

- Supabase project created (https://app.supabase.com)
- Project ID: `mmpluqmxpgbgmimfviru`
- Admin access to Supabase dashboard

## 1. Get Your Supabase Credentials

### Step 1: Access Your Project
1. Go to https://app.supabase.com and sign in
2. Select your project `mmpluqmxpgbgmimfviru`
3. Click **Settings** in the left sidebar
4. Click **API** tab

### Step 2: Copy Your Credentials

You'll see three key pieces of information:

**Project URL**:
```
https://mmpluqmxpgbgmimfviru.supabase.co
```

**anon public key** (Publishable key):
```
sb_publishable_aV2IHPkdJYcXER87Qamntw_QO-rr2Lm
```

**service_role secret key** (Secret key):
```
sb_secret_Kb3K2PIECIMkTYiGo8iH0Q_Ge0biOiS
```

## 2. Create Environment Files

### Backend Configuration (`.env`)

Create or update `.env` in your project root with these Supabase variables:

```bash
# Supabase Authentication
SUPABASE_URL=https://mmpluqmxpgbgmimfviru.supabase.co
SUPABASE_ANON_KEY=sb_publishable_aV2IHPkdJYcXER87Qamntw_QO-rr2Lm
SUPABASE_SERVICE_ROLE_KEY=sb_secret_Kb3K2PIECIMkTYiGo8iH0Q_Ge0biOiS
```

**Important**:
- `.env` is in `.gitignore` - it won't be committed
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret - never share it
- The anon key can be safely used in frontend code

### Frontend Configuration (`frontend/.env`)

Create `frontend/.env` with the public keys only:

```bash
# Supabase Frontend Configuration
VITE_SUPABASE_URL=https://mmpluqmxpgbgmimfviru.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_aV2IHPkdJYcXER87Qamntw_QO-rr2Lm
```

**Important**:
- Only public keys go in frontend `.env`
- `VITE_` prefix exposes vars to frontend build
- Never put `SUPABASE_SERVICE_ROLE_KEY` in frontend `.env`

## 3. Configure Supabase Auth Providers

### Email/Password Authentication

1. In Supabase dashboard: **Authentication** → **Providers**
2. Scroll to **Email** section
3. Toggle **Enable Email provider** ON
4. Save

### Google OAuth (Optional)

1. Create OAuth credentials in Google Cloud Console
2. In Supabase: **Authentication** → **Providers** → **Google**
3. Enable Google provider
4. Paste your Google OAuth credentials
5. Save

### Configure Redirect URLs

1. **Authentication** → **URL Configuration**
2. Under **Redirect URLs** (Auth Callbacks):
   - Development: `http://localhost:5173/auth/callback`
   - Production: `https://yourdomain.com/auth/callback`
3. Save

## 4. Verify Configuration

### Backend Test
```bash
# Activate virtualenv
source venv/bin/activate

# Test backend can load Supabase config
python3 -c "
from photocat.auth.config import get_auth_settings
settings = get_auth_settings()
print('✅ Backend configured')
print(f'   URL: {settings.supabase_url}')
print(f'   JWKS: {settings.jwks_url}')
"

# Test API starts
python3 -m uvicorn photocat.api:app --reload
```

### Frontend Test
```bash
# Build frontend
npm run build

# Check for no errors (some warnings about outDir are normal)
# Should see: ✓ built in Xms
```

## 5. Database Setup

The authentication tables (`user_profiles`, `user_tenants`, `invitations`) are created by the Alembic migration:

```bash
# Run migrations
DATABASE_URL="your_connection_string" alembic upgrade head

# Verify tables exist
DATABASE_URL="your_connection_string" psql -c "\dt user_*"
```

## 6. Test the Auth Flow

### 1. Start development servers
```bash
make dev
```

### 2. Visit http://localhost:5173/signup
- Create an account with email/password
- See "Awaiting admin approval" message

### 3. Approve user (admin task)
```bash
# Connect to database and promote user
DATABASE_URL="your_connection_string" psql

UPDATE user_profiles
SET is_active = TRUE, is_super_admin = TRUE
WHERE email = 'your.email@example.com';
```

### 4. Login at http://localhost:5173/login
- Use your email and password
- Should redirect to main app

## 7. Troubleshooting

### "Field required" - Settings not loading
**Problem**: Backend can't find SUPABASE_URL in environment
**Solution**:
1. Ensure `.env` file is in project root
2. Ensure vars are formatted correctly: `KEY=VALUE` (no quotes)
3. If using different shell (zsh vs bash), reload: `exec zsh` or `exec bash`

### "Invalid authorization header"
**Problem**: Frontend JWT token isn't valid
**Solution**:
1. Check SUPABASE_ANON_KEY is correct in `frontend/.env`
2. Ensure token is being sent: `Authorization: Bearer <token>`
3. Check JWKS endpoint is reachable: `curl https://xxx.supabase.co/auth/v1/.well-known/jwks.json`

### "User not found" after signup
**Problem**: User profile wasn't created
**Solution**:
1. Check POST `/auth/register` returned successfully
2. Verify `user_profiles` table has your user
3. Check `is_active` flag - must be TRUE to login

### OAuth redirect loop
**Problem**: Google OAuth redirects back to login indefinitely
**Solution**:
1. Verify redirect URL is registered in Supabase
2. Check `VITE_SUPABASE_ANON_KEY` is correct
3. Ensure Google OAuth credentials are set up correctly

## 8. Production Deployment

For production, store credentials in Google Secret Manager:

```bash
# Create secrets
gcloud secrets create supabase-url --data="https://mmpluqmxpgbgmimfviru.supabase.co"
gcloud secrets create supabase-anon-key --data="sb_publishable_..."
gcloud secrets create supabase-service-role-key --data="sb_secret_..."

# Reference in cloudbuild.yaml
env:
  - 'SUPABASE_URL=$_SUPABASE_URL'
  - 'SUPABASE_ANON_KEY=$_SUPABASE_ANON_KEY'
secretEnv:
  - 'SUPABASE_SERVICE_ROLE_KEY'
```

## 9. Security Checklist

- [ ] `.env` file is in `.gitignore` and not committed
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is never in frontend code
- [ ] CORS is configured to allow your domain
- [ ] Redirect URLs are set for your domain
- [ ] OAuth providers are properly configured
- [ ] Row Level Security (RLS) is enabled on auth tables
- [ ] Database uses HTTPS connections
- [ ] API validates all tokens with JWKS

## 10. Common Configuration Reference

```bash
# Development
SUPABASE_URL=https://mmpluqmxpgbgmimfviru.supabase.co
SUPABASE_ANON_KEY=sb_publishable_aV2IHPkdJYcXER87Qamntw_QO-rr2Lm
SUPABASE_SERVICE_ROLE_KEY=sb_secret_Kb3K2PIECIMkTYiGo8iH0Q_Ge0biOiS

# Frontend only (.env variables with VITE_ prefix)
VITE_SUPABASE_URL=https://mmpluqmxpgbgmimfviru.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_aV2IHPkdJYcXER87Qamntw_QO-rr2Lm
```

## Next Steps

1. ✅ Configure `.env` files (you've done this!)
2. ✅ Set up auth providers (email/password minimum)
3. ✅ Run database migrations
4. ✅ Start dev server and test signup/login
5. → See [TESTING_AUTH.md](TESTING_AUTH.md) for detailed testing procedures
6. → See [AUTH_DEPLOYMENT_CHECKLIST.md](AUTH_DEPLOYMENT_CHECKLIST.md) for production deployment

---

**Questions?** Check the error logs:
- Backend: Check console output from `make dev`
- Frontend: Check browser console (F12)
- Database: Check Supabase dashboard logs
