import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index.ts';

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;

export interface CreateDatabaseOptions {
  url: string;
  // Max connections. Keep low in tests and serverless; higher in long-
  // running workers. `postgres` default is 10 which suits a single API
  // pod well enough — callers can override.
  max?: number;
  // Idle timeout in seconds before a connection is closed.
  idleTimeout?: number;
}

export interface DatabaseHandle {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const sql = postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
    // Prepare is disabled for compatibility with pgBouncer transaction
    // pooling — easier to enable once we pick a concrete deployment.
    prepare: false,
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
