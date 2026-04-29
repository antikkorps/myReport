# `@myreport/email`

Outbound transactional email for myReport.

## Goal

Provide a thin, swappable abstraction so the rest of the codebase depends only on `EmailSender`, not on a concrete provider. The first consumers are the invitations flow (`POST /tenants` and `POST /invitations`); future consumers (password reset, mission notifications, etc.) reuse the same interface.

## API

```ts
import {
  createEmailSender,
  type Email,
  type EmailAddress,
  type EmailSender,
} from '@myreport/email';

const sender: EmailSender = createEmailSender({
  driver: 'resend',
  apiKey: process.env.RESEND_API_KEY!,
  from: { address: 'noreply@myreport.dev', name: 'myReport' },
});

await sender.send({
  to: 'alice@example.com',
  subject: 'Welcome to myReport',
  text: 'Hello Alice,\n\nClick the link to set your password: ...',
  // html: '<p>Hello Alice,</p><p>...</p>',  // optional
  // replyTo: 'inbox@myreport.dev',          // optional
});
```

`text` is mandatory (accessibility + spam-score). `html` is optional. The `from` address is configured **once at driver construction**, not per-message — templates stay portable across drivers.

## Drivers

| Driver | Status | Use case |
|---|---|---|
| `console` | ✅ Implemented | Local development and tests. Logs the email to the configured sink and exposes the captured outbox via `sender.sent`. |
| `resend` | ✅ Implemented | Production. Posts to the Resend HTTP API (see [ADR 0003](../../docs/adr/0003-email-provider-resend.md)). |

### Console driver

Used in dev (`EMAIL_DRIVER=console`) and in integration tests where assertions on outbound mail are needed.

```ts
import { createConsoleEmailSender } from '@myreport/email';

const sender = createConsoleEmailSender({
  // optional — silences the default `console.info` output:
  log: () => {},
  // optional — attached to every captured entry for parity with prod:
  from: { address: 'dev@local.test', name: 'myReport (dev)' },
});

await sender.send({ to: 'a@b', subject: 's', text: 't' });
expect(sender.sent).toHaveLength(1);
sender.reset();
```

### Resend driver

Direct `fetch` to `POST https://api.resend.com/emails` with `Authorization: Bearer <apiKey>`. No SDK; ~30 lines of code keep the supply-chain footprint small.

```ts
import { createResendEmailSender } from '@myreport/email';

const sender = createResendEmailSender({
  apiKey: process.env.RESEND_API_KEY!,
  from: { address: 'noreply@myreport.dev', name: 'myReport' },
  // Optional overrides for tests:
  // fetch: customFetch,
  // endpoint: 'http://localhost:9999/emails',
});
```

The `from.address` must be on a **domain validated** in your Resend dashboard, otherwise sends are rejected with a 4xx.

#### Sandbox / staging

Resend does not expose a server-side sandbox flag. The standard pattern is to create a **separate "test" API key** in the Resend dashboard for staging, or to send to one of Resend's discard addresses (`delivered@resend.dev`, `bounced@resend.dev`, ...) which short-circuit delivery.

#### Errors

A non-2xx response from Resend turns into a regular `Error` with a message of the shape `resend: send failed (422): validation_error: <reason>`. The api key is never included in the error message.

## Why this lives in its own package

Keeps the API surface stable across consumers and makes the driver swap a single dependency-injection point rather than a multi-callsite refactor. Switching providers (Postmark, SES, SMTP, ...) is a new file under `src/drivers/` and a new branch in `factory.ts`.
