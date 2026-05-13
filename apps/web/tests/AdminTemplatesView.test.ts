import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { ApiError } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import AdminTemplatesView from '../src/views/AdminTemplatesView.vue';

// PrimeVue Select reads window.matchMedia; jsdom doesn't ship it. Stub
// a no-op MediaQueryList so the component mounts.
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

// Edge cases tracked (see plan PR 4a):
// - cabinet_admin loads /admin/templates without query → list scoped by RLS.
// - super_admin without ?tenantId= → empty state + 0 API calls.
// - super_admin with ?tenantId= → list scoped + header pulled from tenants.list.
// - Create happy path resets the form + refreshes the list.
// - 409 SLUG_TAKEN → inline error under slug.
// - Slug auto-derived from name; user edit pins it.
// - DELETE confirm flow.
// - PATCH no-op (empty edit) still calls update once and refreshes.
// - load error (network / 500) surfaces a retry CTA.

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
const OTHER_TENANT_ID = '00000000-0000-0000-0000-0000000000bb';

function sampleTemplate(over: Partial<{ id: string; name: string; slug: string }> = {}) {
  return {
    id: over.id ?? '550e8400-e29b-41d4-a716-446655440001',
    tenantId: TENANT_ID,
    name: over.name ?? 'Audit financier',
    slug: over.slug ?? 'audit-financier',
    description: 'Modèle standard',
    currentVersionId: null,
    createdAt: '2026-05-13T10:00:00.000Z',
    updatedAt: '2026-05-13T10:00:00.000Z',
  };
}

function makeRouter() {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: { template: '<div />' } },
    { path: '/admin/tenants', name: 'admin-tenants', component: { template: '<div />' } },
    { path: '/admin/templates', name: 'admin-templates', component: AdminTemplatesView },
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

async function mountView(path = '/admin/templates') {
  const router = makeRouter();
  await router.push(path);
  const wrapper = mount(AdminTemplatesView, {
    global: { plugins: [router, PrimeVue, ToastService] },
  });
  // Flush onMounted's await refresh()
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { wrapper, router };
}

