import argon2 from 'argon2';

// Argon2id parameters tuned for an interactive login (~250 ms on a
// modern CPU). Adjust if the auth route's p99 latency budget shifts.
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 2,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash on disk → treat as a failed login rather than 500.
    return false;
  }
}
