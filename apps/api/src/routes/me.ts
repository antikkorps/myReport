import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { schema } from '@myreport/db';
import { TBErrorResponse, TBMeResponse } from '@myreport/shared-schemas';
import { and, eq, isNull } from 'drizzle-orm';

const meRoute: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/me',
    {
      preHandler: app.requireAuth,
      schema: {
        response: {
          200: TBMeResponse,
          401: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const claims = request.user;

      return app.withTenantTx({ userId: claims.sub, tenantId: claims.tenantId }, async (tx) => {
        const userRows = await tx
          .select({
            id: schema.users.id,
            email: schema.users.email,
            displayName: schema.users.displayName,
            isSuperAdmin: schema.users.isSuperAdmin,
          })
          .from(schema.users)
          .where(eq(schema.users.id, claims.sub))
          .limit(1);
        const user = userRows[0];
        if (!user) {
          return reply.code(401).send({ code: 'USER_NOT_FOUND', message: 'user not found' });
        }

        // RLS narrows visibility to the current tenant; we additionally
        // want the user's *other* memberships to power a tenant picker
        // on the front. To list them we re-read with admin privileges.
        const memberships = await app.withAdminTx(async (admin) =>
          admin
            .select({
              id: schema.tenants.id,
              name: schema.tenants.name,
              slug: schema.tenants.slug,
              role: schema.memberships.role,
            })
            .from(schema.memberships)
            .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
            .where(
              and(eq(schema.memberships.userId, claims.sub), isNull(schema.tenants.deletedAt)),
            ),
        );

        const currentTenant = memberships.find((m) => m.id === claims.tenantId) ?? null;

        return reply.send({
          user,
          memberships,
          currentTenant,
        });
      });
    },
  );
};

export default meRoute;
