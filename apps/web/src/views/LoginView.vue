<script setup lang="ts">
import { ZLoginRequest } from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { computed, ref } from 'vue';

// Placeholder login screen — wires the shared-schemas Zod validator
// against the form payload but does not call the API yet. The real
// flow lands in the next backlog item ("Login + /me").
const email = ref('');
const password = ref('');
const submitted = ref(false);

const validation = computed(() => {
  const result = ZLoginRequest.safeParse({ email: email.value, password: password.value });
  return result.success ? null : (result.error.issues[0]?.message ?? 'Champ invalide');
});

const onSubmit = (): void => {
  submitted.value = true;
};
</script>

<template>
  <div class="flex justify-center">
    <Card class="w-full max-w-md">
      <template #title>Connexion</template>
      <template #content>
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <label class="flex flex-col gap-1">
            <span class="text-sm">Email</span>
            <InputText v-model="email" type="email" autocomplete="email" required />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm">Mot de passe</span>
            <Password
              v-model="password"
              :feedback="false"
              toggle-mask
              autocomplete="current-password"
              input-class="w-full"
              required
            />
          </label>
          <Message v-if="submitted && validation" severity="error" :closable="false">
            {{ validation }}
          </Message>
          <Button type="submit" label="Se connecter" :disabled="!email || !password" />
        </form>
      </template>
    </Card>
  </div>
</template>
