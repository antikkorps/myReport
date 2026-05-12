import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppUserConnection,
  connectAsAppAdmin,
  connectAsAppUser,
  startPostgres,
  stopPostgres,
  type TestPostgres,
} from './setup/postgres.ts';

// Tests for the 0005 migration: questionnaire_templates and
// questionnaire_template_versions. Covers RLS, partial slug
// uniqueness, version monotonicity, the immutability trigger, and FK
// cascade behaviour. Edge cases were listed before implementation per
// the project rule (each becomes a test below).

interface Fixtures {
  tenantA: string;
  tenantB: string;
  userA: string;
  userB: string;
}

async function seedTenants(pg: TestPostgres): Promise<Fixtures> {
  const admin = await connectAsAppAdmin(pg.url);
  const f: Fixtures = {
    tenantA: uuidv7(),
    tenantB: uuidv7(),
    userA: uuidv7(),
    userB: uuidv7(),
  };
  try {
    await admin.sql`
      insert into tenants (id, name, slug)
      values (${f.tenantA}, 'Tenant A', 'qt-tenant-a'),
             (${f.tenantB}, 'Tenant B', 'qt-tenant-b')
    `;
    await admin.sql`
      insert into users (id, email, display_name)
      values (${f.userA}, 'qta@example.test', 'Alice'),
             (${f.userB}, 'qtb@example.test', 'Bob')
    `;
  } finally {
    await admin.close();
  }
  return f;
}

// postgres.js auto-stringifies string parameters when the destination
// column is jsonb, which would double-encode if we pre-stringify. The
// schema content does not matter for most assertions below — we use a
// minimal jsonb literal inlined in SQL. The single test that verifies
// a schema mutation uses Drizzle (`pg.db`) so the type system handles
// serialisation correctly.

