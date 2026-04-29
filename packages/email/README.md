# `@myreport/email`

Outbound transactional email for myReport.

## Goal

Provide a thin, swappable abstraction so the rest of the codebase depends only on `EmailSender`, not on a concrete provider. The first consumer is the upcoming invitations flow (Phase 2 *Gestion users*); later consumers (password reset, mission notifications, etc.) reuse the same interface.

## API

```ts
import { createEmailSender, type Email, type EmailSender } from '@myreport/email';

const sender: EmailSender = createEmailSender({ driver: 'console' });

await sender.send({
  to: 'alice@example.com',
  subject: 'Welcome to myReport',
  text: 'Hello Alice,\n\nClick the link to set your password: ...',
  // html: '<p>Hello Alice,</p><p>...</p>',  // optional
});
```

`text` is mandatory (accessibility + spam-score). `html` is optional and only used when present.

## Drivers

| Driver | Status | Use case |
|---|---|---|
| `console` | ✅ Implemented | Local development and tests. Logs the email to the configured sink and exposes the captured outbox. |
| `mailjet` | ⏳ Planned | Production. Will be added in a dedicated PR (see `BACKLOG.md`). |

## Console driver: capturing in tests

```ts
import { createConsoleEmailSender } from '@myreport/email';

const sender = createConsoleEmailSender();
await sender.send({ to: 'a@b', subject: 's', text: 't' });
expect(sender.sent).toHaveLength(1);
sender.reset();
```

Pass a custom `log` sink to silence output (e.g. in tests):

```ts
const sender = createConsoleEmailSender({ log: () => {} });
```

## Why this lives in its own package

Keeps the API surface stable across consumers and makes the driver swap a single dependency-injection point rather than a multi-callsite refactor when we wire Mailjet in.
