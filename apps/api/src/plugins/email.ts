import { createEmailSender, type EmailConfig, type EmailSender } from '@myreport/email';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.ts';

declare module 'fastify' {
  interface FastifyInstance {
    emailSender: EmailSender;
  }
}

export interface EmailPluginOptions {
  env: Env;
  // Test override. When provided, the plugin uses this instance verbatim
  // instead of building one from the env — lets integration tests assert
  // against an in-memory `ConsoleEmailSender` they fully control.
  override?: EmailSender;
}

const emailPlugin: FastifyPluginAsync<EmailPluginOptions> = async (app, opts) => {
  const sender = opts.override ?? createEmailSender(buildEmailConfig(opts.env));
  app.decorate('emailSender', sender);
};

// Translates the flat env shape into the discriminated `EmailConfig`
// expected by `@myreport/email`. The env-level superRefine has already
// guaranteed the resend branch's required fields are present, but the
// runtime guards below keep TypeScript narrow without `!` assertions.
function buildEmailConfig(env: Env): EmailConfig {
  if (env.EMAIL_DRIVER === 'resend') {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required when EMAIL_DRIVER=resend');
    }
    if (!env.EMAIL_FROM_ADDRESS) {
      throw new Error('EMAIL_FROM_ADDRESS is required when EMAIL_DRIVER=resend');
    }
    return {
      driver: 'resend',
      apiKey: env.RESEND_API_KEY,
      from: {
        address: env.EMAIL_FROM_ADDRESS,
        ...(env.EMAIL_FROM_NAME ? { name: env.EMAIL_FROM_NAME } : { name: 'myReport' }),
      },
    };
  }
  // Console driver — `from` is purely informational so we attach it
  // when present but don't fall back to a hardcoded address.
  if (env.EMAIL_FROM_ADDRESS) {
    return {
      driver: 'console',
      from: {
        address: env.EMAIL_FROM_ADDRESS,
        ...(env.EMAIL_FROM_NAME ? { name: env.EMAIL_FROM_NAME } : {}),
      },
    };
  }
  return { driver: 'console' };
}

export default fp(emailPlugin, { name: 'email' });
