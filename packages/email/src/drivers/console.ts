import type { Email, EmailSender } from '../sender.ts';

export interface SentEmail {
  email: Email;
  sentAt: Date;
}

export interface ConsoleEmailSenderOptions {
  // Override where the driver writes each delivery. Defaults to
  // `console.info` with a structured payload — tests typically pass a
  // no-op sink and read `sender.sent` directly instead.
  log?: (entry: SentEmail) => void;
}

// Driver used in development and tests. Captures every send so callers
// can assert against the outbox without a real SMTP/HTTP transport.
export interface ConsoleEmailSender extends EmailSender {
  readonly sent: ReadonlyArray<SentEmail>;
  reset(): void;
}

export function createConsoleEmailSender(
  options: ConsoleEmailSenderOptions = {},
): ConsoleEmailSender {
  const sent: SentEmail[] = [];
  const log = options.log ?? defaultLog;

  return {
    get sent() {
      return sent;
    },
    async send(email: Email): Promise<void> {
      const entry: SentEmail = { email, sentAt: new Date() };
      sent.push(entry);
      log(entry);
    },
    reset(): void {
      sent.length = 0;
    },
  };
}

function defaultLog(entry: SentEmail): void {
  // Single-line structured output — easy to grep in dev logs and
  // never includes the email body in a way that would be parsed as
  // markup by terminal emulators.
  // biome-ignore lint/suspicious/noConsole: the console driver's purpose is to log to stdout in dev.
  console.info('[email:console]', {
    to: entry.email.to,
    subject: entry.email.subject,
    sentAt: entry.sentAt.toISOString(),
  });
}
