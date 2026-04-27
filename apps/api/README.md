# @myreport/api

Fastify HTTP API for myReport. Provides authentication, the `/me`
endpoint, and the foundations on which Phase 2+ business routes will be
built.

## Stack

- **Fastify 5** + **TypeBox** (typed JSON-Schema for routes, fed into
  the auto-generated OpenAPI doc at `/docs`).
- **JWT access tokens** (15 min, HS256) signed with `JWT_ACCESS_SECRET`.
- **Opaque refresh tokens** (14 d, 32 random bytes hex) stored as
  `sha256` in the `sessions` table. Cookie is `httpOnly`, `SameSite=Lax`,
  `Secure` in production, scoped to `/auth`.
- **Argon2id** password hashing.
- **RLS** is enforced per-request: every authenticated handler runs
  inside `withTenantTx({ userId, tenantId }, ...)`, which opens a
  transaction, switches role to `app_user`, and sets
  `app.current_user_id` / `app.current_tenant_id` GUCs. Pre-auth flows
  (login, refresh, logout) use `withAdminTx` (`app_admin`, BYPASSRLS).

## Routes

| Method | Path           | Auth | Notes                                                  |
| ------ | -------------- | ---- | ------------------------------------------------------ |
| POST   | /auth/login    | —    | rate-limited 5/min/IP                                  |
| POST   | /auth/refresh  | cookie | rotates the token; reuse of a revoked token revokes the entire chain |
| POST   | /auth/logout   | cookie | revokes the current session and clears the cookie     |
| GET    | /me            | JWT  | returns the user, all memberships, and current tenant  |
| GET    | /health        | —    | liveness check                                         |
| GET    | /docs          | —    | Swagger UI                                             |

## Local dev

```sh
pnpm dev:up               # boot Postgres + Redis + MinIO
pnpm db:migrate           # apply migrations
pnpm --filter @myreport/api dev   # run with --watch
```

The API reads the repo-root `.env` (see `.env.example`).

## Tests

Integration tests boot a disposable Postgres via Testcontainers, apply
migrations, seed a tenant + user, build the Fastify app via `inject()`
calls (no real port). Run them sequentially across packages because two
Testcontainers in parallel routinely fight on Docker resources:

```sh
pnpm --filter @myreport/api test
# or, full repo:
pnpm test    # already passes --concurrency=1 to turbo
```

## Security note: refresh-token rotation chain

Each successful `/auth/refresh` revokes the presented session and
inserts a new row whose `rotatedFrom` points at the old `id`. Replaying
a revoked refresh token is treated as token theft: the recursive walk
of the rotation chain marks every descendant session as revoked, so the
attacker and the legitimate user both have to re-authenticate. The
existence of this safety net is the reason the refresh token is single-
use.
