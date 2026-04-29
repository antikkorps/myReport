import type { Email, EmailAddress, EmailSender } from '../sender.ts';

export interface SentEmail {
  email: Email;
  from: EmailAddress | null;
  sentAt: Date;
}

export interface ConsoleEmailSenderOptions {
  // Override where the driver writes each delivery. Defaults to
  // `console.info` with a structured payload — tests typically pass a
  // no-op sink and read `sender.sent` directly instead.
  log?: (entry: SentEmail) => void;
  // Sender to attach to every captured entry. Optional for the console
  // driver — tests rarely care about it. Production drivers (Resend,
  // ...) require it.
  from?: EmailAddress;
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
  const from = options.from ?? null;

  return {
    get sent() {
      return sent;
    },
    async send(email: Email): Promise<void> {
      const entry: SentEmail = { email, from, sentAt: new Date() };
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
    from: entry.from ? formatAddress(entry.from) : null,
    to: entry.email.to,
    subject: entry.email.subject,
    sentAt: entry.sentAt.toISOString(),
  });
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address;
}
