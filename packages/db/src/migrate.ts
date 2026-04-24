import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.ts';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const handle = createDatabase({ url, max: 1 });
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
  try {
    await migrate(handle.db, { migrationsFolder });
    console.log('Migrations applied.');
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
