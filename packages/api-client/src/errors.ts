// Decoupled from TypeBox vs Zod inference: both produce a `details`
// field that is structurally compatible with this shape. Defining it
// here keeps the constructor signature simple under
// `exactOptionalPropertyTypes`.
interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown> | undefined;
}

// Thrown for any non-2xx response that the server returned with a
// well-formed `ErrorResponse` envelope. The original status code is kept
// so callers can branch on auth failures (401) vs others.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, payload: ErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

// Avoids overriding `Error.cause` (ES2022) since the web tsconfig still
// targets the ES2020 lib for Vite compatibility, where `cause` is not
// declared on Error.
//
// Thrown when the response could not be parsed as JSON or did not match
// the expected schema. Indicates a contract drift between front and API
// — surface it loudly rather than silently returning a wrong shape.
export class ApiContractError extends Error {
  readonly status: number;
  readonly reason: unknown;

  constructor(status: number, message: string, reason: unknown) {
    super(message);
    this.name = 'ApiContractError';
    this.status = status;
    this.reason = reason;
  }
}

// Thrown for network-level failures (DNS, offline, abort) where no
// response was ever received from the API.
export class ApiNetworkError extends Error {
  readonly reason: unknown;

  constructor(message: string, reason: unknown) {
    super(message);
    this.name = 'ApiNetworkError';
    this.reason = reason;
  }
}
