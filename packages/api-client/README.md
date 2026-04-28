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
import { createApiClient, ApiError } from '@myreport/api-client';

const client = createApiClient({
  baseUrl: '/api',
  // Optional: provides the bearer token at call time. Returning null
  // omits the Authorization header (used for /auth/login itself).
  getAccessToken: () => store.accessToken,
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

All methods accept an optional `{ signal }` for cancellation.

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
