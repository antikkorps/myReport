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
// POST /invitations
//   - 401 without auth
//   - 403 when caller is auditor
//   - 403 cabinet_admin attempting cross-tenant via tenantId in body (rejected)
//   - 400 super_admin missing tenantId
//   - 400 cabinet_admin sending tenantId in body
//   - 400 malformed payload variants (empty body, bad email, invalid role)
//   - 404 super_admin pointing at a deleted tenant
//   - 409 ALREADY_MEMBER when email is an active member of the tenant
//   - 409 INVITATION_PENDING when an active invitation already exists
//   - re-invite OK after revoke / consume / soft-delete
//   - 201 happy path: cabinet_admin invites auditor, email captured
//   - 201 happy path: super_admin invites cabinet_admin
//
// GET /invitations
//   - 401 without auth
//   - 403 auditor
//   - cabinet_admin sees only their tenant
//   - default filter is pending; ?status=all returns every status
//   - super_admin can pass ?tenantId to scope
//
// DELETE /invitations/:id
//   - 401 without auth
//   - 404 unknown id
//   - 404 cross-tenant for cabinet_admin (RLS hides it)
//   - 410 INVITATION_ALREADY_USED on a consumed row
//   - 410 INVITATION_ALREADY_REVOKED on a revoked row
//   - 204 success
//
// POST /invitations/:token/accept
//   - 404 INVITATION_NOT_FOUND on unknown token
//   - 410 INVITATION_EXPIRED
//   - 410 INVITATION_REVOKED
//   - 410 INVITATION_ALREADY_USED
//   - 400 bad password
//   - 409 EMAIL_TAKEN if a user with that email already exists
//   - 200 happy path: creates user + auth_identity + membership, returns
//     access token + sets refresh cookie

