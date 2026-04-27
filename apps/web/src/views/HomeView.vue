<script setup lang="ts">
import Card from 'primevue/card';
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl">
    <h1 class="text-2xl sm:text-3xl font-semibold">Accueil</h1>
    <p class="text-surface-600 dark:text-surface-400">
      Squelette du front&nbsp;: Vue&nbsp;3 + Vite, PrimeVue Aura, Tailwind&nbsp;v4,
      vue-router, Pinia. Layout responsive (mobile-first 375&nbsp;px).
    </p>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card>
        <template #title>Auth</template>
        <template #content>
          Login + /me arrivent dans la prochaine étape (Phase 2 — login + /me).
        </template>
      </Card>
      <Card>
        <template #title>API</template>
        <template #content>
          Client API typé dérivé des schémas TypeBox de
          <code>@myreport/shared-schemas</code>.
        </template>
      </Card>
      <Card>
        <template #title>Mobile</template>
        <template #content>
          Chaque écran est validé en 375&nbsp;px avant merge.
        </template>
      </Card>
    </div>
  </div>
</template>
