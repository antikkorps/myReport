import { sql } from 'drizzle-orm';
import { customType, index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt, uuidFk } from './_shared.ts';
import { membershipRole } from './enums.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

// Postgres bytea, used to store the sha256 of the invitation token. The
// clear token is shown once in the email link and never persisted —
// same pattern as `sessions.refresh_token_hash`.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// Pending invitation to join a tenant with a given role. See
// docs/adr/0002-invitations-model.md for the design rationale.
//
// Lifecycle: an invitation is *active* iff `consumed_at IS NULL`,
// `revoked_at IS NULL`, `deleted_at IS NULL`, AND `expires_at > now()`.
// The first three live in the partial unique index predicate; the
// expiry check happens in the application at create time (Postgres
// requires immutable index predicates so `now()` cannot be inlined).
export const invitations = pgTable(
  'invitations',
  {
    id: primaryId(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: citext().notNull(),
    role: membershipRole().notNull(),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp({ withTimezone: true, mode: 'date' }),
    revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
    // Nullable: a super-admin issuing the very first invitation of a
    // tenant has no membership in that tenant — the inviter is the
    // platform. We still store the super-admin user id when known.
    invitedByUserId: uuidFk().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // At most one active invitation per (tenant, email). Stale rows
    // (consumed / revoked / soft-deleted) are excluded so a user can be
    // re-invited after a previous invitation lapsed.
    uniqueIndex('invitations_tenant_email_active_unique')
      .on(t.tenantId, t.email)
      .where(sql`${t.consumedAt} is null and ${t.revokedAt} is null and ${t.deletedAt} is null`),
    // Lookup by token at acceptance time. Not unique: collisions are
    // negligible (256-bit hash) and a partial unique would force us to
    // worry about reused hashes after soft-delete for no security gain.
    index('invitations_token_hash_idx').on(t.tokenHash),
    index('invitations_tenant_idx').on(t.tenantId),
    index('invitations_deleted_at_idx').on(t.deletedAt),
  ],
);
