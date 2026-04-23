# myReport

Multi-tenant SaaS platform for audit firms. Mission management, parameterisable questionnaires, audit report generation (docx + optional md→PDF), optional AI rewriting, fine-grained RBAC.

## Stack

Node 24 LTS · TypeScript (strict) · Fastify + TypeBox · Drizzle + Postgres 16 (RLS) · Vue 3 + Vite + PrimeVue (Aura) · Tailwind v4 · BullMQ + Redis · docxtemplater · CASL · pnpm workspaces + Turborepo · Biome · Vitest · Playwright.

## Layout

```
apps/
  api/       # Fastify API
  web/       # Vue 3 + Vite front
  worker/    # BullMQ workers (AI, reports, emails)
packages/
  db/               # Drizzle schema, migrations, seeds
  shared-types/     # Shared TS types (API DTOs)
  shared-schemas/   # TypeBox schemas + Zod helpers
  ai/               # AIProvider abstraction + implementations
  rbac/             # CASL abilities (iso back/front)
  report-engine/    # docx + md→PDF generation
infra/              # docker-compose, terraform
docs/               # architecture, ADRs, runbooks
```

## Getting started

```sh
# Requires Node 24 LTS and pnpm 10+
nvm use               # reads .nvmrc
pnpm install
pnpm dev
```

## Quality gates

Before pushing:

```sh
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass. See [`CLAUDE.md`](./CLAUDE.md) for the full quality bar.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — high-level architecture
- [`docs/adr/`](./docs/adr/) — Architecture Decision Records
- Per-package `README.md` under `packages/*` and `apps/*`
