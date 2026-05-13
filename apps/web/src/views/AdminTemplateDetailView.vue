<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import type { QuestionnaireTemplate, QuestionnaireTemplateVersion } from '@myreport/shared-schemas';
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
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const templateId = computed(() => {
  const raw = route.params['id'];
  return typeof raw === 'string' ? raw : (raw?.[0] ?? '');
});

const template = ref<QuestionnaireTemplate | null>(null);
const versions = ref<QuestionnaireTemplateVersion[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

const currentVersion = computed(
  () => versions.value.find((v) => v.id === template.value?.currentVersionId) ?? null,
);

// When the pinned current_version_id points to a version that has
// been archived, the cabinet should promote a different published
// version (missions still reference this current). The banner makes
// the asymmetry visible until they act.
const currentIsArchived = computed(
  () => currentVersion.value !== null && currentVersion.value.status === 'archived',
);

async function load(): Promise<void> {
  if (!templateId.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    const [tpl, list] = await Promise.all([
      client.templates.get(templateId.value),
      client.templateVersions.list(templateId.value),
    ]);
    template.value = tpl;
    versions.value = list.items;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      toast.add({
        severity: 'error',
        summary: 'Template introuvable',
        detail: 'Il a peut-être été supprimé.',
        life: 4000,
      });
      await router.push({ name: 'admin-templates' });
      return;
    }
    loadError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function backToList(): void {
  // super_admin entered from /admin/templates?tenantId=<id>; preserve
  // the scope on the back button so they don't land on the empty
  // "pick a tenant" state. cabinet_admin lands on the bare path.
  if (auth.user?.isSuperAdmin && template.value) {
    void router.push({
      name: 'admin-templates',
      query: { tenantId: template.value.tenantId },
    });
  } else {
    void router.push({ name: 'admin-templates' });
  }
}

// ---------------------------------------------------------------------
// Metadata edit dialog (PATCH name / description)
// ---------------------------------------------------------------------

interface MetaDraft {
  name: string;
  description: string;
}
const metaDraft = ref<MetaDraft | null>(null);
const metaSubmitting = ref(false);
const metaError = ref<string | null>(null);

function onEditMeta(): void {
  if (!template.value) return;
  metaDraft.value = {
    name: template.value.name,
    description: template.value.description ?? '',
  };
  metaError.value = null;
}

function cancelMeta(): void {
  metaDraft.value = null;
  metaError.value = null;
}

async function confirmMeta(): Promise<void> {
  if (!metaDraft.value || !template.value) return;
  metaSubmitting.value = true;
  try {
    const updated = await client.templates.update(template.value.id, {
      name: metaDraft.value.name,
      description: metaDraft.value.description,
    });
    template.value = updated;
    toast.add({ severity: 'success', summary: 'Template mis à jour', life: 3000 });
    metaDraft.value = null;
  } catch (err) {
    metaError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    metaSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------
// Create a draft version
// ---------------------------------------------------------------------

const creatingDraft = ref(false);

function defaultSchema(name: string): Record<string, unknown> {
  // Minimal valid schema per the DSL (TSection.questions minItems:1,
  // sections minItems:1). The cabinet edits it right after creation.
  return {
    version: 1,
    title: name,
    sections: [
      {
        kind: 'section',
        id: crypto.randomUUID(),
        label: 'Section 1',
        questions: [{ kind: 'boolean', id: crypto.randomUUID(), label: 'Première question' }],
      },
    ],
  };
}

async function onCreateDraft(): Promise<void> {
  if (!template.value) return;
  creatingDraft.value = true;
  try {
    const created = await client.templateVersions.create(template.value.id, {
      schema: defaultSchema(template.value.name),
    });
    toast.add({
      severity: 'success',
      summary: 'Brouillon créé',
      detail: `Version ${created.version}`,
      life: 3000,
    });
    await router.push({
      name: 'admin-template-version',
      params: { id: template.value.id, vid: created.id },
    });
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 4000,
    });
  } finally {
    creatingDraft.value = false;
  }
}

// ---------------------------------------------------------------------
// Per-version row actions
// ---------------------------------------------------------------------

function openVersion(v: QuestionnaireTemplateVersion): void {
  if (!template.value) return;
  void router.push({
    name: 'admin-template-version',
    params: { id: template.value.id, vid: v.id },
  });
}

async function onPublish(v: QuestionnaireTemplateVersion): Promise<void> {
  if (!template.value) return;
  try {
    await client.templateVersions.publish(template.value.id, v.id);
    toast.add({ severity: 'success', summary: 'Version publiée', life: 3000 });
    await load();
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 4000,
    });
  }
}

