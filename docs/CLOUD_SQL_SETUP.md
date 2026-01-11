# Cloud SQL Development Setup Guide

This guide will help you switch from local PostgreSQL to Cloud SQL for development.

## Database Structure

The Cloud SQL instance has **separate databases for each environment**:
- `photocat_dev` - Development database
- `photocat_prod` - Production database

Both databases are in the same Cloud SQL instance (`photocat-db`).

## Prerequisites

1. **Install Cloud SQL Proxy** (if not already installed):
   ```bash
   brew install cloud-sql-proxy
   ```

## Quick Setup

### Step 1: Get the Database Password

You'll need the password for the `photocat-user` database user. If you don't have it, reset it:

```bash
gcloud sql users set-password photocat-user \
  --instance=photocat-db \
  --password=YOUR_NEW_PASSWORD \
  --project=photocat-483622
```

### Step 2: Start the Cloud SQL Proxy

In a **separate terminal window**, run:

```bash
./scripts/start_cloud_sql_proxy.sh
```

Keep this terminal open - the proxy needs to stay running. The proxy will make your Cloud SQL database available at `127.0.0.1:5432`.

### Step 3: Update Your `.env` File

Update the `ENVIRONMENT` and `DATABASE_URL` in your `.env` file:

**For Development:**
```bash
ENVIRONMENT=dev
DATABASE_URL=postgresql://photocat-user:YOUR_PASSWORD@127.0.0.1:5432/photocat_dev
```

**For Production:**
```bash
ENVIRONMENT=prod
DATABASE_URL=postgresql://photocat-user:YOUR_PASSWORD@127.0.0.1:5432/photocat_prod
```

Replace `YOUR_PASSWORD` with the actual database password.

### Step 4: Reset the Database (Development)

To start fresh with the dev database:

```bash
./scripts/reset_cloud_db.sh dev
```

This will:
- Drop the `photocat_dev` database
- Recreate it fresh
- Run all migrations

**For Production (use with caution!):**
```bash
./scripts/reset_cloud_db.sh prod
```

### Step 5: Verify the Setup

Test the connection:

```bash
PGPASSWORD='YOUR_PASSWORD' psql -h 127.0.0.1 -U photocat-user -d photocat_dev \
  -c "SELECT version();"
```

You should see PostgreSQL version information.

## Daily Usage

**Every time you start development:**

1. Start the Cloud SQL Proxy in a terminal:
   ```bash
   ./scripts/start_cloud_sql_proxy.sh
   ```

2. In another terminal, run your app:
   ```bash
   uvicorn photocat.api:app --host 0.0.0.0 --port 8080 --reload
   ```

## Alternative: Background Proxy

If you want the proxy to run in the background:

```bash
# Start in background
cloud-sql-proxy photocat-483622:us-central1:photocat-db &

# To stop it later, find the PID:
ps aux | grep cloud-sql-proxy

# Then kill it:
kill <PID>
```

## Troubleshooting

### "Connection refused" errors

- Make sure the Cloud SQL Proxy is running
- Check that your DATABASE_URL uses `127.0.0.1:5432`

### "Password authentication failed"

- Verify the password is correct
- Try resetting it with the command in Step 1

### "Database does not exist"

- Make sure you ran Steps 4 and 5 to create and migrate the database

## Cloud SQL Instance Details

- **Project**: photocat-483622
- **Instance**: photocat-db
- **Region**: us-central1
- **Databases**:
  - `photocat_dev` (development)
  - `photocat_prod` (production)
  - `photocat` (legacy - not used)
- **User**: photocat-user
- **Version**: PostgreSQL 15

## Environment Configuration

Your `.env` file should have the `ENVIRONMENT` variable set to match the database you're using:

```bash
# For development
ENVIRONMENT=dev
DATABASE_URL=postgresql://photocat-user:PASSWORD@127.0.0.1:5432/photocat_dev

# For production
ENVIRONMENT=prod
DATABASE_URL=postgresql://photocat-user:PASSWORD@127.0.0.1:5432/photocat_prod
```

This ensures:
- Storage buckets use the correct naming: `photocat-483622-dev-shared` or `photocat-483622-prod-shared`
- The application behavior matches the environment
