import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { type Database, schema } from '@myreport/db';
import { TBErrorResponse, TBUserListResponse, TBUuid } from '@myreport/shared-schemas';
import { Type } from '@sinclair/typebox';
import { and, eq, isNull } from 'drizzle-orm';

const usersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Cabinet-admin lists active members of their tenant. super_admin
  // can pass `?tenantId` to scope; without one, they see every active
  // membership across every tenant — same convention as GET /invitations.
  app.get(
    '/users',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'User')],
      schema: {
        querystring: Type.Object({
          tenantId: Type.Optional(TBUuid),
        }),
        response: {
          200: TBUserListResponse,
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
      const tenantFilter = request.query.tenantId;

      // Auditor explicitly forbidden from the listing — they only have
      // `read User` scoped to their own row, not a tenant-wide list.
      if (!isSuperAdmin && !request.ability?.can('manage', 'User')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'insufficient permissions' });
      }

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId }, fn);

      const items = await runTx(async (tx) => {
        const conditions = [isNull(schema.memberships.deletedAt), isNull(schema.users.deletedAt)];
        if (isSuperAdmin && tenantFilter) {
          conditions.push(eq(schema.memberships.tenantId, tenantFilter));
        }

        const rows = await tx
          .select({
            id: schema.users.id,
            email: schema.users.email,
            displayName: schema.users.displayName,
            lastLoginAt: schema.users.lastLoginAt,
            membershipId: schema.memberships.id,
            role: schema.memberships.role,
            joinedAt: schema.memberships.createdAt,
          })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(and(...conditions))
          .orderBy(schema.memberships.createdAt);

        return rows.map((r) => ({
          id: r.id,
          email: r.email,
          displayName: r.displayName,
          membershipId: r.membershipId,
          role: r.role,
          joinedAt: r.joinedAt.toISOString(),
          lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
        }));
      });

      return reply.send({ items });
    },
  );
};

export default usersRoutes;
