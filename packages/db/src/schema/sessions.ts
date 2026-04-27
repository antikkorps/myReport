import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './_shared.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

// Native Postgres `inet` type for storing IP addresses (v4 or v6) with
// proper indexing support. Text would work but loses semantic validation.
const inet = customType<{ data: string }>({
  dataType: () => 'inet',
});

// Persisted refresh-token sessions. Access tokens stay stateless JWT;
// refresh tokens are stored as a hash so a leaked DB dump cannot be
// replayed to obtain fresh access tokens.
//
// Rotation: on refresh we mark the current row revoked, insert a new
// row with `rotatedFrom` pointing at the old id. If a revoked token is
// ever presented again we detect token reuse (chain compromise) and
// can invalidate the whole chain.
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Null when the refresh token is not yet scoped to a tenant (e.g.
    // right after login for a multi-tenant user picking a cabinet).
    tenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
    refreshTokenHash: text().notNull(),
    userAgent: text(),
    ipAddress: inet(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
    // Self-reference: chain of rotated refresh tokens.
    rotatedFrom: uuid().references((): AnyPgColumn => sessions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_tenant_idx').on(t.userId, t.tenantId),
    // Used by the cleanup job that deletes expired, revoked sessions.
    index('sessions_expires_at_idx').on(t.expiresAt),
    index('sessions_active_idx').on(t.userId).where(sql`${t.revokedAt} is null`),
  ],
);
