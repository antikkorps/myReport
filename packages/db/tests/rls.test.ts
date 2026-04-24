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

// These tests verify tenant isolation at the database layer. They are
// mandatory per CLAUDE.md: "chaque table avec tenant_id doit avoir un
// test qui vérifie qu'un tenant ne voit pas les données d'un autre".

interface Fixtures {
  tenantA: string;
  tenantB: string;
  userA: string; // cabinet_admin of tenant A
  userB: string; // cabinet_admin of tenant B
  missionA: string;
  missionB: string;
}

async function seedFixtures(pg: TestPostgres): Promise<Fixtures> {
  const admin = await connectAsAppAdmin(pg.url);
  const f: Fixtures = {
    tenantA: uuidv7(),
    tenantB: uuidv7(),
    userA: uuidv7(),
    userB: uuidv7(),
    missionA: uuidv7(),
    missionB: uuidv7(),
  };
  try {
    await admin.sql`
      insert into tenants (id, name, slug)
      values (${f.tenantA}, 'Tenant A', 'tenant-a'),
             (${f.tenantB}, 'Tenant B', 'tenant-b')
    `;
    await admin.sql`
      insert into users (id, email, password_hash, display_name)
      values (${f.userA}, 'a@example.test', 'x', 'Alice'),
             (${f.userB}, 'b@example.test', 'x', 'Bob')
    `;
    await admin.sql`
      insert into memberships (id, tenant_id, user_id, role)
      values (${uuidv7()}, ${f.tenantA}, ${f.userA}, 'cabinet_admin'),
             (${uuidv7()}, ${f.tenantB}, ${f.userB}, 'cabinet_admin')
    `;
    await admin.sql`
      insert into missions (id, tenant_id, title)
      values (${f.missionA}, ${f.tenantA}, 'Mission A'),
             (${f.missionB}, ${f.tenantB}, 'Mission B')
    `;
    await admin.sql`
      insert into mission_members (id, tenant_id, mission_id, user_id, role)
      values (${uuidv7()}, ${f.tenantA}, ${f.missionA}, ${f.userA}, 'lead'),
             (${uuidv7()}, ${f.tenantB}, ${f.missionB}, ${f.userB}, 'lead')
    `;
  } finally {
    await admin.close();
  }
  return f;
}

describe('Row-Level Security', () => {
  let pg: TestPostgres;
  let f: Fixtures;

  beforeAll(async () => {
    pg = await startPostgres();
    f = await seedFixtures(pg);
  });

  afterAll(async () => {
    if (pg) {
      await stopPostgres(pg);
    }
  });

  describe('tenant A context', () => {
    let conn: AppUserConnection;

    beforeAll(async () => {
      conn = await connectAsAppUser(pg.url, { userId: f.userA, tenantId: f.tenantA });
    });

    afterAll(async () => {
      await conn.close();
    });

    it('sees its own tenant only', async () => {
      const rows = await conn.sql<{ id: string }[]>`select id from tenants`;
      expect(rows.map((r) => r.id)).toEqual([f.tenantA]);
    });

    it('sees only missions of the current tenant', async () => {
      const rows = await conn.sql<{ id: string }[]>`select id from missions`;
      expect(rows.map((r) => r.id)).toEqual([f.missionA]);
    });

    it('sees only mission_members of the current tenant', async () => {
      const rows = await conn.sql<{ mission_id: string }[]>`
        select mission_id from mission_members
      `;
      expect(rows.map((r) => r.mission_id)).toEqual([f.missionA]);
    });

    it('sees memberships of the current tenant (plus any of own)', async () => {
      const rows = await conn.sql<{ tenant_id: string }[]>`
        select tenant_id from memberships
      `;
      // Alice only has one membership, in tenant A.
      expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([f.tenantA]));
    });

    it('sees self plus tenant peers on users, not strangers', async () => {
      const rows = await conn.sql<{ id: string }[]>`select id from users`;
      expect(rows.map((r) => r.id).sort()).toEqual([f.userA].sort());
    });

    it('cannot insert a mission into another tenant', async () => {
      await expect(
        conn.sql`
          insert into missions (id, tenant_id, title)
          values (${uuidv7()}, ${f.tenantB}, 'sneaky')
        `,
      ).rejects.toThrow(/row-level security|violates row-level/i);
    });

    it('cannot update another tenant mission (no rows match)', async () => {
      const result = await conn.sql`
        update missions set title = 'hijacked' where id = ${f.missionB}
      `;
      // RLS turns cross-tenant updates into no-ops (USING clause filters
      // them out before the update reaches the target row).
      expect(result.count).toBe(0);
    });
  });

  describe('tenant B context', () => {
    it('sees the mirrored set of rows', async () => {
      const conn = await connectAsAppUser(pg.url, { userId: f.userB, tenantId: f.tenantB });
      try {
        const missions = await conn.sql<{ id: string }[]>`select id from missions`;
        expect(missions.map((m) => m.id)).toEqual([f.missionB]);
        const tenants = await conn.sql<{ id: string }[]>`select id from tenants`;
        expect(tenants.map((t) => t.id)).toEqual([f.tenantB]);
      } finally {
        await conn.close();
      }
    });
  });

  describe('sessions', () => {
    it('a user sees only their own sessions', async () => {
      // Insert two sessions, one per user, via admin bypass.
      const admin = await connectAsAppAdmin(pg.url);
      try {
        await admin.sql`
          insert into sessions (id, user_id, refresh_token_hash, expires_at)
          values
            (${uuidv7()}, ${f.userA}, 'ha', now() + interval '1 day'),
            (${uuidv7()}, ${f.userB}, 'hb', now() + interval '1 day')
        `;
      } finally {
        await admin.close();
      }

      const connA = await connectAsAppUser(pg.url, { userId: f.userA, tenantId: f.tenantA });
      try {
        const rows = await connA.sql<{ user_id: string }[]>`select user_id from sessions`;
        expect(rows.every((r) => r.user_id === f.userA)).toBe(true);
        expect(rows.length).toBe(1);
      } finally {
        await connA.close();
      }
    });
  });

  describe('unset GUCs', () => {
    it('app_user with no tenant/user context sees nothing', async () => {
      const conn = await connectAsAppUser(pg.url);
      try {
        const tenants = await conn.sql<{ id: string }[]>`select id from tenants`;
        expect(tenants).toHaveLength(0);
        const missions = await conn.sql<{ id: string }[]>`select id from missions`;
        expect(missions).toHaveLength(0);
      } finally {
        await conn.close();
      }
    });
  });

  describe('app_admin', () => {
    it('bypasses RLS and sees everything', async () => {
      const admin = await connectAsAppAdmin(pg.url);
      try {
        const tenants = await admin.sql<{ id: string }[]>`select id from tenants`;
        expect(tenants.length).toBeGreaterThanOrEqual(2);
        const missions = await admin.sql<{ id: string }[]>`select id from missions`;
        expect(missions.length).toBeGreaterThanOrEqual(2);
      } finally {
        await admin.close();
      }
    });
  });
});
