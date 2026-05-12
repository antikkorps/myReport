import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { EmailSender } from '@myreport/email';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.ts';
import abilityPlugin from './plugins/ability.ts';
import authPlugin from './plugins/auth.ts';
import dbPlugin from './plugins/db.ts';
import dbContextPlugin from './plugins/dbContext.ts';
import emailPlugin from './plugins/email.ts';
import errorHandlerPlugin from './plugins/errorHandler.ts';
import loginRoute from './routes/auth/login.ts';
import logoutRoute from './routes/auth/logout.ts';
import refreshRoute from './routes/auth/refresh.ts';
import invitationsRoutes from './routes/invitations.ts';
import meRoute from './routes/me.ts';
import membershipsRoutes from './routes/memberships.ts';
import questionnaireTemplatesRoutes from './routes/questionnaire-templates.ts';
import tenantsRoutes from './routes/tenants.ts';
import usersRoutes from './routes/users.ts';

export type AppInstance = FastifyInstance & {
  // Re-export the TypeBox provider so route files can rely on schema
  // types being inferred from the registered TypeBox schemas.
  withTypeProvider: never;
};

export interface BuildAppOptions {
  // Optional EmailSender override — used by integration tests to assert
  // against a captured outbox without going through the env factory.
  emailSender?: EmailSender;
}

export async function buildApp(env: Env, opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    trustProxy: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(fastifySensible);
  await app.register(errorHandlerPlugin);
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: env.CORS_ORIGIN.split(',').map((s: string) => s.trim()),
    credentials: true,
  });
  await app.register(fastifyHelmet, {
    // Swagger UI loads inline scripts and pulls fonts from data URIs;
    // we relax CSP just for that route's subtree.
    contentSecurityPolicy: false,
  });
  // Rate limit is disabled in test mode so integration tests can run
  // many auth attempts back-to-back from 127.0.0.1 without hitting
  // the 5/min cap. The cap is exercised separately if needed.
  if (env.NODE_ENV !== 'test') {
    await app.register(fastifyRateLimit, {
      max: 100,
      timeWindow: '1 minute',
    });
  }

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'myReport API',
        version: '0.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  await app.register(dbPlugin, { url: env.DATABASE_URL });
  await app.register(dbContextPlugin);
  await app.register(authPlugin, {
    secret: env.JWT_ACCESS_SECRET,
    accessTokenTtl: env.JWT_ACCESS_TTL,
  });
  await app.register(abilityPlugin);
  await app.register(emailPlugin, opts.emailSender ? { env, override: opts.emailSender } : { env });

  app.get('/health', async () => ({ status: 'ok' }));

  const cookieOpts = {
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    cookieDomain: env.COOKIE_DOMAIN,
    isProd: env.NODE_ENV === 'production',
  };

  await app.register(loginRoute, cookieOpts);
  await app.register(refreshRoute, cookieOpts);
  await app.register(logoutRoute, {
    cookieDomain: env.COOKIE_DOMAIN,
    isProd: env.NODE_ENV === 'production',
  });
  await app.register(meRoute);
  await app.register(tenantsRoutes, { webBaseUrl: env.WEB_BASE_URL });
  await app.register(usersRoutes);
  await app.register(membershipsRoutes);
  await app.register(invitationsRoutes, {
    webBaseUrl: env.WEB_BASE_URL,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    cookieDomain: env.COOKIE_DOMAIN,
    isProd: env.NODE_ENV === 'production',
  });
  await app.register(questionnaireTemplatesRoutes);

  return app;
}