describe('invitations', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let cabinetAdmin: Seed;
  let superAdmin: SuperAdminSeed;
  let cabinetAdminToken: string;
  let superAdminToken: string;
  let auditor: { userId: string; tenantId: string; email: string; password: string; token: string };
  let emailSender: ConsoleEmailSender;

  beforeAll(async () => {
    pg = await startPostgres();
    cabinetAdmin = await seedUser(pg.url);
    superAdmin = await seedSuperAdmin(pg.url);

    // Seed an auditor inside the same tenant as the cabinet admin.
    const sql = postgres(pg.url, { max: 1, prepare: false });
    const auditorUserId = uuidv7();
    const auditorEmail = `auditor-${auditorUserId.slice(-12)}@example.test`;
    const auditorPassword = 'correct-horse-battery-staple';
    try {
      const argon2 = await import('argon2');
      const hash = await argon2.default.hash(auditorPassword);
      await sql`SET ROLE app_admin`;
      await sql`
        insert into users (id, email, display_name)
        values (${auditorUserId}, ${auditorEmail}, 'Auditor User')
      `;
      await sql`
        insert into auth_identities (id, user_id, provider, secret_hash, email_at_link)
        values (${uuidv7()}, ${auditorUserId}, 'password', ${hash}, ${auditorEmail})
      `;
      await sql`
        insert into memberships (id, tenant_id, user_id, role)
        values (${uuidv7()}, ${cabinetAdmin.tenantId}, ${auditorUserId}, 'auditor')
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

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

    const loginCabinet = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: cabinetAdmin.email, password: cabinetAdmin.password },
    });
    cabinetAdminToken = loginCabinet.json().accessToken;

    const loginSuper = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: superAdmin.email, password: superAdmin.password },
    });
    superAdminToken = loginSuper.json().accessToken;

    const loginAuditor = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: auditorEmail, password: auditorPassword },
    });
    auditor = {
      userId: auditorUserId,
      tenantId: cabinetAdmin.tenantId,
      email: auditorEmail,
      password: auditorPassword,
      token: loginAuditor.json().accessToken,
    };
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await stopPostgres(pg);
  });

  beforeEach(() => {
    emailSender.reset();
  });

  // -----------------------------------------------------------------
  // POST /invitations
  // -----------------------------------------------------------------
  describe('POST /invitations', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        payload: { email: 'invitee@example.test', role: 'auditor' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects auditor callers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${auditor.token}` },
        payload: { email: 'invitee@example.test', role: 'auditor' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects cabinet_admin sending tenantId in the body', async () => {
      const otherTenantId = uuidv7();
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email: 'invitee@example.test', role: 'auditor', tenantId: otherTenantId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_ID_FORBIDDEN');
    });

    it('rejects super_admin missing tenantId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { email: 'invitee@example.test', role: 'cabinet_admin' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_ID_REQUIRED');
    });

    it('rejects malformed payloads (empty, bad email, invalid role)', async () => {
      const variants = [
        {},
        { email: 'invitee@example.test' },
        { role: 'auditor' },
        { email: 'not-an-email', role: 'auditor' },
        { email: 'invitee@example.test', role: 'super_admin' },
      ];
      for (const payload of variants) {
        const res = await app.inject({
          method: 'POST',
          url: '/invitations',
          headers: { authorization: `Bearer ${cabinetAdminToken}` },
          payload,
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('returns 404 when super_admin targets a missing tenant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { email: 'somebody@example.test', role: 'cabinet_admin', tenantId: uuidv7() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('TENANT_NOT_FOUND');
    });

    it('returns 409 ALREADY_MEMBER when the email is already a member', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email: auditor.email, role: 'auditor' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ALREADY_MEMBER');
    });

    it('cabinet_admin invites an auditor (happy path) and the email is captured', async () => {
      const email = `pending-${uuidv7().slice(-8)}@example.test`;
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.email).toBe(email);
      expect(body.role).toBe('auditor');
      expect(body.tenantId).toBe(cabinetAdmin.tenantId);
      expect(body.acceptUrl).toMatch(/^http:\/\/localhost:5173\/invitations\/accept\?token=/);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      expect(emailSender.sent).toHaveLength(1);
      const sent = emailSender.sent[0];
      if (!sent) throw new Error('expected one captured email');
      expect(sent.email.to).toBe(email);
      expect(sent.email.text).toContain(body.acceptUrl);
    });

    it('returns 409 INVITATION_PENDING on a duplicate active invitation', async () => {
      const email = `dup-${uuidv7().slice(-8)}@example.test`;
      const first = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      expect(first.statusCode).toBe(201);

      const dup = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('INVITATION_PENDING');
    });

    it('allows re-inviting after the previous invitation was revoked', async () => {
      const email = `reinvite-${uuidv7().slice(-8)}@example.test`;
      const first = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      const firstId = first.json().id;

      const del = await app.inject({
        method: 'DELETE',
        url: `/invitations/${firstId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(del.statusCode).toBe(204);

      const reinvite = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      expect(reinvite.statusCode).toBe(201);
    });

    it('super_admin can invite a cabinet_admin into any tenant', async () => {
      const email = `cab-${uuidv7().slice(-8)}@example.test`;
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { email, role: 'cabinet_admin', tenantId: cabinetAdmin.tenantId },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe('cabinet_admin');
    });
  });

  // -----------------------------------------------------------------
  // GET /invitations
  // -----------------------------------------------------------------
  describe('GET /invitations', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'GET', url: '/invitations' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects auditor callers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/invitations',
        headers: { authorization: `Bearer ${auditor.token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('cabinet_admin sees pending invitations of their tenant by default', async () => {
      // Create a fresh invitation we can rely on regardless of test order.
      const email = `list-${uuidv7().slice(-8)}@example.test`;
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(
        body.items.every((i: { tenantId: string }) => i.tenantId === cabinetAdmin.tenantId),
      ).toBe(true);
      expect(body.items.every((i: { status: string }) => i.status === 'pending')).toBe(true);
      expect(body.items.find((i: { email: string }) => i.email === email)).toBeDefined();
    });

    it('?status=all returns every status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/invitations?status=all',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const statuses = new Set(res.json().items.map((i: { status: string }) => i.status));
      expect(statuses.has('pending')).toBe(true);
      // Revoked rows came from the re-invite flow.
      expect(statuses.has('revoked')).toBe(true);
    });

    it('super_admin filters by ?tenantId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/invitations?status=all&tenantId=${cabinetAdmin.tenantId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(
        res.json().items.every((i: { tenantId: string }) => i.tenantId === cabinetAdmin.tenantId),
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // DELETE /invitations/:id
  // -----------------------------------------------------------------
  describe('DELETE /invitations/:id', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'DELETE', url: `/invitations/${uuidv7()}` });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/invitations/${uuidv7()}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when cabinet_admin targets another tenant', async () => {
      // Seed a separate tenant + invitation via app_admin.
      const otherTenantId = uuidv7();
      const otherInvId = uuidv7();
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        await sql`
          insert into tenants (id, name, slug)
          values (${otherTenantId}, 'Other', ${`other-${otherTenantId.slice(-8)}`})
        `;
        await sql.unsafe(
          `insert into invitations (id, tenant_id, email, role, token_hash, expires_at)
           values ('${otherInvId}', '${otherTenantId}', 'cross@example.test', 'auditor',
                   decode('${'aa'.repeat(32)}', 'hex'), now() + interval '7 days')`,
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      const res = await app.inject({
        method: 'DELETE',
        url: `/invitations/${otherInvId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 410 INVITATION_ALREADY_REVOKED when revoking twice', async () => {
      const email = `revoke-twice-${uuidv7().slice(-8)}@example.test`;
      const first = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      const id = first.json().id;

      const del1 = await app.inject({
        method: 'DELETE',
        url: `/invitations/${id}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(del1.statusCode).toBe(204);

      const del2 = await app.inject({
        method: 'DELETE',
        url: `/invitations/${id}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(del2.statusCode).toBe(410);
      expect(del2.json().code).toBe('INVITATION_ALREADY_REVOKED');
    });
  });

  // -----------------------------------------------------------------
  // POST /invitations/:token/accept
  // -----------------------------------------------------------------
  describe('POST /invitations/:token/accept', () => {
    function extractToken(acceptUrl: string): string {
      const url = new URL(acceptUrl);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('no token in acceptUrl');
      return token;
    }

    it('returns 404 INVITATION_NOT_FOUND on an unknown token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations/this-token-does-not-exist/accept',
        payload: { password: 'longenough', displayName: 'New User' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('INVITATION_NOT_FOUND');
    });

    it('rejects a short password', async () => {
      const email = `short-${uuidv7().slice(-8)}@example.test`;
      const created = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      const token = extractToken(created.json().acceptUrl);
      const res = await app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        payload: { password: 'short', displayName: 'New User' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 409 EMAIL_TAKEN when a user with that email already exists', async () => {
      // Re-use the cabinet_admin's email which already maps to a user.
      const sql = postgres(pg.url, { max: 1, prepare: false });
      const invId = uuidv7();
      const tokenClear = `tok-${uuidv7()}`;
      const { createHash } = await import('node:crypto');
      const hashHex = createHash('sha256').update(tokenClear).digest('hex');
      try {
        await sql`SET ROLE app_admin`;
        await sql.unsafe(
          `insert into invitations (id, tenant_id, email, role, token_hash, expires_at)
           values ('${invId}', '${cabinetAdmin.tenantId}', '${cabinetAdmin.email}', 'auditor',
                   decode('${hashHex}', 'hex'), now() + interval '7 days')`,
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      const res = await app.inject({
        method: 'POST',
        url: `/invitations/${tokenClear}/accept`,
        payload: { password: 'longenough', displayName: 'Conflict User' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('EMAIL_TAKEN');
    });

    it('happy path: creates user + membership and issues an access token', async () => {
      const email = `accept-${uuidv7().slice(-8)}@example.test`;
      const created = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      expect(created.statusCode).toBe(201);
      const token = extractToken(created.json().acceptUrl);

      const res = await app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        payload: { password: 'correct-horse-battery-staple', displayName: 'New Auditor' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken.length).toBeGreaterThan(0);
      expect(body.user.email).toBe(email);
      expect(body.user.displayName).toBe('New Auditor');
      expect(body.tenant.id).toBe(cabinetAdmin.tenantId);
      expect(body.tenant.role).toBe('auditor');
      expect(res.cookies.find((c) => c.name === 'refresh_token')).toBeDefined();

      // The new user can log in immediately.
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'correct-horse-battery-staple' },
      });
      expect(login.statusCode).toBe(200);
    });

    it('returns 410 INVITATION_ALREADY_USED on a second accept', async () => {
      const email = `consume-${uuidv7().slice(-8)}@example.test`;
      const created = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      const token = extractToken(created.json().acceptUrl);

      const first = await app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        payload: { password: 'longenough', displayName: 'Once' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        payload: { password: 'longenough', displayName: 'Twice' },
      });
      expect(second.statusCode).toBe(410);
      expect(second.json().code).toBe('INVITATION_ALREADY_USED');
    });

    it('returns 410 INVITATION_REVOKED on a revoked invitation', async () => {
      const email = `revoked-accept-${uuidv7().slice(-8)}@example.test`;
      const created = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { email, role: 'auditor' },
      });
      const token = extractToken(created.json().acceptUrl);
      const id = created.json().id;

      await app.inject({
        method: 'DELETE',
        url: `/invitations/${id}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/invitations/${token}/accept`,
        payload: { password: 'longenough', displayName: 'X' },
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('INVITATION_REVOKED');
    });

    it('returns 410 INVITATION_EXPIRED for a row past expires_at', async () => {
      const sql = postgres(pg.url, { max: 1, prepare: false });
      const invId = uuidv7();
      const tokenClear = `expired-${uuidv7()}`;
      const { createHash } = await import('node:crypto');
      const hashHex = createHash('sha256').update(tokenClear).digest('hex');
      const email = `expired-${uuidv7().slice(-8)}@example.test`;
      try {
        await sql`SET ROLE app_admin`;
        await sql.unsafe(
          `insert into invitations (id, tenant_id, email, role, token_hash, expires_at)
           values ('${invId}', '${cabinetAdmin.tenantId}', '${email}', 'auditor',
                   decode('${hashHex}', 'hex'), now() - interval '1 day')`,
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      const res = await app.inject({
        method: 'POST',
        url: `/invitations/${tokenClear}/accept`,
        payload: { password: 'longenough', displayName: 'X' },
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('INVITATION_EXPIRED');
    });
  });
});
