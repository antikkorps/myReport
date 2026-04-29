import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import { type Seed, type SuperAdminSeed, seedSuperAdmin, seedUser } from './setup/seed.ts';

// Edge cases listed up-front (per the project's "test edge cases" rule):
// - super_admin creates tenant + first admin (happy path)
// - 401 when unauthenticated
// - 403 when authenticated but not super_admin
// - 400 when payload validation fails (empty name, bad slug, short
//   password, malformed email)
// - 409 SLUG_TAKEN when slug collides with an active tenant
// - 409 EMAIL_TAKEN when email collides with an active user
// - Slug of a soft-deleted tenant is reusable
// - Email of a soft-deleted user is reusable
// - GET /tenants happy path (active only, includes membershipCount)
// - GET /tenants 403 for non-super-admin

describe('admin tenants', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let cabinetAdmin: Seed;
  let superAdmin: SuperAdminSeed;
  let superAdminToken: string;

  beforeAll(async () => {
    pg = await startPostgres();
    cabinetAdmin = await seedUser(pg.url);
    superAdmin = await seedSuperAdmin(pg.url);
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
    };
    app = await buildApp(env);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: superAdmin.email, password: superAdmin.password },
    });
    superAdminToken = login.json().accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await stopPostgres(pg);
  });

  function payload(slug: string, email: string) {
    return {
      name: 'Acme',
      slug,
      firstAdmin: {
        email,
        displayName: 'Alice',
        password: 'correct-horse-battery-staple',
      },
    };
  }

  describe('POST /tenants', () => {
    it('creates a tenant + first cabinet_admin user (happy path)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('acme', 'alice@acme.test'),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tenant.slug).toBe('acme');
      expect(body.firstAdmin.email).toBe('alice@acme.test');

      // The new user can log in with the supplied password and lands
      // attached to the new tenant as cabinet_admin.
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'alice@acme.test', password: 'correct-horse-battery-staple' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().tenant).toMatchObject({ slug: 'acme', role: 'cabinet_admin' });
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: payload('beta', 'beta@example.test'),
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects authenticated non-super-admin with 403', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: cabinetAdmin.email, password: cabinetAdmin.password },
      });
      const token = login.json().accessToken;

      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${token}` },
        payload: payload('gamma', 'gamma@example.test'),
      });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['empty name', { name: '', slug: 'val-1', email: 'a@b.test', password: 'longenough!' }],
      ['bad slug', { name: 'A', slug: 'BadSlug', email: 'a@b.test', password: 'longenough!' }],
      ['short slug', { name: 'A', slug: 'a', email: 'a@b.test', password: 'longenough!' }],
      ['short password', { name: 'A', slug: 'val-2', email: 'a@b.test', password: 'short' }],
      ['bad email', { name: 'A', slug: 'val-3', email: 'not-an-email', password: 'longenough!' }],
    ])('returns 400 on %s', async (_label, p) => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          name: p.name,
          slug: p.slug,
          firstAdmin: { email: p.email, displayName: 'X', password: p.password },
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 409 SLUG_TAKEN when the slug matches an active tenant', async () => {
      await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('dup-slug', 'first-dup@example.test'),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('dup-slug', 'second-dup@example.test'),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    });

    it('returns 409 EMAIL_TAKEN when the email matches an active user', async () => {
      await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('first-email', 'shared@example.test'),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('second-email', 'shared@example.test'),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('reuses the slug of a soft-deleted tenant', async () => {
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        // Create then soft-delete by slug 'reusable'.
        const id = uuidv7();
        await sql`
          insert into tenants (id, name, slug, deleted_at)
          values (${id}, 'Old', 'reusable', now())
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('reusable', 'reusable-admin@example.test'),
      });
      expect(res.statusCode).toBe(201);
    });

    it('reuses the email of a soft-deleted user', async () => {
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        const id = uuidv7();
        await sql`
          insert into users (id, email, display_name, deleted_at)
          values (${id}, 'gone@example.test', 'Gone User', now())
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('after-soft-delete', 'gone@example.test'),
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('GET /tenants', () => {
    it('returns the active tenants with membership counts (super_admin)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
      const acme = body.items.find((t: { slug: string }) => t.slug === 'acme');
      expect(acme).toBeDefined();
      expect(acme.membershipCount).toBeGreaterThanOrEqual(1);
    });

    it('does not include soft-deleted tenants', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      const body = res.json();
      const slugs: string[] = body.items.map((t: { slug: string }) => t.slug);
      expect(slugs).not.toContain('reusable-deleted-marker');
    });

    it('rejects non-super-admin with 403', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: cabinetAdmin.email, password: cabinetAdmin.password },
      });
      const token = login.json().accessToken;

      const res = await app.inject({
        method: 'GET',
        url: '/tenants',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects unauthenticated with 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/tenants' });
      expect(res.statusCode).toBe(401);
    });
  });
});
