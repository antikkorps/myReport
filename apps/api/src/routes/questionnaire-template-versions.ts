import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { type Database, schema } from '@myreport/db';
import { validateQuestionnaireSchema } from '@myreport/questionnaire-schema';
import {
  TBCreateQuestionnaireTemplateVersionRequest,
  TBErrorResponse,
  TBQuestionnaireSchemaValidationError,
  TBQuestionnaireTemplateVersion,
  TBQuestionnaireTemplateVersionListQuery,
  TBQuestionnaireTemplateVersionListResponse,
  TBUpdateQuestionnaireTemplateVersionRequest,
} from '@myreport/shared-schemas';
import { Type } from '@sinclair/typebox';
import { and, asc, eq, isNull, max } from 'drizzle-orm';

// Versions + publish/archive lifecycle. Sibling of /templates from
// PR 3a — see ADR 0004 for the design (immutable snapshot per
// published version, lifecycle enforced by the DB trigger).
//
// Tenant resolution: cabinet_admin uses `withTenantTx` and RLS scopes
// every SELECT; super_admin uses `withAdminTx` and we look up the
// template by id to discover its tenant — no `?tenantId=` query
// parameter is needed since the URL path already pins the template
// (and therefore the tenant). A 404 hides cross-tenant rows from
// cabinet_admin via RLS; from super_admin a true 404 means the
// template id is unknown.
//
// State pre-checks return clean 409 codes (VERSION_NOT_DRAFT /
// VERSION_NOT_PUBLISHED). The constraint trigger in 0005 is the
// defense-in-depth backstop: if a concurrent transaction changes the
// state between SELECT and UPDATE, the trigger fires and the request
// 5xx — acceptable given how rare that race is.

const TBTemplateAndVersionParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
  vid: Type.String({ format: 'uuid' }),
});

const TBTemplateOnlyParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

