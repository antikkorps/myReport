<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import {
  type CreateTenantResponse,
  type TenantListItem,
  ZCreateTenantRequest,
} from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useApiClient } from '../api/client.ts';

const client = useApiClient();
const toast = useToast();
const router = useRouter();

function manageMembers(tenantId: string): void {
  // Drill into a specific tenant's member list. The AdminUsersView
  // reads ?tenantId= and routes the API calls through the super_admin
  // path (withAdminTx), so super_admin can invite + manage members of
  // any cabinet without being a member themselves.
  void router.push({ name: 'admin-users', query: { tenantId } });
}

function manageTemplates(tenantId: string): void {
  // Same drill-in pattern, scoped to questionnaire templates.
  void router.push({ name: 'admin-templates', query: { tenantId } });
}

const name = ref('');
const slug = ref('');
const adminEmail = ref('');

// Auto-derive a slug from the name on every keystroke until the user
// touches the slug field; once they do we stop overwriting their edit.
const slugTouched = ref(false);
function onNameInput(): void {
  if (!slugTouched.value) {
    slug.value = toSlug(name.value);
  }
}
function onSlugInput(): void {
  slugTouched.value = true;
}
function toSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

const submitted = ref(false);
const submitting = ref(false);
const slugError = ref<string | null>(null);
const emailError = ref<string | null>(null);

// Last successful creation. Surfaced as a persistent panel rather than
// a transient toast so the super_admin has time to copy the invitation
// link (the dev console driver is the only one wired today; in prod
// the email goes out, but we still want a visible fallback).
const lastInvitation = ref<CreateTenantResponse | null>(null);

const validation = computed(() => {
  const result = ZCreateTenantRequest.safeParse({
    name: name.value,
    slug: slug.value,
    adminEmail: adminEmail.value,
  });
  return result.success ? null : (result.error.issues[0]?.message ?? 'Champ invalide');
});

const tenants = ref<TenantListItem[]>([]);
const listLoading = ref(false);

async function refresh(): Promise<void> {
  listLoading.value = true;
  try {
    const response = await client.tenants.list();
    tenants.value = response.items;
  } finally {
    listLoading.value = false;
  }
}

onMounted(refresh);

async function onSubmit(): Promise<void> {
  submitted.value = true;
  slugError.value = null;
  emailError.value = null;
  lastInvitation.value = null;
  if (validation.value) return;
  submitting.value = true;
  try {
    const created = await client.tenants.create({
      name: name.value,
      slug: slug.value,
      adminEmail: adminEmail.value,
    });
    lastInvitation.value = created;
    toast.add({
      severity: 'success',
      summary: 'Cabinet créé',
      detail: `${created.tenant.name} — invitation envoyée à ${created.invitation.email}`,
      life: 5000,
    });
    name.value = '';
    slug.value = '';
    slugTouched.value = false;
    adminEmail.value = '';
    submitted.value = false;
    await refresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      if (err.code === 'SLUG_TAKEN') {
        slugError.value = 'Ce slug est déjà utilisé.';
      } else if (err.code === 'EMAIL_TAKEN') {
        emailError.value = 'Cet email est déjà attaché à un compte existant.';
      }
    } else {
      toast.add({
        severity: 'error',
        summary: 'Erreur',
        detail: err instanceof ApiError ? err.message : 'Erreur réseau',
        life: 5000,
      });
    }
  } finally {
    submitting.value = false;
  }
}

async function copyInvitationUrl(): Promise<void> {
  const url = lastInvitation.value?.invitation.acceptUrl;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast.add({ severity: 'info', summary: 'Lien copié', life: 2000 });
  } catch {
    toast.add({ severity: 'warn', summary: 'Copie impossible', life: 3000 });
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl">
    <h1 class="text-2xl sm:text-3xl font-semibold">Administration — Cabinets</h1>

    <Card>
      <template #title>Créer un cabinet</template>
      <template #content>
        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm">Nom du cabinet</span>
              <InputText v-model="name" required @input="onNameInput" />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm">Slug</span>
              <InputText v-model="slug" required @input="onSlugInput" />
              <Message v-if="slugError" severity="error" :closable="false">
                {{ slugError }}
              </Message>
            </label>
          </div>

          <label class="flex flex-col gap-1">
            <span class="text-sm">Email du premier cabinet_admin</span>
            <InputText v-model="adminEmail" type="email" autocomplete="off" required />
            <Message v-if="emailError" severity="error" :closable="false">
              {{ emailError }}
            </Message>
            <span class="text-xs text-surface-600 dark:text-surface-400">
              Le cabinet_admin recevra une invitation par email pour choisir son mot de passe et son
              nom affiché.
            </span>
          </label>

          <Message v-if="submitted && validation" severity="error" :closable="false">
            {{ validation }}
          </Message>

          <Button
            type="submit"
            label="Créer le cabinet"
            :loading="submitting"
            :disabled="submitting"
          />
        </form>
      </template>
    </Card>

    <Card v-if="lastInvitation">
      <template #title>Invitation envoyée</template>
      <template #content>
        <div class="flex flex-col gap-3">
          <p class="text-sm">
            Cabinet <strong>{{ lastInvitation.tenant.name }}</strong> créé.
            Une invitation a été envoyée à
            <strong>{{ lastInvitation.invitation.email }}</strong>.
          </p>
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Lien d'acceptation (à transmettre directement si l'email n'arrive pas) :
          </p>
          <div class="flex flex-col sm:flex-row gap-2">
            <InputText
              :model-value="lastInvitation.invitation.acceptUrl"
              readonly
              class="flex-1"
            />
            <Button label="Copier" icon="pi pi-copy" outlined @click="copyInvitationUrl" />
          </div>
          <p class="text-xs text-surface-500">
            Expire le
            {{ new Date(lastInvitation.invitation.expiresAt).toLocaleString() }}.
          </p>
        </div>
      </template>
    </Card>

    <Card>
      <template #title>Cabinets existants</template>
      <template #content>
        <DataTable
          :value="tenants"
          :loading="listLoading"
          responsive-layout="stack"
          breakpoint="640px"
          striped-rows
        >
          <Column field="name" header="Nom" />
          <Column field="slug" header="Slug" />
          <Column field="membershipCount" header="Membres" />
          <Column field="createdAt" header="Créé le">
            <template #body="{ data }">
              {{ new Date(data.createdAt).toLocaleString() }}
            </template>
          </Column>
          <Column header="Actions">
            <template #body="{ data }">
              <div class="flex flex-wrap gap-2">
                <Button
                  label="Gérer les membres"
                  icon="pi pi-users"
                  outlined
                  size="small"
                  data-testid="manage-members"
                  @click="manageMembers(data.id)"
                />
                <Button
                  label="Gérer les templates"
                  icon="pi pi-file"
                  outlined
                  size="small"
                  data-testid="manage-templates"
                  @click="manageTemplates(data.id)"
                />
              </div>
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>
  </div>
</template>
