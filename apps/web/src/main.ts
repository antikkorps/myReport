import Aura from '@primevue/themes/aura';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.ts';
import './styles.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      // PrimeVue's Tailwind integration uses .dark on <html>; keeping
      // dark mode opt-in via class lets us toggle from a future user
      // setting without affecting the OS default.
      darkModeSelector: '.dark',
      cssLayer: { name: 'primevue', order: 'tailwind-base, primevue, tailwind-utilities' },
    },
  },
  ripple: true,
});

app.mount('#app');
