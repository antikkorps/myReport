<script setup lang="ts">
import * as monaco from 'monaco-editor';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface Props {
  modelValue: string;
  readOnly?: boolean;
  // JSON Schema (Draft 2020-12 compatible) used by Monaco's JSON
  // language service to drive squigglies and autocomplete.
  schema?: Record<string, unknown> | undefined;
  schemaUri?: string;
}

const props = withDefaults(defineProps<Props>(), {
  readOnly: false,
  schema: undefined,
  schemaUri: 'inmemory://questionnaire-schema.json',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  // Fired when the user hits Ctrl+S / Cmd+S inside the editor.
  save: [];
}>();

const container = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let resizeObserver: ResizeObserver | null = null;

// Guard against feedback loops: when we programmatically push a new
// modelValue prop into the editor we must not re-emit update:modelValue
// from the resulting change event.
let suppressEmit = false;

// monaco 0.55.x types mark `monaco.languages.json` as
// `{ deprecated: true }` even though the runtime namespace is
// unchanged. Cast through a minimal local interface so we don't
// rely on the deprecated typings and don't trigger `any`.
interface JsonLanguageDefaults {
  setDiagnosticsOptions(options: {
    validate?: boolean;
    allowComments?: boolean;
    schemas?: Array<{ uri: string; fileMatch?: string[]; schema?: object }>;
  }): void;
}

function applySchemaDiagnostics(): void {
  if (!props.schema) return;
  const jsonNamespace = monaco.languages.json as unknown as {
    jsonDefaults: JsonLanguageDefaults;
  };
  jsonNamespace.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [
      {
        uri: props.schemaUri,
        fileMatch: ['*'],
        schema: props.schema as object,
      },
    ],
  });
}

onMounted(() => {
  if (!container.value) return;

  applySchemaDiagnostics();

  editor = monaco.editor.create(container.value, {
    value: props.modelValue,
    language: 'json',
    automaticLayout: false,
    readOnly: props.readOnly,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    tabSize: 2,
    wordWrap: 'on',
    accessibilitySupport: 'on',
  });

  editor.onDidChangeModelContent(() => {
    if (suppressEmit) return;
    const next = editor?.getValue() ?? '';
    emit('update:modelValue', next);
  });

  // Ctrl/Cmd+S → save. We capture the chord *before* the browser's
  // save-page dialog by binding inside Monaco's command registry.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (props.readOnly) return;
    emit('save');
  });

  // Manual layout: Monaco's `automaticLayout` polls every 100ms which
  // is wasteful for a single editor. A ResizeObserver delivers the
  // same effect without the timer.
  if (typeof ResizeObserver !== 'undefined' && container.value) {
    resizeObserver = new ResizeObserver(() => editor?.layout());
    resizeObserver.observe(container.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  editor?.dispose();
  editor = null;
});

watch(
  () => props.modelValue,
  (next) => {
    if (!editor) return;
    if (editor.getValue() === next) return;
    suppressEmit = true;
    try {
      editor.setValue(next);
    } finally {
      suppressEmit = false;
    }
  },
);

watch(
  () => props.readOnly,
  (readOnly) => {
    editor?.updateOptions({ readOnly });
  },
);

watch(
  () => props.schema,
  () => {
    applySchemaDiagnostics();
  },
  { deep: true },
);

// Public method: triggers Monaco's built-in JSON formatter.
function formatDocument(): void {
  void editor?.getAction('editor.action.formatDocument')?.run();
}

defineExpose({ formatDocument });
</script>

<template>
  <div
    ref="container"
    class="border border-surface-200 dark:border-surface-800 rounded"
    style="min-height: 360px; height: 60vh"
    data-testid="monaco-editor"
  />
</template>
