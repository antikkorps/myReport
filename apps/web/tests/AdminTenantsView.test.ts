import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import AdminTenantsView from '../src/views/AdminTenantsView.vue';

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

vi.mock('../src/api/client.ts', () => {
  const auth = { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
  const me = { get: vi.fn() };
  const tenants = { create: vi.fn(), list: vi.fn() };
  const users = { list: vi.fn() };
  const memberships = { update: vi.fn(), remove: vi.fn() };
  const invitations = { create: vi.fn(), list: vi.fn(), revoke: vi.fn(), accept: vi.fn() };
  const templates = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const client: ApiClient = {
    auth,
    me,
    tenants,
    users,
    memberships,
    invitations,
    templates,
    ensureRefresh: vi.fn(),
  };
  const scheduler: RefreshScheduler = { schedule: vi.fn(), cancel: vi.fn() };
  return {
    useApiClient: () => client,
    useRefreshScheduler: () => scheduler,
    resetApiClientForTests: () => {},
  };
});

const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';

function makeRouter() {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/admin/tenants', name: 'admin-tenants', component: AdminTenantsView },
    { path: '/admin/users', name: 'admin-users', component: { template: '<div />' } },
    {
      path: '/admin/templates',
      name: 'admin-templates',
      component: { template: '<div />' },
    },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

async function setupSuperAdmin(): Promise<void> {
  setActivePinia(createPinia());
  const { useAuthStore } = await import('../src/stores/auth.ts');
  const store = useAuthStore();
  store.user = {
    id: '00000000-0000-0000-0000-0000000000ff',
    email: 'super@example.test',
    displayName: 'Super',
    isSuperAdmin: true,
  };
  store.currentTenant = null;
  store.accessToken = 'token';
}

describe('AdminTenantsView', () => {
  beforeEach(() => {
    resetApiClientForTests();
    vi.clearAllMocks();
  });

  it('navigates to /admin/templates with the tenantId when "Gérer les templates" is clicked', async () => {
    await setupSuperAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.tenants.list).mockResolvedValue({
      items: [
        {
          id: TENANT_ID,
          name: 'Acme',
          slug: 'acme',
          membershipCount: 1,
          createdAt: '2026-04-01T10:00:00.000Z',
        },
      ],
    });

    const router = makeRouter();
    await router.push('/admin/tenants');
    const wrapper = mount(AdminTenantsView, {
      global: { plugins: [router, PrimeVue, ToastService] },
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const pushSpy = vi.spyOn(router, 'push');
    await wrapper.get('[data-testid="manage-templates"]').trigger('click');

    expect(pushSpy).toHaveBeenCalledWith({
      name: 'admin-templates',
      query: { tenantId: TENANT_ID },
    });
  });
});