async function onArchive(v: QuestionnaireTemplateVersion): Promise<void> {
  if (!template.value) return;
  try {
    await client.templateVersions.archive(template.value.id, v.id);
    toast.add({ severity: 'success', summary: 'Version archivée', life: 3000 });
    await load();
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 4000,
    });
  }
}

async function onPromote(v: QuestionnaireTemplateVersion): Promise<void> {
  if (!template.value) return;
  try {
    await client.templateVersions.promote(template.value.id, v.id);
    toast.add({ severity: 'success', summary: 'Version définie comme courante', life: 3000 });
    await load();
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 4000,
    });
  }
}

const removeRequest = ref<QuestionnaireTemplateVersion | null>(null);
const removeSubmitting = ref(false);
const removeError = ref<string | null>(null);

function onRemoveClick(v: QuestionnaireTemplateVersion): void {
  removeRequest.value = v;
  removeError.value = null;
}

function cancelRemove(): void {
  removeRequest.value = null;
  removeError.value = null;
}

async function confirmRemove(): Promise<void> {
  if (!removeRequest.value || !template.value) return;
  removeSubmitting.value = true;
  try {
    await client.templateVersions.remove(template.value.id, removeRequest.value.id);
    toast.add({ severity: 'success', summary: 'Brouillon supprimé', life: 3000 });
    removeRequest.value = null;
    await load();
  } catch (err) {
    removeError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    removeSubmitting.value = false;
  }
}

