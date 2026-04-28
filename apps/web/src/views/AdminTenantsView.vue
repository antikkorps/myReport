<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import { type TenantListItem, ZCreateTenantRequest } from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useApiClient } from '../api/client.ts';

const client = useApiClient();
const toast = useToast();

const name = ref('');
const slug = ref('');
const adminEmail = ref('');
const adminDisplayName = ref('');
const adminPassword = ref('');

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

const validation = computed(() => {
  const result = ZCreateTenantRequest.safeParse({
    name: name.value,
    slug: slug.value,
    firstAdmin: {
      email: adminEmail.value,
      displayName: adminDisplayName.value,
      password: adminPassword.value,
    },
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
  if (validation.value) return;
  submitting.value = true;
  try {
    const created = await client.tenants.create({
      name: name.value,
      slug: slug.value,
      firstAdmin: {
        email: adminEmail.value,
        displayName: adminDisplayName.value,
        password: adminPassword.value,
      },
    });
    toast.add({
      severity: 'success',
      summary: 'Cabinet créé',
      detail: `${created.tenant.name} (${created.tenant.slug}) — admin : ${created.firstAdmin.email}`,
      life: 5000,
    });
    name.value = '';
    slug.value = '';
    slugTouched.value = false;
    adminEmail.value = '';
    adminDisplayName.value = '';
    adminPassword.value = '';
    submitted.value = false;
    await refresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      if (err.code === 'SLUG_TAKEN') {
        slugError.value = 'Ce slug est déjà utilisé.';
      } else if (err.code === 'EMAIL_TAKEN') {
        emailError.value = 'Cet email est déjà utilisé.';
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

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm">Email du premier cabinet_admin</span>
              <InputText v-model="adminEmail" type="email" autocomplete="off" required />
              <Message v-if="emailError" severity="error" :closable="false">
                {{ emailError }}
              </Message>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm">Nom affiché</span>
              <InputText v-model="adminDisplayName" required />
            </label>
          </div>

          <label class="flex flex-col gap-1">
            <span class="text-sm">Mot de passe initial</span>
            <Password
              v-model="adminPassword"
              :feedback="false"
              toggle-mask
              autocomplete="new-password"
              input-class="w-full"
              required
            />
            <span class="text-xs text-surface-600 dark:text-surface-400">
              À transmettre hors-bande au cabinet_admin. L'invitation par email arrive avec la story
              « Gestion users ».
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
        </DataTable>
      </template>
    </Card>
  </div>
</template>
