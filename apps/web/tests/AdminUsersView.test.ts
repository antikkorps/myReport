import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { ApiError } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import AdminUsersView from '../src/views/AdminUsersView.vue';

// PrimeVue Select reads window.matchMedia for orientation breakpoints.
// jsdom omits it; stub a no-op MediaQueryList so the component mounts.
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

// Edge cases:
// - Listing renders both members and pending invitations.
// - Inviting calls invitations.create with the form payload.
// - Self-removal triggers the modal, then forceLocalLogout() and a
//   redirect to /login (the API has already revoked the session).
// - LAST_ADMIN error from the API surfaces as an inline message in the
//   removal modal and keeps the user logged in.

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
  const templates = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const templateVersions = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    archive: vi.fn(),
    promote: vi.fn(),
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
    templateVersions,
    ensureRefresh: vi.fn(),
  };
  const scheduler: RefreshScheduler = { schedule: vi.fn(), cancel: vi.fn() };
  return {
    useApiClient: () => client,
    useRefreshScheduler: () => scheduler,
    resetApiClientForTests: () => {},
  };
});

const SELF_ID = '00000000-0000-0000-0000-000000000001';
const SELF_MEMBERSHIP = '00000000-0000-0000-0000-000000000010';
const PEER_ID = '00000000-0000-0000-0000-000000000002';
const PEER_MEMBERSHIP = '00000000-0000-0000-0000-000000000020';
const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';

function selfMember() {
  return {
    id: SELF_ID,
    email: 'me@example.test',
    displayName: 'Me',
    membershipId: SELF_MEMBERSHIP,
    role: 'cabinet_admin' as const,
    joinedAt: '2026-04-29T12:00:00Z',
    lastLoginAt: null,
  };
}

function peerMember() {
  return {
    id: PEER_ID,
    email: 'peer@example.test',
    displayName: 'Peer',
    membershipId: PEER_MEMBERSHIP,
    role: 'auditor' as const,
    joinedAt: '2026-04-29T12:30:00Z',
    lastLoginAt: null,
  };
}

function makeRouter() {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: { template: '<div />' } },
    { path: '/admin/users', name: 'admin-users', component: AdminUsersView },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

async function setupStore(): Promise<void> {
  setActivePinia(createPinia());
  const { useAuthStore } = await import('../src/stores/auth.ts');
  const store = useAuthStore();
  store.user = {
    id: SELF_ID,
    email: 'me@example.test',
    displayName: 'Me',
    isSuperAdmin: false,
  };
  store.currentTenant = {
    id: TENANT_ID,
    name: 'Acme',
    slug: 'acme',
    role: 'cabinet_admin',
  };
  store.accessToken = 'token';
}

async function mountView(path = '/admin/users') {
  await setupStore();
  const router = makeRouter();
  await router.push(path);
  const wrapper = mount(AdminUsersView, {
    global: { plugins: [router, PrimeVue, ToastService] },
  });
  // Let onMounted's await refresh() resolve.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { wrapper, router };
}

