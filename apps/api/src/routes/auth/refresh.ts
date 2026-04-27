import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { schema } from '@myreport/db';
import { TBErrorResponse, TBRefreshResponse } from '@myreport/shared-schemas';
import { eq } from 'drizzle-orm';
import {
  createSession,
  findSessionByHash,
  revokeChain,
  revokeSession,
} from '../../services/sessions.ts';
import { generateRefreshToken, hashRefreshToken } from '../../services/tokens.ts';

interface RefreshPluginOptions {
  refreshTtlDays: number;
  cookieDomain: string | undefined;
  isProd: boolean;
}

const refreshRoute: FastifyPluginAsyncTypebox<RefreshPluginOptions> = async (app, opts) => {
  app.post(
    '/auth/refresh',
    {
      schema: {
        response: {
          200: TBRefreshResponse,
          401: TBErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const presented = request.cookies['refresh_token'];
      if (!presented) {
        return reply.code(401).send({ code: 'NO_REFRESH_TOKEN', message: 'missing refresh token' });
      }

      const presentedHash = hashRefreshToken(presented);

      const outcome = await app.withAdminTx(async (tx) => {
        const session = await findSessionByHash(tx, presentedHash);
        if (!session) return { kind: 'unknown' as const };

        // Token reuse: a previously revoked refresh token has reappeared,
        // which means an attacker likely captured it. Burn the chain so
        // every descendant session is forced to re-authenticate.
        if (session.revokedAt) {
          await revokeChain(tx, session.id);
          return { kind: 'reuse' as const };
        }

        if (session.expiresAt.getTime() < Date.now()) {
          await revokeSession(tx, session.id);
          return { kind: 'expired' as const };
        }

        await revokeSession(tx, session.id);

        const newToken = generateRefreshToken();
        const newHash = hashRefreshToken(newToken);
        const expiresAt = new Date(Date.now() + opts.refreshTtlDays * 24 * 60 * 60 * 1000);

        await createSession(tx, {
          userId: session.userId,
          tenantId: session.tenantId,
          refreshTokenHash: newHash,
          expiresAt,
          userAgent: request.headers['user-agent'] ?? null,
          ipAddress: request.ip,
          rotatedFrom: session.id,
        });

        const userRows = await tx
          .select({
            id: schema.users.id,
            isSuperAdmin: schema.users.isSuperAdmin,
          })
          .from(schema.users)
          .where(eq(schema.users.id, session.userId))
          .limit(1);
        const user = userRows[0];
        if (!user) return { kind: 'unknown' as const };

        return {
          kind: 'rotated' as const,
          newToken,
          claims: {
            sub: user.id,
            tenantId: session.tenantId,
            isSuperAdmin: user.isSuperAdmin,
          },
        };
      });

      if (outcome.kind !== 'rotated') {
        reply.clearCookie('refresh_token', { path: '/auth' });
        return reply.code(401).send({ code: 'INVALID_REFRESH_TOKEN', message: 'session invalid' });
      }

      const accessToken = await reply.jwtSign(outcome.claims);

      reply.setCookie('refresh_token', outcome.newToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: opts.isProd,
        path: '/auth',
        ...(opts.cookieDomain ? { domain: opts.cookieDomain } : {}),
        maxAge: opts.refreshTtlDays * 24 * 60 * 60,
      });

      return reply.send({ accessToken });
    },
  );
};

export default refreshRoute;
