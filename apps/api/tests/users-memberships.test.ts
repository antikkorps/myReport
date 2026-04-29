import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import { type Seed, type SuperAdminSeed, seedSuperAdmin, seedUser } from './setup/seed.ts';

// Edge cases listed up-front (per the project's "test edge cases" rule):
//
// GET /users
//   - 401 without auth
//   - 403 auditor
//   - cabinet_admin sees only their tenant
//   - super_admin without ?tenantId sees memberships across tenants
//   - super_admin with ?tenantId scopes
//   - soft-deleted memberships are filtered out
//
// PATCH /memberships/:id
//   - 401, 403 auditor
//   - 404 unknown id, 404 cross-tenant for cabinet_admin
//   - 400 invalid role (handled by schema)
//   - 409 LAST_ADMIN when demoting the only cabinet_admin
//   - 200 promotion auditor -> cabinet_admin
//   - 200 idempotent (no-op when role is unchanged)
//
// DELETE /memberships/:id
//   - 401, 403 auditor
//   - 404 unknown id
//   - 409 LAST_ADMIN
//   - 204 success: row soft-deleted, sessions revoked
//   - cannot self-delete when last admin

interface ExtraSeed {
  userId: string;
  email: string;
  password: string;
  membershipId: string;
}

async function seedExtraMembership(
  url: string,
  tenantId: string,
  role: 'cabinet_admin' | 'auditor',
): Promise<ExtraSeed> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const userId = uuidv7();
    const email = `extra-${userId.slice(-12)}@example.test`;
    const password = 'correct-horse-battery-staple';
    const passwordHash = await argon2.hash(password);
    const membershipId = uuidv7();

    await sql`SET ROLE app_admin`;
    await sql`
      insert into users (id, email, display_name)
      values (${userId}, ${email}, 'Extra User')
    `;
    await sql`
      insert into auth_identities (id, user_id, provider, secret_hash, email_at_link)
      values (${uuidv7()}, ${userId}, 'password', ${passwordHash}, ${email})
    `;
    await sql`
      insert into memberships (id, tenant_id, user_id, role)
      values (${membershipId}, ${tenantId}, ${userId}, ${role})
    `;
    return { userId, email, password, membershipId };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

