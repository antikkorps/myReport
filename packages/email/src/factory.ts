import { type ConsoleEmailSender, createConsoleEmailSender } from './drivers/console.ts';
import { createResendEmailSender } from './drivers/resend.ts';
import type { EmailAddress, EmailSender } from './sender.ts';

// Discriminated union: each driver carries its own configuration shape
// so adding a new driver becomes a new branch with strictly-typed
// options rather than a bag of optional fields.
export type EmailConfig =
  | { driver: 'console'; from?: EmailAddress }
  | { driver: 'resend'; apiKey: string; from: EmailAddress };

// Returns the matching driver. When more drivers land (Postmark, SES,
// SMTP, ...), extend `EmailConfig` and add a switch arm here. Callers
// should depend on `EmailSender`, never on a concrete driver, except
// in tests that need driver-specific helpers (e.g.
// `ConsoleEmailSender.sent`).
export function createEmailSender(config: EmailConfig): EmailSender {
  if (config.driver === 'console') {
    return createConsoleEmailSender(config.from ? { from: config.from } : {});
  }
  if (config.driver === 'resend') {
    return createResendEmailSender({ apiKey: config.apiKey, from: config.from });
  }
  // Runtime guard for callers that build the config from untrusted
  // input (parsed env vars, JSON config, ...). The TypeScript
  // exhaustive narrowing already catches misuse at compile time; this
  // line guards JS callers and surfaces a clear message instead of
  // returning a stub.
  const driver = (config as { driver?: string }).driver;
  throw new Error(`Unsupported email driver: ${driver ?? '<unknown>'}`);
}

export type { ConsoleEmailSender };
