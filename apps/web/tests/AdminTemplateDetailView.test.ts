import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { ApiError } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import AdminTemplateDetailView from '../src/views/AdminTemplateDetailView.vue';

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

// Edge cases (see plan PR 4b):
// - load happy path renders meta + versions
// - template 404 redirects to /admin/templates with toast
// - "Créer un brouillon" POSTs default schema and navigates to the version
// - promote moves the badge after refresh
// - archive on the current version flips the "archived current" warning
// - delete draft flow via the confirm dialog
// - super_admin back-nav preserves tenantId

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

const TPL_ID = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
const V1_ID = '550e8400-e29b-41d4-a716-446655440010';
const V2_ID = '550e8400-e29b-41d4-a716-446655440011';

function sampleTemplate(over: Partial<{ currentVersionId: string | null }> = {}) {
  return {
    id: TPL_ID,
    tenantId: TENANT_ID,
    name: 'Audit financier',
    slug: 'audit-financier',
    description: 'Modèle standard',
    currentVersionId: over.currentVersionId ?? null,
    createdAt: '2026-05-13T10:00:00.000Z',
    updatedAt: '2026-05-13T10:00:00.000Z',
  };
}

function sampleVersion(id: string, status: 'draft' | 'published' | 'archived', version: number) {
  return {
    id,
    templateId: TPL_ID,
    tenantId: TENANT_ID,
    version,
    status,
    schema: { version: 1, title: 'X', sections: [] },
    publishedAt: status === 'draft' ? null : '2026-05-13T11:00:00.000Z',
    publishedByUserId: status === 'draft' ? null : '00000000-0000-0000-0000-000000000001',
    createdAt: '2026-05-13T10:00:00.000Z',
    updatedAt: '2026-05-13T10:00:00.000Z',
  };
}

function makeRouter() {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/admin/templates', name: 'admin-templates', component: { template: '<div />' } },
    {
      path: '/admin/templates/:id',
      name: 'admin-template-detail',
      component: AdminTemplateDetailView,
    },
    {
      path: '/admin/templates/:id/versions/:vid',
      name: 'admin-template-version',
      component: { template: '<div />' },
    },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

async function setupCabinetAdmin(): Promise<void> {
  setActivePinia(createPinia());
  const { useAuthStore } = await import('../src/stores/auth.ts');
  const store = useAuthStore();
  store.user = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@example.test',
    displayName: 'Admin',
    isSuperAdmin: false,
  };
  store.currentTenant = { id: TENANT_ID, name: 'Acme', slug: 'acme', role: 'cabinet_admin' };
  store.accessToken = 'token';
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

async function mountAt(path = `/admin/templates/${TPL_ID}`) {
  const router = makeRouter();
  await router.push(path);
  const wrapper = mount(AdminTemplateDetailView, {
    global: { plugins: [router, PrimeVue, ToastService] },
  });
  // Flush async onMounted.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { wrapper, router };
}

describe('AdminTemplateDetailView', () => {
  beforeEach(() => {
    resetApiClientForTests();
    vi.clearAllMocks();
  });

  it('loads template + versions and renders the table', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.list).mockResolvedValue({
      items: [sampleVersion(V1_ID, 'draft', 1)],
    });

    const { wrapper } = await mountAt();

    expect(client.templates.get).toHaveBeenCalledWith(TPL_ID);
    expect(client.templateVersions.list).toHaveBeenCalledWith(TPL_ID);
    expect(wrapper.text()).toContain('Audit financier');
    expect(wrapper.text()).toContain('Brouillon');
  });

  it('redirects to /admin/templates with a toast when the template is missing', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockRejectedValue(
      new ApiError(404, { code: 'NOT_FOUND', message: 'template not found' }),
    );
    vi.mocked(client.templateVersions.list).mockResolvedValue({ items: [] });

    const { router } = await mountAt();

    expect(router.currentRoute.value.name).toBe('admin-templates');
  });

  it('creates a draft and navigates to the version edit route', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.list).mockResolvedValue({ items: [] });
    vi.mocked(client.templateVersions.create).mockResolvedValue(sampleVersion(V1_ID, 'draft', 1));

    const { wrapper, router } = await mountAt();
    await wrapper.get('[data-testid="create-draft"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templateVersions.create).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe('admin-template-version');
    expect(router.currentRoute.value.params['vid']).toBe(V1_ID);
  });

  it('promotes a published non-current version and refreshes the badge', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get)
      .mockResolvedValueOnce(sampleTemplate({ currentVersionId: V1_ID }))
      .mockResolvedValueOnce(sampleTemplate({ currentVersionId: V2_ID }));
    vi.mocked(client.templateVersions.list).mockResolvedValue({
      items: [sampleVersion(V1_ID, 'published', 1), sampleVersion(V2_ID, 'published', 2)],
    });
    vi.mocked(client.templateVersions.promote).mockResolvedValue(
      sampleVersion(V2_ID, 'published', 2),
    );

    const { wrapper } = await mountAt();
    await wrapper.get(`[data-testid="promote-version-${V2_ID}"]`).trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templateVersions.promote).toHaveBeenCalledWith(TPL_ID, V2_ID);
    expect(client.templates.get).toHaveBeenCalledTimes(2);
  });

  it('shows the archived-current warning when the pinned version is archived', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate({ currentVersionId: V1_ID }));
    vi.mocked(client.templateVersions.list).mockResolvedValue({
      items: [sampleVersion(V1_ID, 'archived', 1)],
    });

    const { wrapper } = await mountAt();

    expect(wrapper.find('[data-testid="current-archived-warning"]').exists()).toBe(true);
  });

  it('deletes a draft after the dialog confirm', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.list)
      .mockResolvedValueOnce({ items: [sampleVersion(V1_ID, 'draft', 1)] })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(client.templateVersions.remove).mockResolvedValue(undefined);

    const { wrapper } = await mountAt();
    await wrapper.get(`[data-testid="remove-version-${V1_ID}"]`).trigger('click');

    const confirmBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Supprimer' && b.closest('.p-dialog'),
    );
    if (!confirmBtn) throw new Error('expected confirm button in dialog');
    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templateVersions.remove).toHaveBeenCalledWith(TPL_ID, V1_ID);
  });

  it('super_admin back-nav preserves ?tenantId=', async () => {
    await setupSuperAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.list).mockResolvedValue({ items: [] });

    const { wrapper, router } = await mountAt();
    await wrapper.get('[data-testid="back-to-list"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(router.currentRoute.value.name).toBe('admin-templates');
    expect(router.currentRoute.value.query['tenantId']).toBe(TENANT_ID);
  });
});
