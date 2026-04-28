import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Database } from '@myreport/db';
import { schema } from '@myreport/db';
import { TBErrorResponse, TBLoginRequest, TBLoginResponse } from '@myreport/shared-schemas';
import { and, eq, isNull } from 'drizzle-orm';
import { verifyPassword } from '../../services/passwords.ts';
import { createSession } from '../../services/sessions.ts';
import { generateRefreshToken, hashRefreshToken } from '../../services/tokens.ts';

interface LoginPluginOptions {
  refreshTtlDays: number;
  cookieDomain: string | undefined;
  isProd: boolean;
}

const loginRoute: FastifyPluginAsyncTypebox<LoginPluginOptions> = async (app, opts) => {
  app.post(
    '/auth/login',
    {
      config: {
        // Tighter limit than the global one to slow brute-force attempts.
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
      schema: {
        body: TBLoginRequest,
        response: {
          200: TBLoginResponse,
          401: TBErrorResponse,
          403: TBErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const result = await app.withAdminTx(async (tx) => {
        const user = await findUserByEmail(tx, email);
        if (!user) return null;
        const identity = await findPasswordIdentity(tx, user.id);
        if (!identity?.secretHash) return null;
        const ok = await verifyPassword(identity.secretHash, password);
        if (!ok) return null;

        await tx
          .update(schema.authIdentities)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.authIdentities.id, identity.id));

        const memberships = await tx
          .select({
            id: schema.memberships.id,
            tenantId: schema.tenants.id,
            tenantName: schema.tenants.name,
            tenantSlug: schema.tenants.slug,
            role: schema.memberships.role,
          })
          .from(schema.memberships)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
          .where(and(eq(schema.memberships.userId, user.id), isNull(schema.tenants.deletedAt)));

        // Require at least one tenant; multi-tenant picker is a Phase 2
        // concern, so for now we attach the first membership found.
        const chosen = memberships[0];
        if (!chosen) return { user, memberships: [], chosen: null };

        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashRefreshToken(refreshToken);
        const expiresAt = new Date(Date.now() + opts.refreshTtlDays * 24 * 60 * 60 * 1000);

        await createSession(tx, {
          userId: user.id,
          tenantId: chosen.tenantId,
          refreshTokenHash,
          expiresAt,
          userAgent: request.headers['user-agent'] ?? null,
          ipAddress: request.ip,
          rotatedFrom: null,
        });

        await tx
          .update(schema.users)
          .set({ lastLoginAt: new Date() })
          .where(eq(schema.users.id, user.id));

        return { user, memberships, chosen, refreshToken };
      });

      if (!result) {
        return reply
          .code(401)
          .send({ code: 'INVALID_CREDENTIALS', message: 'invalid credentials' });
      }
      if (!result.chosen || !result.refreshToken) {
        return reply
          .code(403)
          .send({ code: 'NO_TENANT', message: 'user is not a member of any active tenant' });
      }

      const accessToken = await reply.jwtSign({
        sub: result.user.id,
        tenantId: result.chosen.tenantId,
        isSuperAdmin: result.user.isSuperAdmin,
      });

      reply.setCookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: opts.isProd,
        path: '/auth',
        ...(opts.cookieDomain ? { domain: opts.cookieDomain } : {}),
        maxAge: opts.refreshTtlDays * 24 * 60 * 60,
      });

      return reply.send({
        accessToken,
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
          isSuperAdmin: result.user.isSuperAdmin,
        },
        tenant: {
          id: result.chosen.tenantId,
          name: result.chosen.tenantName,
          slug: result.chosen.tenantSlug,
          role: result.chosen.role,
        },
      });
    },
  );
};

async function findUserByEmail(db: Database, email: string) {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      isSuperAdmin: schema.users.isSuperAdmin,
    })
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

async function findPasswordIdentity(db: Database, userId: string) {
  const rows = await db
    .select({
      id: schema.authIdentities.id,
      secretHash: schema.authIdentities.secretHash,
    })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.userId, userId),
        eq(schema.authIdentities.provider, 'password'),
        isNull(schema.authIdentities.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export default loginRoute;
