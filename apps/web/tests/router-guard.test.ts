import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
const me = { get: vi.fn() };
const tenants = { create: vi.fn(), list: vi.fn() };
const users = { list: vi.fn() };
const memberships = { update: vi.fn(), remove: vi.fn() };
const invitations = { create: vi.fn(), list: vi.fn(), revoke: vi.fn(), accept: vi.fn() };
const apiClient: ApiClient = {
  auth,
  me,
  tenants,
  users,
  memberships,
  invitations,
  ensureRefresh: vi.fn(),
};
const scheduler: RefreshScheduler = { schedule: vi.fn(), cancel: vi.fn() };

vi.mock('../src/api/client.ts', () => ({
  useApiClient: () => apiClient,
  useRefreshScheduler: () => scheduler,
  resetApiClientForTests: () => {},
}));

// Edge cases:
// - unauth → /admin/tenants redirects to /login?redirect=...
// - authed cabinet_admin → /admin/tenants bounces home (no super_admin)
// - authed super_admin → /admin/tenants resolves to admin-tenants

async function bootstrapWith(
  state: 'guest' | 'cabinet' | 'super',
): Promise<typeof import('vue-router')> {
  setActivePinia(createPinia());
  const { useAuthStore } = await import('../src/stores/auth.ts');
  const store = useAuthStore();
  if (state !== 'guest') {
    store.user = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'u@example.com',
      displayName: 'U',
      isSuperAdmin: state === 'super',
    };
    store.accessToken = 'token';
  }
  return import('vue-router');
}

describe('router guard for /admin/tenants', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('redirects unauthenticated visitors to /login with the original path preserved', async () => {
    await bootstrapWith('guest');
    const { router } = await import('../src/router/index.ts');
    await router.push('/admin/tenants');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query['redirect']).toBe('/admin/tenants');
  });

  it('bounces authenticated non-super-admin to home', async () => {
    await bootstrapWith('cabinet');
    const { router } = await import('../src/router/index.ts');
    await router.push('/admin/tenants');
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('lets super_admin reach the admin tenants route', async () => {
    await bootstrapWith('super');
    const { router } = await import('../src/router/index.ts');
    await router.push('/admin/tenants');
    expect(router.currentRoute.value.name).toBe('admin-tenants');
  });
});
