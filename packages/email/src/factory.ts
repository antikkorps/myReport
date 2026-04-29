import { type ConsoleEmailSender, createConsoleEmailSender } from './drivers/console.ts';
import type { EmailSender } from './sender.ts';

// Discriminated union: each driver carries its own configuration shape
// so adding a new driver (e.g. mailjet) becomes a new branch with
// strictly-typed options rather than a bag of optional fields.
export type EmailConfig = { driver: 'console' };

// Returns the matching driver. When more drivers are added (mailjet,
// smtp, ...), extend `EmailConfig` and add a switch arm here. Callers
// should depend on `EmailSender`, never on a concrete driver, except in
// tests that need driver-specific helpers (e.g. `ConsoleEmailSender.sent`).
export function createEmailSender(config: EmailConfig): EmailSender {
  if (config.driver === 'console') {
    return createConsoleEmailSender();
  }
  // Runtime guard for callers that build the config from untrusted
  // input (parsed env vars, JSON config, ...). Compile-time exhaustive
  // narrowing will be added when a second driver lands.
  const driver = (config as { driver?: string }).driver;
  throw new Error(`Unsupported email driver: ${driver ?? '<unknown>'}`);
}

export type { ConsoleEmailSender };
