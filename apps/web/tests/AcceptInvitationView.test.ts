import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { ApiError } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import AcceptInvitationView from '../src/views/AcceptInvitationView.vue';

// Edge cases:
// - Missing ?token in the query renders the fatal error (no form).
// - Successful accept completes the auth store and navigates home.
// - Terminal API errors (404 / 410 / 409) hide the form and show a
//   "go to login" button instead of leaving the user submitting again.
// - Schema validation rejects the form before any API call.

vi.mock('../src/api/client.ts', () => {
  const auth = { login: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
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
    ensureRefresh: vi.fn(),
  };
  const scheduler: RefreshScheduler = { schedule: vi.fn(), cancel: vi.fn() };
  return {
    useApiClient: () => client,
    useRefreshScheduler: () => scheduler,
    resetApiClientForTests: () => {},
  };
});

function makeRouter(initialPath: string) {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: { template: '<div />' } },
    { path: '/invitations/accept', name: 'accept-invitation', component: AcceptInvitationView },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  return { router, initialPath };
}

async function mountAt(path: string) {
  const { router } = makeRouter(path);
  await router.push(path);
  return {
    wrapper: mount(AcceptInvitationView, {
      global: { plugins: [router, PrimeVue] },
    }),
    router,
  };
}

describe('AcceptInvitationView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetApiClientForTests();
    vi.clearAllMocks();
  });

  it('shows a fatal error when ?token is missing', async () => {
    const { wrapper } = await mountAt('/invitations/accept');
    await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.text()).toContain("Lien d'invitation invalide");
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('hydrates the auth store and navigates home on a successful accept', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.invitations.accept).mockResolvedValue({
      accessToken: 'access-xyz',
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'invitee@example.com',
        displayName: 'Invitee',
        isSuperAdmin: false,
      },
      tenant: {
        id: '00000000-0000-0000-0000-0000000000aa',
        name: 'Acme',
        slug: 'acme',
        role: 'auditor',
      },
    });

    const { wrapper, router } = await mountAt('/invitations/accept?token=abc123def');
    await wrapper.find('[data-testid="display-name"]').setValue('Invitee');
    await wrapper.find('[data-testid="password"] input').setValue('long-enough-password');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));

    expect(client.invitations.accept).toHaveBeenCalledWith('abc123def', {
      password: 'long-enough-password',
      displayName: 'Invitee',
    });
    expect(router.currentRoute.value.name).toBe('home');

    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();
    expect(store.user?.email).toBe('invitee@example.com');
    expect(store.accessToken).toBe('access-xyz');
    expect(store.currentTenant?.role).toBe('auditor');
  });

  it('hides the form and shows a fatal message on a terminal API error', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.invitations.accept).mockRejectedValue(
      new ApiError(410, { code: 'INVITATION_EXPIRED', message: 'expired' }),
    );

    const { wrapper } = await mountAt('/invitations/accept?token=stale');
    await wrapper.find('[data-testid="display-name"]').setValue('X');
    await wrapper.find('[data-testid="password"] input').setValue('long-enough-password');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.text()).toContain('expiré');
    // The fatal branch swaps the form for the "go to login" button.
    expect(wrapper.find('form').exists()).toBe(false);
  });
});
