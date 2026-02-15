# Makefile for Zoltag development and deployment

.PHONY: help install test lint format clean deploy migrate dev worker dev-backend dev-frontend dev-css dev-clean
.PHONY: db-dev db-prod db-migrate-prod db-migrate-dev db-create-migration
.PHONY: deploy-api deploy-worker deploy-all status logs-api logs-worker env-check
.PHONY: train-and-recompute daily verify-video-rollout

# Default environment
ENV ?= prod
PROJECT_ID = photocat-483622
REGION = us-central1
DEV_PID_FILE = .dev-pids

help:
	@echo "Zoltag - Make targets"
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
	@echo "  train-and-recompute Train keyword models and recompute tags"
	@echo "  daily              Sync Dropbox then train + recompute tags"
	@echo "  verify-video-rollout Verify video-thumbnail rollout (DB + optional API smoke checks)"
	@echo "                      Use VERIFY_ARGS='--skip-api' etc to pass script flags"
	@echo ""
	@echo "Environment variables:"
	@echo "  ENV=dev|prod       Target environment (default: dev)"
	@echo "  TENANT_ID          Tenant ID for train-and-recompute target"

# ============================================================================
# Development
# ============================================================================

install:
	pip install --upgrade pip
	pip install -e ".[dev]"
	npm install

test:
	pytest -v --cov=zoltag --cov-report=term-missing

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
	@$(MAKE) dev-clean
	@echo "Starting development servers..."
	@rm -f $(DEV_PID_FILE)
	@set -e; \
	$(MAKE) dev-backend & backend_pid=$$!; \
	$(MAKE) dev-frontend & frontend_pid=$$!; \
	$(MAKE) dev-css & css_pid=$$!; \
	echo "$$backend_pid $$frontend_pid $$css_pid" > $(DEV_PID_FILE); \
	echo "Dev process ids: backend=$$backend_pid frontend=$$frontend_pid css=$$css_pid"; \
	trap 'echo "Stopping dev processes..."; kill $$backend_pid $$frontend_pid $$css_pid 2>/dev/null || true; wait $$backend_pid $$frontend_pid $$css_pid 2>/dev/null || true; rm -f $(DEV_PID_FILE)' INT TERM EXIT; \
	wait $$backend_pid $$frontend_pid $$css_pid

dev-clean:
	@echo "Stopping any existing development processes..."
	@set -e; \
	pids=""; \
	if [ -f $(DEV_PID_FILE) ]; then \
		pids="$$pids $$(cat $(DEV_PID_FILE) 2>/dev/null || true)"; \
		rm -f $(DEV_PID_FILE); \
	fi; \
	for pattern in "uvicorn zoltag.api:app" "zoltag.api:app" "npm run dev" "npm run build:css" "node .*vite" "node .*tailwindcss" "tailwindcss"; do \
		if command -v pgrep >/dev/null 2>&1; then \
			found="$$(pgrep -f "$$pattern" 2>/dev/null || true)"; \
			if [ -n "$$found" ]; then \
				pids="$$pids $$found"; \
			fi; \
		elif command -v pkill >/dev/null 2>&1; then \
			pkill -f "$$pattern" 2>/dev/null || true; \
		fi; \
	done; \
	for port in 8000 5173; do \
		if command -v lsof >/dev/null 2>&1; then \
			ids=$$(lsof -tiTCP:$$port -sTCP:LISTEN || true); \
			if [ -n "$$ids" ]; then \
				echo "Found listeners on port $$port: $$ids"; \
				pids="$$pids $$ids"; \
			fi; \
		fi; \
	done; \
	uniq_pids=$$(printf '%s\n' $$pids | awk 'NF && !seen[$$1]++ {print $$1}'); \
	if [ -n "$$uniq_pids" ]; then \
		echo "Sending SIGTERM to: $$uniq_pids"; \
		echo "$$uniq_pids" | xargs kill 2>/dev/null || true; \
		sleep 2; \
		still_alive=""; \
		for pid in $$uniq_pids; do \
			if kill -0 $$pid 2>/dev/null; then \
				still_alive="$$still_alive $$pid"; \
			fi; \
		done; \
		if [ -n "$$still_alive" ]; then \
			echo "Force killing stuck processes: $$still_alive"; \
			echo "$$still_alive" | xargs kill -9 2>/dev/null || true; \
		fi; \
	else \
		echo "No matching dev processes found."; \
	fi; \
	sleep 1

