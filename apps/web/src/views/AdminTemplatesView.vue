<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import {
  type CreateQuestionnaireTemplateRequest,
  type QuestionnaireTemplate,
  ZCreateQuestionnaireTemplateRequest,
} from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Textarea from 'primevue/textarea';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApiClient } from '../api/client.ts';
import { useAuthStore } from '../stores/auth.ts';

const client = useApiClient();
const toast = useToast();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// Same pattern as AdminUsersView: super_admin drills into a specific
// tenant via ?tenantId=, cabinet_admin's tenant comes from auth.
const tenantOverride = computed<string | null>(() => {
  if (auth.user?.isSuperAdmin !== true) return null;
  const raw = route.query['tenantId'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].length > 0) return raw[0];
  return null;
});

const tenantOverrideMissing = computed(
  () => auth.user?.isSuperAdmin === true && !tenantOverride.value,
);

const tenantHeader = ref<string | null>(null);

async function loadTenantHeader(): Promise<void> {
  if (!tenantOverride.value) {
    tenantHeader.value = null;
    return;
  }
  try {
    const list = await client.tenants.list();
    const match = list.items.find((t) => t.id === tenantOverride.value);
    tenantHeader.value = match ? match.name : null;
  } catch {
    tenantHeader.value = null;
  }
}

const templates = ref<QuestionnaireTemplate[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

function openTemplate(row: QuestionnaireTemplate): void {
  void router.push({ name: 'admin-template-detail', params: { id: row.id } });
}

async function refresh(): Promise<void> {
  if (tenantOverrideMissing.value) {
    templates.value = [];
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    const tenantId = tenantOverride.value ?? undefined;
    const response = await client.templates.list(tenantId ? { tenantId } : undefined);
    templates.value = response.items;
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadTenantHeader(), refresh()]);
});

// ---------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------

const name = ref('');
const slug = ref('');
const description = ref('');

// Auto-derive a slug from the name until the user touches the slug
// field; once touched we stop overwriting their edit.
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

const createSubmitted = ref(false);
const createSubmitting = ref(false);
const slugError = ref<string | null>(null);
const formError = ref<string | null>(null);

const createValidation = computed(() => {
  const payload: CreateQuestionnaireTemplateRequest = {
    name: name.value,
    slug: slug.value,
    ...(description.value.length > 0 ? { description: description.value } : {}),
  };
  const result = ZCreateQuestionnaireTemplateRequest.safeParse(payload);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Champ invalide');
});

