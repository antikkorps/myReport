import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt } from './_shared.ts';
import { missionStatus } from './enums.ts';
import { tenants } from './tenants.ts';

// Minimal mission table. Phase 3 will add: template binding, client
// reference, deadlines, audit period, assigned auditee token, etc.
// Kept here so `mission_members` has a valid FK target.
export const missions = pgTable(
  'missions',
  {
    id: primaryId(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    status: missionStatus().notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('missions_tenant_idx').on(t.tenantId),
    index('missions_status_idx').on(t.status),
    index('missions_deleted_at_idx').on(t.deletedAt),
  ],
);