function statusLabel(s: 'draft' | 'published' | 'archived'): string {
  if (s === 'draft') return 'Brouillon';
  if (s === 'published') return 'Publiée';
  return 'Archivée';
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-5xl">
    <div class="flex items-center gap-3">
      <Button
        icon="pi pi-arrow-left"
        label="Retour"
        text
        size="small"
        data-testid="back-to-list"
        @click="backToList"
      />
    </div>

    <div v-if="loading && !template" class="text-sm text-surface-600 dark:text-surface-400">
      Chargement…
    </div>

    <Message v-if="loadError" severity="error" :closable="false">
      {{ loadError }}
    </Message>

    <Card v-if="template">
      <template #title>
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <span>{{ template.name }}</span>
          <span class="text-sm font-normal text-surface-600 dark:text-surface-400">
            <code>{{ template.slug }}</code>
          </span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-3">
          <p
            v-if="template.description"
            class="text-sm text-surface-700 dark:text-surface-300"
          >
            {{ template.description }}
          </p>
          <p v-else class="text-sm text-surface-500 italic">Aucune description.</p>
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <span class="text-surface-600 dark:text-surface-400">Version courante :</span>
            <span
              v-if="currentVersion"
              class="font-medium"
              data-testid="current-version-badge"
            >
              v{{ currentVersion.version }} ({{ statusLabel(currentVersion.status) }})
            </span>
            <span v-else class="text-surface-500 italic">Aucune publiée</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              label="Modifier les métadonnées"
              icon="pi pi-pencil"
              outlined
              size="small"
              data-testid="edit-meta"
              @click="onEditMeta"
            />
            <Button
              label="Créer un brouillon"
              icon="pi pi-plus"
              size="small"
              :loading="creatingDraft"
              :disabled="creatingDraft"
              data-testid="create-draft"
              @click="onCreateDraft"
            />
          </div>
          <Message
            v-if="currentIsArchived"
            severity="warn"
            :closable="false"
            data-testid="current-archived-warning"
          >
            La version courante est archivée. Promouvez une autre version publiée pour
            la remplacer.
          </Message>
        </div>
      </template>
    </Card>

    <Card v-if="template">
      <template #title>Versions</template>
      <template #content>
        <DataTable
          :value="versions"
          :loading="loading"
          responsive-layout="stack"
          breakpoint="640px"
          striped-rows
          data-testid="versions-table"
        >
          <Column header="Version">
            <template #body="{ data }">
              <span class="font-medium">v{{ data.version }}</span>
              <span
                v-if="template?.currentVersionId === data.id"
                class="ml-2 text-xs px-2 py-0.5 rounded bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100"
                data-testid="current-pin-badge"
              >
                Courante
              </span>
            </template>
          </Column>
          <Column header="Statut">
            <template #body="{ data }">
              {{ statusLabel(data.status) }}
            </template>
          </Column>
          <Column header="Publiée le">
            <template #body="{ data }">
              {{ data.publishedAt ? new Date(data.publishedAt).toLocaleString() : '—' }}
            </template>
          </Column>
          <Column header="Mise à jour le">
            <template #body="{ data }">
              {{ new Date(data.updatedAt).toLocaleString() }}
            </template>
          </Column>
          <Column header="Actions">
            <template #body="{ data }">
              <div class="flex flex-wrap gap-2">
                <Button
                  :label="data.status === 'draft' ? 'Éditer' : 'Voir'"
                  :icon="data.status === 'draft' ? 'pi pi-pencil' : 'pi pi-eye'"
                  outlined
                  size="small"
                  :data-testid="`open-version-${data.id}`"
                  @click="openVersion(data)"
                />
                <Button
                  v-if="data.status === 'draft'"
                  label="Publier"
                  icon="pi pi-check"
                  severity="success"
                  size="small"
                  :data-testid="`publish-version-${data.id}`"
                  @click="onPublish(data)"
                />
                <Button
                  v-if="data.status === 'published' && template?.currentVersionId !== data.id"
                  label="Définir comme courante"
                  icon="pi pi-star"
                  outlined
                  size="small"
                  :data-testid="`promote-version-${data.id}`"
                  @click="onPromote(data)"
                />
                <Button
                  v-if="data.status === 'published'"
                  label="Archiver"
                  icon="pi pi-box"
                  severity="secondary"
                  outlined
                  size="small"
                  :data-testid="`archive-version-${data.id}`"
                  @click="onArchive(data)"
                />
                <Button
                  v-if="data.status === 'draft'"
                  label="Supprimer"
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  :data-testid="`remove-version-${data.id}`"
                  @click="onRemoveClick(data)"
                />
              </div>
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <!-- Edit metadata dialog -->
    <Dialog
      :visible="metaDraft !== null"
      modal
      :closable="false"
      header="Modifier le template"
      :style="{ width: '32rem' }"
    >
      <div v-if="metaDraft" class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-sm">Nom</span>
          <InputText v-model="metaDraft.name" required />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm">Description</span>
          <Textarea v-model="metaDraft.description" rows="3" />
        </label>
        <Message v-if="metaError" severity="error" :closable="false">
          {{ metaError }}
        </Message>
      </div>
      <template #footer>
        <Button label="Annuler" text :disabled="metaSubmitting" @click="cancelMeta" />
        <Button
          label="Enregistrer"
          :loading="metaSubmitting"
          :disabled="metaSubmitting"
          @click="confirmMeta"
        />
      </template>
    </Dialog>

    <!-- Delete draft confirmation -->
    <Dialog
      :visible="removeRequest !== null"
      modal
      :closable="false"
      header="Supprimer ce brouillon ?"
      :style="{ width: '28rem' }"
    >
      <p class="text-sm">
        Le brouillon <strong>v{{ removeRequest?.version }}</strong> sera définitivement
        supprimé. Cette action est irréversible.
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
