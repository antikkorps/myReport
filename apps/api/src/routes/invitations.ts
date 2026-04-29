import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { type Database, schema } from '@myreport/db';
import {
  TBAcceptInvitationRequest,
  TBAcceptInvitationResponse,
  TBCreateInvitationRequest,
  TBCreateInvitationResponse,
  TBErrorResponse,
  TBInvitationListResponse,
  TBInvitationStatus,
  TBUuid,
} from '@myreport/shared-schemas';
import { Type } from '@sinclair/typebox';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { buildInvitationEmail } from '../services/emails.ts';
import {
  buildAcceptUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
} from '../services/invitations.ts';
import { hashPassword } from '../services/passwords.ts';
import { createSession } from '../services/sessions.ts';
import { generateRefreshToken, hashRefreshToken } from '../services/tokens.ts';

interface InvitationsPluginOptions {
  webBaseUrl: string;
  refreshTtlDays: number;
  cookieDomain: string | undefined;
  isProd: boolean;
}

const invitationsRoutes: FastifyPluginAsyncTypebox<InvitationsPluginOptions> = async (
  app,
  opts,
) => {
  // ---------------------------------------------------------------
  // POST /invitations
  // ---------------------------------------------------------------
  app.post(
    '/invitations',
    {
      preHandler: [app.requireAuth, app.requireAbility('create', 'Invitation')],
      schema: {
        body: TBCreateInvitationRequest,
        response: {
          201: TBCreateInvitationResponse,
          400: TBErrorResponse,
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
          409: TBErrorResponse,
          500: TBErrorResponse,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { email, role, tenantId: bodyTenantId } = request.body;
      const auth = request.auth;
      const ability = request.ability;
      if (!auth || !ability) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'authentication required' });
      }

      const isSuperAdmin = auth.isSuperAdmin === true;

      // Resolve target tenant. Super-admin: explicit body field is
      // required. Cabinet-admin: implicit from auth context, body field
      // is rejected to avoid confusion ("which tenant did I just write to?").
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

      // Instance-level RBAC. The preHandler already verified the
      // caller has `create:Invitation` somewhere; this re-check
      // narrows to the *target* tenantId, so a cabinet_admin cannot
      // smuggle a foreign tenantId past the preHandler.
      if (
        !ability.can('create', {
          __subject: 'Invitation',
          id: 'pending',
          tenantId: targetTenantId,
          role,
        })
      ) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'insufficient permissions' });
      }

      // The accept link must be embedded in the email *and* returned
      // in the response, so we generate the token outside the tx.
      const token = generateInvitationToken();
      const expiresAt = invitationExpiry();
      const acceptUrl = buildAcceptUrl(opts.webBaseUrl, token.clear);

      // Whether to issue from the tenant context (cabinet_admin) or
      // bypass RLS entirely (super_admin). The lookup queries below
      // run inside the same tx so RLS isolation applies consistently.
      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: targetTenantId }, fn);

      const result = await runTx(async (tx) => {
        // Tenant must exist (super_admin path may pass a stale id).
        const tenantRows = await tx
          .select({ id: schema.tenants.id, name: schema.tenants.name })
          .from(schema.tenants)
          .where(and(eq(schema.tenants.id, targetTenantId), isNull(schema.tenants.deletedAt)))
          .limit(1);
        const tenant = tenantRows[0];
        if (!tenant) return { kind: 'tenant-not-found' as const };

        // Already an active member of the tenant?
        const memberRows = await tx
          .select({ userId: schema.memberships.userId })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(
            and(
              eq(schema.memberships.tenantId, targetTenantId),
              eq(schema.users.email, email),
              isNull(schema.users.deletedAt),
            ),
          )
          .limit(1);
        if (memberRows.length > 0) return { kind: 'already-member' as const };

        // Active invitation already pending? Partial unique covers
        // (tenant_id, email) on rows with all soft-state columns NULL,
        // but not the time-based expiry. Re-check both.
        const pendingRows = await tx
          .select({ id: schema.invitations.id, expiresAt: schema.invitations.expiresAt })
          .from(schema.invitations)
          .where(
            and(
              eq(schema.invitations.tenantId, targetTenantId),
              eq(schema.invitations.email, email),
              isNull(schema.invitations.consumedAt),
              isNull(schema.invitations.revokedAt),
              isNull(schema.invitations.deletedAt),
            ),
          )
          .limit(1);
        const pending = pendingRows[0];
        if (pending && pending.expiresAt.getTime() > Date.now()) {
          return { kind: 'invitation-pending' as const };
        }

        // Inviter id: known for any authenticated caller, but the
        // FK is nullable so super_admins (who don't have a membership
        // in the target tenant) can still be tracked.
        const [inserted] = await tx
          .insert(schema.invitations)
          .values({
            tenantId: targetTenantId,
            email,
            role,
            tokenHash: token.hash,
            expiresAt,
            invitedByUserId: auth.sub,
          })
          .returning({
            id: schema.invitations.id,
            email: schema.invitations.email,
            role: schema.invitations.role,
            tenantId: schema.invitations.tenantId,
            expiresAt: schema.invitations.expiresAt,
          });
        if (!inserted) throw new Error('failed to insert invitation');

        // Inviter display name, used in the email body. Best-effort:
        // a super_admin lookup uses the same query thanks to RLS bypass.
        const inviterRows = await tx
          .select({ displayName: schema.users.displayName })
          .from(schema.users)
          .where(eq(schema.users.id, auth.sub))
          .limit(1);
        const inviterName = inviterRows[0]?.displayName ?? null;

        return {
          kind: 'ok' as const,
          invitation: inserted,
          tenantName: tenant.name,
          inviterName,
        };
      });

      if (result.kind === 'tenant-not-found') {
        return reply.code(404).send({ code: 'TENANT_NOT_FOUND', message: 'tenant not found' });
      }
      if (result.kind === 'already-member') {
        return reply.code(409).send({
          code: 'ALREADY_MEMBER',
          message: 'this email is already a member of the tenant',
        });
      }
      if (result.kind === 'invitation-pending') {
        return reply.code(409).send({
          code: 'INVITATION_PENDING',
          message: 'an active invitation already exists for this email in this tenant',
        });
      }

      // Send the email *after* the tx commits — failing to send must
      // not roll back a row we already showed the user.
      try {
        await app.emailSender.send(
          buildInvitationEmail({
            inviteeEmail: result.invitation.email,
            tenantName: result.tenantName,
            inviterName: result.inviterName,
            role: result.invitation.role,
            acceptUrl,
            expiresAt: result.invitation.expiresAt,
          }),
        );
      } catch (err) {
        // The invitation row is in the DB; failing to send the email
        // is recoverable (admin can revoke + reissue). Log and surface
        // a 500 with a specific code so the front can hint at retry.
        request.log.error({ err, invitationId: result.invitation.id }, 'invitation email failed');
        return reply.code(500).send({
          code: 'EMAIL_DELIVERY_FAILED',
          message: 'invitation created but the email could not be sent',
        });
      }

      return reply.code(201).send({
        id: result.invitation.id,
        email: result.invitation.email,
        role: result.invitation.role,
        tenantId: result.invitation.tenantId,
        expiresAt: result.invitation.expiresAt.toISOString(),
        acceptUrl,
      });
    },
  );

  // ---------------------------------------------------------------
  // GET /invitations
  // ---------------------------------------------------------------
  app.get(
    '/invitations',
    {
      preHandler: [app.requireAuth, app.requireAbility('read', 'Invitation')],
      schema: {
        querystring: Type.Object({
          status: Type.Optional(Type.Union([TBInvitationStatus, Type.Literal('all')])),
          tenantId: Type.Optional(TBUuid),
        }),
        response: {
          200: TBInvitationListResponse,
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
      const status = request.query.status ?? 'pending';
      const tenantFilter = request.query.tenantId;

      const runTx = isSuperAdmin
        ? <T>(fn: (tx: Database) => Promise<T>) => app.withAdminTx(fn)
        : <T>(fn: (tx: Database) => Promise<T>) =>
            app.withTenantTx({ userId: auth.sub, tenantId: auth.tenantId }, fn);

      const items = await runTx(async (tx) => {
        // Compute status in SQL so the filter and the projected value
        // stay consistent. Order: consumed/revoked/expired/pending.
        const statusExpr = sql<string>`
          case
            when ${schema.invitations.consumedAt} is not null then 'consumed'
            when ${schema.invitations.revokedAt}  is not null then 'revoked'
            when ${schema.invitations.expiresAt}  <= now()   then 'expired'
            else 'pending'
          end`;

        const conditions = [isNull(schema.invitations.deletedAt)];
        if (isSuperAdmin && tenantFilter) {
          conditions.push(eq(schema.invitations.tenantId, tenantFilter));
        }
        if (status !== 'all') {
          conditions.push(sql`${statusExpr} = ${status}`);
        }

        const rows = await tx
          .select({
            id: schema.invitations.id,
            email: schema.invitations.email,
            role: schema.invitations.role,
            tenantId: schema.invitations.tenantId,
            status: statusExpr.as('status'),
            expiresAt: schema.invitations.expiresAt,
            createdAt: schema.invitations.createdAt,
            consumedAt: schema.invitations.consumedAt,
            revokedAt: schema.invitations.revokedAt,
            invitedByEmail: schema.users.email,
          })
          .from(schema.invitations)
          .leftJoin(schema.users, eq(schema.users.id, schema.invitations.invitedByUserId))
          .where(and(...conditions))
          .orderBy(schema.invitations.createdAt);

        return rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role,
          tenantId: r.tenantId,
          status: r.status as 'pending' | 'expired' | 'consumed' | 'revoked',
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          consumedAt: r.consumedAt ? r.consumedAt.toISOString() : null,
          revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
          invitedByEmail: r.invitedByEmail ?? null,
        }));
      });

      return reply.send({ items });
    },
  );

  // ---------------------------------------------------------------
  // DELETE /invitations/:id  — revoke a pending invitation
  // ---------------------------------------------------------------
  app.delete(
    '/invitations/:id',
    {
      preHandler: [app.requireAuth, app.requireAbility('delete', 'Invitation')],
      schema: {
        params: Type.Object({ id: TBUuid }),
        response: {
          204: Type.Null(),
          401: TBErrorResponse,
          403: TBErrorResponse,
          404: TBErrorResponse,
          410: TBErrorResponse,
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
            id: schema.invitations.id,
            tenantId: schema.invitations.tenantId,
            role: schema.invitations.role,
            consumedAt: schema.invitations.consumedAt,
            revokedAt: schema.invitations.revokedAt,
          })
          .from(schema.invitations)
          .where(and(eq(schema.invitations.id, id), isNull(schema.invitations.deletedAt)))
          .limit(1);
        const row = rows[0];
        if (!row) return { kind: 'not-found' as const };

        if (
          !ability.can('delete', {
            __subject: 'Invitation',
            id: row.id,
            tenantId: row.tenantId,
            role: row.role,
          })
        ) {
          return { kind: 'forbidden' as const };
        }

        if (row.consumedAt) return { kind: 'already-used' as const };
        if (row.revokedAt) return { kind: 'already-revoked' as const };

        await tx
          .update(schema.invitations)
          .set({ revokedAt: new Date() })
          .where(eq(schema.invitations.id, row.id));
        return { kind: 'ok' as const };
      });

      if (result.kind === 'not-found') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'invitation not found' });
      }
      if (result.kind === 'forbidden') {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'insufficient permissions' });
      }
      if (result.kind === 'already-used') {
        return reply
          .code(410)
          .send({ code: 'INVITATION_ALREADY_USED', message: 'invitation has already been used' });
      }
      if (result.kind === 'already-revoked') {
        return reply.code(410).send({
          code: 'INVITATION_ALREADY_REVOKED',
          message: 'invitation has already been revoked',
        });
      }
      return reply.code(204).send(null);
    },
  );

  // ---------------------------------------------------------------
  // POST /invitations/:token/accept — public, no auth
  // ---------------------------------------------------------------
  app.post(
    '/invitations/:token/accept',
    {
      schema: {
        params: Type.Object({ token: Type.String({ minLength: 16, maxLength: 256 }) }),
        body: TBAcceptInvitationRequest,
        response: {
          200: TBAcceptInvitationResponse,
          400: TBErrorResponse,
          404: TBErrorResponse,
          409: TBErrorResponse,
          410: TBErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params;
      const { password, displayName } = request.body;
      const tokenHash = hashInvitationToken(token);

      const passwordHash = await hashPassword(password);

      const result = await app
        .withAdminTx(async (tx) => {
          const rows = await tx
            .select({
              id: schema.invitations.id,
              email: schema.invitations.email,
              role: schema.invitations.role,
              tenantId: schema.invitations.tenantId,
              expiresAt: schema.invitations.expiresAt,
              consumedAt: schema.invitations.consumedAt,
              revokedAt: schema.invitations.revokedAt,
            })
            .from(schema.invitations)
            .where(
              and(
                eq(schema.invitations.tokenHash, tokenHash),
                isNull(schema.invitations.deletedAt),
              ),
            )
            .limit(1);
          const invitation = rows[0];
          if (!invitation) return { kind: 'not-found' as const };
          if (invitation.consumedAt) return { kind: 'already-used' as const };
          if (invitation.revokedAt) return { kind: 'revoked' as const };
          if (invitation.expiresAt.getTime() <= Date.now()) {
            return { kind: 'expired' as const };
          }

          // Multi-tenant user is a future story. v1: refuse acceptance
          // when the email already maps to a global user.
          const existing = await tx
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(and(eq(schema.users.email, invitation.email), isNull(schema.users.deletedAt)))
            .limit(1);
          if (existing.length > 0) return { kind: 'email-taken' as const };

          const tenantRows = await tx
            .select({
              id: schema.tenants.id,
              name: schema.tenants.name,
              slug: schema.tenants.slug,
            })
            .from(schema.tenants)
            .where(
              and(eq(schema.tenants.id, invitation.tenantId), isNull(schema.tenants.deletedAt)),
            )
            .limit(1);
          const tenant = tenantRows[0];
          if (!tenant) return { kind: 'tenant-gone' as const };

          const [userRow] = await tx
            .insert(schema.users)
            .values({
              email: invitation.email,
              displayName,
              isSuperAdmin: false,
              lastLoginAt: new Date(),
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
            lastUsedAt: new Date(),
          });

          await tx.insert(schema.memberships).values({
            userId: userRow.id,
            tenantId: tenant.id,
            role: invitation.role,
          });

          // Atomic consume — guards against parallel accepts. The unique
          // partial index on (tenant_id, email) doesn't help here (it
          // covers active invitations), so we rely on the consumedAt
          // null-check inside the same tx as the user insert.
          const consumeResult = await tx
            .update(schema.invitations)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(schema.invitations.id, invitation.id),
                isNull(schema.invitations.consumedAt),
                isNull(schema.invitations.revokedAt),
                isNull(schema.invitations.deletedAt),
              ),
            );
          if (consumeResult.count === 0) {
            // Another request consumed it between our SELECT and UPDATE.
            throw new Error('invitation_race');
          }

          const refreshToken = generateRefreshToken();
          const refreshTokenHash = hashRefreshToken(refreshToken);
          const expiresAt = new Date(Date.now() + opts.refreshTtlDays * 24 * 60 * 60 * 1000);

          await createSession(tx, {
            userId: userRow.id,
            tenantId: tenant.id,
            refreshTokenHash,
            expiresAt,
            userAgent: request.headers['user-agent'] ?? null,
            ipAddress: request.ip,
            rotatedFrom: null,
          });

          return {
            kind: 'ok' as const,
            user: userRow,
            tenant,
            role: invitation.role,
            refreshToken,
          };
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === 'invitation_race') {
            return { kind: 'already-used' as const };
          }
          throw err;
        });

      if (result.kind === 'not-found') {
        return reply
          .code(404)
          .send({ code: 'INVITATION_NOT_FOUND', message: 'invitation not found' });
      }
      if (result.kind === 'expired') {
        return reply
          .code(410)
          .send({ code: 'INVITATION_EXPIRED', message: 'invitation has expired' });
      }
      if (result.kind === 'revoked') {
        return reply
          .code(410)
          .send({ code: 'INVITATION_REVOKED', message: 'invitation has been revoked' });
      }
      if (result.kind === 'already-used') {
        return reply
          .code(410)
          .send({ code: 'INVITATION_ALREADY_USED', message: 'invitation has already been used' });
      }
      if (result.kind === 'email-taken') {
        return reply.code(409).send({
          code: 'EMAIL_TAKEN',
          message: 'a user with this email already exists',
        });
      }
      if (result.kind === 'tenant-gone') {
        return reply.code(410).send({ code: 'TENANT_GONE', message: 'tenant has been deleted' });
      }

      const accessToken = await reply.jwtSign({
        sub: result.user.id,
        tenantId: result.tenant.id,
        isSuperAdmin: false,
      });

      reply.setCookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: opts.isProd,
        path: '/auth',
        ...(opts.cookieDomain ? { domain: opts.cookieDomain } : {}),
        maxAge: opts.refreshTtlDays * 24 * 60 * 60,
      });

      return reply.code(200).send({
        accessToken,
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
          isSuperAdmin: false,
        },
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
          slug: result.tenant.slug,
          role: result.role,
        },
      });
    },
  );
};

export default invitationsRoutes;
