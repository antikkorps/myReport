import { type Database, schema } from '@myreport/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

export interface CreateSessionInput {
  userId: string;
  tenantId: string | null;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  rotatedFrom: string | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  tenantId: string | null;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedFrom: string | null;
}

export async function createSession(db: Database, input: CreateSessionInput): Promise<SessionRow> {
  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      tenantId: input.tenantId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      rotatedFrom: input.rotatedFrom,
    })
    .returning({
      id: schema.sessions.id,
      userId: schema.sessions.userId,
      tenantId: schema.sessions.tenantId,
      refreshTokenHash: schema.sessions.refreshTokenHash,
      expiresAt: schema.sessions.expiresAt,
      revokedAt: schema.sessions.revokedAt,
      rotatedFrom: schema.sessions.rotatedFrom,
    });
  if (!row) throw new Error('Failed to insert session');
  return row;
}

export async function findSessionByHash(
  db: Database,
  refreshTokenHash: string,
): Promise<SessionRow | null> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      userId: schema.sessions.userId,
      tenantId: schema.sessions.tenantId,
      refreshTokenHash: schema.sessions.refreshTokenHash,
      expiresAt: schema.sessions.expiresAt,
      revokedAt: schema.sessions.revokedAt,
      rotatedFrom: schema.sessions.rotatedFrom,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.refreshTokenHash, refreshTokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeSession(db: Database, id: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.revokedAt)));
}

// Walks the rotation chain starting from `originId` (forward via
// `rotatedFrom`-pointing children) and revokes every active session.
// Triggered when a presented refresh token matches a row that is
// already revoked: we can no longer trust any descendant in the chain.
export async function revokeChain(db: Database, originId: string): Promise<void> {
  await db.execute(sql`
    with recursive chain as (
      select id from sessions where id = ${originId}
      union all
      select s.id from sessions s join chain c on s.rotated_from = c.id
    )
    update sessions
       set revoked_at = now()
     where id in (select id from chain)
       and revoked_at is null
  `);
}
