import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

// Client-generated UUIDv7 primary key. Using v7 (time-ordered) improves
// index locality on large tables and makes IDs safe to generate offline
// (see CLAUDE.md: prepares V2 sync without ID conflicts).
export const primaryId = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

// Foreign key column targeting a UUIDv7 primary key.
export const uuidFk = () => uuid();

export const createdAt = () =>
  timestamp({ withTimezone: true, mode: 'date' }).notNull().default(sql`now()`);

export const updatedAt = () =>
  timestamp({ withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`)
    .$onUpdateFn(() => new Date());

export const deletedAt = () => timestamp({ withTimezone: true, mode: 'date' });
