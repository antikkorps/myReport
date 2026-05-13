import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.ts';
import { buildApp } from '../src/server.ts';
import { startPostgres, stopPostgres, type TestPostgres } from './setup/postgres.ts';
import { type Seed, type SuperAdminSeed, seedSuperAdmin, seedUser } from './setup/seed.ts';

// Edge cases up-front. Each → one test below.
//
// POST /templates/:id/versions
//   - cabinet_admin first version: 201 with version=1, status=draft
//   - cabinet_admin second version: 201 with version=2
//   - 400 SCHEMA_INVALID on duplicate question id
//   - 404 on unknown template
//   - 404 on cross-tenant template (RLS hides it)
//   - 404 on soft-deleted template
//   - super_admin can post on any template
//   - auditor: 403, unauthenticated: 401
//
// GET /templates/:id/versions
//   - lists own template's versions
//   - status filter narrows
//   - cross-tenant: 404
//
// GET /templates/:id/versions/:vid
//   - own: 200 with schema body
//   - mismatched (vid belongs to another template): 404
//   - cross-tenant: 404
//
// PATCH /templates/:id/versions/:vid
//   - cabinet_admin edits draft schema: 200
//   - invalid schema body: 400 SCHEMA_INVALID
//   - on published: 409 VERSION_NOT_DRAFT
//   - on archived: 409 VERSION_NOT_DRAFT
//   - cross-tenant: 404
//
// POST publish
//   - draft → published: 200; first publish auto-sets template.current_version_id
//   - second publish (template already has current_version_id): current stays
//   - publish published: 409 VERSION_NOT_DRAFT
//   - publish archived: 409 VERSION_NOT_DRAFT
//
// POST archive
//   - published → archived: 200
//   - archive draft: 409 VERSION_NOT_PUBLISHED
//   - archive archived: 409 VERSION_NOT_PUBLISHED
//   - archiving the current_version_id leaves the pin in place
//
// DELETE
//   - delete draft: 204
//   - delete published: 409 VERSION_NOT_DRAFT
//   - delete archived: 409 VERSION_NOT_DRAFT
//   - cross-tenant: 404
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

const sampleSchema = (title = 'Sample') => ({
  version: 1,
  title,
  sections: [
    {
      kind: 'section',
      id: uuidv7(),
      label: 'Sec',
      questions: [{ kind: 'boolean', id: uuidv7(), label: 'q' }],
    },
  ],
});

