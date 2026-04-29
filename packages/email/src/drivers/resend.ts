import type { Email, EmailAddress, EmailSender } from '../sender.ts';

export interface ResendEmailSenderOptions {
  apiKey: string;
  from: EmailAddress;
  // Override fetch for tests. Defaults to globalThis.fetch.
  fetch?: typeof fetch;
  // Override endpoint for tests / on-prem deployments. Defaults to
  // the public Resend API.
  endpoint?: string;
}

const DEFAULT_ENDPOINT = 'https://api.resend.com/emails';

// Production driver targeting the Resend HTTP API
// (POST https://api.resend.com/emails). We deliberately call `fetch`
// directly rather than pulling the `resend` SDK: the payload is small,
// the auth is a Bearer token, and the SDK adds another supply-chain
// surface for negligible value at this stage.
export function createResendEmailSender(options: ResendEmailSenderOptions): EmailSender {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const fromHeader = formatAddress(options.from);

  return {
    async send(email: Email): Promise<void> {
      const body: ResendSendRequest = {
        from: fromHeader,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      };

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw new Error(
          `resend: network error contacting ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (!response.ok) {
        // Resend returns a JSON body of shape { name, message, statusCode }
        // on errors. We surface name + message so callers can grep and
        // troubleshoot, but do NOT log the api key.
        const detail = await safeReadErrorBody(response);
        throw new Error(`resend: send failed (${response.status}): ${detail ?? 'unknown error'}`);
      }
    },
  };
}

interface ResendSendRequest {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  reply_to?: string;
}

async function safeReadErrorBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { name?: string; message?: string };
      const name = typeof parsed.name === 'string' ? parsed.name : null;
      const message = typeof parsed.message === 'string' ? parsed.message : null;
      if (name && message) return `${name}: ${message}`;
      if (message) return message;
      return text;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address;
}
