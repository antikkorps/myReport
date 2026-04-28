import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { schema } from '@myreport/db';
import {
  TBCreateTenantRequest,
  TBCreateTenantResponse,
  TBErrorResponse,
  TBTenantListResponse,
} from '@myreport/shared-schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { hashPassword } from '../services/passwords.ts';

const tenantsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/tenants',
    {
      preHandler: [app.requireAuth, app.requireAbility('create', 'Tenant')],
      schema: {
        body: TBCreateTenantRequest,
        response: {
          201: TBCreateTenantResponse,
          400: TBErrorResponse,
          401: TBErrorResponse,
          403: TBErrorResponse,
          409: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { name, slug, firstAdmin } = request.body;

      // Hash the password outside the transaction so a slow argon2id
      // run does not hold the DB tx open for ~250 ms.
      const passwordHash = await hashPassword(firstAdmin.password);

      const result = await app.withAdminTx(async (tx) => {
        const slugTaken = await tx
          .select({ id: schema.tenants.id })
          .from(schema.tenants)
          .where(and(eq(schema.tenants.slug, slug), isNull(schema.tenants.deletedAt)))
          .limit(1);
        if (slugTaken.length > 0) {
          return { kind: 'slug-taken' as const };
        }

        const emailTaken = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.email, firstAdmin.email), isNull(schema.users.deletedAt)))
          .limit(1);
        if (emailTaken.length > 0) {
          return { kind: 'email-taken' as const };
        }

        const [tenantRow] = await tx.insert(schema.tenants).values({ name, slug }).returning({
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
        });
        if (!tenantRow) throw new Error('failed to insert tenant');

        const [userRow] = await tx
          .insert(schema.users)
          .values({
            email: firstAdmin.email,
            displayName: firstAdmin.displayName,
            isSuperAdmin: false,
          })
          .returning({
            id: schema.users.id,
            email: schema.users.email,
            displayName: schema.users.displayName,
          });
        if (!userRow) throw new Error('failed to insert user');

        await tx.insert(schema.authIdentities).values({
          userId: userRow.id,
          provider: 'password',
          secretHash: passwordHash,
          emailAtLink: userRow.email,
        });

        await tx.insert(schema.memberships).values({
          userId: userRow.id,
          tenantId: tenantRow.id,
          role: 'cabinet_admin',
        });

        return { kind: 'ok' as const, tenant: tenantRow, user: userRow };
      });

      if (result.kind === 'slug-taken') {
        return reply
          .code(409)
          .send({ code: 'SLUG_TAKEN', message: 'a tenant with this slug already exists' });
      }
      if (result.kind === 'email-taken') {
        return reply
          .code(409)
          .send({ code: 'EMAIL_TAKEN', message: 'a user with this email already exists' });
      }

      return reply.code(201).send({
        tenant: result.tenant,
        firstAdmin: result.user,
      });
    },
  );

  app.get(
    '/tenants',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'Tenant')],
      schema: {
        response: {
          200: TBTenantListResponse,
          401: TBErrorResponse,
          403: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      // Super-admin only path (the 'manage all' rule grants 'read'
      // on Tenant globally; tenant-scoped users can read their own
      // tenant via /me, not via this endpoint). Nothing here should
      // leak across tenants in a non-super-admin context, but we
      // still go through withAdminTx because counting memberships
      // across tenants would otherwise be filtered by RLS.
      if (!request.auth?.isSuperAdmin) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'super_admin required' });
      }

      const items = await app.withAdminTx(async (tx) => {
        const rows = await tx
          .select({
            id: schema.tenants.id,
            name: schema.tenants.name,
            slug: schema.tenants.slug,
            createdAt: schema.tenants.createdAt,
            membershipCount: sql<number>`count(${schema.memberships.id})::int`.as(
              'membership_count',
            ),
          })
          .from(schema.tenants)
          .leftJoin(schema.memberships, eq(schema.memberships.tenantId, schema.tenants.id))
          .where(isNull(schema.tenants.deletedAt))
          .groupBy(schema.tenants.id)
          .orderBy(schema.tenants.createdAt);
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          createdAt: r.createdAt.toISOString(),
          membershipCount: r.membershipCount,
        }));
      });

      return reply.send({ items });
    },
  );
};

export default tenantsRoutes;
