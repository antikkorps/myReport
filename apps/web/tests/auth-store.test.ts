import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
};
const me = { get: vi.fn() };
const ensureRefresh = vi.fn();
const apiClient: ApiClient = { auth, me, ensureRefresh };
const scheduler: RefreshScheduler = {
  schedule: vi.fn(),
  cancel: vi.fn(),
};

vi.mock('../src/api/client.ts', () => ({
  useApiClient: () => apiClient,
  useRefreshScheduler: () => scheduler,
  resetApiClientForTests: () => {},
}));

const meResponse = {
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'alice@example.com',
    displayName: 'Alice',
    isSuperAdmin: false,
  },
  memberships: [],
  currentTenant: null,
};

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('bootstrap hydrates the store when the refresh cookie is valid', async () => {
    ensureRefresh.mockResolvedValueOnce('rotated-token');
    me.get.mockResolvedValueOnce(meResponse);
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();

    await store.bootstrap();

    expect(store.bootstrapped).toBe(true);
    expect(store.user?.email).toBe('alice@example.com');
    expect(ensureRefresh).toHaveBeenCalledOnce();
    expect(me.get).toHaveBeenCalledOnce();
  });

  it('bootstrap leaves the store empty when no session is present', async () => {
    ensureRefresh.mockRejectedValueOnce(new Error('no session'));
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();

    await store.bootstrap();

    expect(store.bootstrapped).toBe(true);
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(me.get).not.toHaveBeenCalled();
  });

  it('login arms the refresh scheduler with the new access token', async () => {
    auth.login.mockResolvedValueOnce({
      accessToken: 'fresh-token',
      user: meResponse.user,
      tenant: null,
    });
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();

    const ok = await store.login({ email: 'a@b.c', password: 'hunter2hunter2' });

    expect(ok).toBe(true);
    expect(scheduler.schedule).toHaveBeenCalledExactlyOnceWith('fresh-token');
  });

  it('logout cancels the scheduler and resets state', async () => {
    auth.logout.mockResolvedValueOnce(undefined);
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();
    store.user = meResponse.user;
    store.accessToken = 'whatever';

    await store.logout();

    expect(scheduler.cancel).toHaveBeenCalledOnce();
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
  });

  it('markSessionExpired bumps the tick so watchers can react', async () => {
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();
    const before = store.sessionExpiredTick;

    store.markSessionExpired(new Error('forced'));

    expect(store.sessionExpiredTick).toBe(before + 1);
  });
});
