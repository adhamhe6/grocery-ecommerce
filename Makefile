.DEFAULT_GOAL := help
SHELL := /bin/bash

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

env: ## Create .env with freshly generated secrets (never overwrites an existing .env)
	@test -f .env && echo ".env already exists — leaving it alone" || { \
	  cp .env.example .env; \
	  sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(60))')|" .env; \
	  sed -i "s|^PAYMENT_WEBHOOK_SECRET=.*|PAYMENT_WEBHOOK_SECRET=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(40))')|" .env; \
	  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$(python3 -c 'import secrets; print(secrets.token_hex(24))')|" .env; \
	  echo "Created .env with generated secrets"; }

up: env ## Build and start the whole stack (http://localhost:3000)
	docker compose up --build -d

down: ## Stop the stack (keeps data volumes)
	docker compose down

seed: ## Load deterministic demo data into the running stack
	docker compose --profile tools run --rm seed

logs: ## Follow logs
	docker compose logs -f --tail=100

# ---- local development (no Docker): needs PostgreSQL 16 and Redis running locally -----------------------------------
backend-install: ## Create the backend virtualenv and install dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements/dev.txt

frontend-install: ## Install frontend dependencies
	cd frontend && npm ci

test-backend: ## Run the backend test suite (requires PostgreSQL)
	cd backend && .venv/bin/python -m pytest -q

lint-backend: ## Ruff lint + format check
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .

test-frontend: ## Frontend typecheck, lint and unit tests
	cd frontend && npm run typecheck && npm run lint && npm test

e2e: ## Playwright end-to-end suite (needs the stack running with demo data)
	cd frontend && npx playwright test

.PHONY: help env up down seed logs backend-install frontend-install test-backend lint-backend test-frontend e2e
