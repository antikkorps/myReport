import { createEmailSender, type EmailSender } from '@myreport/email';
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
  const sender = opts.override ?? createEmailSender({ driver: opts.env.EMAIL_DRIVER });
  app.decorate('emailSender', sender);
};

export default fp(emailPlugin, { name: 'email' });
