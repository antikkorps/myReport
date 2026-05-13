import type { ApiClient, RefreshScheduler } from '@myreport/api-client';
import { ApiError } from '@myreport/api-client';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { resetApiClientForTests } from '../src/api/client.ts';
import AdminTemplateVersionView from '../src/views/AdminTemplateVersionView.vue';

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
// - Loads template + version and seeds the textarea.
// - Published version → read-only banner + textarea disabled.
// - Version 404 redirects to detail with a toast.
// - JSON parse error blocks save.
// - Client-side validateQuestionnaireSchema rejection prevents API call.
// - SCHEMA_INVALID API response with issues[] populates the panel.
// - Race: 409 VERSION_NOT_DRAFT on save → reload + warn toast.
// - Lifecycle dialog confirm path (publish).

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
const V_ID = '550e8400-e29b-41d4-a716-446655440010';

function sampleTemplate(over: Partial<{ currentVersionId: string | null }> = {}) {
  return {
    id: TPL_ID,
    tenantId: TENANT_ID,
    name: 'Audit',
    slug: 'audit',
    description: null,
    currentVersionId: over.currentVersionId ?? null,
    createdAt: '2026-05-13T10:00:00.000Z',
    updatedAt: '2026-05-13T10:00:00.000Z',
  };
}

const validSchema = {
  version: 1,
  title: 'Sample',
  sections: [
    {
      kind: 'section',
      id: '11111111-1111-4111-8111-111111111111',
      label: 'S',
      questions: [{ kind: 'boolean', id: '22222222-2222-4222-8222-222222222222', label: 'q' }],
    },
  ],
};

function sampleVersion(status: 'draft' | 'published' | 'archived' = 'draft') {
  return {
    id: V_ID,
    templateId: TPL_ID,
    tenantId: TENANT_ID,
    version: 1,
    status,
    schema: validSchema,
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
      component: { template: '<div />' },
    },
    {
      path: '/admin/templates/:id/versions/:vid',
      name: 'admin-template-version',
      component: AdminTemplateVersionView,
    },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

async function setupAuth(): Promise<void> {
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

async function mountAt() {
  await setupAuth();
  const router = makeRouter();
  await router.push(`/admin/templates/${TPL_ID}/versions/${V_ID}`);
  const wrapper = mount(AdminTemplateVersionView, {
    global: { plugins: [router, PrimeVue, ToastService] },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { wrapper, router };
}

describe('AdminTemplateVersionView', () => {
  beforeEach(() => {
    resetApiClientForTests();
    vi.clearAllMocks();
  });

  it('loads template + version and seeds the textarea with the schema', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get).mockResolvedValue(sampleVersion('draft'));

    const { wrapper } = await mountAt();

    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="schema-textarea"]');
    expect(textarea.element.value).toContain('"title": "Sample"');
    expect(textarea.element.disabled).toBe(false);
  });

  it('renders a read-only banner and disables the textarea for a published version', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get).mockResolvedValue(sampleVersion('published'));

    const { wrapper } = await mountAt();

    expect(wrapper.find('[data-testid="readonly-banner"]').exists()).toBe(true);
    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="schema-textarea"]');
    expect(textarea.element.disabled).toBe(true);
    expect(wrapper.find('[data-testid="save-version"]').exists()).toBe(false);
  });

  it('redirects to the detail view when the version is not found', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get).mockRejectedValue(
      new ApiError(404, { code: 'NOT_FOUND', message: 'version not found' }),
    );

    const { router } = await mountAt();

    expect(router.currentRoute.value.name).toBe('admin-template-detail');
    expect(router.currentRoute.value.params['id']).toBe(TPL_ID);
  });

  it('shows a JSON parse error and blocks save when the textarea body is malformed', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get).mockResolvedValue(sampleVersion('draft'));

    const { wrapper } = await mountAt();

    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="schema-textarea"]');
    await textarea.setValue('{ "broken": ');
    await wrapper.get('[data-testid="save-version"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.find('[data-testid="parse-error"]').exists()).toBe(true);
    expect(client.templateVersions.update).not.toHaveBeenCalled();
  });

  it('runs client-side DSL validation before calling the API', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get).mockResolvedValue(sampleVersion('draft'));

    const { wrapper } = await mountAt();

    // Wrong literal for the DSL format version → SHAPE/version error.
    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="schema-textarea"]');
    await textarea.setValue(JSON.stringify({ version: 99, title: 'X', sections: [] }, null, 2));
    await wrapper.get('[data-testid="save-version"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.find('[data-testid="validation-issues"]').exists()).toBe(true);
    expect(client.templateVersions.update).not.toHaveBeenCalled();
  });

  it('renders API SCHEMA_INVALID issues in the side panel', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get).mockResolvedValue(sampleVersion('draft'));
    vi.mocked(client.templateVersions.update).mockRejectedValue(
      new ApiError(400, {
        code: 'SCHEMA_INVALID',
        message: 'questionnaire schema validation failed',
        details: {
          issues: [
            {
              path: 'sections[0].questions[0].id',
              code: 'DUPLICATE_ID',
              message: 'duplicate id',
            },
          ],
        },
      }),
    );

    const { wrapper } = await mountAt();

    // Submit the (locally valid) seeded payload — the API still rejects.
    await wrapper.get('[data-testid="schema-textarea"]').trigger('input');
    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="schema-textarea"]');
    // Force a one-character change so dirty=true and the save button activates.
    await textarea.setValue(`${textarea.element.value} `);
    // Restore valid JSON for client-side validation to pass through.
    await textarea.setValue(JSON.stringify(validSchema, null, 2) + '\n');
    await wrapper.get('[data-testid="save-version"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.find('[data-testid="validation-issues"]').text()).toContain('DUPLICATE_ID');
  });

  it('reloads and shows a warn toast when a save returns 409 VERSION_NOT_DRAFT', async () => {
    const { useApiClient } = await import('../src/api/client.ts');
    const client = useApiClient();
    vi.mocked(client.templates.get).mockResolvedValue(sampleTemplate());
    vi.mocked(client.templateVersions.get)
      .mockResolvedValueOnce(sampleVersion('draft'))
      .mockResolvedValueOnce(sampleVersion('published'));
    vi.mocked(client.templateVersions.update).mockRejectedValue(
      new ApiError(409, {
        code: 'VERSION_NOT_DRAFT',
        message: 'version is published',
      }),
    );

    const { wrapper } = await mountAt();
    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="schema-textarea"]');
    await textarea.setValue(JSON.stringify(validSchema, null, 2) + '\n');
    await wrapper.get('[data-testid="save-version"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // After the reload the version is now published and the read-only
    // banner shows up.
    expect(wrapper.find('[data-testid="readonly-banner"]').exists()).toBe(true);
  });
});
