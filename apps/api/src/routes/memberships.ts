import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { type Database, schema } from '@myreport/db';
import {
  TBErrorResponse,
  TBUpdateMembershipRequest,
  TBUpdateMembershipResponse,
  TBUuid,
} from '@myreport/shared-schemas';
import { Type } from '@sinclair/typebox';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';

// Counts active `cabinet_admin` memberships in the given tenant,
// optionally excluding one row (used when checking whether the
// candidate row is the *last* admin before mutating it).
async function countActiveAdmins(
  db: Database,
  tenantId: string,
  excludeMembershipId: string | null,
): Promise<number> {
  const baseConditions = [
    eq(schema.memberships.tenantId, tenantId),
    eq(schema.memberships.role, 'cabinet_admin'),
    isNull(schema.memberships.deletedAt),
  ];
  if (excludeMembershipId) {
    baseConditions.push(ne(schema.memberships.id, excludeMembershipId));
  }
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(and(...baseConditions));
  return rows[0]?.count ?? 0;
}

const membershipsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // -----------------------------------------------------------------
  // PATCH /memberships/:id — change a user's role inside a tenant
  // -----------------------------------------------------------------
  app.patch(
    '/memberships/:id',
    {
      preHandler: [app.requireAuth, app.requireAbility('update', 'Membership')],
      schema: {
        params: Type.Object({ id: TBUuid }),
        body: TBUpdateMembershipRequest,
        response: {
          200: TBUpdateMembershipResponse,
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
      const isSuperAdmin = auth.isSuperAdmin === true;
      const { id } = request.params;
      const { role: newRole } = request.body;

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId }, fn);

      const result = await runTx(async (tx) => {
        const rows = await tx
          .select({
            id: schema.memberships.id,
            tenantId: schema.memberships.tenantId,
            userId: schema.memberships.userId,
            role: schema.memberships.role,
          })
          .from(schema.memberships)
          .where(and(eq(schema.memberships.id, id), isNull(schema.memberships.deletedAt)))
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: 'not-found' as const };

        if (
          !ability.can('update', {
            __subject: 'Membership',
            id: row.id,
            tenantId: row.tenantId,
            userId: row.userId,
            role: row.role,
          })
        ) {
          return { kind: 'forbidden' as const };
        }

        if (row.role === newRole) {
          // No-op: return the current row so PATCH stays idempotent.
          return { kind: 'ok' as const, row };
        }

        // Demoting the last cabinet_admin would lock the tenant out
        // of admin operations. Reject up-front rather than letting it
        // happen and then surface a confusing UX state.
        if (row.role === 'cabinet_admin' && newRole !== 'cabinet_admin') {
          const remaining = await countActiveAdmins(tx, row.tenantId, row.id);
          if (remaining === 0) return { kind: 'last-admin' as const };
        }

        const [updated] = await tx
          .update(schema.memberships)
          .set({ role: newRole })
          .where(eq(schema.memberships.id, row.id))
          .returning({
            id: schema.memberships.id,
            tenantId: schema.memberships.tenantId,
            userId: schema.memberships.userId,
            role: schema.memberships.role,
          });
        if (!updated) throw new Error('failed to update membership');
        return { kind: 'ok' as const, row: updated };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'membership not found' });
      }
      if (result.kind === 'forbidden') {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'insufficient permissions' });
      }
      if (result.kind === 'last-admin') {
        return reply.code(409).send({
          code: 'LAST_ADMIN',
          message: 'cannot demote the last active cabinet_admin of this tenant',
        });
      }

      return reply.send(result.row);
    },
  );

  // -----------------------------------------------------------------
  // DELETE /memberships/:id — soft-delete + revoke active sessions
  // -----------------------------------------------------------------
  app.delete(
    '/memberships/:id',
    {
      preHandler: [app.requireAuth, app.requireAbility('delete', 'Membership')],
      schema: {
        params: Type.Object({ id: TBUuid }),
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
      const ability = request.ability;
      if (!auth || !ability) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const isSuperAdmin = auth.isSuperAdmin === true;
      const { id } = request.params;

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId }, fn);

      const result = await runTx(async (tx) => {
        const rows = await tx
          .select({
            id: schema.memberships.id,
            tenantId: schema.memberships.tenantId,
            userId: schema.memberships.userId,
            role: schema.memberships.role,
          })
          .from(schema.memberships)
          .where(and(eq(schema.memberships.id, id), isNull(schema.memberships.deletedAt)))
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: 'not-found' as const };

        if (
          !ability.can('delete', {
            __subject: 'Membership',
            id: row.id,
            tenantId: row.tenantId,
            userId: row.userId,
            role: row.role,
          })
        ) {
          return { kind: 'forbidden' as const };
        }

        if (row.role === 'cabinet_admin') {
          const remaining = await countActiveAdmins(tx, row.tenantId, row.id);
          if (remaining === 0) return { kind: 'last-admin' as const };
        }

        await tx
          .update(schema.memberships)
          .set({ deletedAt: new Date() })
          .where(eq(schema.memberships.id, row.id));

        // Revoke active sessions for this (user, tenant) pair so the
        // user loses access immediately. The user keeps their global
        // account and can still sign in to *other* tenants they
        // belong to. Sessions are filtered by `withTenantTx` for the
        // cabinet_admin path, so we have to drop to admin to update
        // sessions across the user's other tenants.
        await app.withAdminTx(async (admin) => {
          await admin
            .update(schema.sessions)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(schema.sessions.userId, row.userId),
                eq(schema.sessions.tenantId, row.tenantId),
                isNull(schema.sessions.revokedAt),
              ),
            );
        });

        return { kind: 'ok' as const };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'membership not found' });
      }
      if (result.kind === 'forbidden') {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'insufficient permissions' });
      }
      if (result.kind === 'last-admin') {
        return reply.code(409).send({
          code: 'LAST_ADMIN',
          message: 'cannot remove the last active cabinet_admin of this tenant',
        });
      }
      return reply.code(204).send(null);
    },
  );
};

export default membershipsRoutes;
