SHELL := /bin/bash
.DEFAULT_GOAL := help

# Read DATABASE_URL from the repo-root .env. Other vars are read by the
# underlying tools (pnpm scripts, docker compose) directly from .env.
DATABASE_URL := $(shell grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d'=' -f2-)

.PHONY: help psql q db-tables db-describe db-migrate db-seed db-reset db-studio

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

psql: ## Open an interactive psql session against the dev database
	@psql "$(DATABASE_URL)"

q: ## Run a one-shot SQL query: make q QUERY="select count(*) from users"
	@test -n "$(QUERY)" || (echo 'Usage: make q QUERY="..."'; exit 1)
	@psql "$(DATABASE_URL)" -c "$(QUERY)"

db-tables: ## List tables in the dev database
	@psql "$(DATABASE_URL)" -c "\dt"

db-describe: ## Describe a table: make db-describe TABLE=users
	@test -n "$(TABLE)" || (echo 'Usage: make db-describe TABLE=<name>'; exit 1)
	@psql "$(DATABASE_URL)" -c "\d $(TABLE)"

db-migrate: ## Apply pending Drizzle migrations
	@pnpm -C packages/db db:migrate

db-seed: ## Run the dev seed (idempotent)
	@pnpm -C packages/db db:seed

db-reset: ## Tear down + recreate the dev DB (alias of pnpm dev:reset)
	@pnpm dev:reset

db-studio: ## Open Drizzle Studio
	@pnpm -C packages/db db:studio
