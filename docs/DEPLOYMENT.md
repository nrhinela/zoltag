# PhotoCat Deployment Guide

This document provides quick reference for deploying and managing PhotoCat using `make` commands.

## Quick Start

```bash
# See all available commands
make help

# Check your environment configuration
make env-check
```

## Common Workflows

### Development

```bash
# Start the development server
make dev

# Run the background worker
make worker

# Run tests
make test
```

### Database Management

```bash
# Start Cloud SQL Proxy (required for local database access)
make db-proxy

# Connect to dev database
make db-dev

# Connect to prod database
make db-prod

# Run migrations on dev
make db-migrate-dev

# Run migrations on prod (with confirmation)
make db-migrate-prod

# Create a new migration
make db-create-migration ENV=dev
# or
make db-create-migration ENV=prod
```

### Deployment

```bash
# Deploy everything to production (API + Worker)
make deploy-all

# Or deploy individually
make deploy-api      # Deploy API service only
make deploy-worker   # Deploy worker service only

# Check deployment status
make status

# View logs
make logs-api
make logs-worker
```

## Complete Deployment Process

Here's the typical workflow for deploying to production:

### 1. Ensure Cloud SQL Proxy is Running

```bash
# Start the proxy in a separate terminal
make db-proxy
```

### 2. Test Locally

```bash
# Make sure your changes work locally
make dev

# Run tests
make test
```

### 3. Run Migrations on Production Database

```bash
# Connect to prod and verify current state
make db-prod
# Type \q to exit psql

# Run migrations (will ask for confirmation)
make db-migrate-prod
```

### 4. Deploy to Production

```bash
# Deploy both API and worker services
make deploy-all

# Or deploy them individually
make deploy-api
make deploy-worker
```

### 5. Verify Deployment

```bash
# Check status
make status

# View logs to ensure everything is working
make logs-api
make logs-worker
```

## Environment Variables

You can override the default environment:

```bash
# Target a specific environment
make db-migrate-dev ENV=dev
make db-create-migration ENV=prod
```

Default values (see Makefile):
- `ENV=dev`
- `PROJECT_ID=photocat-483622`
- `REGION=us-central1`

## Destructive Operations

These commands will **permanently delete data**. Use with caution:

```bash
# Reset dev database (deletes all data)
make db-reset-dev

# Reset prod database (deletes all data, asks for confirmation)
make db-reset-prod
```

## Troubleshooting

### Cloud SQL Proxy Not Running

If you get errors about database connections:

```bash
# Check if proxy is running
make check-proxy

# If not, start it
make db-proxy
```

### Alembic/Python Commands Not Found

Make sure you're in the photocat directory and your virtualenv is activated:

```bash
cd /Users/ned.rhinelander/Developer/photocat
source ~/.zshrc  # This auto-activates the virtualenv
```

### View Current Environment

```bash
make env-check
```

## Docker (Local Testing)

```bash
# Build Docker image locally
make docker-build

# Run Docker container
make docker-run

# Run tests in Docker
make docker-test
```

## Utilities

```bash
# Clean build artifacts
make clean

# Format code
make format

# Lint code
make lint

# Install/update dependencies
make install
```

## Additional Notes

- The Makefile automatically checks if Cloud SQL Proxy is running before database operations
- `db-migrate-prod` requires confirmation to prevent accidental production changes
- All deployment commands use the configuration from `cloudbuild.yaml`
- Logs are limited to the last 50 entries by default
