import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import LoginView from '../src/views/LoginView.vue';

vi.mock('../src/api/client.ts', () => {
  const auth = {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  const me = { get: vi.fn() };
  const tenants = { create: vi.fn(), list: vi.fn() };
  const users = { list: vi.fn() };
  const memberships = { update: vi.fn(), remove: vi.fn() };
  const invitations = {
    create: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn(),
    accept: vi.fn(),
  };
  const client: ApiClient = {
    auth,
    me,
    tenants,
    users,
    memberships,
    invitations,
    ensureRefresh: vi.fn().mockResolvedValue('token'),
  };
  const scheduler: RefreshScheduler = {
    schedule: vi.fn(),
    cancel: vi.fn(),
  };
  return {
    useApiClient: () => client,
    useRefreshScheduler: () => scheduler,
    resetApiClientForTests: () => {},
  };
});

function makeRouter() {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: LoginView },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetApiClientForTests();
  });

  it('calls auth.login and redirects to home on success', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.auth.login).mockResolvedValue({
      accessToken: 'token-abc',
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'alice@example.com',
        displayName: 'Alice',
        isSuperAdmin: false,
      },
      tenant: null,
    });

    const router = makeRouter();
    await router.push('/login');
    const wrapper = mount(LoginView, {
      global: { plugins: [router, PrimeVue] },
    });

    await wrapper.find('input[type="email"]').setValue('alice@example.com');
    await wrapper.find('input[type="password"]').setValue('hunter2hunter2');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.auth.login).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'hunter2hunter2',
    });
    expect(router.currentRoute.value.name).toBe('home');
  });
});
