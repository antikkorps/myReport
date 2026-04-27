import { index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, updatedAt } from './_shared.ts';
import { membershipRole } from './enums.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

// Link table between users and tenants, carrying the user's role inside
// that tenant. A user can belong to multiple tenants (different cabinets
// for freelance auditors, or an inter-cabinet reviewer).
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
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    index('memberships_tenant_idx').on(t.tenantId),
  ],
);
