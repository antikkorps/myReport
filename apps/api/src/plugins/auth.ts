import fastifyJwt from '@fastify/jwt';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AccessTokenClaims } from '../services/tokens.ts';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth: AccessTokenClaims | null;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

interface AuthOptions {
  secret: string;
  accessTokenTtl: string;
}

const authPlugin: FastifyPluginAsync<AuthOptions> = async (app, opts) => {
  await app.register(fastifyJwt, {
    secret: opts.secret,
    sign: { expiresIn: opts.accessTokenTtl },
  });

  app.decorateRequest('auth', null);

  app.decorate('requireAuth', async function requireAuth(request: FastifyRequest) {
    try {
      await request.jwtVerify();
      request.auth = request.user;
    } catch {
      throw app.httpErrors.unauthorized('invalid or missing access token');
    }
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/sensible'] });
