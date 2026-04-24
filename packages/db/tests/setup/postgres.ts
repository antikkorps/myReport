import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import * as schema from '../../src/schema/index.ts';

export type TestDatabase = PostgresJsDatabase<typeof schema>;

export interface TestPostgres {
  container: StartedPostgreSqlContainer;
  sql: Sql;
  db: TestDatabase;
  url: string;
}

// Boots a disposable Postgres container, applies the repo extensions
// script (mirrors infra/postgres/init/01-extensions.sql), runs the
// Drizzle migrations, and returns a handle. One call per test file.
export async function startPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('myreport_test')
    .withUsername('myreport')
    .withPassword('myreport')
    .start();

  const url = container.getConnectionUri();
  const sql = postgres(url, { max: 5, prepare: false });

  // Extensions that infra/postgres/init/01-extensions.sql installs for
  // the dev container. Kept here so the test container matches dev.
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "citext"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`;

  const db = drizzle(sql, { schema, casing: 'snake_case' });
  const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));
  await migrate(db, { migrationsFolder });

  return { container, sql, db, url };
}

export async function stopPostgres(handle: TestPostgres): Promise<void> {
  await handle.sql.end({ timeout: 5 });
  await handle.container.stop();
}

// Opens a fresh connection that connects as `app_user` with the given
// GUCs set at the session level. Call close() when done.
export interface AppUserConnection {
  sql: Sql;
  close: () => Promise<void>;
}

export async function connectAsAppUser(
  url: string,
  opts: { userId?: string; tenantId?: string } = {},
): Promise<AppUserConnection> {
  const sql = postgres(url, { max: 1, prepare: false });
  await sql`SET ROLE app_user`;
  // Empty string is a valid "unset" value for our app_current_uuid helper.
  await sql.unsafe(`SET app.current_user_id = '${opts.userId ?? ''}'`);
  await sql.unsafe(`SET app.current_tenant_id = '${opts.tenantId ?? ''}'`);
  return { sql, close: () => sql.end({ timeout: 5 }) };
}

export async function connectAsAppAdmin(url: string): Promise<AppUserConnection> {
  const sql = postgres(url, { max: 1, prepare: false });
  await sql`SET ROLE app_admin`;
  return { sql, close: () => sql.end({ timeout: 5 }) };
}