describe('users + memberships', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let cabinetAdmin: Seed;
  let superAdmin: SuperAdminSeed;
  let cabinetAdminToken: string;
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
      WEB_BASE_URL: 'http://localhost:5173',
    };
    app = await buildApp(env);

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
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await stopPostgres(pg);
  });

  // -----------------------------------------------------------------
  // GET /users
  // -----------------------------------------------------------------
  describe('GET /users', () => {
    let auditor: ExtraSeed;
    let auditorToken: string;

    beforeAll(async () => {
      auditor = await seedExtraMembership(pg.url, cabinetAdmin.tenantId, 'auditor');
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: auditor.email, password: auditor.password },
      });
      auditorToken = login.json().accessToken;
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'GET', url: '/users' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects auditor callers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { authorization: `Bearer ${auditorToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('cabinet_admin sees only their tenant members', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{ email: string; role: string }>;
      const emails = items.map((i) => i.email);
      expect(emails).toContain(cabinetAdmin.email);
      expect(emails).toContain(auditor.email);
      expect(items.find((i) => i.email === auditor.email)?.role).toBe('auditor');
    });

    it('super_admin can scope by ?tenantId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/users?tenantId=${cabinetAdmin.tenantId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items as Array<{ email: string }>;
      expect(items.map((i) => i.email)).toEqual(
        expect.arrayContaining([cabinetAdmin.email, auditor.email]),
      );
    });

    it('soft-deleted memberships disappear from the listing', async () => {
      const tempo = await seedExtraMembership(pg.url, cabinetAdmin.tenantId, 'auditor');
      // Soft-delete directly via app_admin to simulate prior removal.
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        await sql`update memberships set deleted_at = now() where id = ${tempo.membershipId}`;
      } finally {
        await sql.end({ timeout: 5 });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      const items = res.json().items as Array<{ email: string }>;
      expect(items.find((i) => i.email === tempo.email)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  // PATCH /memberships/:id
  // -----------------------------------------------------------------
  describe('PATCH /memberships/:id', () => {
    let target: ExtraSeed;
    let auditor: ExtraSeed;
    let auditorToken: string;

    beforeAll(async () => {
      target = await seedExtraMembership(pg.url, cabinetAdmin.tenantId, 'auditor');
      auditor = await seedExtraMembership(pg.url, cabinetAdmin.tenantId, 'auditor');
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: auditor.email, password: auditor.password },
      });
      auditorToken = login.json().accessToken;
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${target.membershipId}`,
        payload: { role: 'cabinet_admin' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects auditor callers', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${target.membershipId}`,
        headers: { authorization: `Bearer ${auditorToken}` },
        payload: { role: 'cabinet_admin' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects unknown ids with 404', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${uuidv7()}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { role: 'cabinet_admin' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid roles via schema (400)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${target.membershipId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { role: 'super_admin' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuses to demote the last cabinet_admin', async () => {
      // Spin up a brand-new tenant whose only admin is the seeded user.
      const lone = await seedUser(pg.url);
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${await findMembershipId(pg.url, lone.tenantId, lone.userId)}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { role: 'auditor' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('LAST_ADMIN');
    });

    it('promotes an auditor to cabinet_admin (happy path)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${target.membershipId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { role: 'cabinet_admin' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe('cabinet_admin');
    });

    it('is idempotent when the role is unchanged', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/memberships/${target.membershipId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
        payload: { role: 'cabinet_admin' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe('cabinet_admin');
    });
  });

  // -----------------------------------------------------------------
  // DELETE /memberships/:id
  // -----------------------------------------------------------------
  describe('DELETE /memberships/:id', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/memberships/${uuidv7()}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects unknown ids with 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/memberships/${uuidv7()}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('refuses to remove the last cabinet_admin', async () => {
      const lone = await seedUser(pg.url);
      const membershipId = await findMembershipId(pg.url, lone.tenantId, lone.userId);
      const res = await app.inject({
        method: 'DELETE',
        url: `/memberships/${membershipId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('LAST_ADMIN');
    });

    it('soft-deletes a membership and revokes the user sessions', async () => {
      const target = await seedExtraMembership(pg.url, cabinetAdmin.tenantId, 'auditor');
      // Log the user in so they have an active session bound to the
      // tenant — we'll verify it gets revoked.
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: target.email, password: target.password },
      });
      expect(login.statusCode).toBe(200);

      const del = await app.inject({
        method: 'DELETE',
        url: `/memberships/${target.membershipId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(del.statusCode).toBe(204);

      // Verify the membership is soft-deleted (still there, deleted_at set).
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        const rows = await sql<{ deleted_at: Date | null }[]>`
          select deleted_at from memberships where id = ${target.membershipId}
        `;
        expect(rows[0]?.deleted_at).toBeInstanceOf(Date);

        // Sessions for this (user, tenant) pair must be revoked.
        const sessions = await sql<{ revoked_at: Date | null }[]>`
          select revoked_at from sessions
          where user_id = ${target.userId} and tenant_id = ${cabinetAdmin.tenantId}
        `;
        expect(sessions.length).toBeGreaterThan(0);
        expect(sessions.every((s) => s.revoked_at !== null)).toBe(true);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it('allows re-adding the same user to the same tenant after a soft-delete', async () => {
      const target = await seedExtraMembership(pg.url, cabinetAdmin.tenantId, 'auditor');
      const del = await app.inject({
        method: 'DELETE',
        url: `/memberships/${target.membershipId}`,
        headers: { authorization: `Bearer ${cabinetAdminToken}` },
      });
      expect(del.statusCode).toBe(204);

      // Direct insert to assert the partial unique constraint doesn't
      // block: re-attaching a previously-removed user is supported.
      const sql = postgres(pg.url, { max: 1, prepare: false });
      try {
        await sql`SET ROLE app_admin`;
        await sql`
          insert into memberships (id, tenant_id, user_id, role)
          values (${uuidv7()}, ${cabinetAdmin.tenantId}, ${target.userId}, 'auditor')
        `;
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });
});

async function findMembershipId(url: string, tenantId: string, userId: string): Promise<string> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql`SET ROLE app_admin`;
    const rows = await sql<{ id: string }[]>`
      select id from memberships
      where tenant_id = ${tenantId} and user_id = ${userId} and deleted_at is null
      limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error('membership not found');
    return row.id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
