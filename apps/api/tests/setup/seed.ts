import argon2 from 'argon2';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';

export interface Seed {
  userId: string;
  tenantId: string;
  email: string;
  password: string;
}

// Seeds a single tenant + cabinet_admin user using the test container's
// owner role (BYPASSRLS). Returns plaintext credentials for use by login
// tests.
export async function seedUser(url: string): Promise<Seed> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const userId = uuidv7();
    const tenantId = uuidv7();
    const email = `user-${userId.slice(-12)}@example.test`;
    const password = 'correct-horse-battery-staple';
    const passwordHash = await argon2.hash(password);

    await sql`SET ROLE app_admin`;
    await sql`
      insert into tenants (id, name, slug)
      values (${tenantId}, 'Test Tenant', ${`tenant-${tenantId.slice(-8)}`})
    `;
    await sql`
      insert into users (id, email, password_hash, display_name)
      values (${userId}, ${email}, ${passwordHash}, 'Test User')
    `;
    await sql`
      insert into memberships (id, tenant_id, user_id, role)
      values (${uuidv7()}, ${tenantId}, ${userId}, 'cabinet_admin')
    `;

    return { userId, tenantId, email, password };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
