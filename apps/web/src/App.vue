<script setup lang="ts">
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { watch } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from './components/AppShell.vue';
import { useAuthStore } from './stores/auth.ts';

const auth = useAuthStore();
const toast = useToast();
const router = useRouter();

// Surface session-expiry to the user with a toast and bounce them to
// /login keeping the current URL so they land back after re-auth.
watch(
  () => auth.sessionExpiredTick,
  (tick, prev) => {
    if (tick === prev) return;
    toast.add({
      severity: 'warn',
      summary: 'Session expirée',
      detail: 'Veuillez vous reconnecter.',
      life: 5000,
    });
    const current = router.currentRoute.value;
    void router.push({
      name: 'login',
      query: current.fullPath !== '/login' ? { redirect: current.fullPath } : {},
    });
  },
);
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <Toast position="top-right" />
</template>
