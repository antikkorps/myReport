# @myreport/web

Vue 3 + Vite front-end for myReport.

## Stack

- **Vue 3** + `<script setup lang="ts">`
- **Vite 7** with `@vitejs/plugin-vue` and `@tailwindcss/vite`
- **PrimeVue 4** with a customised **Aura** preset (Noir primary on Zinc + Slate surface, see `src/theme/preset.ts`), dark mode opt-in via `.dark` on `<html>`
- **Tailwind v4** with `@import "tailwindcss"` (no config file, theme via `@theme {}`)
- **vue-router 4** (memory history in tests, web history in app)
- **Pinia 3** for state
- **Vitest 4** + **@vue/test-utils 2** with **jsdom**

## Layout

```
src/
  components/AppShell.vue   Mobile-first responsive shell (drawer + topbar)
  views/                    Route components (HomeView, LoginView, NotFoundView)
  stores/                   Pinia stores (auth skeleton)
  router/index.ts           Routes + lazy chunks
  styles.css                Tailwind v4 + global tokens
  main.ts                   App boot (Pinia, router, PrimeVue)
```

## Dev

```sh
pnpm --filter @myreport/web dev
```

`vite.config.ts` proxies `/api/*` to `http://localhost:3000` so the
browser can call relative URLs and the refresh-token cookie stays in
scope. Start the API in another terminal:

```sh
pnpm --filter @myreport/api dev
```

## Mobile-first

The project's rule (CLAUDE.md): every screen must be tested at 375 px
before merge. `AppShell` uses Tailwind responsive classes
(`hidden lg:block`, `lg:flex-row`) and the topbar/drawer toggle
collapses cleanly below `lg`. Component tests assert the hamburger
toggle works headlessly so regressions surface in CI.

## Tests

```sh
pnpm --filter @myreport/web test
```

## Notes

- The login screen wires `ZLoginRequest` from `@myreport/shared-schemas`
  for client-side validation but does not hit the API yet — the real
  flow lands in the next backlog item ("Login + /me").
- Biome cannot follow Vue template references back to script imports
  (it doesn't parse `.vue` templates), so `noUnusedImports` /
  `noUnusedVariables` are turned off for `*.vue` files via a Biome
  override.