interface VersionRow {
  id: string;
  templateId: string;
  tenantId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  schema: unknown;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toVersionResponse(row: VersionRow) {
  return {
    id: row.id,
    templateId: row.templateId,
    tenantId: row.tenantId,
    version: row.version,
    status: row.status,
    schema: row.schema as Record<string, unknown>,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    publishedByUserId: row.publishedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const versionColumns = {
  id: schema.questionnaireTemplateVersions.id,
  templateId: schema.questionnaireTemplateVersions.templateId,
  tenantId: schema.questionnaireTemplateVersions.tenantId,
  version: schema.questionnaireTemplateVersions.version,
  status: schema.questionnaireTemplateVersions.status,
  schema: schema.questionnaireTemplateVersions.schema,
  publishedAt: schema.questionnaireTemplateVersions.publishedAt,
  publishedByUserId: schema.questionnaireTemplateVersions.publishedByUserId,
  createdAt: schema.questionnaireTemplateVersions.createdAt,
  updatedAt: schema.questionnaireTemplateVersions.updatedAt,
};

const questionnaireTemplateVersionsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Helper: pick the tx flavour based on the caller. Defined here so
  // each endpoint can use it consistently.
  function txFor(auth: { sub: string; tenantId: string | null; isSuperAdmin: boolean }) {
    if (auth.isSuperAdmin) {
      return <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn);
    }
    if (!auth.tenantId) return null;
    const tenantId = auth.tenantId;
    return <T>(fn: (tx: Database) => Promise<T>) =>
      app.withTenantTx({ userId: auth.sub, tenantId }, fn);
  }

  app.post(
    '/templates/:id/versions',
    {
      preHandler: [app.requireAuth, app.requireAbility('create', 'TemplateVersion')],
      schema: {
        params: TBTemplateOnlyParams,
        body: TBCreateQuestionnaireTemplateVersionRequest,
        response: {
          201: TBQuestionnaireTemplateVersion,
          400: Type.Union([TBQuestionnaireSchemaValidationError, TBErrorResponse]),
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      const ability = request.ability;
      if (!auth || !ability) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const dslResult = validateQuestionnaireSchema(request.body.schema);
      if (!dslResult.ok) {
        return reply.code(400).send({
          code: 'SCHEMA_INVALID',
          message: 'questionnaire schema validation failed',
          issues: dslResult.issues,
        });
      }

      const { id: templateId } = request.params;

      const result = await tx(async (txdb) => {
        const tplRows = await txdb
          .select({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
          })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              eq(schema.questionnaireTemplates.id, templateId),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .limit(1);
        const tpl = tplRows[0];
        if (!tpl) return { kind: 'template-not-found' as const };

        if (
          !ability.can('create', {
            __subject: 'TemplateVersion',
            id: 'pending',
            tenantId: tpl.tenantId,
            templateId: tpl.id,
            status: 'draft',
          })
        ) {
          return { kind: 'template-not-found' as const };
        }

        // Pick `max(version) + 1`. Two parallel inserts on the same
        // template race here; the unique (template_id, version) index
        // catches duplicates, surfacing as a 23505 — propagated to the
        // caller as a generic 5xx (retry path is fine, races are rare).
        const [maxRow] = await txdb
          .select({ next: max(schema.questionnaireTemplateVersions.version) })
          .from(schema.questionnaireTemplateVersions)
          .where(eq(schema.questionnaireTemplateVersions.templateId, templateId));
        const nextVersion = (maxRow?.next ?? 0) + 1;

        const [row] = await txdb
          .insert(schema.questionnaireTemplateVersions)
          .values({
            templateId: tpl.id,
            tenantId: tpl.tenantId,
            version: nextVersion,
            schema: dslResult.schema,
          })
          .returning(versionColumns);
        if (!row) throw new Error('failed to insert questionnaire_template_version');
        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'template-not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'template not found' });
      }
      return reply.code(201).send(toVersionResponse(result.row));
    },
  );

  app.get(
    '/templates/:id/versions',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'TemplateVersion')],
      schema: {
        params: TBTemplateOnlyParams,
        querystring: TBQuestionnaireTemplateVersionListQuery,
        response: {
          200: TBQuestionnaireTemplateVersionListResponse,
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const { id: templateId } = request.params;
      const statusFilter = request.query.status;

      const result = await tx(async (txdb) => {
        const tplRows = await txdb
          .select({ id: schema.questionnaireTemplates.id })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              eq(schema.questionnaireTemplates.id, templateId),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .limit(1);
        if (tplRows.length === 0) return { kind: 'template-not-found' as const };

        const whereExpr =
          statusFilter && statusFilter !== 'all'
            ? and(
                eq(schema.questionnaireTemplateVersions.templateId, templateId),
                eq(schema.questionnaireTemplateVersions.status, statusFilter),
              )
            : eq(schema.questionnaireTemplateVersions.templateId, templateId);

        const rows = await txdb
          .select(versionColumns)
          .from(schema.questionnaireTemplateVersions)
          .where(whereExpr)
          .orderBy(asc(schema.questionnaireTemplateVersions.version));
        return { kind: 'ok' as const, rows };
      });

      if (result.kind === 'template-not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'template not found' });
      }
      return reply.send({ items: result.rows.map(toVersionResponse) });
    },
  );

  app.get(
    '/templates/:id/versions/:vid',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'TemplateVersion')],
      schema: {
        params: TBTemplateAndVersionParams,
        response: {
          200: TBQuestionnaireTemplateVersion,
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const { id: templateId, vid } = request.params;
      const result = await tx(async (txdb) => {
        const rows = await txdb
          .select(versionColumns)
          .from(schema.questionnaireTemplateVersions)
          .where(
            and(
              eq(schema.questionnaireTemplateVersions.id, vid),
              eq(schema.questionnaireTemplateVersions.templateId, templateId),
            ),
          )
          .limit(1);
        return rows[0];
      });
      if (!result) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'version not found' });
      }
      return reply.send(toVersionResponse(result));
    },
  );

  app.patch(
    '/templates/:id/versions/:vid',
    {
      preHandler: [app.requireAuth, app.requireAbility('update', 'TemplateVersion')],
      schema: {
        params: TBTemplateAndVersionParams,
        body: TBUpdateQuestionnaireTemplateVersionRequest,
        response: {
          200: TBQuestionnaireTemplateVersion,
          400: Type.Union([TBQuestionnaireSchemaValidationError, TBErrorResponse]),
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
          409: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const dslResult = validateQuestionnaireSchema(request.body.schema);
      if (!dslResult.ok) {
        return reply.code(400).send({
          code: 'SCHEMA_INVALID',
          message: 'questionnaire schema validation failed',
          issues: dslResult.issues,
        });
      }

      const { id: templateId, vid } = request.params;

      const result = await tx(async (txdb) => {
        const rows = await txdb
          .select({ id: versionColumns.id, status: versionColumns.status })
          .from(schema.questionnaireTemplateVersions)
          .where(
            and(
              eq(schema.questionnaireTemplateVersions.id, vid),
              eq(schema.questionnaireTemplateVersions.templateId, templateId),
            ),
          )
          .limit(1);
        const found = rows[0];
        if (!found) return { kind: 'not-found' as const };
        if (found.status !== 'draft') {
          return { kind: 'not-draft' as const, status: found.status };
        }
        const [row] = await txdb
          .update(schema.questionnaireTemplateVersions)
          .set({ schema: dslResult.schema })
          .where(eq(schema.questionnaireTemplateVersions.id, vid))
          .returning(versionColumns);
        if (!row) return { kind: 'not-found' as const };
        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'version not found' });
      }
      if (result.kind === 'not-draft') {
        return reply.code(409).send({
          code: 'VERSION_NOT_DRAFT',
          message: `version is ${result.status}; only drafts may be edited`,
        });
      }
      return reply.send(toVersionResponse(result.row));
    },
  );

  app.post(
    '/templates/:id/versions/:vid/publish',
    {
      preHandler: [app.requireAuth, app.requireAbility('update', 'TemplateVersion')],
      schema: {
        params: TBTemplateAndVersionParams,
        response: {
          200: TBQuestionnaireTemplateVersion,
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
          409: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const { id: templateId, vid } = request.params;
      const userId = auth.sub;

      const result = await tx(async (txdb) => {
        const rows = await txdb
          .select({ id: versionColumns.id, status: versionColumns.status })
          .from(schema.questionnaireTemplateVersions)
          .where(
            and(
              eq(schema.questionnaireTemplateVersions.id, vid),
              eq(schema.questionnaireTemplateVersions.templateId, templateId),
            ),
          )
          .limit(1);
        const found = rows[0];
        if (!found) return { kind: 'not-found' as const };
        if (found.status !== 'draft') {
          return { kind: 'not-draft' as const, status: found.status };
        }
        const [row] = await txdb
          .update(schema.questionnaireTemplateVersions)
          .set({
            status: 'published',
            publishedAt: new Date(),
            publishedByUserId: userId,
          })
          .where(eq(schema.questionnaireTemplateVersions.id, vid))
          .returning(versionColumns);
        if (!row) return { kind: 'not-found' as const };

        // Auto-set template.current_version_id on the first publish
        // (when it is still null). Subsequent publishes leave the
        // pin untouched — per ADR 0004 the pin is deliberate, not
        // "the latest". Promotion to a different version will land
        // with its own endpoint when the UI needs it.
        await txdb
          .update(schema.questionnaireTemplates)
          .set({ currentVersionId: vid })
          .where(
            and(
              eq(schema.questionnaireTemplates.id, templateId),
              isNull(schema.questionnaireTemplates.currentVersionId),
            ),
          );

        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'version not found' });
      }
      if (result.kind === 'not-draft') {
        return reply.code(409).send({
          code: 'VERSION_NOT_DRAFT',
          message: `version is ${result.status}; only drafts may be published`,
        });
      }
      return reply.send(toVersionResponse(result.row));
    },
  );

  app.post(
    '/templates/:id/versions/:vid/archive',
    {
      preHandler: [app.requireAuth, app.requireAbility('update', 'TemplateVersion')],
      schema: {
        params: TBTemplateAndVersionParams,
        response: {
          200: TBQuestionnaireTemplateVersion,
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
          409: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const { id: templateId, vid } = request.params;
      const result = await tx(async (txdb) => {
        const rows = await txdb
          .select({ id: versionColumns.id, status: versionColumns.status })
          .from(schema.questionnaireTemplateVersions)
          .where(
            and(
              eq(schema.questionnaireTemplateVersions.id, vid),
              eq(schema.questionnaireTemplateVersions.templateId, templateId),
            ),
          )
          .limit(1);
        const found = rows[0];
        if (!found) return { kind: 'not-found' as const };
        if (found.status !== 'published') {
          return { kind: 'not-published' as const, status: found.status };
        }
        const [row] = await txdb
          .update(schema.questionnaireTemplateVersions)
          .set({ status: 'archived' })
          .where(eq(schema.questionnaireTemplateVersions.id, vid))
          .returning(versionColumns);
        if (!row) return { kind: 'not-found' as const };
        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'version not found' });
      }
      if (result.kind === 'not-published') {
        return reply.code(409).send({
          code: 'VERSION_NOT_PUBLISHED',
          message: `version is ${result.status}; only published versions may be archived`,
        });
      }
      return reply.send(toVersionResponse(result.row));
    },
  );

  app.delete(
    '/templates/:id/versions/:vid',
    {
      preHandler: [app.requireAuth, app.requireAbility('delete', 'TemplateVersion')],
      schema: {
        params: TBTemplateAndVersionParams,
        response: {
          204: Type.Null(),
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
          409: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const tx = txFor(auth);
      if (!tx)
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });

      const { id: templateId, vid } = request.params;
      const result = await tx(async (txdb) => {
        const rows = await txdb
          .select({ id: versionColumns.id, status: versionColumns.status })
          .from(schema.questionnaireTemplateVersions)
          .where(
            and(
              eq(schema.questionnaireTemplateVersions.id, vid),
              eq(schema.questionnaireTemplateVersions.templateId, templateId),
            ),
          )
          .limit(1);
        const found = rows[0];
        if (!found) return { kind: 'not-found' as const };
        if (found.status !== 'draft') {
          return { kind: 'not-draft' as const, status: found.status };
        }
        const deleted = await txdb
          .delete(schema.questionnaireTemplateVersions)
          .where(eq(schema.questionnaireTemplateVersions.id, vid))
          .returning({ id: schema.questionnaireTemplateVersions.id });
        if (deleted.length === 0) return { kind: 'not-found' as const };
        return { kind: 'ok' as const };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'version not found' });
      }
      if (result.kind === 'not-draft') {
        return reply.code(409).send({
          code: 'VERSION_NOT_DRAFT',
          message: `version is ${result.status}; only drafts may be deleted`,
        });
      }
      return reply.code(204).send(null);
    },
  );
};

export default questionnaireTemplateVersionsRoutes;