describe('questionnaire template versions — API', () => {
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

  async function createTemplate(token: string, slug: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: slug, slug },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function createDraft(token: string, templateId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/templates/${templateId}/versions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { schema: sampleSchema() },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  async function fetchTemplate(token: string, id: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/templates/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json();
  }

  describe('POST /templates/:id/versions', () => {
    it('creates the first version with version=1 and status=draft', async () => {
      const tplId = await createTemplate(tokenA, 'v-create-1');
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: sampleSchema('Hello') },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.status).toBe('draft');
      expect(body.publishedAt).toBeNull();
      expect(body.schema.title).toBe('Hello');
    });

    it('increments version on the next draft of the same template', async () => {
      const tplId = await createTemplate(tokenA, 'v-create-2');
      await createDraft(tokenA, tplId);
      const second = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: sampleSchema() },
      });
      expect(second.statusCode).toBe(201);
      expect(second.json().version).toBe(2);
    });

    it('rejects invalid DSL with 400 SCHEMA_INVALID and an issues array', async () => {
      const tplId = await createTemplate(tokenA, 'v-bad-dsl');
      const sharedId = uuidv7();
      const badSchema = {
        version: 1,
        title: 'X',
        sections: [
          {
            kind: 'section',
            id: uuidv7(),
            label: 'S',
            questions: [
              { kind: 'boolean', id: sharedId, label: 'q1' },
              { kind: 'text', id: sharedId, label: 'q2' },
            ],
          },
        ],
      };
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: badSchema },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('SCHEMA_INVALID');
      expect(body.issues.some((i: { code: string }) => i.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('returns 404 when the template id is unknown', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${uuidv7()}/versions`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when the template belongs to another tenant', async () => {
      const tplId = await createTemplate(tokenA, 'v-cross');
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(404);
    });

    it('super_admin can post on any tenant template', async () => {
      const tplId = await createTemplate(tokenA, 'v-super');
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenSuper}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(201);
    });

    it('auditor — 403', async () => {
      const tplId = await createTemplate(tokenA, 'v-auditor');
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenAuditor}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(403);
    });

    it('unauthenticated — 401', async () => {
      const tplId = await createTemplate(tokenA, 'v-anon');
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions`,
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /templates/:id/versions', () => {
    it('lists own template versions in version order', async () => {
      const tplId = await createTemplate(tokenA, 'v-list-1');
      const v1 = await createDraft(tokenA, tplId);
      const v2 = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const ids = res.json().items.map((v: { id: string }) => v.id);
      expect(ids).toEqual([v1, v2]);
    });

    it('filters by status', async () => {
      const tplId = await createTemplate(tokenA, 'v-list-status');
      const v1 = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${v1}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await createDraft(tokenA, tplId); // a second draft
      const drafts = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions?status=draft`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(drafts.json().items.every((v: { status: string }) => v.status === 'draft')).toBe(true);
      const published = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions?status=published`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(published.json().items).toHaveLength(1);
      expect(published.json().items[0].id).toBe(v1);
    });

    it('cross-tenant — 404', async () => {
      const tplId = await createTemplate(tokenA, 'v-list-cross');
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /templates/:id/versions/:vid', () => {
    it('returns the version with the schema body', async () => {
      const tplId = await createTemplate(tokenA, 'v-read-ok');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(vid);
      expect(res.json().schema.sections).toBeDefined();
    });

    it('returns 404 when vid does not belong to the template in the URL', async () => {
      const tplA = await createTemplate(tokenA, 'v-read-mismatch-a');
      const tplB = await createTemplate(tokenA, 'v-read-mismatch-b');
      const vidOfA = await createDraft(tokenA, tplA);
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${tplB}/versions/${vidOfA}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('cross-tenant — 404', async () => {
      const tplId = await createTemplate(tokenA, 'v-read-cross');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /templates/:id/versions/:vid', () => {
    it('edits a draft schema and returns the new payload', async () => {
      const tplId = await createTemplate(tokenA, 'v-patch-ok');
      const vid = await createDraft(tokenA, tplId);
      const newSchema = sampleSchema('Edited');
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: newSchema },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().schema.title).toBe('Edited');
    });

    it('rejects invalid DSL with 400 SCHEMA_INVALID', async () => {
      const tplId = await createTemplate(tokenA, 'v-patch-bad');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: { version: 2, title: 'X', sections: [] } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SCHEMA_INVALID');
    });

    it('returns 409 VERSION_NOT_DRAFT when version is published', async () => {
      const tplId = await createTemplate(tokenA, 'v-patch-published');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_NOT_DRAFT');
    });

    it('returns 409 VERSION_NOT_DRAFT when version is archived', async () => {
      const tplId = await createTemplate(tokenA, 'v-patch-archived');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(409);
    });

    it('cross-tenant — 404', async () => {
      const tplId = await createTemplate(tokenA, 'v-patch-cross');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'PATCH',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { schema: sampleSchema() },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /publish', () => {
    it('publishes a draft and auto-sets template.current_version_id on first publish', async () => {
      const tplId = await createTemplate(tokenA, 'v-publish-first');
      const beforeTpl = await fetchTemplate(tokenA, tplId);
      expect(beforeTpl.currentVersionId).toBeNull();
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('published');
      expect(res.json().publishedAt).not.toBeNull();
      expect(res.json().publishedByUserId).toBe(cabinetA.userId);
      const afterTpl = await fetchTemplate(tokenA, tplId);
      expect(afterTpl.currentVersionId).toBe(vid);
    });

    it('a second publish does not overwrite the existing current_version_id', async () => {
      const tplId = await createTemplate(tokenA, 'v-publish-keep-current');
      const v1 = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${v1}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const v2 = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${v2}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const tpl = await fetchTemplate(tokenA, tplId);
      expect(tpl.currentVersionId).toBe(v1);
    });

    it('publishing an already-published version returns 409 VERSION_NOT_DRAFT', async () => {
      const tplId = await createTemplate(tokenA, 'v-publish-twice');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_NOT_DRAFT');
    });

    it('publishing an archived version returns 409 VERSION_NOT_DRAFT', async () => {
      const tplId = await createTemplate(tokenA, 'v-publish-archived');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /archive', () => {
    it('archives a published version', async () => {
      const tplId = await createTemplate(tokenA, 'v-archive-ok');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('archived');
    });

    it('archiving a draft returns 409 VERSION_NOT_PUBLISHED', async () => {
      const tplId = await createTemplate(tokenA, 'v-archive-draft');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_NOT_PUBLISHED');
    });

    it('archiving an already-archived version returns 409', async () => {
      const tplId = await createTemplate(tokenA, 'v-archive-twice');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
    });

    it('archiving the current_version_id leaves the pin in place (front shows warning)', async () => {
      const tplId = await createTemplate(tokenA, 'v-archive-current');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const tpl = await fetchTemplate(tokenA, tplId);
      expect(tpl.currentVersionId).toBe(vid);
    });
  });

  describe('POST /promote', () => {
    it('promotes a published version to current and pins it on the template', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-ok');
      const v1 = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${v1}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const v2 = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${v2}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });

      // After v2 is published the template still pins v1 (auto-set on
      // first publish only). Promoting v2 moves the pin.
      const before = await fetchTemplate(tokenA, tplId);
      expect(before.currentVersionId).toBe(v1);
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${v2}/promote`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(v2);
      expect(res.json().status).toBe('published');
      const after = await fetchTemplate(tokenA, tplId);
      expect(after.currentVersionId).toBe(v2);
    });

    it('promoting the already-current version is idempotent — 200', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-idem');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/promote`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const tpl = await fetchTemplate(tokenA, tplId);
      expect(tpl.currentVersionId).toBe(vid);
    });

    it('promoting a draft returns 409 VERSION_NOT_PUBLISHED', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-draft');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/promote`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_NOT_PUBLISHED');
    });

    it('promoting an archived version returns 409 VERSION_NOT_PUBLISHED', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-archived');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/promote`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_NOT_PUBLISHED');
    });

    it('returns 404 when the version id is unknown', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-404');
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${uuidv7()}/promote`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('cross-tenant — 404 (RLS hides the version)', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-cross');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/promote`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('auditor — 403', async () => {
      const tplId = await createTemplate(tokenA, 'v-promote-auditor');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/promote`,
        headers: { authorization: `Bearer ${tokenAuditor}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /templates/:id/versions/:vid', () => {
    it('deletes a draft — 204', async () => {
      const tplId = await createTemplate(tokenA, 'v-delete-draft');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(204);
      const fetched = await app.inject({
        method: 'GET',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(fetched.statusCode).toBe(404);
    });

    it('deleting a published version returns 409 VERSION_NOT_DRAFT', async () => {
      const tplId = await createTemplate(tokenA, 'v-delete-published');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('VERSION_NOT_DRAFT');
    });

    it('deleting an archived version returns 409', async () => {
      const tplId = await createTemplate(tokenA, 'v-delete-archived');
      const vid = await createDraft(tokenA, tplId);
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/publish`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      await app.inject({
        method: 'POST',
        url: `/templates/${tplId}/versions/${vid}/archive`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(409);
    });

    it('cross-tenant — 404', async () => {
      const tplId = await createTemplate(tokenA, 'v-delete-cross');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('auditor — 403', async () => {
      const tplId = await createTemplate(tokenA, 'v-delete-auditor');
      const vid = await createDraft(tokenA, tplId);
      const res = await app.inject({
        method: 'DELETE',
        url: `/templates/${tplId}/versions/${vid}`,
        headers: { authorization: `Bearer ${tokenAuditor}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
