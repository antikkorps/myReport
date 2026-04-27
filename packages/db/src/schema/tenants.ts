import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt } from './_shared.ts';

export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    name: text().notNull(),
    // URL-safe identifier, e.g. "acme-audit". Immutable once assigned.
    slug: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Partial unique: a soft-deleted tenant must not block re-creating
    // a tenant with the same slug.
    uniqueIndex('tenants_slug_unique').on(t.slug).where(sql`${t.deletedAt} is null`),
    index('tenants_deleted_at_idx').on(t.deletedAt),
  ],
);
