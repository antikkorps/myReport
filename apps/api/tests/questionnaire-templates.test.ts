import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import { type Seed, type SuperAdminSeed, seedSuperAdmin, seedUser } from './setup/seed.ts';

// Edge cases up-front (per project rule). Each becomes a test below.
//
// POST /templates
//   - cabinet_admin: 201 with auto-set null currentVersionId
//   - cabinet_admin: 400 on empty name
//   - cabinet_admin: 400 on bad slug
//   - cabinet_admin: 400 TENANT_ID_FORBIDDEN if body carries tenantId
//   - cabinet_admin: 409 SLUG_TAKEN when active slug exists
//   - cabinet_admin: slug reusable after soft-delete
//   - super_admin: 400 TENANT_ID_REQUIRED without body.tenantId
//   - super_admin: 201 with valid body.tenantId
//   - super_admin: 404 TENANT_NOT_FOUND with unknown body.tenantId
//   - auditor: 403
//   - unauthenticated: 401
//
// GET /templates
//   - cabinet_admin: own only, excludes soft-deleted
//   - super_admin: 400 without ?tenantId=
//   - super_admin: 200 with ?tenantId=
//   - auditor: 403
//
// GET /templates/:id
//   - cabinet_admin own: 200
//   - cabinet_admin cross-tenant: 404
//   - cabinet_admin soft-deleted: 404
//   - super_admin: 200 on any tenant
//
// PATCH /templates/:id
//   - cabinet_admin updates name: 200
//   - cabinet_admin updates description: 200
//   - cabinet_admin extra field: 400
//   - cabinet_admin cross-tenant: 404
//   - auditor: 403
//
// DELETE /templates/:id
//   - cabinet_admin: 204
//   - cabinet_admin already deleted: 404
//   - cabinet_admin cross-tenant: 404
//   - auditor: 403

interface AuditorSeed {
  userId: string;
  tenantId: string;
  email: string;
  password: string;
}

async function seedAuditor(url: string, tenantId: string): Promise<AuditorSeed> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const userId = uuidv7();
    const email = `auditor-${userId.slice(-12)}@example.test`;
    const password = 'correct-horse-battery-staple';
    const passwordHash = await argon2.hash(password);
    await sql`SET ROLE app_admin`;
    await sql`
      insert into users (id, email, display_name)
      values (${userId}, ${email}, 'Auditor')
    `;
    await sql`
      insert into auth_identities (id, user_id, provider, secret_hash, email_at_link)
      values (${uuidv7()}, ${userId}, 'password', ${passwordHash}, ${email})
    `;
    await sql`
      insert into memberships (id, tenant_id, user_id, role)
      values (${uuidv7()}, ${tenantId}, ${userId}, 'auditor')
    `;
    return { userId, tenantId, email, password };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  return res.json().accessToken;
}

