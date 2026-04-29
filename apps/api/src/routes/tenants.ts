import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { schema } from '@myreport/db';
import {
  TBCreateTenantRequest,
  TBCreateTenantResponse,
  TBErrorResponse,
  TBTenantListResponse,
} from '@myreport/shared-schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { buildInvitationEmail } from '../services/emails.ts';
import {
  buildAcceptUrl,
  generateInvitationToken,
  invitationExpiry,
} from '../services/invitations.ts';

interface TenantsPluginOptions {
  // Public base URL of the web app — embedded in the invitation link
  // sent to the freshly-named cabinet_admin.
  webBaseUrl: string;
}

const tenantsRoutes: FastifyPluginAsyncTypebox<TenantsPluginOptions> = async (app, opts) => {
  // Tenant creation goes through the invitation flow: super_admin
  // names the cabinet + the email of the first admin, and a single
  // invitation row is created alongside the tenant. The invitee picks
  // their password and displayName at accept time. No password ever
  // travels out-of-band.
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
          500: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }
      const { name, slug, adminEmail } = request.body;

      // Token + expiry generated outside the tx so they can be passed
      // to the email template after commit.
      const token = generateInvitationToken();
      const expiresAt = invitationExpiry();
      const acceptUrl = buildAcceptUrl(opts.webBaseUrl, token.clear);

      const result = await app.withAdminTx(async (tx) => {
        const slugTaken = await tx
          .select({ id: schema.tenants.id })
          .from(schema.tenants)
          .where(and(eq(schema.tenants.slug, slug), isNull(schema.tenants.deletedAt)))
          .limit(1);
        if (slugTaken.length > 0) return { kind: 'slug-taken' as const };

        // Refuse early when the admin email already maps to a global
        // user. The accept route would surface the same EMAIL_TAKEN
        // later anyway; failing here avoids leaving a dead invitation
        // around. Multi-tenant user is a future story.
        const emailTaken = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.email, adminEmail), isNull(schema.users.deletedAt)))
          .limit(1);
        if (emailTaken.length > 0) return { kind: 'email-taken' as const };

        const [tenantRow] = await tx.insert(schema.tenants).values({ name, slug }).returning({
          id: schema.tenants.id,
          name: schema.tenants.name,
          slug: schema.tenants.slug,
        });
        if (!tenantRow) throw new Error('failed to insert tenant');

        const [invitation] = await tx
          .insert(schema.invitations)
          .values({
            tenantId: tenantRow.id,
            email: adminEmail,
            role: 'cabinet_admin',
            tokenHash: token.hash,
            expiresAt,
            invitedByUserId: auth.sub,
          })
          .returning({
            id: schema.invitations.id,
            email: schema.invitations.email,
            role: schema.invitations.role,
            expiresAt: schema.invitations.expiresAt,
          });
        if (!invitation) throw new Error('failed to insert invitation');

        const inviterRows = await tx
          .select({ displayName: schema.users.displayName })
          .from(schema.users)
          .where(eq(schema.users.id, auth.sub))
          .limit(1);
        const inviterName = inviterRows[0]?.displayName ?? null;

        return {
          kind: 'ok' as const,
          tenant: tenantRow,
          invitation,
          inviterName,
        };
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

      // Email is sent after the tx commits — failure to deliver must
      // not roll back a tenant we already showed the caller. Same
      // pattern as POST /invitations.
      try {
        await app.emailSender.send(
          buildInvitationEmail({
            inviteeEmail: result.invitation.email,
            tenantName: result.tenant.name,
            inviterName: result.inviterName,
            role: result.invitation.role,
            acceptUrl,
            expiresAt: result.invitation.expiresAt,
          }),
        );
      } catch (err) {
        request.log.error(
          { err, invitationId: result.invitation.id, tenantId: result.tenant.id },
          'tenant invitation email failed',
        );
        return reply.code(500).send({
          code: 'EMAIL_DELIVERY_FAILED',
          message: 'tenant created but the admin invitation email could not be sent',
        });
      }

      return reply.code(201).send({
        tenant: result.tenant,
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          role: result.invitation.role,
          expiresAt: result.invitation.expiresAt.toISOString(),
          acceptUrl,
        },
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
          .leftJoin(
            schema.memberships,
            and(
              eq(schema.memberships.tenantId, schema.tenants.id),
              isNull(schema.memberships.deletedAt),
            ),
          )
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
