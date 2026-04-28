import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../src/index.ts';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const userPayload = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'alice@example.com',
  displayName: 'Alice',
  isSuperAdmin: false,
};

function meBody() {
  return JSON.stringify({
    user: userPayload,
    memberships: [],
    currentTenant: null,
  });
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('401 retry interceptor', () => {
  it('refreshes once and retries the original request on 401', async () => {
    const calls: FetchCall[] = [];
    const responses: Response[] = [
      jsonResponse(401, JSON.stringify({ code: 'TOKEN_EXPIRED', message: 'expired' })),
      jsonResponse(200, JSON.stringify({ accessToken: 'token-2' })),
      jsonResponse(200, meBody()),
    ];
    const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch call');
      return Promise.resolve(next);
    }) as unknown as typeof fetch;

    const onRotated = vi.fn();
    let token = 'token-1';
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl,
      getAccessToken: () => token,
      onAccessTokenRotated: (t) => {
        onRotated(t);
        token = t;
      },
    });

    const result = await client.me.get();

    expect(result.user.email).toBe('alice@example.com');
    expect(onRotated).toHaveBeenCalledExactlyOnceWith('token-2');
    expect(calls).toHaveLength(3);
    const [first, refresh, retry] = calls;
    if (!first || !refresh || !retry) throw new Error('expected three calls');
    expect(first.url).toBe('/api/me');
    expect(refresh.url).toBe('/api/auth/refresh');
    expect(retry.url).toBe('/api/me');
    // The retried call uses the rotated token.
    expect(new Headers(retry.init.headers).get('Authorization')).toBe('Bearer token-2');
  });

  it('calls onSessionExpired and propagates the original 401 when refresh also fails', async () => {
    const responses: Response[] = [
      jsonResponse(401, JSON.stringify({ code: 'TOKEN_EXPIRED', message: 'expired' })),
      jsonResponse(401, JSON.stringify({ code: 'INVALID_REFRESH_TOKEN', message: 'invalid' })),
    ];
    const fetchImpl = (() => Promise.resolve(responses.shift())) as unknown as typeof fetch;

    const onExpired = vi.fn();
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl,
      getAccessToken: () => 'stale',
      onAccessTokenRotated: () => {},
      onSessionExpired: onExpired,
    });

    await expect(client.me.get()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('shares a single in-flight refresh across parallel 401s', async () => {
    let refreshCount = 0;
    const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshCount += 1;
        return Promise.resolve(
          jsonResponse(200, JSON.stringify({ accessToken: `t-${refreshCount}` })),
        );
      }
      // First call: 401 unless the request carries the rotated bearer.
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth?.startsWith('Bearer t-')) {
        return Promise.resolve(jsonResponse(200, meBody()));
      }
      return Promise.resolve(
        jsonResponse(401, JSON.stringify({ code: 'TOKEN_EXPIRED', message: 'expired' })),
      );
    }) as unknown as typeof fetch;

    let token = 'stale';
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl,
      getAccessToken: () => token,
      onAccessTokenRotated: (t) => {
        token = t;
      },
    });

    const [a, b, c] = await Promise.all([client.me.get(), client.me.get(), client.me.get()]);

    expect(a.user.email).toBe('alice@example.com');
    expect(b.user.email).toBe('alice@example.com');
    expect(c.user.email).toBe('alice@example.com');
    // Three concurrent 401s should have triggered a single /auth/refresh.
    expect(refreshCount).toBe(1);
  });

  it('does not retry on 401 from /auth/login itself', async () => {
    const responses: Response[] = [
      jsonResponse(401, JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'invalid' })),
    ];
    const fetchImpl = (() => Promise.resolve(responses.shift())) as unknown as typeof fetch;

    const onRotated = vi.fn();
    const client = createApiClient({
      baseUrl: '/api',
      fetch: fetchImpl,
      onAccessTokenRotated: onRotated,
    });

    await expect(
      client.auth.login({ email: 'a@b.c', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(onRotated).not.toHaveBeenCalled();
    expect(responses).toHaveLength(0);
  });
});
