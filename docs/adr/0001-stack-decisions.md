# ADR 0001 — Initial stack decisions

- **Status**: Accepted
- **Date**: 2026-04-23
- **Deciders**: Franck

## Context

Greenfield SaaS for audit firms. Multi-tenant, data-heavy, report generation, optional AI. Solo dev, senior Node/TS background, past experience on LogiBOP informs several "what not to do" decisions.

## Decision

Stack choices validated in initial architecture document and during setup discussion:

| Concern | Choice | Alternatives rejected |
|---|---|---|
| Runtime | Node 24 LTS | Node 22 (older LTS), Node 25 (not LTS, short support) |
| Language | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | Loose TS (rejected: tech debt target), JS (no) |
| API framework | Fastify | Express (no plugins, no built-in schema), Hono (smaller ecosystem), Koa (abandoned feel) |
| ORM | Drizzle | Prisma (too magical, RLS workarounds), TypeORM (legacy), Sequelize (no) |
| DB | Postgres 16+ with RLS | Mysql (no JSONB ergonomics, weaker RLS story), Mongo (multi-tenant reporting = pain) |
| Multi-tenancy | Shared schema + `tenant_id` + RLS | Schema-per-tenant (migration pain at scale), DB-per-tenant (overkill <1000 tenants) |
| Input validation | TypeBox (back) + Zod (front) | Single-lib everywhere (Zod back = extra conversion to JSON Schema for Fastify; TypeBox front = worse DX for Vue) |
| Front framework | Vue 3 + Vite + vue-router + Pinia | Nuxt (SSR magic unused for auth-gated app), React (team prefers Vue) |
| UI lib | PrimeVue 4 (Aura theme) | Naive-UI (smaller), Vuetify (heavier), headless + custom (too much work solo) |
| Styling | Tailwind v4 + PrimeVue tokens | CSS modules only (no utilities), UnoCSS (less mature ecosystem) |
| Auth | Fastify + JWT (short access + httpOnly refresh) + argon2 | Lucia (abstraction layer we don't need), session cookies (less mobile-friendly for V2) |
| RBAC | CASL (iso back/front) | AccessControl (heavier), homegrown (never again) |
| Queue | BullMQ + Redis | Inngest (vendor lock-in), SQS (ops overhead solo) |
| Docx generation | docxtemplater | Raw OOXML (time sink), Carbone (license), Word automation (absurd) |
| Monorepo | pnpm workspaces + Turborepo | Nx (heavier), Moonrepo (smaller community), no monorepo (DRY violations inevitable) |
| Lint/format | Biome 2 | ESLint + Prettier (slow, duplicated config) |
| Tests | Vitest + @vue/test-utils + Playwright + Testcontainers | Jest (slower, CJS pain), Cypress (Playwright more capable now) |
| Storage | S3-compatible (MinIO dev, Scaleway/R2/BYOK prod) | Local filesystem (no HA), GCS/Azure (no reason to leave S3 API) |
| AI providers | Anthropic default, OpenAI fallback, Ollama experimental, BYOK + managed modes | Single-provider lock-in (rejected on principle) |

## Consequences

### Positive

- Every major choice has a clear "not this instead" rationale — future drift becomes explicit via new ADRs.
- Stack is coherent: TypeScript end-to-end, schema-first APIs, typed RBAC shared across back/front.
- Mature libraries with active maintenance (Fastify, Drizzle, Vue, Biome, Vitest).
- RLS eliminates an entire class of tenant-leakage bugs at the database boundary.

### Negative / trade-offs

- Solo dev maintaining a monorepo with 3 apps + 6 packages requires discipline on boundaries.
- Drizzle is less widespread than Prisma — less Stack Overflow, more reading source. Accepted.
- PrimeVue theming has a learning curve compared to a utility-first-only setup.
- Node 24 LTS is recent; some niche libraries may lag. Mitigate by checking `engines` at install.

### Future / deferred

- **Offline mode** (V2): schema already prepared with UUID v7, `updated_at`, `deleted_at` everywhere to ease future sync.
- **Mobile native**: not planned. Responsive web only.
- **BMAD-METHOD** workflow: followed in spirit (short iterations, well-scoped stories), not ceremonially.

## Notes

- Dependencies are always pinned to latest stable at install time (`pnpm add pkg@latest`). Dependabot + `pnpm audit` in CI. See `CLAUDE.md` for the full dependency policy.
- This ADR will not be amended; future decisions supersede it via new numbered ADRs.
