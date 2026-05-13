<script setup lang="ts">
import { ApiError } from '@myreport/api-client';
import { toJsonSchema, validateQuestionnaireSchema } from '@myreport/questionnaire-schema';
import type { QuestionnaireTemplate, QuestionnaireTemplateVersion } from '@myreport/shared-schemas';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { useApiClient } from '../api/client.ts';
import MonacoJsonEditor from '../components/MonacoJsonEditor.vue';

const client = useApiClient();
const toast = useToast();
const router = useRouter();
const route = useRoute();

const templateId = computed(() => {
  const raw = route.params['id'];
  return typeof raw === 'string' ? raw : (raw?.[0] ?? '');
});

const versionId = computed(() => {
  const raw = route.params['vid'];
  return typeof raw === 'string' ? raw : (raw?.[0] ?? '');
});

const template = ref<QuestionnaireTemplate | null>(null);
const version = ref<QuestionnaireTemplateVersion | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

// The textarea buffer is the source of truth for the editor; we
// re-serialise the version's schema into it on load and re-serialise
// on every save success. PR 4c will swap this textarea for Monaco
// without changing the buffer plumbing.
const buffer = ref('');
const initialBuffer = ref('');
const dirty = computed(() => buffer.value !== initialBuffer.value);

interface IssueDisplay {
  path: string;
  code: string;
  message: string;
}
const parseError = ref<string | null>(null);
const validationIssues = ref<IssueDisplay[]>([]);

const isReadOnly = computed(() => version.value?.status !== 'draft');