async function onCreateSubmit(): Promise<void> {
  createSubmitted.value = true;
  slugError.value = null;
  formError.value = null;
  if (createValidation.value) return;
  createSubmitting.value = true;
  try {
    const tenantId = tenantOverride.value ?? undefined;
    const created = await client.templates.create({
      name: name.value,
      slug: slug.value,
      ...(description.value.length > 0 ? { description: description.value } : {}),
      ...(tenantId ? { tenantId } : {}),
    });
    toast.add({
      severity: 'success',
      summary: 'Template créé',
      detail: created.name,
      life: 3000,
    });
    name.value = '';
    slug.value = '';
    description.value = '';
    slugTouched.value = false;
    createSubmitted.value = false;
    await refresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === 'SLUG_TAKEN') {
      slugError.value = 'Ce slug est déjà utilisé.';
    } else if (err instanceof ApiError && err.code === 'TENANT_ID_REQUIRED') {
      formError.value = 'Sélectionnez un cabinet depuis « Cabinets » avant de créer un template.';
    } else if (err instanceof ApiError && err.code === 'TENANT_NOT_FOUND') {
      formError.value = "Ce cabinet n'existe plus.";
    } else {
      formError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
    }
  } finally {
    createSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------
// Edit dialog (PATCH name / description)
// ---------------------------------------------------------------------

interface EditDraft {
  id: string;
  name: string;
  description: string;
}
const editRequest = ref<EditDraft | null>(null);
const editSubmitting = ref(false);
const editError = ref<string | null>(null);

function onEditClick(row: QuestionnaireTemplate): void {
  editRequest.value = {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
  };
  editError.value = null;
}

function cancelEdit(): void {
  editRequest.value = null;
  editError.value = null;
}

async function confirmEdit(): Promise<void> {
  const draft = editRequest.value;
  if (!draft) return;
  editSubmitting.value = true;
  try {
    await client.templates.update(draft.id, {
      name: draft.name,
      description: draft.description,
    });
    toast.add({ severity: 'success', summary: 'Template mis à jour', life: 3000 });
    editRequest.value = null;
    await refresh();
  } catch (err) {
    editError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    editSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------
// Delete dialog (soft-delete)
// ---------------------------------------------------------------------

const removeRequest = ref<QuestionnaireTemplate | null>(null);
const removeSubmitting = ref(false);
const removeError = ref<string | null>(null);

function onRemoveClick(row: QuestionnaireTemplate): void {
  removeRequest.value = row;
  removeError.value = null;
}

function cancelRemove(): void {
  removeRequest.value = null;
  removeError.value = null;
}

async function confirmRemove(): Promise<void> {
  const target = removeRequest.value;
  if (!target) return;
  removeSubmitting.value = true;
  try {
    await client.templates.remove(target.id);
    toast.add({
      severity: 'success',
      summary: 'Template supprimé',
      detail: target.name,
      life: 3000,
    });
    removeRequest.value = null;
    await refresh();
  } catch (err) {
    removeError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    removeSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl sm:text-3xl font-semibold">
        {{ tenantHeader ? `Templates — ${tenantHeader}` : 'Templates de questionnaire' }}
      </h1>
      <p
        v-if="tenantOverride && !tenantHeader"
        class="text-sm text-surface-600 dark:text-surface-400"
      >
        Cabinet introuvable (peut-être supprimé). Retournez à la liste des cabinets.
      </p>
    </div>

    <Card v-if="tenantOverrideMissing">
      <template #title>Aucun cabinet sélectionné</template>
      <template #content>
        <p class="text-sm">
          En tant que super-administrateur vous devez d'abord choisir un cabinet pour gérer ses
          templates. Ouvrez la liste des cabinets et cliquez sur « Gérer les templates ».
        </p>
        <div class="mt-3">
          <Button
            label="Aller aux cabinets"
            icon="pi pi-arrow-right"
            outlined
            @click="router.push({ name: 'admin-tenants' })"
          />
        </div>
      </template>
    </Card>

    <Card v-if="!tenantOverrideMissing">
      <template #title>Créer un template</template>
      <template #content>
        <form class="flex flex-col gap-4" @submit.prevent="onCreateSubmit">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1">
              <span class="text-sm">Nom</span>
              <InputText
                v-model="name"
                required
                data-testid="template-name"
                @input="onNameInput"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-sm">Slug</span>
              <InputText
                v-model="slug"
                required
                data-testid="template-slug"
                @input="onSlugInput"
              />
              <Message v-if="slugError" severity="error" :closable="false">
                {{ slugError }}
              </Message>
            </label>
          </div>

          <label class="flex flex-col gap-1">
            <span class="text-sm">Description (optionnel)</span>
            <Textarea
              v-model="description"
              rows="2"
              data-testid="template-description"
              autocomplete="off"
            />
          </label>

          <Message
            v-if="createSubmitted && createValidation"
            severity="error"
            :closable="false"
          >
            {{ createValidation }}
          </Message>
          <Message v-if="formError" severity="error" :closable="false">
            {{ formError }}
          </Message>

          <Button
            type="submit"
            label="Créer le template"
            :loading="createSubmitting"
            :disabled="createSubmitting"
          />
        </form>
      </template>
    </Card>

    <Card v-if="!tenantOverrideMissing">
      <template #title>Templates existants</template>
      <template #content>
        <Message v-if="loadError" severity="error" :closable="false" class="mb-3">
          {{ loadError }} —
          <button type="button" class="underline" @click="refresh">Réessayer</button>
        </Message>
        <DataTable
          :value="templates"
          :loading="loading"
          responsive-layout="stack"
          breakpoint="640px"
          striped-rows
          data-testid="templates-table"
        >
          <Column field="name" header="Nom" />
          <Column field="slug" header="Slug" />
          <Column header="Version courante">
            <template #body="{ data }">
              <span v-if="data.currentVersionId" class="text-sm">
                {{ data.currentVersionId.slice(0, 8) }}…
              </span>
              <span v-else class="text-sm text-surface-500">—</span>
            </template>
          </Column>
          <Column header="Mis à jour le">
            <template #body="{ data }">
              {{ new Date(data.updatedAt).toLocaleString() }}
            </template>
          </Column>
          <Column header="Actions">
            <template #body="{ data }">
              <div class="flex flex-wrap gap-2">
                <Button
                  label="Ouvrir"
                  icon="pi pi-arrow-right"
                  size="small"
                  data-testid="open-template"
                  @click="openTemplate(data)"
                />
                <Button
                  label="Modifier"
                  icon="pi pi-pencil"
                  outlined
                  size="small"
                  data-testid="edit-template"
                  @click="onEditClick(data)"
                />
                <Button
                  label="Supprimer"
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  data-testid="remove-template"
                  @click="onRemoveClick(data)"
                />
              </div>
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <!-- Edit dialog -->
    <Dialog
      :visible="editRequest !== null"
      modal
      :closable="false"
      header="Modifier le template"
      :style="{ width: '32rem' }"
    >
      <div v-if="editRequest" class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-sm">Nom</span>
          <InputText v-model="editRequest.name" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm">Description</span>
          <Textarea v-model="editRequest.description" rows="3" />
        </label>
        <Message v-if="editError" severity="error" :closable="false">
          {{ editError }}
        </Message>
      </div>
      <template #footer>
        <Button label="Annuler" text :disabled="editSubmitting" @click="cancelEdit" />
        <Button
          label="Enregistrer"
          :loading="editSubmitting"
          :disabled="editSubmitting"
          @click="confirmEdit"
        />
      </template>
    </Dialog>

    <!-- Delete confirmation -->
    <Dialog
      :visible="removeRequest !== null"
      modal
      :closable="false"
      header="Supprimer ce template ?"
      :style="{ width: '28rem' }"
    >
      <p class="text-sm">
        <strong>{{ removeRequest?.name }}</strong> sera supprimé. Les versions associées (brouillons,
        publiées, archivées) resteront en base mais ne seront plus accessibles. L'opération est
        réversible côté super-administration ; le slug
        <code>{{ removeRequest?.slug }}</code> redevient utilisable pour un nouveau template.
      </p>
      <Message v-if="removeError" severity="error" :closable="false" class="mt-3">
        {{ removeError }}
      </Message>
      <template #footer>
        <Button label="Annuler" text :disabled="removeSubmitting" @click="cancelRemove" />
        <Button
          label="Supprimer"
          severity="danger"
          :loading="removeSubmitting"
          :disabled="removeSubmitting"
          @click="confirmRemove"
        />
      </template>
    </Dialog>
  </div>
</template>
