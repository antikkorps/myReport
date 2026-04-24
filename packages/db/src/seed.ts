import { and, eq, isNull } from 'drizzle-orm';
import { createDatabase } from './client.ts';
import { tenants } from './schema/tenants.ts';

// Dev-only seed. Creates a single demo tenant so the API has something
// to attach fixtures to. Users and memberships will be seeded once the
// auth module lands (needs argon2 for password hashing).
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const handle = createDatabase({ url, max: 1 });
  try {
    const existing = await handle.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, 'demo'), isNull(tenants.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      console.log('Seed: demo tenant already exists, skipping.');
      return;
    }

    const [row] = await handle.db
      .insert(tenants)
      .values({ name: 'Demo Cabinet', slug: 'demo' })
      .returning({ id: tenants.id, slug: tenants.slug });
    console.log(`Seed: created tenant ${row?.slug} (${row?.id}).`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
