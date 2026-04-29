# ADR 0002 — Invitations data model

- **Status**: Accepted
- **Date**: 2026-04-29
- **Deciders**: Franck

## Context

Phase 2 of the backlog adds user management for cabinets:

1. A super-admin can invite the first `cabinet_admin` of a new tenant (replacing the current "set the password out-of-band" stopgap from the *Admin tenants* story).
2. A `cabinet_admin` can invite `auditor`s (and additional `cabinet_admin`s) into their tenant.
3. A future Phase 2 story will add B2C self-signup, where someone creates their own tenant and confirms their email — that flow needs the same email-verification primitive.

We need a place to track outstanding invitations: who is being invited, into which tenant, with which role, by whom, and a one-shot secret that lets the invitee complete enrolment. We also need to revoke or expire an invitation, and to detect duplicate invitations for the same email in a tenant.

Two designs were considered:

### Option A — Reuse `auth_identities` with `provider='magic_link'`

Add rows to `auth_identities` for pending invitations. The `secret_hash` column would carry the hashed invitation token, and `email_at_link` the target email.

**Why this is wrong here.** `auth_identities` represents *long-lived* login methods owned by an existing `users` row (FK with `ON DELETE cascade`). An invitation is the opposite: it is a short-lived *offer* that exists *before* the user account does, has its own expiry, can be revoked, and is consumed exactly once. Forcing it into `auth_identities` would mean either creating a placeholder `users` row at invite time (violating the "user only after consent" model and polluting the users RLS scope) or making `user_id` nullable (gutting a strong invariant relied on by the auth flow). It would also overload the `magic_link` provider, which we want to keep available for the future *auditee invitation* flow (Phase 3, mission-scoped, no account creation).

### Option B — Dedicated `invitations` table

A new tenant-scoped table tracking the offer itself, with the user / membership rows created only at acceptance time.

## Decision

**Adopt Option B.** Add a dedicated `invitations` table with the following shape:

```sql
invitations (
  id                   uuid v7 PK,
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  email                citext NOT NULL,
  role                 membership_role NOT NULL,
  token_hash           bytea NOT NULL,
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz NULL,
  revoked_at           timestamptz NULL,
  invited_by_user_id   uuid NULL REFERENCES users(id),
  created_at, updated_at, deleted_at
)
```

Key design points:

- **Tenant-scoped**: the invitation belongs to the cabinet it grants access to. Even when a super-admin issues it (creating a tenant + inviting its first `cabinet_admin`), the `tenant_id` is set immediately so RLS applies.
- **`invited_by_user_id` is nullable**: a super-admin issuing the very first invitation of a tenant has no membership in that tenant; the inviter is the *platform*, not a tenant user. We store the super-admin's `users.id` when known, but FK NULL is allowed.
- **Token storage**: only `token_hash` (sha256 of a random 32-byte token) is persisted. The clear token is shown once (in the email link) and never logged. Mirror of how `sessions.refresh_token_hash` already works.
- **Triple-state lifecycle**: `expires_at` (time-based), `revoked_at` (admin-driven), `consumed_at` (one-shot acceptance). An invitation is *active* iff none of the three is reached. Mutually-exclusive booleans were rejected — timestamps double as audit trail.
- **Partial unique index** on `(tenant_id, email) WHERE consumed_at IS NULL AND revoked_at IS NULL AND deleted_at IS NULL AND expires_at > now()`. Mirrors the `tenants_slug_unique` pattern: a stale or revoked invitation must not block re-inviting the same email. Note: `expires_at > now()` cannot live in the index predicate (Postgres requires immutable predicates), so the "active" filter at write time is enforced by a partial index covering only the soft-state columns; expiry collisions are handled in the application layer (the *create* path checks `expires_at > now()` explicitly).
- **No `accepted_user_id` column**: the link from invitation to created user is implicit via `consumed_at IS NOT NULL` plus the `(tenant_id, email)` pair. Adding the column was tempting but would duplicate state already discoverable via `users` + `memberships` and create a refactor surface if a user later changes their email.

## Consequences

### Positive

- `invitations` and `auth_identities` keep cleanly separated semantics: identities = long-term login, invitations = short-term offer.
- The `magic_link` `auth_provider` value stays free for the Phase 3 auditee flow (mission-scoped, no account creation).
- RLS is straightforward: tenant-scoped policies, identical pattern to `missions` / `mission_members`.
- Same primitive will serve the upcoming B2C self-signup story (a self-signup is just an invitation issued by the platform with `tenant_id` pointing to the freshly-created tenant and `role='cabinet_admin'`).

### Negative / trade-offs

- One additional migration and one more table to keep in sync with the RLS test suite. Acceptable: every new tenant-scoped table costs us this anyway.
- The "active" predicate of the partial unique index is split between the index (soft-state columns) and the application (`expires_at > now()` check at insert time). We accept this because the alternative would be a per-row trigger or a generated column — both heavier than a single explicit check at the call site.
- An invitation row outlives the join to its accepted user (no FK link), so analytics queries that want "who accepted what" must join via `(tenant_id, email)` to `users` / `memberships`. We accept this; the alternative `accepted_user_id` column wasn't worth the duplication.

### Future / deferred

- **B2C self-signup** (next story): reuses this table. The signup request is materialised as an invitation immediately self-consumed once the email is verified.
- **Auditee mission invitations** (Phase 3): explicitly *not* covered by this table. Those are mission-scoped, do not create a tenant membership, and will use a separate `mission_invitations` (or similar) model with `auth_identities.provider='magic_link'` for the per-mission session.
- **SCIM / SSO provisioning** (V2+): when introduced, those flows will short-circuit the `invitations` table and create `users` + `memberships` directly via `app_admin`. This ADR does not foreclose that path.