dev-backend:
	@echo "Starting backend development server..."
	@echo "Environment: $(ENV)"
	@if [ ! -f .env ]; then \
		echo "ERROR: .env file not found. Please create one with DATABASE_URL set."; \
		exit 1; \
	fi
	set -a && . ./.env && set +a && \
	TOKENIZERS_PARALLELISM=false python3 -m uvicorn zoltag.api:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	@echo "Starting frontend development server..."
	npm run dev

dev-css:
	@echo "Starting Tailwind CSS watch..."
	npm run build:css -- --watch


worker:
	@echo "Starting background worker..."
	WORKER_MODE=true python3 -m zoltag.worker

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
	@echo "Deploying Zoltag to production..."
	@echo "Project: $(PROJECT_ID)"
	@echo "Region: $(REGION)"
	@echo ""
	COMMIT_SHA=$$(git rev-parse --short HEAD) ; \
	gcloud builds submit --project $(PROJECT_ID) --config=cloudbuild.yaml --substitutions=_COMMIT_SHA=$$COMMIT_SHA

# Alias for backward compatibility
deploy: deploy-all

deploy-api:
	@echo "Deploying API service only..."
	gcloud run deploy zoltag-api \
		--project $(PROJECT_ID) \
		--image gcr.io/$(PROJECT_ID)/zoltag:latest \
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
	gcloud run deploy zoltag-worker \
		--project $(PROJECT_ID) \
		--image gcr.io/$(PROJECT_ID)/zoltag:latest \
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
	gcloud run services list --project $(PROJECT_ID) --platform managed --region $(REGION)
	@echo ""
	@echo "Recent builds:"
	gcloud builds list --project $(PROJECT_ID) --limit 5

logs-api:
	@echo "Tailing API service logs..."
	gcloud run services logs read zoltag-api \
		--project $(PROJECT_ID) \
		--region $(REGION) \
		--limit 50 \
		--format "table(severity,timestamp.date('%Y-%m-%d %H:%M:%S'),textPayload)"

logs-worker:
	@echo "Tailing worker service logs..."
	gcloud run services logs read zoltag-worker \
		--project $(PROJECT_ID) \
		--region $(REGION) \
		--limit 50 \
		--format "table(severity,timestamp.date('%Y-%m-%d %H:%M:%S'),textPayload)"

# ============================================================================
# Docker (local testing)
# ============================================================================

docker-build:
	docker build -t zoltag:local .

docker-run:
	docker run -p 8080:8080 --env-file .env zoltag:local

docker-test:
	docker build -t zoltag:test . && \
	docker run --rm zoltag:test pytest

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

train-and-recompute:
	@if [ -z "$(TENANT_ID)" ]; then \
		echo "ERROR: TENANT_ID is required"; \
		echo "Usage: make train-and-recompute TENANT_ID=<tenant_id>"; \
		exit 1; \
	fi
	@echo "Training keyword models for tenant: $(TENANT_ID)..."
	zoltag train-keyword-models --tenant-id $(TENANT_ID)
	@echo "Recomputing trained tags..."
	zoltag recompute-trained-tags --tenant-id $(TENANT_ID) --replace
	@echo "Recomputing SigLIP tags..."
	zoltag recompute-siglip-tags --replace --tenant-id $(TENANT_ID)
	@echo "Done!"

daily:
	@if [ -z "$(TENANT_ID)" ]; then \
		echo "ERROR: TENANT_ID is required"; \
		echo "Usage: make daily TENANT_ID=<tenant_id>"; \
		exit 1; \
	fi
	@echo "Syncing Dropbox for tenant: $(TENANT_ID)..."
	zoltag sync-dropbox --tenant-id $(TENANT_ID)
	@echo "Running train-and-recompute..."
	$(MAKE) train-and-recompute TENANT_ID=$(TENANT_ID)

verify-video-rollout:
	@echo "Running video-thumbnail rollout verification..."
	@set -e; \
	if [ -f .env ]; then \
		set -a; . ./.env; set +a; \
	fi; \
	PY_CMD=".venv/bin/python"; \
	if [ ! -x "$$PY_CMD" ]; then \
		PY_CMD="python3"; \
	fi; \
	"$$PY_CMD" scripts/verify_video_thumbnail_rollout.py $(VERIFY_ARGS)
