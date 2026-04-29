import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import {
  type OrphanSeed,
  type Seed,
  type SuperAdminSeed,
  seedOrphanUser,
  seedSuperAdmin,
  seedUser,
} from './setup/seed.ts';

describe('auth + /me', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let seed: Seed;
  let superAdmin: SuperAdminSeed;
  let orphan: OrphanSeed;

  beforeAll(async () => {
    pg = await startPostgres();
    seed = await seedUser(pg.url);
    superAdmin = await seedSuperAdmin(pg.url);
    orphan = await seedOrphanUser(pg.url);
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
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await stopPostgres(pg);
  });

  it('rejects bad credentials with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: seed.email, password: 'wrong-password!' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('rejects unknown email with 401 (same shape, no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.test', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('logs in, returns access token + tenant, sets refresh cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: seed.email, password: seed.password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user).toMatchObject({ id: seed.userId, email: seed.email });
    expect(body.tenant).toMatchObject({ id: seed.tenantId, role: 'cabinet_admin' });

    const cookies = res.cookies as Array<{ name: string; value: string; httpOnly?: boolean }>;
    const refresh = cookies.find((c) => c.name === 'refresh_token');
    expect(refresh).toBeDefined();
    expect(refresh?.httpOnly).toBe(true);
  });

  it('lets a super_admin log in without any tenant membership', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: superAdmin.email, password: superAdmin.password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.isSuperAdmin).toBe(true);
    expect(body.tenant).toBeNull();
    expect(body.accessToken).toBeTypeOf('string');

    // /me should still work — the access token simply carries tenantId=null.
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json();
    expect(meBody.user.id).toBe(superAdmin.userId);
    expect(meBody.memberships).toEqual([]);
    expect(meBody.currentTenant).toBeNull();
  });

  it('rejects a non-super-admin without any membership with 403 NO_TENANT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: orphan.email, password: orphan.password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'NO_TENANT' });
  });

  it('rejects /me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns user + memberships on /me with a valid token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: seed.email, password: seed.password },
    });
    const { accessToken } = login.json();

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe(seed.userId);
    expect(body.memberships).toHaveLength(1);
    expect(body.currentTenant?.id).toBe(seed.tenantId);
  });

  it('rotates refresh token: new token works, old token is invalid', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: seed.email, password: seed.password },
    });
    const cookies = login.cookies as Array<{ name: string; value: string }>;
    const oldRefresh = cookies.find((c) => c.name === 'refresh_token')?.value;
    expect(oldRefresh).toBeTruthy();

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh_token: oldRefresh ?? '' },
    });
    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.json().accessToken).toBeTypeOf('string');

    // Replaying the old refresh token must fail and revoke the new one
    // too (chain reuse detection).
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh_token: oldRefresh ?? '' },
    });
    expect(replay.statusCode).toBe(401);

    const newCookies = refreshRes.cookies as Array<{ name: string; value: string }>;
    const newRefresh = newCookies.find((c) => c.name === 'refresh_token')?.value;
    const afterReuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh_token: newRefresh ?? '' },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: seed.email, password: seed.password },
    });
    const cookies = login.cookies as Array<{ name: string; value: string }>;
    const refresh = cookies.find((c) => c.name === 'refresh_token')?.value;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { refresh_token: refresh ?? '' },
    });
    expect(res.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh_token: refresh ?? '' },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
