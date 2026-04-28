# @myreport/api-client

Typed HTTP client for the myReport API. Inputs and outputs are derived
from `@myreport/shared-schemas` (TypeBox types for static typing, Zod
schemas for runtime validation).

## Why

Per the project rule "no raw `fetch` on the front", every browser-side
call goes through this package. Responses are validated with Zod at
runtime so a contract drift between front and API surfaces immediately
as an `ApiContractError` rather than a wrong shape silently propagating
into the UI.

## Usage

```ts
import { createApiClient, createRefreshScheduler, ApiError } from '@myreport/api-client';

let scheduler: ReturnType<typeof createRefreshScheduler>;
const client = createApiClient({
  baseUrl: '/api',
  // Optional: provides the bearer token at call time. Returning null
  // omits the Authorization header (used for /auth/login itself).
  getAccessToken: () => store.accessToken,
  // Called when a silent refresh rotated the access token. Update the
  // store and re-arm the proactive scheduler.
  onAccessTokenRotated: (token) => {
    store.accessToken = token;
    scheduler.schedule(token);
  },
  // Called when refresh fails (cookie expired, reused). Clear state.
  onSessionExpired: () => store.reset(),
});

scheduler = createRefreshScheduler({
  refresh: () => client.ensureRefresh(),
  marginSec: 30,
});

try {
  const result = await client.auth.login({ email, password });
  // result is fully typed: LoginResponse from shared-schemas
} catch (err) {
  if (err instanceof ApiError && err.status === 401) {
    // invalid credentials
  }
}
```

## Surface

- `apiClient.auth.login(body)` → `LoginResponse`
- `apiClient.auth.refresh()` → `RefreshResponse`
- `apiClient.auth.logout()` → `void` (204)
- `apiClient.me.get()` → `MeResponse`
- `apiClient.ensureRefresh()` → `string` — forces a silent refresh, returns the new access token. Concurrent callers share a single in-flight promise so the server only sees one `/auth/refresh`.

All methods accept an optional `{ signal }` for cancellation.

## Auth lifecycle

The client transparently handles token rotation on two paths:

- **Reactive (interceptor)**: any non-`/auth/*` request that returns
  `401` triggers a silent refresh, then a single retry of the original
  request with the rotated bearer. If the refresh itself fails,
  `onSessionExpired` is invoked and the original `401` propagates.
- **Proactive (scheduler)**: `createRefreshScheduler({ refresh })`
  decodes the JWT `exp` claim client-side and arms a one-shot timer
  that fires `marginSec` (default 30s) before expiry. On rotation the
  host re-arms the scheduler with the new token's exp.

Both paths share the in-flight `ensureRefresh()` promise, so a
proactive fire racing with a 401 retry only produces one
`/auth/refresh` call.

## Errors

- `ApiError` — non-2xx with a well-formed `ErrorResponse` envelope.
  Exposes `status`, `code`, `message`, `details`.
- `ApiContractError` — JSON parse failure or schema mismatch (front/API
  drift). Exposes `status`, `reason`.
- `ApiNetworkError` — fetch threw before a response arrived (offline,
  DNS, abort). Exposes `reason`.

## Tests

```bash
pnpm -C packages/api-client test
```
