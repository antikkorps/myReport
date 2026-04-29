<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import { ZAcceptInvitationRequest } from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApiClient } from '../api/client.ts';
import { useAuthStore } from '../stores/auth.ts';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const client = useApiClient();

// Token comes from the email link `?token=...`. Empty string means a
// stray visit to /invitations/accept without the query param — we
// surface a clear message rather than letting the form submit a
// nonsensical request.
const token = computed(() => {
  const raw = route.query['token'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return '';
});

const password = ref('');
const displayName = ref('');
const submitted = ref(false);
const submitting = ref(false);
const formError = ref<string | null>(null);
const fatalError = ref<string | null>(null);

const validation = computed(() => {
  const result = ZAcceptInvitationRequest.safeParse({
    password: password.value,
    displayName: displayName.value,
  });
  return result.success ? null : (result.error.issues[0]?.message ?? 'Champ invalide');
});

onMounted(() => {
  if (!token.value) {
    fatalError.value = "Lien d'invitation invalide. Vérifiez l'email reçu.";
  }
});

function mapError(err: ApiError): string {
  switch (err.code) {
    case 'INVITATION_NOT_FOUND':
      return "Ce lien d'invitation est invalide ou a déjà été supprimé.";
    case 'INVITATION_EXPIRED':
      return "Cette invitation a expiré. Demandez à l'administrateur de vous en envoyer une nouvelle.";
    case 'INVITATION_REVOKED':
      return "Cette invitation a été annulée par l'administrateur.";
    case 'INVITATION_ALREADY_USED':
      return 'Cette invitation a déjà été utilisée. Connectez-vous directement.';
    case 'EMAIL_TAKEN':
      return 'Un compte existe déjà pour cet email. Connectez-vous avec votre mot de passe habituel.';
    default:
      return err.message || 'Une erreur est survenue.';
  }
}

async function onSubmit(): Promise<void> {
  submitted.value = true;
  formError.value = null;
  if (!token.value) return;
  if (validation.value) return;
  submitting.value = true;
  try {
    const response = await client.invitations.accept(token.value, {
      password: password.value,
      displayName: displayName.value,
    });
    auth.completeAcceptedInvitation(response);
    await router.push({ name: 'home' });
  } catch (err) {
    if (err instanceof ApiError) {
      // 4xx codes (404 / 409 / 410) are terminal: re-submitting the
      // same form will fail again. Show the message in the fatal slot
      // and hide the form so the user goes to /login instead.
      const isTerminal = err.status === 404 || err.status === 409 || err.status === 410;
      if (isTerminal) {
        fatalError.value = mapError(err);
      } else {
        formError.value = mapError(err);
      }
    } else {
      formError.value = 'Erreur réseau. Réessayez.';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <Card class="w-full max-w-md">
      <template #title>Accepter l'invitation</template>
      <template #content>
        <div v-if="fatalError" class="flex flex-col gap-4">
          <Message severity="error" :closable="false">{{ fatalError }}</Message>
          <Button
            label="Aller à la connexion"
            outlined
            @click="router.push({ name: 'login' })"
          />
        </div>
        <form v-else class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Choisissez votre mot de passe et le nom affiché dans l'application. Le lien est valable
            une seule fois.
          </p>
          <label class="flex flex-col gap-1">
            <span class="text-sm">Nom affiché</span>
            <InputText
              v-model="displayName"
              autocomplete="name"
              required
              data-testid="display-name"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-sm">Mot de passe</span>
            <Password
              v-model="password"
              :feedback="true"
              toggle-mask
              autocomplete="new-password"
              input-class="w-full"
              required
              data-testid="password"
            />
            <span class="text-xs text-surface-500">8 caractères minimum.</span>
          </label>

          <Message v-if="submitted && validation" severity="error" :closable="false">
            {{ validation }}
          </Message>
          <Message v-if="formError" severity="error" :closable="false">
            {{ formError }}
          </Message>

          <Button
            type="submit"
            label="Activer mon compte"
            :loading="submitting"
            :disabled="submitting || !token"
          />
        </form>
      </template>
    </Card>
  </div>
</template>
