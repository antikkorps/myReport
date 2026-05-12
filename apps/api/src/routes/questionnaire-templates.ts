import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { type Database, schema } from '@myreport/db';
import {
  TBCreateQuestionnaireTemplateRequest,
  TBErrorResponse,
  TBQuestionnaireTemplate,
  TBQuestionnaireTemplateListResponse,
  TBUpdateQuestionnaireTemplateRequest,
} from '@myreport/shared-schemas';
import { Type } from '@sinclair/typebox';
import { and, eq, isNull } from 'drizzle-orm';

// CRUD on questionnaire templates (identity rows). Versions and the
// publish/archive lifecycle live in a sibling router landing with PR
// 3b. See docs/adr/0004-questionnaire-schema.md for the design.
//
// Routing model — mirrors invitations / users:
//   * cabinet_admin: tenant inferred from auth, `app.withTenantTx`.
//     RLS does the scoping; no manual `where tenantId =` needed in
//     ordinary SELECTs.
//   * super_admin: explicit `tenantId` body/query field. Uses
//     `app.withAdminTx` (BYPASSRLS) and filters by tenantId by hand.
//   * auditor / no-tenant: not allowed (CASL preHandler rejects).

const TBTemplateIdParam = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const TBTemplateListQuery = Type.Object({
  tenantId: Type.Optional(Type.String({ format: 'uuid' })),
});

