import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth.ts';

declare module 'vue-router' {
  interface RouteMeta {
    // True when the route requires an authenticated user. Public routes
    // (login, future landing) omit it.
    requiresAuth?: boolean;
    // True when the route is super_admin only (platform-ops UI).
    requiresSuperAdmin?: boolean;
    // True when the route requires admin-level access in the current
    // tenant (cabinet_admin) — super_admin always passes through.
    requiresAdmin?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
  },
  {
    path: '/admin/tenants',
    name: 'admin-tenants',
    component: () => import('../views/AdminTenantsView.vue'),
    meta: { requiresAuth: true, requiresSuperAdmin: true },
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('../views/AdminUsersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/admin/templates',
    name: 'admin-templates',
    component: () => import('../views/AdminTemplatesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/admin/templates/:id',
    name: 'admin-template-detail',
    component: () => import('../views/AdminTemplateDetailView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/admin/templates/:id/versions/:vid',
    name: 'admin-template-version',
    component: () => import('../views/AdminTemplateVersionView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    // Public — the visitor lands here from an email link before having
    // any session. The view materialises the session itself on success.
    path: '/invitations/accept',
    name: 'accept-invitation',
    component: () => import('../views/AcceptInvitationView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return {
      name: 'login',
      // Preserve the requested URL so post-login can land back there.
      query: { redirect: to.fullPath },
    };
  }
  if (to.meta.requiresSuperAdmin && !auth.user?.isSuperAdmin) {
    // Authenticated but not super_admin → bounce home rather than
    // login (they're already logged in, they just lack the role).
    return { name: 'home' };
  }
  if (to.meta.requiresAdmin) {
    const isAdmin =
      auth.user?.isSuperAdmin === true || auth.currentTenant?.role === 'cabinet_admin';
    if (!isAdmin) return { name: 'home' };
  }
  // Already-authenticated users hitting /login get bounced to home.
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'home' };
  }
  return true;
});
