<script setup lang="ts">
import Button from 'primevue/button';
import { ref } from 'vue';
import { RouterLink } from 'vue-router';

// Mobile-first responsive shell. The drawer is visible at lg+; below
// that we collapse to a hamburger toggle so the 375px viewport remains
// usable per the project's mobile-first rule.
const drawerOpen = ref(false);
const toggleDrawer = (): void => {
  drawerOpen.value = !drawerOpen.value;
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
      class="lg:w-64 lg:min-h-screen border-r border-surface-200 dark:border-surface-800 lg:block"
      :class="drawerOpen ? 'block' : 'hidden'"
    >
      <div class="hidden lg:flex items-center px-6 py-4 border-b border-surface-200 dark:border-surface-800">
        <RouterLink to="/" class="font-semibold text-lg">myReport</RouterLink>
      </div>
      <nav class="flex flex-col p-4 gap-1">
        <RouterLink
          to="/"
          class="px-3 py-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
          @click="drawerOpen = false"
        >
          Accueil
        </RouterLink>
        <RouterLink
          to="/login"
          class="px-3 py-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
          @click="drawerOpen = false"
        >
          Connexion
        </RouterLink>
      </nav>
    </aside>

    <main class="flex-1 p-4 lg:p-8">
      <slot />
    </main>
  </div>
</template>