function toTemplateRow(row: {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const questionnaireTemplatesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/templates',
    {
      preHandler: [app.requireAuth, app.requireAbility('create', 'Template')],
      schema: {
        body: TBCreateQuestionnaireTemplateRequest,
        response: {
          201: TBQuestionnaireTemplate,
          400: TBErrorResponse,
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
      const ability = request.ability;
      if (!auth || !ability) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }

      const { name, slug, description, tenantId: bodyTenantId } = request.body;
      const isSuperAdmin = auth.isSuperAdmin === true;

      // Same tenant-resolution contract as POST /invitations: explicit
      // for super_admin, implicit (and forbidden in body) otherwise.
      let targetTenantId: string;
      if (isSuperAdmin) {
        if (!bodyTenantId) {
          return reply
            .code(400)
            .send({ code: 'TENANT_ID_REQUIRED', message: 'super_admin must specify tenantId' });
        }
        targetTenantId = bodyTenantId;
      } else {
        if (bodyTenantId) {
          return reply.code(400).send({
            code: 'TENANT_ID_FORBIDDEN',
            message: 'tenantId is implicit from the auth context for non super_admin callers',
          });
        }
        if (!auth.tenantId) {
          return reply
            .code(403)
            .send({ code: 'NO_TENANT', message: 'caller has no active tenant' });
        }
        targetTenantId = auth.tenantId;
      }

      // Instance-level RBAC: re-check against the resolved tenant so
      // a stale token cannot smuggle a foreign tenantId past the
      // preHandler.
      if (
        !ability.can('create', {
          __subject: 'Template',
          id: 'pending',
          tenantId: targetTenantId,
        })
      ) {
        return reply.code(403).send({
          code: 'FORBIDDEN',
          message: 'not allowed to create templates in this tenant',
        });
      }

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: targetTenantId }, fn);

      const result = await runTx(async (tx) => {
        const tenantRows = await tx
          .select({ id: schema.tenants.id })
          .from(schema.tenants)
          .where(and(eq(schema.tenants.id, targetTenantId), isNull(schema.tenants.deletedAt)))
          .limit(1);
        if (tenantRows.length === 0) return { kind: 'tenant-not-found' as const };

        // Slug uniqueness pre-check. The partial unique index is the
        // authoritative guard (handles concurrent inserts), this is a
        // UX nicety to surface a clean code rather than a generic 23505.
        const slugTaken = await tx
          .select({ id: schema.questionnaireTemplates.id })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              eq(schema.questionnaireTemplates.tenantId, targetTenantId),
              eq(schema.questionnaireTemplates.slug, slug),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .limit(1);
        if (slugTaken.length > 0) return { kind: 'slug-taken' as const };

        const [row] = await tx
          .insert(schema.questionnaireTemplates)
          .values({
            tenantId: targetTenantId,
            name,
            slug,
            description: description ?? null,
          })
          .returning({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
            name: schema.questionnaireTemplates.name,
            slug: schema.questionnaireTemplates.slug,
            description: schema.questionnaireTemplates.description,
            currentVersionId: schema.questionnaireTemplates.currentVersionId,
            createdAt: schema.questionnaireTemplates.createdAt,
            updatedAt: schema.questionnaireTemplates.updatedAt,
          });
        if (!row) throw new Error('failed to insert questionnaire_template');
        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'tenant-not-found') {
        return reply.code(404).send({ code: 'TENANT_NOT_FOUND', message: 'tenant not found' });
      }
      if (result.kind === 'slug-taken') {
        return reply
          .code(409)
          .send({ code: 'SLUG_TAKEN', message: 'a template with this slug already exists' });
      }
      return reply.code(201).send(toTemplateRow(result.row));
    },
  );

  app.get(
    '/templates',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'Template')],
      schema: {
        querystring: TBTemplateListQuery,
        response: {
          200: TBQuestionnaireTemplateListResponse,
          400: TBErrorResponse,
          401: TBErrorResponse,
          403: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const isSuperAdmin = auth.isSuperAdmin === true;
      const queryTenantId = request.query.tenantId;

      let scopedTenantId: string;
      if (isSuperAdmin) {
        if (!queryTenantId) {
          return reply
            .code(400)
            .send({ code: 'TENANT_ID_REQUIRED', message: 'super_admin must specify tenantId' });
        }
        scopedTenantId = queryTenantId;
      } else {
        if (!auth.tenantId) {
          return reply
            .code(403)
            .send({ code: 'NO_TENANT', message: 'caller has no active tenant' });
        }
        scopedTenantId = auth.tenantId;
      }

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: scopedTenantId }, fn);

      const rows = await runTx(async (tx) =>
        tx
          .select({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
            name: schema.questionnaireTemplates.name,
            slug: schema.questionnaireTemplates.slug,
            description: schema.questionnaireTemplates.description,
            currentVersionId: schema.questionnaireTemplates.currentVersionId,
            createdAt: schema.questionnaireTemplates.createdAt,
            updatedAt: schema.questionnaireTemplates.updatedAt,
          })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              // RLS already scopes for the cabinet_admin path. For
              // super_admin we filter explicitly.
              eq(schema.questionnaireTemplates.tenantId, scopedTenantId),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .orderBy(schema.questionnaireTemplates.createdAt),
      );

      return reply.send({ items: rows.map(toTemplateRow) });
    },
  );

  app.get(
    '/templates/:id',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'Template')],
      schema: {
        params: TBTemplateIdParam,
        response: {
          200: TBQuestionnaireTemplate,
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
      const isSuperAdmin = auth.isSuperAdmin === true;
      const { id } = request.params;

      // For non-super-admin without a tenant, RLS would return 0 rows
      // anyway, but we 403 explicitly to give a clearer UX signal.
      if (!isSuperAdmin && !auth.tenantId) {
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });
      }

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            // safe: we just refused !auth.tenantId above.
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId as string }, fn);

      const row = await runTx(async (tx) => {
        const rows = await tx
          .select({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
            name: schema.questionnaireTemplates.name,
            slug: schema.questionnaireTemplates.slug,
            description: schema.questionnaireTemplates.description,
            currentVersionId: schema.questionnaireTemplates.currentVersionId,
            createdAt: schema.questionnaireTemplates.createdAt,
            updatedAt: schema.questionnaireTemplates.updatedAt,
          })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              eq(schema.questionnaireTemplates.id, id),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .limit(1);
        return rows[0];
      });

      if (!row) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'template not found' });
      }

      // Instance-level RBAC check. For super_admin this is always true
      // (manage all); for cabinet_admin it confirms tenant scoping.
      if (!ability.can('read', { __subject: 'Template', id: row.id, tenantId: row.tenantId })) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'template not found' });
      }

      return reply.send(toTemplateRow(row));
    },
  );

  app.patch(
    '/templates/:id',
    {
      preHandler: [app.requireAuth, app.requireAbility('update', 'Template')],
      schema: {
        params: TBTemplateIdParam,
        body: TBUpdateQuestionnaireTemplateRequest,
        response: {
          200: TBQuestionnaireTemplate,
          400: TBErrorResponse,
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
      const isSuperAdmin = auth.isSuperAdmin === true;
      const { id } = request.params;
      const { name, description } = request.body;

      if (!isSuperAdmin && !auth.tenantId) {
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });
      }

      // No-op PATCH (empty body) is allowed and idempotent — the
      // updated_at trigger still bumps so the front gets a fresh row.
      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId as string }, fn);

      const result = await runTx(async (tx) => {
        const existing = await tx
          .select({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
          })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              eq(schema.questionnaireTemplates.id, id),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .limit(1);
        const found = existing[0];
        if (!found) return { kind: 'not-found' as const };

        if (
          !ability.can('update', {
            __subject: 'Template',
            id: found.id,
            tenantId: found.tenantId,
          })
        ) {
          return { kind: 'not-found' as const };
        }

        const patch: Record<string, unknown> = {};
        if (name !== undefined) patch['name'] = name;
        if (description !== undefined) patch['description'] = description;

        // No-op PATCH: nothing usable in the body. Return the current
        // row instead of issuing an UPDATE with an empty SET (which
        // Drizzle rejects). Fastify strips unknown body fields by
        // default (`removeAdditional: true`), so a payload of only
        // unrecognised keys lands here as well.
        if (Object.keys(patch).length === 0) {
          const [row] = await tx
            .select({
              id: schema.questionnaireTemplates.id,
              tenantId: schema.questionnaireTemplates.tenantId,
              name: schema.questionnaireTemplates.name,
              slug: schema.questionnaireTemplates.slug,
              description: schema.questionnaireTemplates.description,
              currentVersionId: schema.questionnaireTemplates.currentVersionId,
              createdAt: schema.questionnaireTemplates.createdAt,
              updatedAt: schema.questionnaireTemplates.updatedAt,
            })
            .from(schema.questionnaireTemplates)
            .where(eq(schema.questionnaireTemplates.id, id))
            .limit(1);
          if (!row) return { kind: 'not-found' as const };
          return { kind: 'ok' as const, row };
        }

        const [row] = await tx
          .update(schema.questionnaireTemplates)
          .set(patch)
          .where(eq(schema.questionnaireTemplates.id, id))
          .returning({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
            name: schema.questionnaireTemplates.name,
            slug: schema.questionnaireTemplates.slug,
            description: schema.questionnaireTemplates.description,
            currentVersionId: schema.questionnaireTemplates.currentVersionId,
            createdAt: schema.questionnaireTemplates.createdAt,
            updatedAt: schema.questionnaireTemplates.updatedAt,
          });
        if (!row) return { kind: 'not-found' as const };
        return { kind: 'ok' as const, row };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'template not found' });
      }
      return reply.send(toTemplateRow(result.row));
    },
  );

  app.delete(
    '/templates/:id',
    {
      preHandler: [app.requireAuth, app.requireAbility('delete', 'Template')],
      schema: {
        params: TBTemplateIdParam,
        response: {
          204: Type.Null(),
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
      const isSuperAdmin = auth.isSuperAdmin === true;
      const { id } = request.params;

      if (!isSuperAdmin && !auth.tenantId) {
        return reply.code(403).send({ code: 'NO_TENANT', message: 'caller has no active tenant' });
      }

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId as string }, fn);

      const result = await runTx(async (tx) => {
        const existing = await tx
          .select({
            id: schema.questionnaireTemplates.id,
            tenantId: schema.questionnaireTemplates.tenantId,
          })
          .from(schema.questionnaireTemplates)
          .where(
            and(
              eq(schema.questionnaireTemplates.id, id),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .limit(1);
        const found = existing[0];
        if (!found) return { kind: 'not-found' as const };
        if (
          !ability.can('delete', {
            __subject: 'Template',
            id: found.id,
            tenantId: found.tenantId,
          })
        ) {
          return { kind: 'not-found' as const };
        }
        const updated = await tx
          .update(schema.questionnaireTemplates)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(schema.questionnaireTemplates.id, id),
              isNull(schema.questionnaireTemplates.deletedAt),
            ),
          )
          .returning({ id: schema.questionnaireTemplates.id });
        if (updated.length === 0) return { kind: 'not-found' as const };
        return { kind: 'ok' as const };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'template not found' });
      }
      return reply.code(204).send(null);
    },
  );
};

export default questionnaireTemplatesRoutes;
