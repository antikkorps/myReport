import { fileURLToPath } from 'node:url';
import { schema } from '@myreport/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

export type TestDatabase = PostgresJsDatabase<typeof schema>;

export interface TestPostgres {
  container: StartedPostgreSqlContainer;
  sql: Sql;
  db: TestDatabase;
  url: string;
}

export async function startPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('myreport_test')
    .withUsername('myreport')
    .withPassword('myreport')
    .start();

  const url = container.getConnectionUri();
  const sql = postgres(url, { max: 5, prepare: false });

  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "citext"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`;

  const db = drizzle(sql, { schema, casing: 'snake_case' });
  const migrationsFolder = fileURLToPath(
    new URL('../../../../packages/db/migrations', import.meta.url),
  );
  await migrate(db, { migrationsFolder });

  return { container, sql, db, url };
}

export async function stopPostgres(handle: TestPostgres): Promise<void> {
  await handle.sql.end({ timeout: 5 });
  await handle.container.stop();
}
