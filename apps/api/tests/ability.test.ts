import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import { type Seed, seedUser } from './setup/seed.ts';

// We exercise the ability plugin through a tiny probe route mounted
// via Fastify's plugin API. The route reads request.ability and
// returns a serialised view, so the test asserts on the wiring rather
// than re-testing the rule matrix (which lives in @myreport/rbac).

describe('ability plugin', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let seed: Seed;

  beforeAll(async () => {
    pg = await startPostgres();
    seed = await seedUser(pg.url);
    const env: Env = {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 0,
      LOG_LEVEL: 'silent',
      DATABASE_URL: pg.url,
      JWT_ACCESS_SECRET: 'test-secret-with-enough-entropy',
      JWT_ACCESS_TTL: '15m',
      REFRESH_TOKEN_TTL_DAYS: 14,
      COOKIE_DOMAIN: undefined,
      CORS_ORIGIN: 'http://localhost:5173',
      EMAIL_DRIVER: 'console',
      WEB_BASE_URL: 'http://localhost:5173',
    };
    app = await buildApp(env);

    // `update` (not `manage`) since cabinet_admin loses `manage:Tenant`
    // — Tenant create/delete is super_admin-only.
    app.get(
      '/_probe/can',
      { preHandler: [app.requireAuth, app.requireAbility('update', 'Tenant')] },
      async () => ({ ok: true }),
    );
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await stopPostgres(pg);
  });

  async function login(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: seed.email, password: seed.password },
    });
    return res.json().accessToken;
  }

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/_probe/can' });
    expect(res.statusCode).toBe(401);
  });

  it('lets cabinet_admin pass the update:Tenant gate', async () => {
    // Seeded user is cabinet_admin of their tenant.
    const token = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/_probe/can',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
