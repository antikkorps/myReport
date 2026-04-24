import { sql } from 'drizzle-orm';
import { index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, updatedAt } from './_shared.ts';
import { missionMemberRole } from './enums.ts';
import { missions } from './missions.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

// Role of a user inside a specific mission. `tenantId` is denormalised
// from `missions.tenantId` so RLS policies on this table can filter on
// the current tenant without an extra join.
export const missionMembers = pgTable(
  'mission_members',
  {
    id: primaryId(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    missionId: uuid()
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: missionMemberRole().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mission_members_mission_user_unique').on(t.missionId, t.userId),
    // At most one active lead per mission. Closing or reassigning a
    // mission flips the previous lead to 'contributor' before inserting.
    uniqueIndex('mission_members_single_lead').on(t.missionId).where(sql`${t.role} = 'lead'`),
    index('mission_members_tenant_idx').on(t.tenantId),
    index('mission_members_user_idx').on(t.userId),
  ],
);
