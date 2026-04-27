import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.ts';
import { NoirSlatePreset } from './theme/preset.ts';
import 'primeicons/primeicons.css';
import './styles.css';

const app = createApp(App);

app.use(createPinia());
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

app.mount('#app');
