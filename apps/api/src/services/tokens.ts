import { createHash, randomBytes } from 'node:crypto';

// 32 bytes = 256 bits of entropy, encoded as 64 hex chars. Plenty for a
// refresh token even with online guessing.
const REFRESH_TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

// SHA-256 is used (not argon2) because we need a deterministic hash to
// look up sessions by index. Pre-image resistance of SHA-256 is enough
// here: the input is high-entropy random, so rainbow tables and
// dictionary attacks do not apply.
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AccessTokenClaims {
  sub: string;
  tenantId: string | null;
  isSuperAdmin: boolean;
}
