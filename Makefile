# Makefile for PhotoCat development and deployment

.PHONY: help install test lint format clean deploy migrate dev worker dev-backend dev-frontend dev-css
.PHONY: db-dev db-prod db-migrate-prod db-migrate-dev db-create-migration
.PHONY: deploy-api deploy-worker deploy-all status logs-api logs-worker env-check

# Default environment
ENV ?= prod
PROJECT_ID = photocat-483622
REGION = us-central1

help:
	@echo "PhotoCat - Make targets"
	@echo ""
	@echo "Development:"
	@echo "  install            Install dependencies"
	@echo "  dev                Run development server (backend + frontend + Tailwind CSS watch)"
	@echo "  dev-backend        Run backend development server only"
	@echo "  dev-frontend       Run frontend development server only"
	@echo "  dev-css            Run Tailwind CSS watch only"
	@echo "  worker             Run background worker"
	@echo "  test               Run tests"
	@echo "  lint               Run linters"
	@echo "  format             Format code"
	@echo "  clean              Clean build artifacts"
	@echo ""
	@echo "Database:"
	@echo "  db-dev             Connect to dev database (psql)"
	@echo "  db-prod            Connect to prod database (psql)"
	@echo "  db-migrate-dev     Run migrations on dev database"
	@echo "  db-migrate-prod    Run migrations on prod database"
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
	npm install

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
	@echo "Stopping any existing development processes..."
	@pkill -f "uvicorn photocat.api:app" || true
	@pkill -f "npm run dev" || true
	@pkill -f "npm run build:css" || true
	@pkill -f "vite" || true
	@sleep 1
	@echo "Starting development servers..."
	make dev-backend & make dev-frontend & make dev-css

dev-backend:
	@echo "Starting backend development server..."
	@echo "Environment: $(ENV)"
	@if [ ! -f .env ]; then \
		echo "ERROR: .env file not found. Please create one with DATABASE_URL set."; \
		exit 1; \
	fi
	set -a && . ./.env && set +a && \
	TOKENIZERS_PARALLELISM=false python3 -m uvicorn photocat.api:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	@echo "Starting frontend development server..."
	npm run dev

dev-css:
	@echo "Starting Tailwind CSS watch..."
	npm run build:css -- --watch


worker:
	@echo "Starting background worker..."
	WORKER_MODE=true python3 -m photocat.worker

# ============================================================================
# Database Management
# ============================================================================

db-dev:
	@echo "Connecting to database (DATABASE_URL)..."
	@if [ -z "$(DATABASE_URL)" ]; then \
		echo "DATABASE_URL is not set."; \
		exit 1; \
	fi
	psql "$(DATABASE_URL)"

db-prod:
	@echo "Connecting to database (DATABASE_URL)..."
	@if [ -z "$(DATABASE_URL)" ]; then \
		echo "DATABASE_URL is not set."; \
		exit 1; \
	fi
	psql "$(DATABASE_URL)"

db-migrate-dev:
	@echo "Running migrations on database (DATABASE_URL)..."
	@if [ -z "$(DATABASE_URL)" ]; then \
		echo "DATABASE_URL is not set."; \
		exit 1; \
	fi
	DATABASE_URL="$(DATABASE_URL)" alembic upgrade head

db-migrate-prod:
	@echo "Running migrations on database (DATABASE_URL)..."
	@echo "⚠️  About to run migrations on PRODUCTION database"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		if [ -z "$(DATABASE_URL)" ]; then \
			echo "DATABASE_URL is not set."; \
			exit 1; \
		fi; \
		DATABASE_URL="$(DATABASE_URL)" alembic upgrade head; \
	else \
		echo "Cancelled."; \
	fi

db-create-migration:
	@read -p "Migration name: " name; \
	if [ -z "$(DATABASE_URL)" ]; then \
		echo "DATABASE_URL is not set."; \
		exit 1; \
	fi; \
	DATABASE_URL="$(DATABASE_URL)" alembic revision --autogenerate -m "$$name"

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
		--memory=512Mi \
		--cpu=1 \
		--timeout=900 \
		--max-instances=1 \
		--min-instances=0 \
		--set-env-vars THUMBNAIL_CDN_BASE_URL=https://pc.nedeva.com

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
		--max-instances=10 \
		--set-env-vars THUMBNAIL_CDN_BASE_URL=https://pc.nedeva.com

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

env-check:
	@echo "Current environment configuration:"
	@echo "  ENV: $(ENV)"
	@echo "  PROJECT_ID: $(PROJECT_ID)"
	@echo "  REGION: $(REGION)"
	@echo ""
	@echo "Checking .env file:"
	@grep -E "^(ENVIRONMENT|DATABASE_URL)" .env 2>/dev/null || echo "  (not configured)"
