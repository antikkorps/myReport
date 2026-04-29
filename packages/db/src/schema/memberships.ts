import { sql } from 'drizzle-orm';
import { index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt } from './_shared.ts';
import { membershipRole } from './enums.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

// Link table between users and tenants, carrying the user's role inside
// that tenant. A user can belong to multiple tenants (different cabinets
// for freelance auditors, or an inter-cabinet reviewer). Soft-deleted
// rows are retained for audit (which user belonged to which tenant
// when), so the active uniqueness predicate is a partial index.
export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_active_unique')
      .on(t.tenantId, t.userId)
      .where(sql`${t.deletedAt} is null`),
    index('memberships_user_idx').on(t.userId),
    index('memberships_tenant_idx').on(t.tenantId),
    index('memberships_deleted_at_idx').on(t.deletedAt),
  ],
);
