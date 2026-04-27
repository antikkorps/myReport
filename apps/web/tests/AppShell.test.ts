import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import AppShell from '../src/components/AppShell.vue';

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
});
