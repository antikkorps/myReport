import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.ts';
import { useAuthStore } from './stores/auth.ts';
import { NoirSlatePreset } from './theme/preset.ts';
import 'primeicons/primeicons.css';
import './styles.css';

const app = createApp(App);

const pinia = createPinia();
app.use(pinia);
// Activate the Pinia instance for non-component code (the bootstrap
// call below uses the auth store before any component is mounted).
setActivePinia(pinia);

app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: NoirSlatePreset,
    options: {
      // PrimeVue's Tailwind integration uses .dark on <html>; keeping
      // dark mode opt-in via class lets us toggle from a future user
      // setting without affecting the OS default.
      darkModeSelector: '.dark',
      // Layer order is declared in src/styles.css:
      // `@layer theme, base, primevue, utilities`. We just tell
      // PrimeVue which layer to emit into so Tailwind utilities can
      // override component styles when applied deliberately.
      cssLayer: { name: 'primevue', order: 'theme, base, primevue, utilities' },
    },
  },
  ripple: true,
});
app.use(ToastService);

// Try to restore the session before mounting so the router guard sees
// the populated store on first navigation (avoids a /login flash for
// authenticated users reloading the app).
const auth = useAuthStore();
auth.bootstrap().finally(() => {
  app.mount('#app');
});
