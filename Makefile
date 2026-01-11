# Makefile for PhotoCat development and deployment

.PHONY: help install test lint format clean deploy migrate dev worker
.PHONY: db-dev db-prod db-reset-dev db-reset-prod db-proxy db-migrate-prod db-migrate-dev
.PHONY: deploy-api deploy-worker deploy-all status logs-api logs-worker check-proxy env-check

# Default environment
ENV ?= dev
DB_PASSWORD = EcrZH7UymHpa6kqduFHG
PROJECT_ID = photocat-483622
REGION = us-central1

help:
	@echo "PhotoCat - Make targets"
	@echo ""
	@echo "Development:"
	@echo "  install            Install dependencies"
	@echo "  dev                Run development server"
	@echo "  worker             Run background worker"
	@echo "  test               Run tests"
	@echo "  lint               Run linters"
	@echo "  format             Format code"
	@echo "  clean              Clean build artifacts"
	@echo ""
	@echo "Database (Local/Cloud SQL via proxy):"
	@echo "  db-proxy           Start Cloud SQL proxy"
	@echo "  db-dev             Connect to dev database (psql)"
	@echo "  db-prod            Connect to prod database (psql)"
	@echo "  db-migrate-dev     Run migrations on dev database"
	@echo "  db-migrate-prod    Run migrations on prod database"
	@echo "  db-reset-dev       Reset dev database (DESTRUCTIVE)"
	@echo "  db-reset-prod      Reset prod database (DESTRUCTIVE)"
	@echo "  db-create-migration Create new migration"
	@echo ""
	@echo "Deployment:"
	@echo "  deploy-all         Deploy everything to production"
	@echo "  deploy-api         Deploy API service only"
	@echo "  deploy-worker      Deploy worker service only"
	@echo "  status             Show Cloud Run services status"
	@echo "  logs-api           Tail API service logs"
	@echo "  logs-worker        Tail worker service logs"
	@echo ""
	@echo "Utilities:"
	@echo "  check-proxy        Check if Cloud SQL proxy is running"
	@echo "  env-check          Show current environment configuration"
	@echo ""
	@echo "Environment variables:"
	@echo "  ENV=dev|prod       Target environment (default: dev)"

# ============================================================================
# Development
# ============================================================================

install:
	pip install --upgrade pip
	pip install -e ".[dev]"

test:
	pytest -v --cov=photocat --cov-report=term-missing

lint:
	ruff check src tests
	mypy src

format:
	black src tests
	ruff check --fix src tests

clean:
	rm -rf build dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete

dev:
	@echo "Starting development server..."
	@echo "Environment: $(ENV)"
	TOKENIZERS_PARALLELISM=false python3 -m uvicorn photocat.api:app --reload --host 0.0.0.0 --port 8080

worker:
	@echo "Starting background worker..."
	WORKER_MODE=true python3 -m photocat.worker

# ============================================================================
# Database Management
# ============================================================================

db-proxy:
	@echo "Starting Cloud SQL Proxy..."
	@echo "This will allow local connections to Cloud SQL"
	./scripts/start_cloud_sql_proxy.sh

db-dev:
	@echo "Connecting to dev database..."
	PGPASSWORD='$(DB_PASSWORD)' psql -h 127.0.0.1 -U photocat-user -d photocat_dev

db-prod:
	@echo "Connecting to prod database..."
	PGPASSWORD='$(DB_PASSWORD)' psql -h 127.0.0.1 -U photocat-user -d photocat_prod

db-migrate-dev: check-proxy
	@echo "Running migrations on dev database..."
	DATABASE_URL="postgresql://photocat-user:$(DB_PASSWORD)@127.0.0.1:5432/photocat_dev" \
		alembic upgrade head

