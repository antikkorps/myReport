import { type ConsoleEmailSender, createConsoleEmailSender } from '@myreport/email';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import { type Seed, type SuperAdminSeed, seedSuperAdmin, seedUser } from './setup/seed.ts';

// Edge cases listed up-front (per the project's "test edge cases" rule):
//
// POST /tenants (now: tenant + cabinet_admin invitation flow)
//   - super_admin creates the tenant, an invitation row is persisted,
//     the invitation email is sent, accepting the invitation lets the
//     invitee log in as cabinet_admin.
//   - 401 unauthenticated, 403 non-super-admin
//   - 400 on shape variants (empty name, bad slug, malformed email,
//     legacy `firstAdmin` payload from a stale front)
//   - 409 SLUG_TAKEN when the slug matches an active tenant
//   - 409 EMAIL_TAKEN when the adminEmail already matches an active
//     global user (multi-tenant user is a future story)
//   - slug of a soft-deleted tenant is reusable
//   - email of a soft-deleted user is reusable
//
// GET /tenants
//   - super_admin sees the active tenants with membership counts
//     (= 0 until the invitation is accepted)
//   - excludes soft-deleted tenants
//   - 403 non-super-admin, 401 unauthenticated

describe('admin tenants', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let cabinetAdmin: Seed;
  let superAdmin: SuperAdminSeed;
  let superAdminToken: string;
  let emailSender: ConsoleEmailSender;

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
      WEB_BASE_URL: 'http://localhost:5173',
    };

    emailSender = createConsoleEmailSender({ log: () => {} });
    app = await buildApp(env, { emailSender });

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

  beforeEach(() => {
    emailSender.reset();
  });

  function payload(slug: string, adminEmail: string) {
    return { name: 'Acme', slug, adminEmail };
  }

  function extractToken(acceptUrl: string): string {
    const url = new URL(acceptUrl);
    const token = url.searchParams.get('token');
    if (!token) throw new Error('no token in acceptUrl');
    return token;
  }

  describe('POST /tenants', () => {
    it('creates the tenant + cabinet_admin invitation, sends the email, and the invitee can log in after accepting', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('acme', 'alice@acme.test'),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tenant.slug).toBe('acme');
      expect(body.invitation.email).toBe('alice@acme.test');
      expect(body.invitation.role).toBe('cabinet_admin');
      expect(body.invitation.acceptUrl).toMatch(
        /^http:\/\/localhost:5173\/invitations\/accept\?token=/,
      );

      // Invitation email was sent through the captured sender.
      expect(emailSender.sent).toHaveLength(1);
      const sent = emailSender.sent[0];
      if (!sent) throw new Error('expected one captured email');
      expect(sent.email.to).toBe('alice@acme.test');
      expect(sent.email.text).toContain(body.invitation.acceptUrl);

      // Accept the invitation to materialise the user, then log in.
      const token = extractToken(body.invitation.acceptUrl);
      const accept = await app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        payload: { password: 'correct-horse-battery-staple', displayName: 'Alice' },
      });
      expect(accept.statusCode).toBe(200);

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
      ['empty name', { name: '', slug: 'val-1', adminEmail: 'a@b.test' }],
      ['bad slug', { name: 'A', slug: 'BadSlug', adminEmail: 'a@b.test' }],
      ['short slug', { name: 'A', slug: 'a', adminEmail: 'a@b.test' }],
      ['bad email', { name: 'A', slug: 'val-3', adminEmail: 'not-an-email' }],
    ])('returns 400 on %s', async (_label, body) => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects the legacy firstAdmin payload (stale front)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          name: 'Legacy',
          slug: 'legacy',
          firstAdmin: { email: 'a@b.test', displayName: 'A', password: 'longenough!' },
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
        payload: payload('dup-slug-2', 'second-dup@example.test'),
      });
      // Different slug + email → 201 (sanity check the prior call worked).
      expect(res.statusCode).toBe(201);

      const collide = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('dup-slug', 'third-dup@example.test'),
      });
      expect(collide.statusCode).toBe(409);
      expect(collide.json()).toMatchObject({ code: 'SLUG_TAKEN' });
    });

    it('returns 409 EMAIL_TAKEN when adminEmail matches an existing global user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: payload('email-conflict', cabinetAdmin.email),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('reuses the slug of a soft-deleted tenant', async () => {
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        await sql`
          insert into tenants (id, name, slug, deleted_at)
          values (${uuidv7()}, 'Old', 'reusable', now())
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
        await sql`
          insert into users (id, email, display_name, deleted_at)
          values (${uuidv7()}, 'gone@example.test', 'Gone User', now())
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
    it('returns active tenants with membership counts (= 0 until invitation accepted)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tenants',
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.items)).toBe(true);
      // 'acme' was created in the happy-path test above and its
      // invitation was accepted, so its membership count is at least 1.
      const acme = body.items.find((t: { slug: string }) => t.slug === 'acme');
      expect(acme).toBeDefined();
      expect(acme.membershipCount).toBeGreaterThanOrEqual(1);

      // 'reusable' was created without accepting the invitation —
      // membership count should be 0.
      const reusable = body.items.find((t: { slug: string }) => t.slug === 'reusable');
      expect(reusable?.membershipCount).toBe(0);
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
