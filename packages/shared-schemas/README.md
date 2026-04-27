# @myreport/shared-schemas

Shared validation schemas for myReport. Each DTO is declared **twice** —
once with [TypeBox](https://github.com/sinclairzx81/typebox) (for Fastify
on the API side) and once with [Zod](https://github.com/colinhacks/zod)
(for input validation on the front before sending requests).

## Why two libraries?

- **TypeBox** produces JSON Schema that Fastify consumes natively, which
  feeds OpenAPI generation and the API's request validation.
- **Zod** is the de facto choice for ergonomic client-side form validation
  (PrimeVue forms, Pinia stores).

We considered a TypeBox→Zod converter, but for the schemas in scope (auth,
admin, mission CRUD) the duplication is trivial (≤ 5 lines per DTO) and
each library is used idiomatically. Drift is caught by the parity tests
(`tests/parity.ts`).

## Layout

```
src/
  primitives/    Uuid, Email, NonEmptyString, IsoDateTime
  envelopes/     ErrorResponse, PaginationQuery, PaginationMeta, PaginatedResponse
```

## Usage

API side (Fastify route):

```ts
import { TBPaginationQuery } from '@myreport/shared-schemas';

fastify.get('/missions', { schema: { querystring: TBPaginationQuery } }, handler);
```

Front side (Vue form):

```ts
import { ZEmail } from '@myreport/shared-schemas';

const result = ZEmail.safeParse(form.email);
```

## Adding a DTO

1. Create `src/<area>/<name>.ts` exporting `TB<Name>` and `Z<Name>`.
2. Re-export from the area `index.ts`.
3. Add a parity test in `tests/` using `expectParity()` to confirm both
   accept and reject the same inputs.

## Tests

```sh
pnpm --filter @myreport/shared-schemas test
```