db-migrate-prod: check-proxy
	@echo "Running migrations on prod database..."
	@echo "⚠️  About to run migrations on PRODUCTION database"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		DATABASE_URL="postgresql://photocat-user:$(DB_PASSWORD)@127.0.0.1:5432/photocat_prod" \
			alembic upgrade head; \
	else \
		echo "Cancelled."; \
	fi

db-reset-dev: check-proxy
	@echo "⚠️  Resetting dev database (all data will be lost)"
	./scripts/reset_cloud_db.sh dev

db-reset-prod: check-proxy
	@echo "⚠️  Resetting PRODUCTION database (all data will be lost)"
	./scripts/reset_cloud_db.sh prod

db-create-migration: check-proxy
	@read -p "Migration name: " name; \
	DATABASE_URL="postgresql://photocat-user:$(DB_PASSWORD)@127.0.0.1:5432/photocat_$(ENV)" \
		alembic revision --autogenerate -m "$$name"

# Alias for backward compatibility
migrate: db-migrate-dev

migrate-create: db-create-migration

# ============================================================================
# Deployment
# ============================================================================

deploy-all:
	@echo "Deploying PhotoCat to production..."
	@echo "Project: $(PROJECT_ID)"
	@echo "Region: $(REGION)"
	@echo ""
	COMMIT_SHA=$$(git rev-parse --short HEAD) ; \
	gcloud builds submit --config=cloudbuild.yaml --substitutions=_COMMIT_SHA=$$COMMIT_SHA

# Alias for backward compatibility
deploy: deploy-all

deploy-api:
	@echo "Deploying API service only..."
	gcloud run deploy photocat-api \
		--image gcr.io/$(PROJECT_ID)/photocat:latest \
		--region $(REGION) \
		--platform managed \
		--allow-unauthenticated \
		--memory=8Gi \
		--cpu=2 \
		--timeout=900 \
		--max-instances=10 \
		--min-instances=1

deploy-worker:
	@echo "Deploying worker service only..."
	gcloud run deploy photocat-worker \
		--image gcr.io/$(PROJECT_ID)/photocat:latest \
		--region $(REGION) \
		--platform managed \
		--no-allow-unauthenticated \
		--memory=8Gi \
		--cpu=2 \
		--timeout=900 \
		--max-instances=10

status:
	@echo "Cloud Run Services Status:"
	@echo ""
	gcloud run services list --platform managed --region $(REGION)
	@echo ""
	@echo "Recent builds:"
	gcloud builds list --limit 5

logs-api:
	@echo "Tailing API service logs..."
	gcloud run services logs read photocat-api \
		--region $(REGION) \
		--limit 50 \
		--format "table(severity,timestamp.date('%Y-%m-%d %H:%M:%S'),textPayload)"

logs-worker:
	@echo "Tailing worker service logs..."
	gcloud run services logs read photocat-worker \
		--region $(REGION) \
		--limit 50 \
		--format "table(severity,timestamp.date('%Y-%m-%d %H:%M:%S'),textPayload)"

# ============================================================================
# Docker (local testing)
# ============================================================================

docker-build:
	docker build -t photocat:local .

docker-run:
	docker run -p 8080:8080 --env-file .env photocat:local

docker-test:
	docker build -t photocat:test . && \
	docker run --rm photocat:test pytest

# ============================================================================
# Utilities
# ============================================================================

check-proxy:
	@if ! lsof -i:5432 2>/dev/null | grep -q LISTEN; then \
		echo "❌ Cloud SQL Proxy is not running on port 5432"; \
		echo "Run: make db-proxy"; \
		exit 1; \
	else \
		echo "✓ Cloud SQL Proxy is running"; \
	fi

env-check:
	@echo "Current environment configuration:"
	@echo "  ENV: $(ENV)"
	@echo "  PROJECT_ID: $(PROJECT_ID)"
	@echo "  REGION: $(REGION)"
	@echo ""
	@echo "Checking .env file:"
	@grep -E "^(ENVIRONMENT|DATABASE_URL)" .env 2>/dev/null || echo "  (not configured)"
