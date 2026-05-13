import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import AppShell from '../src/components/AppShell.vue';
import { useAuthStore } from '../src/stores/auth.ts';

function makeRouter() {
  const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: { template: '<div />' } },
  ];
  return createRouter({ history: createMemoryHistory(), routes });
}

describe('AppShell', () => {
  it('renders the brand and the main slot', async () => {
    const router = makeRouter();
    await router.push('/');
    const wrapper = mount(AppShell, {
      slots: { default: '<p data-test="page">page content</p>' },
      global: { plugins: [router, createPinia(), PrimeVue] },
    });
    expect(wrapper.text()).toContain('myReport');
    expect(wrapper.find('[data-test="page"]').text()).toBe('page content');
  });

  it('toggles the mobile drawer when the hamburger is clicked', async () => {
    const router = makeRouter();
    await router.push('/');
    const wrapper = mount(AppShell, {
      global: { plugins: [router, createPinia(), PrimeVue] },
    });
    const toggle = wrapper.get('button[aria-expanded]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');
  });

  it('shows the Templates link for cabinet_admin', async () => {
    setActivePinia(createPinia());
    const store = useAuthStore();
    store.user = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@example.test',
      displayName: 'Admin',
      isSuperAdmin: false,
    };
    store.currentTenant = {
      id: '00000000-0000-0000-0000-0000000000aa',
      name: 'Acme',
      slug: 'acme',
      role: 'cabinet_admin',
    };
    store.accessToken = 'token';

    const router = makeRouter();
    await router.push('/');
    const wrapper = mount(AppShell, {
      global: { plugins: [router, PrimeVue] },
    });

    expect(wrapper.text()).toContain('Templates');
  });

  it('hides the Templates link for super_admin (drill in via /admin/tenants instead)', async () => {
    setActivePinia(createPinia());
    const store = useAuthStore();
    store.user = {
      id: '00000000-0000-0000-0000-0000000000ff',
      email: 'super@example.test',
      displayName: 'Super',
      isSuperAdmin: true,
    };
    store.currentTenant = null;
    store.accessToken = 'token';

    const router = makeRouter();
    await router.push('/');
    const wrapper = mount(AppShell, {
      global: { plugins: [router, PrimeVue] },
    });

    expect(wrapper.text()).not.toContain('Templates');
  });
});
