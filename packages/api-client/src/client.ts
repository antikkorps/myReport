import { ZErrorResponse, ZRefreshResponse } from '@myreport/shared-schemas';
import type { ZodType } from 'zod';
import { ApiContractError, ApiError, ApiNetworkError } from './errors.ts';

export interface ApiClientConfig {
  // Base URL prefixed to every request path. Use `/api` in dev (Vite
  // proxies to the API server) and the absolute API URL in prod.
  baseUrl: string;
  // Provides the current access token at call time. Returning null
  // omits the Authorization header — used for /auth/login itself.
  getAccessToken?: () => string | null;
  // Called when a silent refresh successfully rotated the access
  // token. The host application updates its in-memory store from here.
  onAccessTokenRotated?: (newAccessToken: string) => void;
  // Called when a silent refresh failed (refresh cookie expired,
  // reused, or the server rejected it). The host clears auth state.
  onSessionExpired?: (cause: unknown) => void;
  // Override fetch for tests or for SSR contexts. Defaults to
  // globalThis.fetch.
  fetch?: typeof fetch;
}

export interface RequestOptions {
  // Forwarded to fetch. Lets callers cancel pending requests when a
  // component unmounts mid-flight.
  signal?: AbortSignal;
}

interface InternalRequest<TBody> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: TBody;
  // When omitted, the response body is not parsed (used for 204).
  responseSchema?: ZodType;
  options?: RequestOptions;
}

export interface ApiClientCore {
  request<TResponse>(
    req: InternalRequest<unknown> & { responseSchema: ZodType<TResponse> },
  ): Promise<TResponse>;
  request(req: InternalRequest<unknown> & { responseSchema?: undefined }): Promise<void>;
  // Forces a refresh, returning the new access token. Multiple parallel
  // callers share the same in-flight refresh promise.
  ensureRefresh(): Promise<string>;
}

// Paths whose 401 must NOT trigger the retry interceptor: refresh
// avoids recursion, login + logout have different 401 semantics.
const NON_RETRYABLE_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

export function createApiClientCore(config: ApiClientConfig): ApiClientCore {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

  // A single in-flight refresh promise; concurrent 401s share it so the
  // server only sees one /auth/refresh call instead of N.
  let inFlightRefresh: Promise<string> | null = null;

  async function ensureRefresh(): Promise<string> {
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = (async (): Promise<string> => {
      try {
        const refreshed = await rawRequest<{ accessToken: string }>({
          method: 'POST',
          path: '/auth/refresh',
          responseSchema: ZRefreshResponse,
        });
        config.onAccessTokenRotated?.(refreshed.accessToken);
        return refreshed.accessToken;
      } catch (err) {
        config.onSessionExpired?.(err);
        throw err;
      } finally {
        inFlightRefresh = null;
      }
    })();
    return inFlightRefresh;
  }

  // The "raw" fetch path: builds a request, parses the response. It is
  // used both for normal traffic (wrapped by `run` for retry) and for
  // /auth/refresh itself (which must skip the interceptor).
  async function rawRequest<TResponse>(req: InternalRequest<unknown>): Promise<TResponse> {
    const url = joinUrl(config.baseUrl, req.path);
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (req.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    const token = config.getAccessToken?.();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const init: RequestInit = {
      method: req.method,
      headers,
      // Refresh token cookie travels with every request; the API sets
      // it httpOnly and scopes it to /auth, so non-auth routes simply
      // ignore it.
      credentials: 'include',
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      ...(req.options?.signal ? { signal: req.options.signal } : {}),
    };

    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (reason) {
      throw new ApiNetworkError(
        reason instanceof Error ? reason.message : 'network request failed',
        reason,
      );
    }

    return parseResponse<TResponse>(response, req.responseSchema);
  }

  async function parseResponse<TResponse>(
    response: Response,
    responseSchema: ZodType | undefined,
  ): Promise<TResponse> {
    if (response.status === 204) {
      return undefined as TResponse;
    }

    const rawText = await response.text();
    let parsed: unknown;
    if (rawText.length > 0) {
      try {
        parsed = JSON.parse(rawText);
      } catch (reason) {
        throw new ApiContractError(
          response.status,
          `expected JSON body but received ${response.headers.get('content-type') ?? 'unknown content-type'}`,
          reason,
        );
      }
    }

    if (!response.ok) {
      const errorParse = ZErrorResponse.safeParse(parsed);
      if (!errorParse.success) {
        throw new ApiContractError(
          response.status,
          'response status is not OK and body does not match ErrorResponse',
          errorParse.error,
        );
      }
      // Some error envelopes carry extra top-level fields outside the
      // standard ErrorResponse shape (e.g. SCHEMA_INVALID returns
      // `issues[]` at the root). Zod's strip mode would silently drop
      // them, so we merge the raw parsed body into `details` whenever
      // the server omits an explicit `details` object. This keeps the
      // client agnostic to specific envelopes while still surfacing
      // the extras to UI code.
      const envelope = errorParse.data;
      let mergedDetails = envelope.details;
      if (!mergedDetails && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const extras: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (key === 'code' || key === 'message' || key === 'details') continue;
          extras[key] = value;
        }
        if (Object.keys(extras).length > 0) mergedDetails = extras;
      }
      throw new ApiError(response.status, {
        code: envelope.code,
        message: envelope.message,
        ...(mergedDetails ? { details: mergedDetails } : {}),
      });
    }

    if (!responseSchema) {
      return undefined as TResponse;
    }
    const result = responseSchema.safeParse(parsed);
    if (!result.success) {
      throw new ApiContractError(
        response.status,
        'response body does not match the expected schema',
        result.error,
      );
    }
    return result.data as TResponse;
  }

  async function run<TResponse>(req: InternalRequest<unknown>): Promise<TResponse | undefined> {
    try {
      return await rawRequest<TResponse>(req);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        !NON_RETRYABLE_PATHS.has(req.path) &&
        config.onAccessTokenRotated
      ) {
        // Token expired between scheduling and arrival. Refresh once
        // and retry the original request with the new bearer.
        try {
          await ensureRefresh();
        } catch {
          // Refresh failed; surface the original 401 to the caller so
          // it can react (e.g. redirect to /login). The session-expired
          // callback was already invoked inside ensureRefresh.
          throw err;
        }
        return rawRequest<TResponse>(req);
      }
      throw err;
    }
  }

  return {
    request: run as ApiClientCore['request'],
    ensureRefresh,
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
