import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt, uuidFk } from './_shared.ts';
import { questionnaireTemplateVersionStatus } from './enums.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

// Identity of a questionnaire template within a tenant. Mutable
// metadata (name, slug, description, current-version pointer); the
// schema payload itself lives on the version rows.
//
// `currentVersionId` is the version a new mission consumes by default.
// It is set explicitly by the cabinet admin at publish time (or via a
// "set as current" action) and is not automatically the latest — that
// supports a deliberate "pin to a known-good version" UX.
//
// Soft-delete (`deleted_at`) preserves history. Active rows are filtered
// via the partial unique on slug so the same slug can be reused inside
// the tenant after retirement.
export const questionnaireTemplates = pgTable(
  'questionnaire_templates',
  {
    id: primaryId(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    // URL-safe identifier, e.g. "compta-2026". Unique per tenant
    // among active rows.
    slug: text().notNull(),
    description: text(),
    currentVersionId: uuid().references((): AnyPgColumn => questionnaireTemplateVersions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('questionnaire_templates_tenant_slug_active_unique')
      .on(t.tenantId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('questionnaire_templates_tenant_idx').on(t.tenantId),
    index('questionnaire_templates_deleted_at_idx').on(t.deletedAt),
  ],
);

// Immutable snapshot of a template's schema at a point in time. See
// docs/adr/0004 for the design rationale (immutable snapshot vs delta
// migration). The `schema` column carries the DSL-validated payload
// (`@myreport/questionnaire-schema`); the DB only enforces jsonb
// integrity. Validation against the DSL happens at the API layer
// before write.
//
// Status transitions enforced by the constraint trigger in 0005:
//   draft     -> draft|published     (any mutation allowed)
//   draft     -> DELETE              (allowed; only drafts may be deleted)
//   published -> archived            (status flip only)
//   published -> published           (no-op; immutable fields cannot change)
//   archived  -> *                   (frozen entirely; DELETE forbidden)
//
// `tenant_id` is denormalised onto every version so RLS policies can
// match the tenant GUC directly without joining back to templates. The
// trigger guarantees it cannot drift from the parent template once
// the version leaves draft.
export const questionnaireTemplateVersions = pgTable(
  'questionnaire_template_versions',
  {
    id: primaryId(),
    templateId: uuid()
      .notNull()
      .references(() => questionnaireTemplates.id, { onDelete: 'cascade' }),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Monotone per template: the application picks `max(version) + 1`
    // inside the create transaction. The unique index below guarantees
    // no duplicates if two transactions race.
    version: integer().notNull(),
    schema: jsonb().notNull(),
    status: questionnaireTemplateVersionStatus().notNull().default('draft'),
    publishedAt: timestamp({ withTimezone: true, mode: 'date' }),
    publishedByUserId: uuidFk().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('questionnaire_template_versions_template_version_unique').on(
      t.templateId,
      t.version,
    ),
    index('questionnaire_template_versions_template_idx').on(t.templateId),
    index('questionnaire_template_versions_tenant_idx').on(t.tenantId),
    index('questionnaire_template_versions_template_status_idx').on(t.templateId, t.status),
  ],
);
