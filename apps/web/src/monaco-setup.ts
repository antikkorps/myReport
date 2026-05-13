// Wires the Monaco workers via Vite's `?worker` syntax. Importing the
// worker scripts as ESM modules lets Vite hash and bundle them; the
// resulting URLs are served from `/assets/*` in both dev and prod.
//
// We only register the workers we actually use:
// - `editor.worker`: required by every model (tokenisation, basic
//   language features).
// - `json.worker`: provides schema validation and autocomplete for the
//   JSON language, which is the only language Monaco runs in this app.
//
// Loading this module via `main.ts` (top-level side-effect import)
// guarantees the workers are configured before any editor instance
// reaches `monaco.editor.create()`.

// Vite's `?worker` query (typed via `vite/client`) resolves these to
// Worker constructors at build time.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';

interface MonacoEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironment;
  }
}

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};
