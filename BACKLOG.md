# myReport — Backlog

Single source of truth pour suivre l'avancement. Mis à jour à chaque fin d'étape (avant commit). Rédigé en FR pour suivi perso, sans impact sur la règle "commentaires en anglais" du code.

**Légende**

- `[ ]` à faire
- `[~]` en cours
- `[x]` terminé (lint + typecheck + test verts + doc à jour + committé)
- `[!]` bloqué (voir note)

---

## Phase 0 — Setup

- [x] **Cadrage & ADR 0001** — doc d'architecture archivée + ADR des choix de stack. *(2026-04-23)*
- [x] **Scaffold monorepo** — pnpm workspaces, Turborepo, Biome 2, tsconfig strict, arborescence `apps/` + `packages/` + `docs/` + `infra/`. *(2026-04-23)*
- [x] **Infra locale** — `infra/docker-compose.yml` (Postgres 16 + Redis 7 + MinIO), scripts `pnpm dev:up/down/logs/reset`, init SQL (extensions). *(2026-04-23)*
- [ ] **CI de base** — GitHub Actions : lint + typecheck + test sur PR. Dependabot activé.
- [ ] **Pre-commit hooks** — husky + lint-staged (Biome check sur fichiers stagés).

## Phase 1 — Fondations data & auth

- [ ] **Package `db`** — Drizzle config, schéma initial (`tenants`, `users`, `memberships`, `sessions`, `mission_members`), migrations, seed dev.
- [ ] **RLS** — policies sur toutes les tables `tenant_id`, rôle `app_user` (pas de BYPASSRLS), rôle `app_admin` dédié au super-admin. Tests d'isolation obligatoires.
- [ ] **Package `shared-schemas`** — TypeBox pour les DTOs API + helpers conversion Zod.
- [ ] **API squelette** — Fastify 5, plugins tenant context, auth (JWT access + refresh httpOnly), rate limit, route `/me`, OpenAPI auto-généré.
- [ ] **Package `rbac`** — CASL, abilities isomorphes, dérivées dynamiquement depuis les rôles + `mission_members`.

## Phase 2 — Front & flux admin

- [ ] **Front squelette** — Vue 3 + Vite, PrimeVue Aura, Tailwind v4, vue-router, Pinia, layout responsive (mobile testé dès le départ).
- [ ] **Client API typé** — dérivé des schémas TypeBox (pas de `fetch` nu).
- [ ] **Login + /me** — UX auth complète (access short + refresh silent), gestion expiration.
- [ ] **Admin tenants** (super_admin) — création cabinet + premier `cabinet_admin`.
- [ ] **Gestion users** (cabinet_admin) — inviter auditors, rôles, révocation.

## Phase 3 — Cœur métier

- [ ] **Templates questionnaires** — éditeur Monaco (JSON validé par méta-schema TypeBox), versionnage immuable.
- [ ] **Missions** — CRUD, assignation d'auditors, cycle `draft → in_progress → submitted → closed`.
- [ ] **Remplissage** — formulaire dynamique généré depuis le `schema` JSONB du template version, validation type-aware, pièces jointes vers S3.
- [ ] **Invitation auditee** — email + lien magique scopé mission, écran de remplissage allégé.

## Phase 4 — Rapports & IA

- [ ] **Package `report-engine`** — génération docx via docxtemplater, placeholders + boucles, résolution branding tenant.
- [ ] **Worker** (app) — BullMQ, job `generate-report`, stockage sortie sur S3, SSE vers le front.
- [ ] **Package `ai`** — abstraction `AIProvider`, implémentation Anthropic par défaut, OpenAI fallback, cache `(mission_id, question_id, input_hash)`.
- [ ] **UI réécriture** — bouton « Reformuler » sur champs texte long, toggle global par cabinet.
- [ ] **Mode BYOK** — écran config clé API, chiffrement libsodium, rotation clé maître documentée.
- [ ] **Templates rapport par cabinet** — upload `.docx`, validation placeholders, manifest JSON des variables.

## Phase 5 — Polish MVP

- [ ] **Export markdown → PDF** (optionnel, si demandé).
- [ ] **Monitoring rapports IA** — `ai_usage` dashboard cabinet + super-admin, quotas.
- [ ] **E2E Playwright** — parcours : login, créer mission, remplir, générer rapport.
- [ ] **Runbook déploiement** — docs/runbook/, doc Hetzner + Scaleway ou équivalent.

## Reportés / V2+

- [ ] Offline mode (sync SQLite client, CRDT/LWW, résolution conflits).
- [ ] Signature électronique (DocuSign / Yousign).
- [ ] API publique pour cabinets.
- [ ] Marketplace de templates.
- [ ] Mobile natif (si vraiment demandé).

---

## Décisions ouvertes

- Hébergement prod (Hetzner probable, Postgres managé vs auto).
- Emails transactionnels (Postmark / Resend / SMTP).
- Observabilité (Pino + Loki/Axiom/Better Stack).

## Dette technique déclarée

_(aucune pour l'instant)_
