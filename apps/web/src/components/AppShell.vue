<script setup lang="ts">
import Button from 'primevue/button';
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.ts';

// Mobile-first responsive shell. The drawer is visible at lg+; below
// that we collapse to a hamburger toggle so the 375px viewport remains
// usable per the project's mobile-first rule.
const drawerOpen = ref(false);
const toggleDrawer = (): void => {
  drawerOpen.value = !drawerOpen.value;
};

const auth = useAuthStore();
const router = useRouter();

// "Membres" is visible to cabinet_admin only — they manage their own
// tenant's members and the link points to /admin/users with no query
// params (their tenant comes from the auth context). super_admin
// reaches the same view *scoped to a specific tenant* via the "Gérer
// les membres" button on /admin/tenants, so a context-less sidebar
// link would be misleading for them.
const showMembersLink = computed(
  () => auth.user?.isSuperAdmin !== true && auth.currentTenant?.role === 'cabinet_admin',
);

const onLogout = async (): Promise<void> => {
  await auth.logout();
  await router.push({ name: 'login' });
};
</script>

<template>
  <div class="min-h-screen flex flex-col lg:flex-row">
    <!-- Top bar (visible below lg) -->
    <header
      class="lg:hidden flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800"
    >
      <RouterLink to="/" class="font-semibold text-lg">myReport</RouterLink>
      <Button
        :icon="drawerOpen ? 'pi pi-times' : 'pi pi-bars'"
        text
        severity="secondary"
        :aria-label="drawerOpen ? 'Fermer le menu' : 'Ouvrir le menu'"
        :aria-expanded="drawerOpen"
        @click="toggleDrawer"
      />
    </header>

    <!-- Side drawer (always visible at lg, slide-down on mobile when open) -->
    <aside
      class="lg:w-64 lg:min-h-screen border-r border-surface-200 dark:border-surface-800 lg:flex lg:flex-col"
      :class="drawerOpen ? 'flex flex-col' : 'hidden'"
    >
      <div
        class="hidden lg:flex items-center px-6 py-4 border-b border-surface-200 dark:border-surface-800"
      >
        <RouterLink to="/" class="font-semibold text-lg">myReport</RouterLink>
      </div>
      <nav class="flex flex-col p-4 gap-1 flex-1">
        <RouterLink
          v-if="auth.isAuthenticated"
          to="/"
          class="px-3 py-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
          @click="drawerOpen = false"
        >
          Accueil
        </RouterLink>
        <RouterLink
          v-if="auth.user?.isSuperAdmin"
          to="/admin/tenants"
          class="px-3 py-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
          @click="drawerOpen = false"
        >
          Cabinets
        </RouterLink>
        <RouterLink
          v-if="showMembersLink"
          to="/admin/users"
          class="px-3 py-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
          @click="drawerOpen = false"
        >
          Membres
        </RouterLink>
        <RouterLink
          v-if="!auth.isAuthenticated"
          to="/login"
          class="px-3 py-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
          @click="drawerOpen = false"
        >
          Connexion
        </RouterLink>
      </nav>
      <div
        v-if="auth.isAuthenticated"
        class="p-4 border-t border-surface-200 dark:border-surface-800 flex flex-col gap-2"
      >
        <span class="text-sm text-surface-600 dark:text-surface-400 truncate">
          {{ auth.user?.displayName }}
        </span>
        <Button
          label="Se déconnecter"
          icon="pi pi-sign-out"
          severity="secondary"
          text
          @click="onLogout"
        />
      </div>
    </aside>

    <main class="flex-1 p-4 lg:p-8">
      <slot />
    </main>
  </div>
</template>
