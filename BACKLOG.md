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
- [x] **Infra locale** — `infra/docker-compose.yml` (Postgres 16 port hôte 5433 + Redis 7 + MinIO), scripts `pnpm dev:up/down/logs/reset`, init SQL (extensions). *(2026-04-23)*
- [x] **CI de base** — GitHub Actions : lint + typecheck + test sur PR, audit deps séparé, Dependabot hebdo (npm + github-actions), PR template. *(2026-04-23)*
- [x] **Pre-commit hooks** — husky 9.1.7 + lint-staged 16.2.7, Biome `check --write` sur fichiers stagés, bloque les erreurs non auto-fixables. *(2026-04-24)*

## Phase 1 — Fondations data & auth

- [x] **Package `db`** — Drizzle config + schéma initial (`tenants`, `users`, `memberships`, `sessions`, `missions` minimal, `mission_members`), migration `0000_init`, seed dev (tenant demo) idempotent. *(2026-04-24)*
- [x] **RLS** — migration `0001_rls` : rôles `app_user` (NOBYPASSRLS) + `app_admin` (BYPASSRLS), FORCE RLS sur les 6 tables, 21 policies, helper `app_current_uuid(text)`. Tests Vitest + Testcontainers couvrent isolation inter-tenants, GUC absente = 0 rows, bypass admin (11 tests verts). *(2026-04-24)*
- [x] **Package `shared-schemas`** — primitives (`Uuid`, `Email`, `NonEmptyString`, `IsoDateTime`) et enveloppes (`ErrorResponse`, `PaginationQuery/Meta/PaginatedResponse`) déclarées en double TypeBox + Zod, parité validée par tests (`expectParity`). Format registry TypeBox initialisé pour `email`/`uuid`/`date-time`. *(2026-04-27)*
- [x] **API squelette** — Fastify 5 + TypeBox, JWT access (15m, HS256) + refresh tokens opaques sha256 stockés dans `sessions` (rotation + détection de réutilisation), cookies httpOnly Secure(prod) SameSite=Lax, argon2id, plugins `withAdminTx`/`withTenantTx` (RLS via SET LOCAL ROLE + GUCs `app.current_user_id`/`app.current_tenant_id`), rate limit (100/min global, 5/min sur /auth/login), error handler global → enveloppe `ErrorResponse`, OpenAPI auto à `/docs`. Routes : `POST /auth/{login,refresh,logout}`, `GET /me`, `GET /health`. Tests intégration Testcontainers (7 verts). *(2026-04-27)*
- [x] **Package `rbac`** — CASL 6.8.0 isomorphic, subjects discriminés (`Tenant`/`User`/`Membership`/`Mission`/`MissionMember`), actions CRUD + `submit`/`close`. `defineAbilitiesFor(ctx)` couvre super_admin, no-tenant, cabinet_admin, et auditor avec règles fines `lead`/`contributor`/`observer` par mission. Câblé dans `apps/api` via `request.ability` (lazy, après `requireAuth`) + helper `app.requireAbility(action, subject)`. 12 tests rbac + 2 tests intégration api. *(2026-04-27)*
- [x] **Refactor `auth_identities`** — extraction des credentials hors de `users` pour préparer SSO (Google/Microsoft) et magic link. Nouvelle table `auth_identities (id, user_id, provider, provider_subject, secret_hash, email_at_link, last_used_at, ...)` avec enum `auth_provider ('password'|'google'|'microsoft'|'magic_link')`. Indexes uniques partiels : `(provider, provider_subject)` et `(user_id, provider)` filtrés `deleted_at is null`. Migration `0002_auth_identities` : création table → backfill (chaque `users.password_hash` → `auth_identity` provider='password') → DROP COLUMN → RLS (FORCE, policy SELECT/UPDATE self, INSERT/DELETE via app_admin). Login route Fastify lit le hash via jointure sur `auth_identities` filtrée par `provider='password'` et met à jour `last_used_at`. Tests RLS étendus (isolation owner-only sur identities, bypass admin, GUC absente = 0 rows). *(2026-04-28)*

## Phase 2 — Front & flux admin

