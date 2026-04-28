<script setup lang="ts">
import { ZLoginRequest } from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.ts';

const email = ref('');
const password = ref('');
const submitted = ref(false);
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const validation = computed(() => {
  const result = ZLoginRequest.safeParse({ email: email.value, password: password.value });
  return result.success ? null : (result.error.issues[0]?.message ?? 'Champ invalide');
});

const onSubmit = async (): Promise<void> => {
  submitted.value = true;
  if (validation.value) return;
  const ok = await auth.login({ email: email.value, password: password.value });
  if (ok) {
    // The redirect query is set by the router guard so the user lands
    // back on the page they originally tried to reach.
    const redirect = typeof route.query['redirect'] === 'string' ? route.query['redirect'] : '/';
    await router.push(redirect);
  }
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
          <Message v-if="auth.error" severity="error" :closable="false">
            {{ auth.error }}
          </Message>
          <Button
            type="submit"
            label="Se connecter"
            :loading="auth.loading"
            :disabled="!email || !password || auth.loading"
          />
        </form>
      </template>
    </Card>
  </div>
</template>
