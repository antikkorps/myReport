import { z } from 'zod';

// Centralised env validation. The API refuses to boot with a missing or
// malformed config: better an early crash than a half-working server
// that silently bypasses auth or RLS.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  // HS256 key. Must be ≥ 32 chars in production; we don't enforce that
  // here so tests can use short fixtures, but `assertProductionSecrets`
  // below double-checks at boot.
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Outbound email driver. Only `console` is wired today; production
  // drivers will extend this enum as they land.
  EMAIL_DRIVER: z.enum(['console']).default('console'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  assertProductionSecrets(parsed.data);
  return parsed.data;
}

function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.JWT_ACCESS_SECRET.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters in production');
  }
}
