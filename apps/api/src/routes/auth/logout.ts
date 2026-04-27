import type { FastifyPluginAsync } from 'fastify';
import { findSessionByHash, revokeSession } from '../../services/sessions.ts';
import { hashRefreshToken } from '../../services/tokens.ts';

interface LogoutPluginOptions {
  cookieDomain: string | undefined;
  isProd: boolean;
}

const logoutRoute: FastifyPluginAsync<LogoutPluginOptions> = async (app, opts) => {
  app.post('/auth/logout', async (request, reply) => {
    const presented = request.cookies['refresh_token'];
    if (presented) {
      const hash = hashRefreshToken(presented);
      await app.withAdminTx(async (tx) => {
        const session = await findSessionByHash(tx, hash);
        if (session && !session.revokedAt) {
          await revokeSession(tx, session.id);
        }
      });
    }
    reply.clearCookie('refresh_token', {
      path: '/auth',
      ...(opts.cookieDomain ? { domain: opts.cookieDomain } : {}),
      sameSite: 'lax',
      secure: opts.isProd,
    });
    return reply.code(204).send();
  });
};

export default logoutRoute;
