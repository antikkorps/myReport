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
  // Outbound email driver. `console` is dev/CI; `resend` is the
  // production provider (see ADR 0003). Selecting `resend` requires
  // RESEND_API_KEY and EMAIL_FROM_ADDRESS — enforced by the
  // superRefine block below.
  EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  // Public base URL of the web app. Used to build the accept link in
  // invitation emails. Must NOT include a trailing slash.
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
});

// Driver-specific required fields are enforced after the base parse so
// the error message references the actual offender ("missing
// RESEND_API_KEY") rather than the union type.
const RefinedEnvSchema = EnvSchema.superRefine((env, ctx) => {
  if (env.EMAIL_DRIVER === 'resend') {
    if (!env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY is required when EMAIL_DRIVER=resend',
      });
    }
    if (!env.EMAIL_FROM_ADDRESS) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM_ADDRESS'],
        message: 'EMAIL_FROM_ADDRESS is required when EMAIL_DRIVER=resend',
      });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = RefinedEnvSchema.safeParse(source);
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
