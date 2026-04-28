import { ZErrorResponse } from '@myreport/shared-schemas';
import type { ZodType } from 'zod';
import { ApiContractError, ApiError, ApiNetworkError } from './errors.ts';

export interface ApiClientConfig {
  // Base URL prefixed to every request path. Use `/api` in dev (Vite
  // proxies to the API server) and the absolute API URL in prod.
  baseUrl: string;
  // Provides the current access token at call time. Returning null
  // omits the Authorization header — used for /auth/login itself.
  getAccessToken?: () => string | null;
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
}

export function createApiClientCore(config: ApiClientConfig): ApiClientCore {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

  async function run<TResponse>(req: InternalRequest<unknown>): Promise<TResponse | undefined> {
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

    if (response.status === 204) {
      return undefined;
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
      throw new ApiError(response.status, errorParse.data);
    }

    if (!req.responseSchema) {
      return undefined;
    }
    const result = req.responseSchema.safeParse(parsed);
    if (!result.success) {
      throw new ApiContractError(
        response.status,
        'response body does not match the expected schema',
        result.error,
      );
    }
    return result.data as TResponse;
  }

  return {
    request: run as ApiClientCore['request'],
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}