async function load(): Promise<void> {
  if (!templateId.value || !versionId.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    const [tpl, v] = await Promise.all([
      client.templates.get(templateId.value),
      client.templateVersions.get(templateId.value, versionId.value),
    ]);
    template.value = tpl;
    version.value = v;
    const serialised = JSON.stringify(v.schema, null, 2);
    buffer.value = serialised;
    initialBuffer.value = serialised;
    parseError.value = null;
    validationIssues.value = [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      toast.add({
        severity: 'error',
        summary: 'Version introuvable',
        life: 4000,
      });
      await router.push({
        name: 'admin-template-detail',
        params: { id: templateId.value },
      });
      return;
    }
    loadError.value = err instanceof ApiError ? err.message : 'Erreur réseau';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function backToDetail(): void {
  void router.push({
    name: 'admin-template-detail',
    params: { id: templateId.value },
  });
}

// ---------------------------------------------------------------------
// Save (PATCH drafts)
// ---------------------------------------------------------------------

const saving = ref(false);

function parseBuffer(): Record<string, unknown> | null {
  parseError.value = null;
  try {
    const parsed = JSON.parse(buffer.value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      parseError.value = 'Le JSON doit représenter un objet à la racine.';
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : 'JSON invalide';
    return null;
  }
}

async function onSave(): Promise<void> {
  if (!template.value || !version.value || isReadOnly.value) return;
  const parsed = parseBuffer();
  if (!parsed) return;

  // Client-side validation gives instant feedback. The API runs the
  // same validator authoritatively; if a drift emerges we still
  // surface the API's issues identically since the shape matches.
  const dslResult = validateQuestionnaireSchema(parsed);
  if (!dslResult.ok) {
    validationIssues.value = dslResult.issues;
    return;
  }
  validationIssues.value = [];

  saving.value = true;
  try {
    const updated = await client.templateVersions.update(template.value.id, version.value.id, {
      schema: parsed,
      expectedUpdatedAt: version.value.updatedAt,
    });
    version.value = updated;
    const reserialised = JSON.stringify(updated.schema, null, 2);
    buffer.value = reserialised;
    initialBuffer.value = reserialised;
    toast.add({ severity: 'success', summary: 'Version enregistrée', life: 3000 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 400 && err.code === 'SCHEMA_INVALID') {
      // The client merges SCHEMA_INVALID's top-level `issues` array
      // into `details` (see ZErrorResponse extras logic). Cast through
      // unknown to honour the strict typing of `details` while still
      // surfacing the issues to the side panel.
      const rawIssues = (err.details?.['issues'] ?? []) as unknown;
      validationIssues.value = Array.isArray(rawIssues) ? (rawIssues as IssueDisplay[]) : [];
    } else if (err instanceof ApiError && err.code === 'VERSION_NOT_DRAFT') {
      // Someone else just published this version; reload to reflect
      // the new read-only state and drop the in-flight edit.
      toast.add({
        severity: 'warn',
        summary: 'Version verrouillée',
        detail: 'Cette version a été publiée par ailleurs ; les modifications sont perdues.',
        life: 5000,
      });
      await load();
    } else if (err instanceof ApiError && err.code === 'STALE_VERSION') {
      // Two tabs edited the same draft. Surface the server-side state
      // in a Dialog so the user picks between reloading (discard local
      // edits) and keeping the local buffer (they can manually copy
      // their work before forcing a reload).
      const currentUpdatedAt = err.details?.['currentUpdatedAt'];
      const currentSchema = err.details?.['currentSchema'];
      if (
        typeof currentUpdatedAt === 'string' &&
        typeof currentSchema === 'object' &&
        currentSchema !== null &&
        !Array.isArray(currentSchema)
      ) {
        staleConflict.value = {
          currentUpdatedAt,
          currentSchema: currentSchema as Record<string, unknown>,
        };
      }
    } else {
      toast.add({
        severity: 'error',
        summary: 'Erreur',
        detail: err instanceof ApiError ? err.message : 'Erreur réseau',
        life: 4000,
      });
    }
  } finally {
    saving.value = false;
  }
}

// ---------------------------------------------------------------------
// Stale version conflict (optimistic-lock 409)
// ---------------------------------------------------------------------

const staleConflict = ref<{
  currentUpdatedAt: string;
  currentSchema: Record<string, unknown>;
} | null>(null);

function reloadStale(): void {
  if (!staleConflict.value || !version.value) return;
  const reserialised = JSON.stringify(staleConflict.value.currentSchema, null, 2);
  version.value = {
    ...version.value,
    schema: staleConflict.value.currentSchema,
    updatedAt: staleConflict.value.currentUpdatedAt,
  };
  buffer.value = reserialised;
  initialBuffer.value = reserialised;
  validationIssues.value = [];
  staleConflict.value = null;
  toast.add({
    severity: 'info',
    summary: 'Version rechargée',
    life: 3000,
  });
}

function dismissStale(): void {
  staleConflict.value = null;
}

// ---------------------------------------------------------------------
// Publish / archive / promote (with confirm dialog)
// ---------------------------------------------------------------------

type LifecycleAction = 'publish' | 'archive' | 'promote';
const lifecycleAction = ref<LifecycleAction | null>(null);
const lifecycleSubmitting = ref(false);

function openLifecycle(action: LifecycleAction): void {
  lifecycleAction.value = action;
}
function cancelLifecycle(): void {
  lifecycleAction.value = null;
}

async function confirmLifecycle(): Promise<void> {
  if (!template.value || !version.value || !lifecycleAction.value) return;
  lifecycleSubmitting.value = true;
  const action = lifecycleAction.value;
  try {
    const updated = await client.templateVersions[action](template.value.id, version.value.id);
    version.value = updated;
    // Promote leaves the version unchanged (status stays "published");
    // we still re-fetch the template so its currentVersionId reflects
    // the new pin in the UI.
    if (action === 'promote') {
      const tpl = await client.templates.get(template.value.id);
      template.value = tpl;
    }
    toast.add({
      severity: 'success',
      summary:
        action === 'publish'
          ? 'Version publiée'
          : action === 'archive'
            ? 'Version archivée'
            : 'Version définie comme courante',
      life: 3000,
    });
    lifecycleAction.value = null;
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Erreur',
      detail: err instanceof ApiError ? err.message : 'Erreur réseau',
      life: 4000,
    });
  } finally {
    lifecycleSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------
// Unsaved-edit guards (beforeunload + route leave)
// ---------------------------------------------------------------------

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (dirty.value) {
    e.preventDefault();
    // The string is ignored by modern browsers but required for the
    // event to fire the native confirm.
    e.returnValue = '';
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
});

onBeforeRouteLeave((_, _from, next) => {
  if (!dirty.value) return next();
  const confirmed = window.confirm(
    'Des modifications non enregistrées seront perdues. Quitter quand même ?',
  );
  next(confirmed);
});

const isCurrent = computed(
  () => template.value !== null && template.value.currentVersionId === version.value?.id,
);

function statusBannerSeverity(): 'info' | 'warn' {
  if (version.value?.status === 'archived') return 'warn';
  return 'info';
}

// Generated once: the JSON Schema is derived from the static TypeBox
// DSL and doesn't depend on any runtime input.
const monacoJsonSchema = toJsonSchema();
const editorRef = ref<{ formatDocument(): void } | null>(null);

function onFormat(): void {
  editorRef.value?.formatDocument();
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-6xl">
    <div class="flex items-center gap-3">
      <Button
        icon="pi pi-arrow-left"
        label="Retour au template"
        text
        size="small"
        data-testid="back-to-detail"
        @click="backToDetail"
      />
    </div>

    <div v-if="loading && !version" class="text-sm text-surface-600 dark:text-surface-400">
      Chargement…
    </div>

    <Message v-if="loadError" severity="error" :closable="false">
      {{ loadError }}
    </Message>

    <Card v-if="template && version">
      <template #title>
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <span>
            {{ template.name }} — Version {{ version.version }}
          </span>
          <span class="text-sm font-normal">
            Statut :
            <strong>
              {{
                version.status === 'draft'
                  ? 'Brouillon'
                  : version.status === 'published'
                    ? 'Publiée'
                    : 'Archivée'
              }}
            </strong>
            <span v-if="isCurrent" class="ml-2 text-xs px-2 py-0.5 rounded bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100">
              Courante
            </span>
          </span>
        </div>
      </template>
      <template #content>
        <div class="flex flex-col gap-3">
          <Message
            v-if="version.status === 'published'"
            severity="info"
            :closable="false"
            data-testid="readonly-banner"
          >
            Cette version est publiée et immuable. Pour la modifier, créez un nouveau
            brouillon depuis l'écran du template.
          </Message>
          <Message
            v-else-if="version.status === 'archived'"
            severity="warn"
            :closable="false"
            data-testid="readonly-banner"
          >
            Cette version est archivée et ne peut plus être modifiée.
          </Message>

          <div class="flex flex-wrap gap-2">
            <Button
              v-if="version.status === 'draft'"
              label="Enregistrer"
              icon="pi pi-save"
              :loading="saving"
              :disabled="saving || !dirty"
              data-testid="save-version"
              @click="onSave"
            />
            <Button
              v-if="version.status === 'draft'"
              label="Publier"
              icon="pi pi-check"
              severity="success"
              :disabled="dirty"
              data-testid="publish-version"
              @click="openLifecycle('publish')"
            />
            <Button
              v-if="version.status === 'published' && !isCurrent"
              label="Définir comme courante"
              icon="pi pi-star"
              outlined
              data-testid="promote-version"
              @click="openLifecycle('promote')"
            />
            <Button
              v-if="version.status === 'published'"
              label="Archiver"
              icon="pi pi-box"
              severity="secondary"
              outlined
              data-testid="archive-version"
              @click="openLifecycle('archive')"
            />
            <Button
              v-if="version.status === 'draft'"
              label="Formater"
              icon="pi pi-align-left"
              outlined
              size="small"
              data-testid="format-version"
              @click="onFormat"
            />
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-sm text-surface-600 dark:text-surface-400">
              Schéma JSON
              <span v-if="dirty" class="text-xs italic">
                · Modifications non enregistrées
              </span>
            </span>
            <MonacoJsonEditor
              ref="editorRef"
              v-model="buffer"
              :read-only="isReadOnly"
              :schema="monacoJsonSchema"
              @save="onSave"
            />
          </div>

          <Message
            v-if="parseError"
            severity="error"
            :closable="false"
            data-testid="parse-error"
          >
            JSON invalide : {{ parseError }}
          </Message>

          <div
            v-if="validationIssues.length > 0"
            class="flex flex-col gap-2"
            data-testid="validation-issues"
          >
            <h3 class="text-sm font-medium">Erreurs de validation</h3>
            <ul class="flex flex-col gap-2">
              <li
                v-for="(issue, i) in validationIssues"
                :key="`${issue.code}-${issue.path}-${i}`"
                class="border-l-4 border-red-500 pl-3 py-1 text-sm"
              >
                <div class="font-mono text-xs text-surface-600 dark:text-surface-400">
                  {{ issue.path || '(racine)' }}
                </div>
                <div>
                  <span
                    class="text-xs uppercase mr-2 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900"
                  >
                    {{ issue.code }}
                  </span>
                  {{ issue.message }}
                </div>
              </li>
            </ul>
          </div>
        </div>
      </template>
    </Card>

    <!-- Lifecycle confirmation dialog -->
    <Dialog
      :visible="lifecycleAction !== null"
      modal
      :closable="false"
      :header="
        lifecycleAction === 'publish'
          ? 'Publier cette version ?'
          : lifecycleAction === 'archive'
            ? 'Archiver cette version ?'
            : 'Définir comme version courante ?'
      "
      :style="{ width: '28rem' }"
    >
      <p v-if="lifecycleAction === 'publish'" class="text-sm">
        Publier rendra cette version immuable et utilisable par les missions.
        <span v-if="!template?.currentVersionId">
          Comme aucune version n'est actuellement épinglée, celle-ci deviendra automatiquement
          la version courante.
        </span>
      </p>
      <p v-else-if="lifecycleAction === 'archive'" class="text-sm">
        Archiver une version la retire des nouvelles missions. Les missions existantes qui
        la référencent continuent de fonctionner.
        <span v-if="isCurrent" class="block mt-2 font-medium" :class="statusBannerSeverity() === 'warn' ? 'text-orange-700 dark:text-orange-300' : ''">
          Attention : cette version est actuellement la version courante.
        </span>
      </p>
      <p v-else class="text-sm">
        Cette version remplacera la version courante du template. Les nouvelles missions
        utiliseront son schéma à partir de maintenant.
      </p>
      <template #footer>
        <Button
          label="Annuler"
          text
          :disabled="lifecycleSubmitting"
          @click="cancelLifecycle"
        />
        <Button
          :label="
            lifecycleAction === 'publish'
              ? 'Publier'
              : lifecycleAction === 'archive'
                ? 'Archiver'
                : 'Promouvoir'
          "
          :loading="lifecycleSubmitting"
          :disabled="lifecycleSubmitting"
          @click="confirmLifecycle"
        />
      </template>
    </Dialog>

    <!-- Optimistic-lock conflict dialog (PR 4d) -->
    <Dialog
      :visible="staleConflict !== null"
      modal
      :closable="false"
      header="Version modifiée ailleurs"
      :style="{ width: '32rem' }"
      data-testid="stale-conflict-dialog"
    >
      <p class="text-sm">
        Cette version a été enregistrée depuis un autre onglet ou un autre utilisateur
        depuis votre dernier chargement. Si vous rechargez, vos modifications locales seront
        perdues.
      </p>
      <template #footer>
        <Button
          label="Garder mes modifs"
          text
          data-testid="stale-keep"
          @click="dismissStale"
        />
        <Button
          label="Recharger"
          severity="danger"
          data-testid="stale-reload"
          @click="reloadStale"
        />
      </template>
    </Dialog>
  </div>
</template>
