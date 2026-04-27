<script setup lang="ts">
import Button from 'primevue/button';
</script>

<template>
  <div class="flex flex-col items-start gap-4">
    <h1 class="text-2xl font-semibold">Page introuvable</h1>
    <p class="text-surface-600 dark:text-surface-400">
      L'URL demandée ne correspond à aucune route enregistrée.
    </p>
    <RouterLink to="/" custom v-slot="{ navigate }">
      <Button label="Retour à l'accueil" icon="pi pi-home" @click="navigate" />
    </RouterLink>
  </div>
</template>