- [x] **Front squelette** — Vue 3 + Vite 7 + PrimeVue 4 (Aura) + Tailwind v4 + vue-router + Pinia. Layout `AppShell` mobile-first 375 px (topbar + drawer hamburger < lg, sidebar permanente lg+). Vues `Home`/`Login`/`NotFound` (lazy). Login utilise `ZLoginRequest` de `shared-schemas` (form non câblé sur l'API — étape suivante). Vite proxy `/api → :3000`. Tests Vitest + @vue/test-utils + jsdom (2 verts). Override Biome pour `.vue` (Biome ne parse pas les templates). *(2026-04-27)*

  Bonus : `infra/docker-compose.yml` — MinIO écoute désormais sur 9010 à l'intérieur du container (et plus 9000), ce qui libère totalement le port 9000 pour d'autres stacks Docker locaux.
- [x] **Client API typé** — package `@myreport/api-client` : `createApiClient({ baseUrl, getAccessToken, fetch? })` exposant `auth.{login,refresh,logout}` et `me.get`. Inputs typés depuis TypeBox (`LoginRequest`...), réponses parsées avec les schémas Zod parité-testés (`ZLoginResponse`/`ZMeResponse`/`ZRefreshResponse`). Trois classes d'erreurs : `ApiError` (envelope `ErrorResponse` validée), `ApiContractError` (drift schéma front/API), `ApiNetworkError` (fetch a throw). `credentials: 'include'` pour le cookie refresh, `AbortSignal` propagé. Câblé dans `apps/web` via composable `useApiClient()` (singleton lazy) + Pinia store `auth.login()` qui appelle `/auth/login` ; `LoginView` redirige sur `/` au succès. 9 tests api-client + smoke test `LoginView` (form → store → redirect). *(2026-04-28)*
- [x] **Login + /me** — UX auth complète. `apps/web/main.ts` `await auth.bootstrap()` avant `app.mount` : tente `apiClient.ensureRefresh()` (cookie httpOnly), puis hydrate via `me.get` si OK ; sinon laisse le store vide (silencieux). `@myreport/api-client` étendu : intercepteur 401 (refresh + retry une fois, dédup via promise in-flight partagée) + `createRefreshScheduler({ refresh, marginSec })` qui décode `exp` du JWT et arme un timer (30 s avant expiry par défaut). Callbacks `onAccessTokenRotated` (re-arme le scheduler côté store) et `onSessionExpired` (toast + redirect via `markSessionExpired` qui bump un tick observé dans `App.vue`). Garde de route `meta.requiresAuth` → redirect `/login?redirect=<path>` ; auth → bounce `/login` vers `/`. Bouton « Se déconnecter » dans le footer du `AppShell` (visible authenticated only). 21 tests api-client (interceptor : happy path, refresh fails, parallel dédup, no-retry sur `/auth/login` ; scheduler : exp décodé, fire à temps, fire immédiat si déjà expiré, cancel, re-schedule, JWT malformé) + 5 tests store (`bootstrap` OK / no-session, `login` arme scheduler, `logout` cancel, `markSessionExpired`). *(2026-04-28)*
- [x] **Admin tenants** (super_admin) — `POST /tenants` + `GET /tenants` (super_admin only via CASL `create`/`read` Tenant). Crée tenant + user + `auth_identities` (argon2id) + membership `cabinet_admin` dans une seule `withAdminTx`. 409 distincts `SLUG_TAKEN` / `EMAIL_TAKEN`. Slug = DNS label (3-63 chars `[a-z0-9-]`). Front `/admin/tenants` (`requiresSuperAdmin`) avec form (slug auto-dérivé du nom, éditable) + DataTable PrimeVue `responsiveLayout="stack"`. Lien « Administration » dans `AppShell` visible si `isSuperAdmin`. **V1 : password initial saisi par super_admin et transmis hors-bande ; invitation par email/lien magique reportée à la story « Gestion users »** (Phase 2 story 5). Refactor RBAC : cabinet_admin ne peut plus `create`/`delete` Tenant (seulement `read`/`update`) — cohérent avec « tenant CRUD = super_admin ». Tests : edge cases listés *avant* code (slug/email taken sur actif vs réutilisable sur soft-deleted, 400 sur 5 variantes de payload, 401/403, GET filtre soft-deleted) — 16 nouveaux tests api + 4 parité shared-schemas + 3 router guard front. *(2026-04-28)*
- [~] **Gestion users** (cabinet_admin) — inviter auditors, rôles, révocation. **À brancher : invitation par email/lien magique pour le premier `cabinet_admin` d'un cabinet** (en plus du flow saisie hors-bande de la story « Admin tenants »).
  - [x] **PR 1 — modèle invitations** : ADR 0002 (table dédiée vs reuse `auth_identities`), schéma Drizzle `invitations` (id v7, tenant_id FK, email citext, role membership_role, token_hash bytea, expires_at, consumed_at, revoked_at, invited_by_user_id FK users nullable, soft-delete), partial unique `(tenant_id, email)` filtré sur lignes actives, migration `0003_invitations` avec RLS (FORCE, policies SELECT/INSERT/UPDATE/DELETE tenant-scoped). 8 tests RLS supplémentaires (isolation cross-tenant, GUC absente, partial unique bloque doublon actif, autorise re-invite après revoke/consume/soft-delete) — 21/21 verts. *(2026-04-29)*
  - [ ] **PR 2 — package `@myreport/email`** : abstraction `EmailSender` + `ConsoleEmailSender` (driver dev), templates TS, factory `createEmailSender({ driver })`. `EMAIL_DRIVER=console|mailjet` dans `.env.example`. Mailjet branché à la PR 6 dédiée.
  - [ ] **PR 3 — endpoints invitations** : `POST /invitations`, `GET /invitations`, `DELETE /invitations/:id`, `POST /invitations/:token/accept`. Tests intégration (edge cases listés dans la conversation : `ALREADY_MEMBER`, `INVITATION_PENDING`, expiry/revoke/consume, race emails, password policy, RBAC).
  - [ ] **PR 4 — endpoints users/memberships** : `GET /users`, `PATCH /memberships/:id`, `DELETE /memberships/:id`. Garde-fous `LAST_ADMIN`.
  - [ ] **PR 5 — refactor `/admin/tenants`** : remplace password hors-bande par invitation cabinet_admin (front + API).
  - [ ] **PR 6 — front** : `/admin/users` (DataTable + form invite + révocation), `/invitations/accept?token=...` (form mdp public).
  - [ ] **PR 7 (différée)** — adapter Mailjet : `MailjetEmailSender` + ADR sur le choix.

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

- **Console : 401 sur `/auth/refresh` au boot pour les visiteurs non loggués.** Comportement fonctionnel correct (le `try/catch` dans `auth.bootstrap()` avale silencieusement et l'app redirige proprement vers `/login`), mais le navigateur logue la status 401 dans la console — bruit cosmétique. Fix pressenti : flag non-sensible `localStorage['myreport.had-session']` posé au login / retiré au logout, et `bootstrap()` n'appelle `ensureRefresh()` que si le flag est présent. Tradeoff : un user qui purge son localStorage manuellement devra se re-logguer même si son cookie refresh est encore valide. À embarquer dans Phase 5 (polish MVP) ou dans une chore PR dédiée.
