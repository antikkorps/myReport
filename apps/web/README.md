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

## Auth flow

- **Boot**: `main.ts` awaits `auth.bootstrap()` before mounting. The
  store calls `apiClient.ensureRefresh()`; if the httpOnly refresh
  cookie is valid the access token is rotated silently and `/me`
  hydrates the store. Failures stay quiet — the user is just not
  logged in yet.
- **Reactive 401**: any non-`/auth/*` API call that returns 401 is
  intercepted by `@myreport/api-client`, which refreshes once and
  retries.
- **Proactive refresh**: on `login` success the store arms
  `useRefreshScheduler().schedule(token)`. The scheduler decodes the
  JWT `exp` and fires ~30s before. On rotation the api-client
  `onAccessTokenRotated` callback re-arms the scheduler.
- **Session expiry**: when the silent refresh fails *while a session
  was active*, the store bumps `sessionExpiredTick`. `App.vue` watches
  it, surfaces a PrimeVue toast, and bounces the user to `/login` with
  a `?redirect=` query so they land back where they came from.
- **Router guard**: routes carrying `meta.requiresAuth` redirect to
  `/login?redirect=<original>` when `auth.isAuthenticated` is false;
  authenticated users hitting `/login` are bounced to `/`.

## Notes

- Biome cannot follow Vue template references back to script imports
  (it doesn't parse `.vue` templates), so `noUnusedImports` /
  `noUnusedVariables` are turned off for `*.vue` files via a Biome
  override.