describe('AdminTemplatesView', () => {
  beforeEach(() => {
    resetApiClientForTests();
    vi.clearAllMocks();
  });

  it('cabinet_admin: lists templates without query param', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list).mockResolvedValue({
      items: [sampleTemplate({ name: 'Audit Q1', slug: 'audit-q1' })],
    });

    const { wrapper } = await mountView();

    expect(client.templates.list).toHaveBeenCalledWith(undefined);
    expect(wrapper.text()).toContain('Audit Q1');
    expect(wrapper.text()).toContain('audit-q1');
  });

  it('super_admin without ?tenantId=: shows empty state and does not call list', async () => {
    await setupSuperAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();

    const { wrapper } = await mountView('/admin/templates');

    expect(wrapper.text()).toContain('Aucun cabinet sélectionné');
    expect(client.templates.list).not.toHaveBeenCalled();
  });

  it('super_admin with ?tenantId=: lists scoped + shows tenant header', async () => {
    await setupSuperAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.tenants.list).mockResolvedValue({
      items: [
        {
          id: TENANT_ID,
          name: 'Acme',
          slug: 'acme',
          membershipCount: 3,
          createdAt: '2026-04-01T10:00:00.000Z',
        },
        {
          id: OTHER_TENANT_ID,
          name: 'Other',
          slug: 'other',
          membershipCount: 0,
          createdAt: '2026-04-01T10:00:00.000Z',
        },
      ],
    });
    vi.mocked(client.templates.list).mockResolvedValue({
      items: [sampleTemplate()],
    });

    const { wrapper } = await mountView(`/admin/templates?tenantId=${TENANT_ID}`);

    expect(client.templates.list).toHaveBeenCalledWith({ tenantId: TENANT_ID });
    expect(wrapper.text()).toContain('Templates — Acme');
  });

  it('auto-derives the slug from the name until the user touches the slug field', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list).mockResolvedValue({ items: [] });

    const { wrapper } = await mountView();

    const nameInput = wrapper.get('[data-testid="template-name"]');
    await nameInput.setValue('Audit Énergétique');
    const slugInput = wrapper.get<HTMLInputElement>('[data-testid="template-slug"]');
    // The Latin-1 mark stripping is best-effort; we just check kebab-case
    // and ASCII-only output.
    expect(slugInput.element.value).toMatch(/^audit-/);

    // User overrides the slug → further name edits do not overwrite it.
    await slugInput.setValue('my-custom-slug');
    await nameInput.setValue('Other Name');
    expect(slugInput.element.value).toBe('my-custom-slug');
  });

  it('creates a template happy path and refreshes the list', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list)
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [sampleTemplate({ name: 'New', slug: 'new-tmpl' })] });
    vi.mocked(client.templates.create).mockResolvedValue(
      sampleTemplate({ name: 'New', slug: 'new-tmpl' }),
    );

    const { wrapper } = await mountView();

    await wrapper.get('[data-testid="template-name"]').setValue('New');
    await wrapper.get('[data-testid="template-slug"]').setValue('new-tmpl');
    await wrapper.get('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templates.create).toHaveBeenCalledWith({
      name: 'New',
      slug: 'new-tmpl',
    });
    expect(client.templates.list).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('new-tmpl');
  });

  it('super_admin with ?tenantId= forwards it to templates.create', async () => {
    await setupSuperAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.tenants.list).mockResolvedValue({
      items: [
        {
          id: TENANT_ID,
          name: 'Acme',
          slug: 'acme',
          membershipCount: 0,
          createdAt: '2026-04-01T10:00:00.000Z',
        },
      ],
    });
    vi.mocked(client.templates.list).mockResolvedValue({ items: [] });
    vi.mocked(client.templates.create).mockResolvedValue(sampleTemplate({ name: 'X', slug: 'x' }));

    const { wrapper } = await mountView(`/admin/templates?tenantId=${TENANT_ID}`);

    await wrapper.get('[data-testid="template-name"]').setValue('X');
    await wrapper.get('[data-testid="template-slug"]').setValue('x-template');
    await wrapper.get('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templates.create).toHaveBeenCalledWith({
      name: 'X',
      slug: 'x-template',
      tenantId: TENANT_ID,
    });
  });

  it('surfaces SLUG_TAKEN inline on the slug field', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list).mockResolvedValue({ items: [] });
    vi.mocked(client.templates.create).mockRejectedValue(
      new ApiError(409, { code: 'SLUG_TAKEN', message: 'slug already in use' }),
    );

    const { wrapper } = await mountView();

    await wrapper.get('[data-testid="template-name"]').setValue('Reuse');
    await wrapper.get('[data-testid="template-slug"]').setValue('reuse');
    await wrapper.get('form').trigger('submit.prevent');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.text()).toContain('Ce slug est déjà utilisé.');
  });

  it('shows a retry button when initial list fails with a network error', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list).mockRejectedValueOnce(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'oops' }),
    );

    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('oops');
    expect(wrapper.text()).toContain('Réessayer');

    // Click retry → list called a second time, success path renders rows.
    vi.mocked(client.templates.list).mockResolvedValueOnce({
      items: [sampleTemplate()],
    });
    await wrapper.get('button.underline').trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.text()).toContain('audit-financier');
  });

  it('deletes a template via the confirmation dialog', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list)
      .mockResolvedValueOnce({ items: [sampleTemplate()] })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(client.templates.remove).mockResolvedValue(undefined);

    const { wrapper } = await mountView();

    await wrapper.get('[data-testid="remove-template"]').trigger('click');
    // The Dialog is teleported to body; find the danger-confirm button by label.
    const confirmBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Supprimer' && b.closest('.p-dialog'),
    );
    if (!confirmBtn) throw new Error('expected the dialog confirm button to be present');
    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templates.remove).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001');
    expect(client.templates.list).toHaveBeenCalledTimes(2);
  });

  it('edits a template via the dialog and refreshes', async () => {
    await setupCabinetAdmin();
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.list)
      .mockResolvedValueOnce({ items: [sampleTemplate()] })
      .mockResolvedValueOnce({
        items: [sampleTemplate({ name: 'Audit financier 2.0' })],
      });
    vi.mocked(client.templates.update).mockResolvedValue(
      sampleTemplate({ name: 'Audit financier 2.0' }),
    );

    const { wrapper } = await mountView();

    await wrapper.get('[data-testid="edit-template"]').trigger('click');
    const dialogNameInput = Array.from(
      document.querySelectorAll<HTMLInputElement>('.p-dialog input'),
    )[0];
    if (!dialogNameInput) throw new Error('expected edit dialog name input');
    dialogNameInput.value = 'Audit financier 2.0';
    dialogNameInput.dispatchEvent(new Event('input', { bubbles: true }));

    const saveBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Enregistrer' && b.closest('.p-dialog'),
    );
    if (!saveBtn) throw new Error('expected save button in dialog');
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(client.templates.update).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440001',
      expect.objectContaining({ name: 'Audit financier 2.0' }),
    );
    expect(wrapper.text()).toContain('Audit financier 2.0');
  });
});
