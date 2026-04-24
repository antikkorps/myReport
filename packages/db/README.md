# @myreport/db

Drizzle schema, migrations, and a thin Postgres client factory for
myReport. Every business table lives here.

## Layout

```
src/
  client.ts          # createDatabase(): Sql + Drizzle instance
  migrate.ts         # Node script: applies SQL migrations
  seed.ts            # Dev-only seed (demo tenant)
  schema/
    _shared.ts       # primaryId (UUIDv7), timestamps, deletedAt
    enums.ts         # pg enums (roles, mission status)
    tenants.ts
    users.ts
    memberships.ts   # users <-> tenants, with cabinet-level role
    sessions.ts      # refresh-token rotation chain
    missions.ts      # minimal, fleshed out in Phase 3
    mission-members.ts
    index.ts         # re-exports
migrations/          # drizzle-kit output (SQL)
drizzle.config.ts
```

## Conventions

- **PKs are UUIDv7**, generated client-side via the `uuidv7` npm package.
  This keeps IDs time-ordered (good index locality) and lets the future
  offline client (V2) mint IDs without sync conflicts.
- **All timestamps are `timestamptz`** with `now()` default. `updated_at`
  is refreshed via drizzle's `$onUpdateFn` (application-level), not a
  DB trigger — keeps behaviour explicit in code.
- **Soft-delete via `deleted_at`** on tenants, users, and missions.
  Unique indexes on natural keys (slug, email) are partial
  `WHERE deleted_at IS NULL` so a soft-deleted row cannot block the
  reuse of its slug/email.
- **Snake_case columns**, mapped from camelCase TS fields via Drizzle's
  `casing: 'snake_case'` (set in both `drizzle.config.ts` and the
  runtime client).
- **`tenant_id` is denormalised on `mission_members`** even though it
  is available via `missions.tenant_id`. This avoids an extra join in
  RLS policies.

## Mission roles

- `lead` — pilots the mission (submit, close, generate reports, invite
  auditees). At most one active `lead` per mission, enforced by a
  partial unique index.
- `contributor` — fills the questionnaire, attaches files, reads all
  mission content.
- `observer` — read-only reviewer (senior, external partner).

Cabinet-level roles on `memberships` are separate: `cabinet_admin`,
`auditor`. The `is_super_admin` flag on `users` is the global operator
flag and is **not** scoped to a tenant.

## Commands

Run from the package folder (or via `pnpm --filter @myreport/db <cmd>`):

```sh
pnpm db:generate   # Generate SQL migration from schema changes
pnpm db:migrate    # Apply pending migrations (reads DATABASE_URL)
pnpm db:push       # Dev-only: push schema directly, no migration file
pnpm db:studio     # Drizzle Studio (GUI) against DATABASE_URL
pnpm db:seed       # Insert the demo tenant
```

All scripts read `DATABASE_URL` from the repo-root `.env` file (via
Node's native `--env-file` flag).

## Row-Level Security

Migration `0001_rls.sql` installs two roles and a policy per table.

- `app_user` (`NOLOGIN NOBYPASSRLS`) — the role used by all regular
  request traffic. The Fastify tenant-context plugin (Phase 1, next
  step) opens a transaction and runs, once per request:

  ```sql
  SET LOCAL ROLE app_user;
  SET LOCAL app.current_user_id   = '<uuid>';
  SET LOCAL app.current_tenant_id = '<uuid>'; -- may be '' pre-tenant-pick
  ```

- `app_admin` (`NOLOGIN BYPASSRLS`) — reserved for super-admin flows
  and a small set of bootstrap writes (tenant creation, user invite)
  where RLS would block the legitimate operation. The API layer
  escalates only for those specific statements, never the whole
  request.

All tenant-scoped tables use `FORCE ROW LEVEL SECURITY` so the table
owner is also subject to policies. Migrations still run as the owner
outside of the `app_user` role, so DDL is not affected.

RLS handles **isolation**; the CASL abilities in `@myreport/rbac`
handle **authorisation** inside a tenant.

## Tests

Integration tests live under `tests/` and use Testcontainers to spin
up a disposable Postgres 16 container per test file.

```sh
pnpm test       # one-shot run
pnpm test:watch # re-run on change
```

Docker (or a compatible runtime) must be reachable. The tests are
independent of the `pnpm dev:up` compose stack.

## Next steps (tracked in BACKLOG.md)

- Expand `missions` (Phase 3): template binding, client ref, deadlines,
  auditee token.
- Seed users + memberships once the auth module lands.
