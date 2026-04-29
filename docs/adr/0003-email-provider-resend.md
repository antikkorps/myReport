# ADR 0003 — Transactional email provider: Resend

- **Status**: Accepted
- **Date**: 2026-04-29
- **Deciders**: Franck

## Context

Phase 2 added the invitations flow and shipped a `ConsoleEmailSender` good enough for development and CI. With the flow now consumed by both `POST /tenants` (super-admin invites the first cabinet_admin) and `POST /invitations` (cabinet_admin invites auditors), production needs a real provider. The `@myreport/email` package was designed (PR 2) so the driver is a single dependency-injection point — the goal of this ADR is to pick which one.

## Decision drivers

In order of weight for this project:

1. **EU hosting / RGPD** — invitee email addresses and bodies (containing tenant names + accept tokens) must stay in the EU.
2. **Free tier generous enough to cover early customers** — we expect dozens to low-hundreds of emails per month for the first months; a paying tier is acceptable but we want headroom before that.
3. **Simple HTTP API** — we do `fetch` directly (no SDK, see PR 7). The API has to be straightforward to call, with stable request shape and clear error reporting.
4. **Modern DX & active maintenance** — we don't want to inherit a 2010-era dashboard or a stagnating product.
5. **Future-proof template story** — the V1 templates are plain text, but if HTML invitations land later we want a clean path (preferably a React/JSX template ecosystem since the team is Vue-shaped but most of the email-template tooling is React).

Cost (per-email pricing past the free tier) is a tie-breaker, not a primary axis — at our scale the bill stays in single-digit euros for a long time.

## Options considered

### Resend (chosen)

- **EU hosting**: yes, an EU region is offered (configurable per project).
- **Free tier**: 3 000 emails / month, 100 / day. Enough to cover the early MVP without paying.
- **API**: `POST https://api.resend.com/emails`, Bearer-token auth, JSON body. ~30 lines of `fetch`.
- **DX**: founded 2023; clean docs, predictable response shape, well-documented webhooks for delivery events (we don't need them yet).
- **Template story**: official `react-email` ecosystem. We don't use it in V1, but if we move to HTML invitations we don't have to switch providers.
- **Trade-off**: younger product than the alternatives. Mitigated by the abstraction in `@myreport/email` — we can swap to a different driver in a single PR if Resend disappoints.

### Mailjet

- **EU hosting**: yes, Mailjet is French/EU.
- **Free tier**: 6 000 emails/month, 200/day — slightly more generous than Resend's free tier on raw volume.
- **API**: `POST /v3.1/send`, Basic auth (api key + secret key). Slightly heavier payload shape (`Messages` array, nested `From/To/Subject` objects with capitalised keys).
- **DX**: established (founded 2010), solid deliverability reputation, but the dashboard and SDKs feel dated.
- **Why not chosen**: the project owner already has a Mailjet account tied to a different product, and we'd rather not co-mingle sender reputation, dashboards, and API keys across unrelated apps. Pure operational reason — Mailjet itself is a fine product.

### Postmark

- **EU hosting**: only via the parent ActiveCampaign infrastructure; not a primary EU offering.
- **Free tier**: 100 emails/month — too small to cover even early dogfooding.
- **API**: very clean, arguably the best of this list.
- **Why not chosen**: free-tier ceiling is too low and EU hosting story is weaker than Resend/Mailjet. Excellent product, but pay-from-day-one doesn't fit a pre-revenue MVP.

### Amazon SES

- **EU hosting**: yes, multiple EU regions.
- **Free tier**: 3 000 emails/month *for the first 12 months only* when sent from EC2. Outside that window the pricing is genuinely cheap (~$0.10 per 1 000), but the free-tier window is misleading.
- **API**: SES SendEmail (`POST /v2/email/outbound-emails`) with Sigv4 auth — heavier than Bearer-token auth, requires either the AWS SDK (a dep we explicitly want to avoid) or a hand-rolled Sigv4 implementation.
- **Why not chosen**: setup overhead (IAM roles, sending domain verification, sandbox-then-prod gating, Sigv4) is disproportionate to the volume we're sending. SES is the right answer at scale; not at our scale.

## Decision

**Adopt Resend** as the production email driver. The `@myreport/email` package gains a `'resend'` driver alongside the existing `'console'`. The `EMAIL_DRIVER` env var picks between them.

### Configuration surface

- `RESEND_API_KEY` (required when `EMAIL_DRIVER=resend`)
- `EMAIL_FROM_ADDRESS` (required when `EMAIL_DRIVER=resend`)
- `EMAIL_FROM_NAME` (optional, defaults to `myReport`)

The `from` address must be on a domain validated in the Resend dashboard; otherwise sends are rejected with a clear API error. We surface that error via the existing `EMAIL_DELIVERY_FAILED` 500 path on the API.

### Sandbox / test mode

Resend does not expose a server-side `sandbox` flag (Mailjet does, AWS does). The standard pattern is to use a **separate test API key** in staging or to send to one of Resend's discard addresses (`delivered@resend.dev`, `bounced@resend.dev`, ...). This is operational rather than a code switch — we don't need an env var for it.

## Consequences

### Positive

- One env var (`RESEND_API_KEY`) is enough to flip from dev (`console`) to prod (`resend`).
- ~30 lines of `fetch` keep the dependency footprint flat (no SDK), which honours the project's supply-chain caution.
- React-email ecosystem available for free if we move to HTML templates later.

### Negative / trade-offs

- We rely on a younger provider. Mitigated by the pluggable driver abstraction — switching is one new file and a new branch in the factory.
- No server-side sandbox flag; staging needs its own Resend API key. Acceptable given the 1:1 dev/staging split is already on the roadmap.
- Free-tier daily cap (100/day) is something to monitor as cabinets onboard. Alerting on `EMAIL_DELIVERY_FAILED` count covers it.

### Future / deferred

- **HTML templates** via `react-email` if invitee feedback demands richer rendering. The current text-only templates are a deliberate V1 simplification.
- **Webhook ingestion** (`bounced`, `complained`, `delivered`, ...) to keep `auth_identities.email_at_link` and the invitations table in sync with deliverability — pure observability for now, not a prerequisite for shipping.
