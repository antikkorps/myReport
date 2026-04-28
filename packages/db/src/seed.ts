import argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { createDatabase } from './client.ts';
import { authIdentities } from './schema/auth-identities.ts';
import { memberships } from './schema/memberships.ts';
import { tenants } from './schema/tenants.ts';
import { users } from './schema/users.ts';

// Dev-only seed. Idempotent: each entity check runs first, the insert
// only happens when the row is missing, so re-running the seed is safe.
//
// Credentials are printed at the end so the developer can copy them
// into the login form. They are obviously not production-grade.

const DEV_PASSWORD = 'devpassword';

interface SeedUser {
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  // null = platform user, no membership.
  membership: { tenantSlug: string; role: 'cabinet_admin' | 'auditor' } | null;
}

const seedUsers: SeedUser[] = [
  {
    email: 'admin@myreport.dev',
    displayName: 'Super Admin',
    isSuperAdmin: true,
    membership: null,
  },
  {
    email: 'alice@demo.myreport.dev',
    displayName: 'Alice (Cabinet Admin)',
    isSuperAdmin: false,
    membership: { tenantSlug: 'demo', role: 'cabinet_admin' },
  },
  {
    email: 'bob@demo.myreport.dev',
    displayName: 'Bob (Auditor)',
    isSuperAdmin: false,
    membership: { tenantSlug: 'demo', role: 'auditor' },
  },
];

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const handle = createDatabase({ url, max: 1 });
  try {
    const tenantId = await ensureDemoTenant(handle.db);
    const passwordHash = await argon2.hash(DEV_PASSWORD);

    for (const u of seedUsers) {
      await ensureUser(handle.db, u, passwordHash, tenantId);
    }

    console.log('');
    console.log('Seed complete. Dev credentials:');
    for (const u of seedUsers) {
      const role = u.membership?.role ?? (u.isSuperAdmin ? 'super_admin' : 'no role');
      console.log(`  ${u.email} / ${DEV_PASSWORD}   (${role})`);
    }
  } finally {
    await handle.close();
  }
}

async function ensureDemoTenant(db: ReturnType<typeof createDatabase>['db']): Promise<string> {
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.slug, 'demo'), isNull(tenants.deletedAt)))
    .limit(1);
  const found = existing[0];
  if (found) {
    console.log(`Seed: demo tenant already exists (${found.id}).`);
    return found.id;
  }
  const [row] = await db
    .insert(tenants)
    .values({ name: 'Demo Cabinet', slug: 'demo' })
    .returning({ id: tenants.id });
  if (!row) throw new Error('failed to create demo tenant');
  console.log(`Seed: created tenant demo (${row.id}).`);
  return row.id;
}

async function ensureUser(
  db: ReturnType<typeof createDatabase>['db'],
  spec: SeedUser,
  passwordHash: string,
  demoTenantId: string,
): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, spec.email), isNull(users.deletedAt)))
    .limit(1);
  const found = existing[0];
  let userId: string;
  if (found) {
    userId = found.id;
    console.log(`Seed: user ${spec.email} already exists.`);
  } else {
    userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      email: spec.email,
      displayName: spec.displayName,
      isSuperAdmin: spec.isSuperAdmin,
    });
    console.log(`Seed: created user ${spec.email}.`);
  }

  // Password identity is owned by the user — re-run leaves it
  // untouched if already present.
  const existingIdentity = await db
    .select({ id: authIdentities.id })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.userId, userId),
        eq(authIdentities.provider, 'password'),
        isNull(authIdentities.deletedAt),
      ),
    )
    .limit(1);
  if (existingIdentity.length === 0) {
    await db.insert(authIdentities).values({
      userId,
      provider: 'password',
      secretHash: passwordHash,
      emailAtLink: spec.email,
    });
  }

  // Membership: only when the user belongs to a tenant.
  if (spec.membership) {
    const existingMembership = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, demoTenantId)))
      .limit(1);
    if (existingMembership.length === 0) {
      await db.insert(memberships).values({
        userId,
        tenantId: demoTenantId,
        role: spec.membership.role,
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