async function setupSuperAdminStore(): Promise<void> {
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

async function mountSuperAdmin(path: string) {
  await setupSuperAdminStore();
  const router = makeRouter();
  await router.push(path);
  const wrapper = mount(AdminUsersView, {
    global: { plugins: [router, PrimeVue, ToastService] },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { wrapper, router };
}

describe('AdminUsersView', () => {
  beforeEach(() => {
    resetApiClientForTests();
    vi.clearAllMocks();
  });

  it('lists members and pending invitations on mount', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.users.list).mockResolvedValue({
      items: [selfMember(), peerMember()],
    });
    vi.mocked(client.invitations.list).mockResolvedValue({
      items: [
        {
          id: '00000000-0000-0000-0000-0000000000bb',
          email: 'pending@example.test',
          role: 'auditor',
          tenantId: TENANT_ID,
          status: 'pending',
          expiresAt: '2026-05-06T12:00:00Z',
          createdAt: '2026-04-29T12:00:00Z',
          consumedAt: null,
          revokedAt: null,
          invitedByEmail: 'me@example.test',
        },
      ],
    });

    const { wrapper } = await mountView();

    expect(client.users.list).toHaveBeenCalledOnce();
    expect(client.invitations.list).toHaveBeenCalledWith({ status: 'pending' });
    expect(wrapper.text()).toContain('Peer');
    expect(wrapper.text()).toContain('peer@example.test');
    expect(wrapper.text()).toContain('pending@example.test');
  });

  it('submits the invite form with the form payload', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.users.list).mockResolvedValue({ items: [selfMember()] });
    vi.mocked(client.invitations.list).mockResolvedValue({ items: [] });
    vi.mocked(client.invitations.create).mockResolvedValue({
      id: 'inv-1',
      email: 'new@example.test',
      role: 'auditor',
      tenantId: TENANT_ID,
      expiresAt: '2026-05-06T12:00:00Z',
      acceptUrl: 'http://localhost:5173/invitations/accept?token=x',
    });

    const { wrapper } = await mountView();
    await wrapper.find('[data-testid="invite-email"]').setValue('new@example.test');
    await wrapper.find('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));

    expect(client.invitations.create).toHaveBeenCalledWith({
      email: 'new@example.test',
      role: 'auditor',
    });
  });

  it('surfaces LAST_ADMIN inline when the API refuses self-removal', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.users.list).mockResolvedValue({ items: [selfMember()] });
    vi.mocked(client.invitations.list).mockResolvedValue({ items: [] });
    vi.mocked(client.memberships.remove).mockRejectedValue(
      new ApiError(409, {
        code: 'LAST_ADMIN',
        message: 'cannot remove the last active cabinet_admin',
      }),
    );

    const { wrapper, router } = await mountView();
    // Mimic the user clicking "Quitter le cabinet" on their own row.
    const vm = wrapper.vm as unknown as {
      onRemoveClick: (m: ReturnType<typeof selfMember>) => void;
      confirmRemove: () => Promise<void>;
    };
    vm.onRemoveClick(selfMember());
    await wrapper.vm.$nextTick();
    await vm.confirmRemove();
    await new Promise((r) => setTimeout(r, 0));

    expect(client.memberships.remove).toHaveBeenCalledWith(SELF_MEMBERSHIP);
    expect(router.currentRoute.value.name).toBe('admin-users');
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();
    expect(store.user).not.toBeNull();
    expect(store.accessToken).toBe('token');
  });

  it('on successful self-removal: forces local logout and redirects to /login', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.users.list).mockResolvedValue({
      items: [selfMember(), { ...peerMember(), role: 'cabinet_admin' }],
    });
    vi.mocked(client.invitations.list).mockResolvedValue({ items: [] });
    vi.mocked(client.memberships.remove).mockResolvedValue(undefined);

    const { wrapper, router } = await mountView();
    const vm = wrapper.vm as unknown as {
      onRemoveClick: (m: ReturnType<typeof selfMember>) => void;
      confirmRemove: () => Promise<void>;
    };
    vm.onRemoveClick(selfMember());
    await wrapper.vm.$nextTick();
    await vm.confirmRemove();
    await new Promise((r) => setTimeout(r, 0));

    expect(client.memberships.remove).toHaveBeenCalledWith(SELF_MEMBERSHIP);
    expect(router.currentRoute.value.name).toBe('login');
    const { useAuthStore } = await import('../src/stores/auth.ts');
    const store = useAuthStore();
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
  });

  // -------------------------------------------------------------------
  // Super-admin tenant-scoped flow (?tenantId=)
  // -------------------------------------------------------------------

  describe('super_admin', () => {
    it('without ?tenantId: shows the empty state and does not call the API', async () => {
      const { useApiClient } = await import('../src/api/client.ts');
      const client = useApiClient();

      const { wrapper } = await mountSuperAdmin('/admin/users');

      expect(client.users.list).not.toHaveBeenCalled();
      expect(client.invitations.list).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('Aucun cabinet sélectionné');
    });

    it('with ?tenantId: scopes list + invite to that tenant', async () => {
      const { useApiClient } = await import('../src/api/client.ts');
      const client = useApiClient();
      vi.mocked(client.tenants.list).mockResolvedValue({
        items: [
          {
            id: TENANT_ID,
            name: 'Acme',
            slug: 'acme',
            createdAt: '2026-04-29T12:00:00Z',
            membershipCount: 1,
          },
        ],
      });
      vi.mocked(client.users.list).mockResolvedValue({ items: [peerMember()] });
      vi.mocked(client.invitations.list).mockResolvedValue({ items: [] });
      vi.mocked(client.invitations.create).mockResolvedValue({
        id: 'inv-x',
        email: 'new@example.test',
        role: 'auditor',
        tenantId: TENANT_ID,
        expiresAt: '2026-05-06T12:00:00Z',
        acceptUrl: 'http://localhost:5173/invitations/accept?token=x',
      });

      const { wrapper } = await mountSuperAdmin(`/admin/users?tenantId=${TENANT_ID}`);

      expect(client.users.list).toHaveBeenCalledWith({ tenantId: TENANT_ID });
      expect(client.invitations.list).toHaveBeenCalledWith({
        status: 'pending',
        tenantId: TENANT_ID,
      });
      // The header reflects the scoped tenant.
      expect(wrapper.text()).toContain('Acme');

      await wrapper.find('[data-testid="invite-email"]').setValue('new@example.test');
      await wrapper.find('form').trigger('submit.prevent');
      await new Promise((r) => setTimeout(r, 0));

      expect(client.invitations.create).toHaveBeenCalledWith({
        email: 'new@example.test',
        role: 'auditor',
        tenantId: TENANT_ID,
      });
    });
  });
});
