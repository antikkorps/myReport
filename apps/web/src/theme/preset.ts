import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

// Aura preset customised to "Noir + Slate":
// - primary palette mapped to zinc (PrimeVue's canonical Noir scale,
//   close to black — zinc.950 is #09090b)
// - surface palette mapped to slate (cooler grays for backgrounds,
//   borders, panels)
//
// Light/dark variants share the surface shift; the primary swap
// follows the standard Noir contract (dark -> light primary in
// dark mode and vice-versa) so contrast stays correct.
const slateSurface = {
  0: '#ffffff',
  50: '{slate.50}',
  100: '{slate.100}',
  200: '{slate.200}',
  300: '{slate.300}',
  400: '{slate.400}',
  500: '{slate.500}',
  600: '{slate.600}',
  700: '{slate.700}',
  800: '{slate.800}',
  900: '{slate.900}',
  950: '{slate.950}',
} as const;

export const NoirSlatePreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{zinc.50}',
      100: '{zinc.100}',
      200: '{zinc.200}',
      300: '{zinc.300}',
      400: '{zinc.400}',
      500: '{zinc.500}',
      600: '{zinc.600}',
      700: '{zinc.700}',
      800: '{zinc.800}',
      900: '{zinc.900}',
      950: '{zinc.950}',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{zinc.950}',
          contrastColor: '#ffffff',
          hoverColor: '{zinc.900}',
          activeColor: '{zinc.800}',
        },
        highlight: {
          background: '{zinc.950}',
          focusBackground: '{zinc.700}',
          color: '#ffffff',
          focusColor: '#ffffff',
        },
        surface: slateSurface,
      },
      dark: {
        primary: {
          color: '{zinc.50}',
          contrastColor: '{zinc.950}',
          hoverColor: '{zinc.100}',
          activeColor: '{zinc.200}',
        },
        highlight: {
          background: 'rgba(250, 250, 250, .16)',
          focusBackground: 'rgba(250, 250, 250, .24)',
          color: 'rgba(255,255,255,.87)',
          focusColor: 'rgba(255,255,255,.87)',
        },
        surface: slateSurface,
      },
    },
  },
  // Aura's Button component reads `primary.500` for the filled
  // background, not `primary.color`. With our zinc primary scale,
  // primary.500 (= zinc.500) is medium gray — visually close to
  // slate.500. We pin the button's primary tokens directly to the
  // Noir contract so the filled "Se connecter" button stays black.
  components: {
    button: {
      colorScheme: {
        light: {
          root: {
            primary: {
              background: '{zinc.950}',
              hoverBackground: '{zinc.900}',
              activeBackground: '{zinc.800}',
              borderColor: '{zinc.950}',
              hoverBorderColor: '{zinc.900}',
              activeBorderColor: '{zinc.800}',
              color: '#ffffff',
              hoverColor: '#ffffff',
              activeColor: '#ffffff',
              focusRing: { color: '{zinc.950}', shadow: 'none' },
            },
          },
        },
        dark: {
          root: {
            primary: {
              background: '{zinc.50}',
              hoverBackground: '{zinc.100}',
              activeBackground: '{zinc.200}',
              borderColor: '{zinc.50}',
              hoverBorderColor: '{zinc.100}',
              activeBorderColor: '{zinc.200}',
              color: '{zinc.950}',
              hoverColor: '{zinc.950}',
              activeColor: '{zinc.950}',
              focusRing: { color: '{zinc.50}', shadow: 'none' },
            },
          },
        },
      },
    },
  },
});