describe('questionnaire_templates + versions — DB layer', () => {
  let pg: TestPostgres;
  let f: Fixtures;
  let userA: AppUserConnection;
  let userB: AppUserConnection;
  let admin: AppUserConnection;

  beforeAll(async () => {
    pg = await startPostgres();
    f = await seedTenants(pg);
    userA = await connectAsAppUser(pg.url, { userId: f.userA, tenantId: f.tenantA });
    userB = await connectAsAppUser(pg.url, { userId: f.userB, tenantId: f.tenantB });
    admin = await connectAsAppAdmin(pg.url);
  }, 60_000);

  afterAll(async () => {
    await userA?.close();
    await userB?.close();
    await admin?.close();
    if (pg) await stopPostgres(pg);
  });

  describe('RLS — tenant isolation', () => {
    it("hides another tenant's templates from a cabinet_admin", async () => {
      const tplB = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tplB}, ${f.tenantB}, 'B template', 'rls-cross-1')
      `;
      const rows = await userA.sql`select id from questionnaire_templates where id = ${tplB}`;
      expect(rows).toHaveLength(0);
      await admin.sql`delete from questionnaire_templates where id = ${tplB}`;
    });

    it("hides another tenant's versions from a cabinet_admin", async () => {
      const tplB = uuidv7();
      const verB = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tplB}, ${f.tenantB}, 'B template', 'rls-cross-2')
      `;
      await admin.sql`
        insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
        values (${verB}, ${tplB}, ${f.tenantB}, 1, '{}'::jsonb)
      `;
      const rows =
        await userA.sql`select id from questionnaire_template_versions where id = ${verB}`;
      expect(rows).toHaveLength(0);
      await admin.sql`delete from questionnaire_templates where id = ${tplB}`;
    });

    it('returns 0 rows when app_user has no tenant GUC', async () => {
      const tplA = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tplA}, ${f.tenantA}, 'leak check', 'rls-no-guc')
      `;
      const anon = await connectAsAppUser(pg.url);
      try {
        const t = await anon.sql`select id from questionnaire_templates`;
        const v = await anon.sql`select id from questionnaire_template_versions`;
        expect(t).toHaveLength(0);
        expect(v).toHaveLength(0);
      } finally {
        await anon.close();
      }
      await admin.sql`delete from questionnaire_templates where id = ${tplA}`;
    });

    it('lets app_admin see rows from any tenant (bypass)', async () => {
      const tplA = uuidv7();
      const tplB = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug) values
          (${tplA}, ${f.tenantA}, 'bypass A', 'rls-bypass-a'),
          (${tplB}, ${f.tenantB}, 'bypass B', 'rls-bypass-b')
      `;
      const rows = await admin.sql`
        select tenant_id from questionnaire_templates
        where id in (${tplA}, ${tplB}) order by slug
      `;
      expect(rows.map((r) => r['tenant_id'])).toEqual([f.tenantA, f.tenantB]);
      await admin.sql`delete from questionnaire_templates where id in (${tplA}, ${tplB})`;
    });

    it('rejects INSERT when row tenant_id mismatches the GUC (WITH CHECK)', async () => {
      await expect(
        userA.sql`
          insert into questionnaire_templates (id, tenant_id, name, slug)
          values (${uuidv7()}, ${f.tenantB}, 'cross', 'rls-with-check')
        `,
      ).rejects.toThrowError();
    });
  });

  describe('slug — partial unique on active rows', () => {
    it('rejects two active templates with the same slug in the same tenant', async () => {
      const t1 = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${t1}, ${f.tenantA}, 'first', 'slug-dup')
      `;
      await expect(
        admin.sql`
          insert into questionnaire_templates (id, tenant_id, name, slug)
          values (${uuidv7()}, ${f.tenantA}, 'second', 'slug-dup')
        `,
      ).rejects.toThrowError();
      await admin.sql`delete from questionnaire_templates where id = ${t1}`;
    });

    it('accepts the same slug across two tenants', async () => {
      const t1 = uuidv7();
      const t2 = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug) values
          (${t1}, ${f.tenantA}, 'A', 'slug-cross'),
          (${t2}, ${f.tenantB}, 'B', 'slug-cross')
      `;
      const rows = await admin.sql`
        select tenant_id from questionnaire_templates
        where slug = 'slug-cross' order by tenant_id
      `;
      expect(rows).toHaveLength(2);
      await admin.sql`delete from questionnaire_templates where id in (${t1}, ${t2})`;
    });

    it('lets a soft-deleted slug be re-used in the same tenant', async () => {
      const t1 = uuidv7();
      const t2 = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${t1}, ${f.tenantA}, 'retired', 'slug-reuse')
      `;
      await admin.sql`update questionnaire_templates set deleted_at = now() where id = ${t1}`;
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${t2}, ${f.tenantA}, 'reborn', 'slug-reuse')
      `;
      await admin.sql`delete from questionnaire_templates where id in (${t1}, ${t2})`;
    });
  });

  describe('version — uniqueness per template', () => {
    it('rejects duplicate (template_id, version)', async () => {
      const tpl = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${f.tenantA}, 'ver-dup', 'ver-dup')
      `;
      await admin.sql`
        insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
        values (${uuidv7()}, ${tpl}, ${f.tenantA}, 1, '{}'::jsonb)
      `;
      await expect(
        admin.sql`
          insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
          values (${uuidv7()}, ${tpl}, ${f.tenantA}, 1, '{}'::jsonb)
        `,
      ).rejects.toThrowError();
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('lets two templates share the same version number', async () => {
      const t1 = uuidv7();
      const t2 = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug) values
          (${t1}, ${f.tenantA}, 't1', 'ver-share-1'),
          (${t2}, ${f.tenantA}, 't2', 'ver-share-2')
      `;
      await admin.sql`
        insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema) values
          (${uuidv7()}, ${t1}, ${f.tenantA}, 1, '{}'::jsonb),
          (${uuidv7()}, ${t2}, ${f.tenantA}, 1, '{}'::jsonb)
      `;
      await admin.sql`delete from questionnaire_templates where id in (${t1}, ${t2})`;
    });

    it('rejects version < 1', async () => {
      const tpl = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${f.tenantA}, 't', 'ver-zero')
      `;
      await expect(
        admin.sql`
          insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
          values (${uuidv7()}, ${tpl}, ${f.tenantA}, 0, '{}'::jsonb)
        `,
      ).rejects.toThrowError();
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });
  });

  describe('published_at invariant', () => {
    it('rejects a draft with a non-null published_at', async () => {
      const tpl = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${f.tenantA}, 't', 'pa-draft')
      `;
      await expect(
        admin.sql`
          insert into questionnaire_template_versions
            (id, template_id, tenant_id, version, schema, status, published_at)
          values (${uuidv7()}, ${tpl}, ${f.tenantA}, 1, '{}'::jsonb, 'draft', now())
        `,
      ).rejects.toThrowError();
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('rejects a published row with null published_at', async () => {
      const tpl = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${f.tenantA}, 't', 'pa-published')
      `;
      await expect(
        admin.sql`
          insert into questionnaire_template_versions
            (id, template_id, tenant_id, version, schema, status, published_at)
          values (${uuidv7()}, ${tpl}, ${f.tenantA}, 1, '{}'::jsonb, 'published', null)
        `,
      ).rejects.toThrowError();
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });
  });

  // The trigger only fires for `app_user` (cabinet_admin via the API).
  // `app_admin` bypasses by design — it is reserved for super-admin
  // tooling and tenant purges, where cascading through published rows
  // is the intended behaviour. Setup/cleanup use admin; the actions
  // being asserted (UPDATE/DELETE) run as userA so the trigger fires.
  describe('immutability trigger (enforced on app_user)', () => {
    async function insertDraft(): Promise<{ tpl: string; ver: string }> {
      const tpl = uuidv7();
      const ver = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${f.tenantA}, 't', ${`im-${ver}`})
      `;
      await admin.sql`
        insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
        values (${ver}, ${tpl}, ${f.tenantA}, 1, '{}'::jsonb)
      `;
      return { tpl, ver };
    }

    async function publish(ver: string): Promise<void> {
      await admin.sql`
        update questionnaire_template_versions
        set status = 'published', published_at = now(), published_by_user_id = ${f.userA}
        where id = ${ver}
      `;
    }

    it('allows UPDATE on a draft (schema mutation OK)', async () => {
      const { tpl, ver } = await insertDraft();
      // postgres.js auto-stringifies parameters destined for jsonb,
      // producing a jsonb scalar string instead of an object. The
      // simplest robust path is to embed the JSON as a SQL literal —
      // safe here because the value is hand-written test data, and
      // postgres' jsonb parser still validates the input.
      const jsonLiteral = JSON.stringify({ version: 1, title: 'Edited', sections: [] }).replace(
        /'/g,
        "''",
      );
      await userA.sql.unsafe(
        `update questionnaire_template_versions set schema = '${jsonLiteral}'::jsonb where id = '${ver}'`,
      );
      const [row] = await admin.sql`
        select schema from questionnaire_template_versions where id = ${ver}
      `;
      expect(row?.['schema']).toMatchObject({ title: 'Edited' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('allows draft -> published transition (as app_user)', async () => {
      const { tpl, ver } = await insertDraft();
      await userA.sql`
        update questionnaire_template_versions
        set status = 'published', published_at = now(), published_by_user_id = ${f.userA}
        where id = ${ver}
      `;
      const [row] = await admin.sql`
        select status from questionnaire_template_versions where id = ${ver}
      `;
      expect(row?.['status']).toBe('published');
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('rejects mutation of schema on a published version', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await expect(
        userA.sql`
          update questionnaire_template_versions
          set schema = ${JSON.stringify({ version: 1, title: 'after publish', sections: [] })}::jsonb
          where id = ${ver}
        `,
      ).rejects.toMatchObject({ code: '23514' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('rejects mutation of version number on a published version', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await expect(
        userA.sql`update questionnaire_template_versions set version = 99 where id = ${ver}`,
      ).rejects.toMatchObject({ code: '23514' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('allows published -> archived transition', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await userA.sql`
        update questionnaire_template_versions set status = 'archived' where id = ${ver}
      `;
      const [row] = await admin.sql`
        select status from questionnaire_template_versions where id = ${ver}
      `;
      expect(row?.['status']).toBe('archived');
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('rejects published -> draft (downgrade)', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await expect(
        userA.sql`update questionnaire_template_versions set status = 'draft' where id = ${ver}`,
      ).rejects.toMatchObject({ code: '23514' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('freezes archived rows fully', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await userA.sql`
        update questionnaire_template_versions set status = 'archived' where id = ${ver}
      `;
      await expect(
        userA.sql`update questionnaire_template_versions set status = 'published' where id = ${ver}`,
      ).rejects.toMatchObject({ code: '23514' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('allows DELETE of a draft (as app_user)', async () => {
      const { tpl, ver } = await insertDraft();
      await userA.sql`delete from questionnaire_template_versions where id = ${ver}`;
      const rows = await admin.sql`
        select id from questionnaire_template_versions where id = ${ver}
      `;
      expect(rows).toHaveLength(0);
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('rejects DELETE of a published version (as app_user)', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await expect(
        userA.sql`delete from questionnaire_template_versions where id = ${ver}`,
      ).rejects.toMatchObject({ code: '23514' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('rejects DELETE of an archived version (as app_user)', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await userA.sql`
        update questionnaire_template_versions set status = 'archived' where id = ${ver}
      `;
      await expect(
        userA.sql`delete from questionnaire_template_versions where id = ${ver}`,
      ).rejects.toMatchObject({ code: '23514' });
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });

    it('lets app_admin DELETE a published version (bypass — tenant purge path)', async () => {
      const { tpl, ver } = await insertDraft();
      await publish(ver);
      await admin.sql`delete from questionnaire_template_versions where id = ${ver}`;
      const rows = await admin.sql`
        select id from questionnaire_template_versions where id = ${ver}
      `;
      expect(rows).toHaveLength(0);
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
    });
  });

  describe('cascade', () => {
    it('hard-deleting a tenant cascades to templates and versions', async () => {
      const tenantC = uuidv7();
      const tpl = uuidv7();
      const ver = uuidv7();
      await admin.sql`
        insert into tenants (id, name, slug) values (${tenantC}, 'C', 'qt-tenant-c')
      `;
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${tenantC}, 't', 'cascade-1')
      `;
      await admin.sql`
        insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
        values (${ver}, ${tpl}, ${tenantC}, 1, '{}'::jsonb)
      `;
      await admin.sql`delete from tenants where id = ${tenantC}`;
      const tpls = await admin.sql`
        select id from questionnaire_templates where id = ${tpl}
      `;
      const vers = await admin.sql`
        select id from questionnaire_template_versions where id = ${ver}
      `;
      expect(tpls).toHaveLength(0);
      expect(vers).toHaveLength(0);
    });

    it('hard-deleting a draft-only template cascades to its versions', async () => {
      const tpl = uuidv7();
      const ver = uuidv7();
      await admin.sql`
        insert into questionnaire_templates (id, tenant_id, name, slug)
        values (${tpl}, ${f.tenantA}, 't', 'cascade-2')
      `;
      await admin.sql`
        insert into questionnaire_template_versions (id, template_id, tenant_id, version, schema)
        values (${ver}, ${tpl}, ${f.tenantA}, 1, '{}'::jsonb)
      `;
      await admin.sql`delete from questionnaire_templates where id = ${tpl}`;
      const vers = await admin.sql`
        select id from questionnaire_template_versions where id = ${ver}
      `;
      expect(vers).toHaveLength(0);
    });
  });
});
