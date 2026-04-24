import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt } from './_shared.ts';

// Case-insensitive text type for emails. Relies on the `citext` extension
// provisioned by infra/postgres/init/01-extensions.sql.
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: citext().notNull(),
    // Argon2id hash; never stored in plaintext. Produced by the API layer
    // (this package does not depend on argon2 to keep it side-effect-free).
    passwordHash: text().notNull(),
    displayName: text().notNull(),
    // Global flag for platform operators. Super-admins are NOT scoped to
    // a tenant and bypass tenant-bound UI, but still hit RLS via the
    // dedicated `app_admin` DB role (see Phase 1 RLS step).
    isSuperAdmin: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email).where(sql`${t.deletedAt} is null`),
    index('users_deleted_at_idx').on(t.deletedAt),
  ],
);
