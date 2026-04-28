import { describe, expect, it, vi } from 'vitest';
import { ApiContractError, ApiError, ApiNetworkError, createApiClient } from '../src/index.ts';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeFetch(response: Response, calls: FetchCall[] = []): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
}

const validLoginResponse = {
  accessToken: 'token-abc',
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'alice@example.com',
    displayName: 'Alice',
    isSuperAdmin: false,
  },
  tenant: {
    id: '00000000-0000-0000-0000-000000000010',
    name: 'Cabinet Demo',
    slug: 'cabinet-demo',
    role: 'cabinet_admin',
  },
};

describe('createApiClient', () => {
  it('sends a typed POST and returns the parsed response', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify(validLoginResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    const result = await client.auth.login({
      email: 'alice@example.com',
      password: 'hunter2hunter2',
    });

    expect(result.accessToken).toBe('token-abc');
    expect(result.user.email).toBe('alice@example.com');
    expect(result.tenant?.role).toBe('cabinet_admin');
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.url).toBe('/api/auth/login');
    expect(call.init.method).toBe('POST');
    expect(call.init.credentials).toBe('include');
    const body = JSON.parse((call.init.body as string) ?? '{}');
    expect(body).toEqual({ email: 'alice@example.com', password: 'hunter2hunter2' });
  });

  it('attaches the bearer token returned by getAccessToken', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(
        JSON.stringify({
          user: validLoginResponse.user,
          memberships: [validLoginResponse.tenant],
          currentTenant: validLoginResponse.tenant,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      calls,
    );
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl,
      getAccessToken: () => 'jwt-xyz',
    });

    await client.me.get();

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    const headers = new Headers(call.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer jwt-xyz');
  });

  it('throws ApiError when the response is a well-formed ErrorResponse', async () => {
    const fetchImpl = makeFetch(
      new Response(
        JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'invalid credentials' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(
      client.auth.login({ email: 'alice@example.com', password: 'hunter2hunter2' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'invalid credentials',
    });
  });

  it('throws ApiContractError when an error body cannot be parsed', async () => {
    const fetchImpl = makeFetch(
      new Response('<html>500</html>', {
        status: 500,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(
      client.auth.login({ email: 'alice@example.com', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(ApiContractError);
  });

  it('throws ApiContractError when the success body does not match the schema', async () => {
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ accessToken: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(
      client.auth.login({ email: 'alice@example.com', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(ApiContractError);
  });

  it('throws ApiNetworkError when fetch itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.me.get()).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('treats 204 No Content as a void response (logout)', async () => {
    const fetchImpl = makeFetch(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    await expect(client.auth.logout()).resolves.toBeUndefined();
  });

  it('forwards an AbortSignal to fetch', async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = makeFetch(
      new Response(JSON.stringify({ accessToken: 'rotated' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      calls,
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });
    const controller = new AbortController();

    await client.auth.refresh({ signal: controller.signal });

    const call = calls[0];
    if (!call) throw new Error('expected one fetch call');
    expect(call.init.signal).toBe(controller.signal);
  });

  it('reports ApiError details on rejected ErrorResponse with `details`', async () => {
    const fetchImpl = makeFetch(
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          message: 'invalid body',
          details: { field: 'email' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = createApiClient({ baseUrl: '/api', fetch: fetchImpl });

    try {
      await client.auth.login({ email: 'bad', password: 'short' });
      throw new Error('expected reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('VALIDATION_ERROR');
      expect(apiErr.details).toEqual({ field: 'email' });
    }
  });
});
