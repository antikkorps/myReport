# myReport — Project instructions

SaaS multi-tenant pour cabinets d'audit. Monorepo pnpm + Turborepo.

## Règles absolues (non négociables)

### Qualité de code

- **Zéro `any`.** Interdit en TypeScript, quelle que soit la raison invoquée. Si un type est vraiment inconnu, utiliser `unknown` + narrowing, ou définir le type proprement. Les PR avec `any` sont rejetées.
- **Pas de `@ts-ignore` / `@ts-expect-error`** sans un commentaire expliquant le bug TS sous-jacent et un ticket de suivi.
- **Strict mode TS activé partout** (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`).
- **Commentaires en anglais.** Partout. Code, JSDoc, ADRs inline. La conversation et la doc utilisateur peuvent rester en FR.
- **Pas de commentaires qui répètent le code.** Un commentaire explique un *pourquoi*, pas un *quoi*. Noms de symboles explicites > commentaires.

### Tests

- **Vitest** pour unit + intégration côté API, worker et packages. **Vitest + @vue/test-utils** côté web.
- **Playwright** pour les tests E2E (au minimum : login, création mission, remplissage, génération rapport).
- **Testcontainers** (ou docker-compose de test) pour les tests d'intégration API : vrai Postgres + vraie RLS, pas de mock de DB.
- **Couverture minimale** : 80 % sur les packages partagés (`rbac`, `ai`, `report-engine`, `shared-schemas`). Pas de seuil arbitraire sur les apps, mais tout chemin critique (auth, tenant isolation, scoring, génération rapport) doit avoir un test.
- **Les tests RLS sont obligatoires** : chaque table avec `tenant_id` doit avoir un test qui vérifie qu'un tenant ne voit pas les données d'un autre.

### Pipeline avant push

**On ne push JAMAIS avant que, localement :**

1. `pnpm lint` passe (Biome, zéro warning toléré sur le code modifié).
2. `pnpm typecheck` passe (zéro erreur).
3. `pnpm test` passe (unit + intégration).
4. Les tests E2E pertinents tournent (si la change touche au flux).

CI rejoue tout et bloque le merge si ça casse. Pas de `--no-verify`, pas de skip de hooks.

### Documentation

- **Chaque étape produit sa doc.** Une feature sans doc n'est pas terminée.
- `docs/` à la racine contient : `architecture.md` (le doc initial), `adr/` (Architecture Decision Records numérotés, format MADR), `runbook/` (ops et déploiement), `api.md` (généré depuis les schémas TypeBox → OpenAPI).
- **Chaque package** a son `README.md` minimal : but, usage, exemples.
- **Chaque endpoint API** expose son schéma TypeBox et est documenté via OpenAPI auto-généré par Fastify.
- **Chaque migration** a un commentaire SQL en tête expliquant le changement et son pourquoi.

### Contraintes "offline-ready" (même si offline = V2)

- **UUID v7** (ou v4 à défaut) pour toutes les PK. Pas de `serial`/`bigserial`.
- `created_at`, `updated_at` (timestamptz) sur toutes les tables métier.
- `deleted_at` (soft-delete) sur les tables qui seront synchronisées offline plus tard (missions, réponses, templates, pièces jointes).
- IDs générables côté client quand pertinent (pour préparer la sync sans conflits).

### Mobile

- Responsive first. Chaque écran doit être testé en viewport mobile (375px min) avant merge.
- Composants PrimeVue data-heavy en mode `responsiveLayout="stack"` par défaut.

### Sécurité

- Secrets **jamais** committés. `.env.example` committé avec valeurs fictives, `.env` dans `.gitignore`.
- Clés API BYOK chiffrées avec libsodium (pas d'AES-GCM manuel).
- Tous les inputs API validés par TypeBox. Tous les inputs front validés par Zod avant envoi.
- RLS Postgres activée dès la première table métier. Jamais désactivée "temporairement".

### Dépendances

- **Toujours latest stable** à l'installation (`pnpm add pkg@latest`). Valable runtime, dev, images Docker (tags explicites et récents, jamais `latest` en prod mais versions majeures actuelles).
- **Délai anti-supply-chain : 90 jours minimum** entre la publication d'une version et son installation. On vise la dernière version stable **dont la date de publication est ≥ 90 jours**. Motif : plusieurs attaques de supply chain récentes (packages npm compromis, mainteneurs piratés) sont détectées dans les premières semaines. Ce délai laisse le temps à la communauté et aux scanners de repérer les versions malveillantes. Applicable à **toutes** les dépendances (runtime + dev), sauf patch de sécurité critique explicitement motivé. Vérifier avec `npm view <pkg> time` avant `pnpm add`.
- **Dependabot + `pnpm audit`** en CI. Patch/minor : auto-merge si tests verts **et** version ≥ 90 jours. Major : PR dédiée, revue manuelle, ADR si breaking.
- **Pas de dépendance abandonnée** (dernier commit > 18 mois) sans justification écrite.
- **`pnpm outdated`** checké à chaque début de sprint/itération. Mise à niveau groupée en chore dédié.
- Node.js : LTS le plus récent (actuellement **24**). Postgres : version stable la plus récente compatible avec les extensions utilisées (16+).

## Stack (rappel rapide)

Node 24 LTS + TS strict, API Fastify + TypeBox, Drizzle + Postgres 16 (RLS), Vue 3 + Vite + PrimeVue (Aura) + Pinia, Tailwind v4, BullMQ + Redis, docxtemplater, CASL, argon2 + JWT, S3-compatible storage (BYOK possible), pnpm workspaces + Turborepo, Biome, Vitest, Playwright.

## Workflow

- BMAD-METHOD **dans l'esprit** : itérations courtes, stories bien découpées, mais pas de cérémonie d'agents.
- Une branche par story. Nommage : `feat/<short-slug>`, `fix/<short-slug>`, `chore/<short-slug>`.
- Commits conventionnels (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- PR obligatoire, même solo. Checklist PR : lint OK, typecheck OK, tests OK, doc à jour.

## À ne pas faire

- Pas de `prisma`, `typeorm`, `sequelize`. On reste sur Drizzle.
- Pas d'ESLint + Prettier. Biome fait les deux, plus vite.
- Pas de `express`, `koa`, `hono`. Fastify, point.
- Pas de Nuxt. Vite + vue-router + Pinia.
- Pas de `fetch` nu côté front. On encapsule dans un client API typé dérivé des schémas TypeBox.
- Pas de feature flag maison improvisé. Si besoin, on choisit une lib ou on documente l'ADR.