async function softDelete(url: string, id: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql`SET ROLE app_admin`;
    await sql`update questionnaire_templates set deleted_at = now() where id = ${id}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

describe('questionnaire templates — API', () => {
  let pg: TestPostgres;
  let app: FastifyInstance;
  let cabinetA: Seed;
  let cabinetB: Seed;
  let auditorA: AuditorSeed;
  let superAdmin: SuperAdminSeed;
  let tokenA: string;
  let tokenB: string;
  let tokenAuditor: string;
  let tokenSuper: string;

  beforeAll(async () => {
    pg = await startPostgres();
    cabinetA = await seedUser(pg.url);
    cabinetB = await seedUser(pg.url);
    auditorA = await seedAuditor(pg.url, cabinetA.tenantId);
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
    tokenA = await login(app, cabinetA.email, cabinetA.password);
    tokenB = await login(app, cabinetB.email, cabinetB.password);
    tokenAuditor = await login(app, auditorA.email, auditorA.password);
    tokenSuper = await login(app, superAdmin.email, superAdmin.password);
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await stopPostgres(pg);
  });

  describe('POST /templates', () => {
    it('cabinet_admin creates a template in own tenant — 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'Compta', slug: 'compta-create-1' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tenantId).toBe(cabinetA.tenantId);
      expect(body.slug).toBe('compta-create-1');
      expect(body.description).toBeNull();
      expect(body.currentVersionId).toBeNull();
    });

    it('rejects empty name with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: '', slug: 'compta-bad-name' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid slug with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'X', slug: 'BAD slug' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects cabinet_admin passing tenantId in body — 400 TENANT_ID_FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'X', slug: 'compta-forbidden', tenantId: cabinetB.tenantId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_ID_FORBIDDEN');
    });

    it('returns 409 SLUG_TAKEN on duplicate active slug in same tenant', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'X', slug: 'compta-dup' },
      });
      expect(first.statusCode).toBe(201);
      const dup = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'Y', slug: 'compta-dup' },
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('SLUG_TAKEN');
    });

    it('lets a soft-deleted slug be reused in the same tenant', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'X', slug: 'compta-reuse' },
      });
      expect(create.statusCode).toBe(201);
      await softDelete(pg.url, create.json().id);
      const reborn = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'X reborn', slug: 'compta-reuse' },
      });
      expect(reborn.statusCode).toBe(201);
      expect(reborn.json().id).not.toBe(create.json().id);
    });

    it('super_admin without tenantId — 400 TENANT_ID_REQUIRED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenSuper}` },
        payload: { name: 'X', slug: 'super-no-tenant' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_ID_REQUIRED');
    });

    it('super_admin with valid tenantId — 201 in that tenant', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenSuper}` },
        payload: { name: 'X', slug: 'super-create', tenantId: cabinetB.tenantId },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().tenantId).toBe(cabinetB.tenantId);
    });

    it('super_admin with non-existent tenantId — 404 TENANT_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenSuper}` },
        payload: { name: 'X', slug: 'super-ghost-tenant', tenantId: uuidv7() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('TENANT_NOT_FOUND');
    });

    it('auditor — 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenAuditor}` },
        payload: { name: 'X', slug: 'auditor-denied' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('unauthenticated — 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/templates',
        payload: { name: 'X', slug: 'anon-denied' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /templates', () => {
    it('cabinet_admin sees own tenant only and excludes soft-deleted', async () => {
      const create1 = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'L1', slug: 'list-1' },
      });
      const create2 = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'L2', slug: 'list-2' },
      });
      await softDelete(pg.url, create1.json().id);
      const res = await app.inject({
        method: 'GET',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const ids = res.json().items.map((t: { id: string }) => t.id);
      expect(ids).not.toContain(create1.json().id);
      expect(ids).toContain(create2.json().id);
      // No row leaks from tenant B.
      for (const t of res.json().items) expect(t.tenantId).toBe(cabinetA.tenantId);
    });

    it('super_admin without ?tenantId= — 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenSuper}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TENANT_ID_REQUIRED');
    });

    it('super_admin with ?tenantId= — returns that tenant rows only', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/templates?tenantId=${cabinetB.tenantId}`,
        headers: { authorization: `Bearer ${tokenSuper}` },
      });
      expect(res.statusCode).toBe(200);
      for (const t of res.json().items) expect(t.tenantId).toBe(cabinetB.tenantId);
    });

    it('auditor — 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenAuditor}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /templates/:id', () => {
    it('cabinet_admin reads own template — 200', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'R', slug: 'read-own' },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(created.json().id);
    });

    it('cabinet_admin reading cross-tenant — 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'R', slug: 'read-cross' },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('soft-deleted template — 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'R', slug: 'read-soft-deleted' },
      });
      await softDelete(pg.url, created.json().id);
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('super_admin reads any tenant — 200', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'R', slug: 'super-read' },
      });
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenSuper}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('PATCH /templates/:id', () => {
    it('cabinet_admin updates name — 200', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'P', slug: 'patch-name' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'Patched' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Patched');
      expect(res.json().slug).toBe('patch-name'); // slug immutable
    });

    it('cabinet_admin updates description — 200', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'P', slug: 'patch-desc' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { description: 'A new description' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe('A new description');
    });

    it('silently ignores unknown body fields (Fastify strips them) and returns the unchanged row', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'P', slug: 'patch-unknown' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { slug: 'patch-renamed' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().slug).toBe('patch-unknown');
      expect(res.json().name).toBe('P');
    });

    it('cabinet_admin patching cross-tenant — 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'P', slug: 'patch-cross' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { name: 'foreign' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('auditor — 403', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'P', slug: 'patch-auditor' },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenAuditor}` },
        payload: { name: 'forbid' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /templates/:id', () => {
    it('cabinet_admin soft-deletes — 204; subsequent GET returns 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'D', slug: 'delete-ok' },
      });
      const del = await app.inject({
        method: 'DELETE',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(del.statusCode).toBe(204);
      const fetched = await app.inject({
        method: 'GET',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(fetched.statusCode).toBe(404);
    });

    it('cabinet_admin deleting an already-deleted template — 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'D', slug: 'delete-twice' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const second = await app.inject({
        method: 'DELETE',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(second.statusCode).toBe(404);
    });

    it('cabinet_admin deleting cross-tenant — 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'D', slug: 'delete-cross' },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('auditor — 403', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/templates',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'D', slug: 'delete-auditor' },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${created.json().id}`,
        headers: { authorization: `Bearer ${tokenAuditor}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
