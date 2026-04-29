import { createHash, randomBytes } from 'node:crypto';

// 32 bytes of CSPRNG randomness, encoded as URL-safe base64 (43 chars
// with no padding). 256 bits of entropy is well above the threshold
// where collision/guessing is a practical concern.
const TOKEN_BYTES = 32;

export interface InvitationToken {
  // The clear token, included in the email link. Never persisted.
  clear: string;
  // sha256(clear). The only thing we store, mirroring how we hash
  // refresh tokens at rest in `sessions`.
  hash: Buffer;
}

export function generateInvitationToken(): InvitationToken {
  const bytes = randomBytes(TOKEN_BYTES);
  const clear = bytes.toString('base64url');
  const hash = createHash('sha256').update(clear).digest();
  return { clear, hash };
}

export function hashInvitationToken(clear: string): Buffer {
  return createHash('sha256').update(clear).digest();
}

export function buildAcceptUrl(webBaseUrl: string, clearToken: string): string {
  // We intentionally don't use URL() so the function stays synchronous
  // and total — webBaseUrl was validated by Zod (.url()) at boot.
  const trimmed = webBaseUrl.endsWith('/') ? webBaseUrl.slice(0, -1) : webBaseUrl;
  return `${trimmed}/invitations/accept?token=${encodeURIComponent(clearToken)}`;
}

// 7-day default lifetime. Long enough to survive a weekend / holiday
// without forcing an admin to re-issue, short enough that a stale
// invitation cannot sit forever in someone's inbox.
export const INVITATION_TTL_DAYS = 7;

export function invitationExpiry(now: Date = new Date()): Date {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITATION_TTL_DAYS);
  return expiresAt;
}
