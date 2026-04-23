# myReport — Architecture initiale

> Document initial de cadrage (2026-04-23). Fait foi jusqu'à ce qu'un ADR vienne le modifier.
> Les décisions ont été affinées en discussion : offline = V2, mobile = responsive PrimeVue (pas natif), BMAD-METHOD dans l'esprit uniquement, dépendances toujours en latest stable.

## 1. Vision produit

Plateforme SaaS multi-tenant destinée aux cabinets d'audit (qualité, conformité, sécurité, ou équivalent). Chaque cabinet gère ses missions, ses templates de questionnaires, son équipe et ses clients audités.

### Personas

- `super_admin` — gestion plateforme, facturation, support.
- `cabinet_admin` — responsable cabinet. Utilisateurs, templates, mise en page des rapports, config IA.
- `auditor` — auditeur rattaché à un cabinet. Prépare et conduit ses missions.
- `auditee` — contact chez le client audité. Accès limité, remplit les parties qui lui sont attribuées via lien magique.
- `viewer` — lecture seule (associé, qualité client).

### Features noyau (MVP)

- Lettre de mission (optionnelle), générée à partir des infos de la mission.
- Templates de questionnaires paramétrables (sections, types de question, conditions d'affichage, scoring).
- Exécution de mission : assignation, remplissage multi-acteur, pièces jointes.
- Génération du rapport d'audit (docx en priorité, markdown stylisé en complément).
- Réécriture IA optionnelle par bloc.
- RBAC fin avec scope par mission.

---

## 2. Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Runtime | Node.js 24 LTS + TypeScript (strict) | LTS le plus récent, écosystème mature. |
| API | Fastify | Plugins propres, validation TypeBox intégrée, perf. |
| DB | Postgres 16 | JSONB, RLS, full-text, extensions. |
| ORM | Drizzle | TypeScript-first, proche du SQL, compatible RLS, pas de magie à la Prisma. |
| Validation | TypeBox (back) + Zod (front) | TypeBox produit des schémas JSON natifs à Fastify ; Zod plus ergonomique côté Vue. |
| Front framework | Vue 3 + Vite | SaaS auth-gated, pas de SEO. Vite + vue-router + Pinia est plus simple et plus prévisible que Nuxt. |
| UI lib | PrimeVue (v4+, thème Aura) | Setup propre, tree-shaking, composants denses qui collent à une app data-heavy. |
| Styling | Tailwind v4 + tokens PrimeVue | Tailwind pour le layout/utilitaires, PrimeVue gère ses composants via ses propres tokens. |
| Génération docx | docxtemplater | Placeholders, boucles, images. L'auditeur édite le `.docx` final dans Word de toute façon. |
| Génération markdown→PDF | markdown-it + Puppeteer (ou weasyprint) | En option, pour les livrables figés avec branding fort. |
| Auth | Fastify + JWT access/refresh + argon2 | Access court, refresh en cookie httpOnly. |
| RBAC | CASL | Isomorphe back/front, cohérent avec l'écosystème Vue. |
| Queue / jobs | BullMQ + Redis | Génération rapport asynchrone, appels IA, envoi d'invitations. |
| Storage | S3-compatible (MinIO en dev, Scaleway/R2/BYOK en prod) | Pièces jointes, logos, rapports générés. |
| Monorepo | pnpm workspaces + Turborepo | pnpm pour la perf et les workspaces natifs, Turbo pour le cache et l'orchestration. |
| Lint/format | Biome | Remplace ESLint + Prettier, plus rapide. |
| Tests | Vitest + @vue/test-utils + Playwright + Testcontainers | Unit, intégration (vraie DB, vraie RLS), E2E. |

---

## 3. Architecture multi-tenant

**Approche : shared schema + `tenant_id` + Row Level Security.**

Chaque table métier porte une colonne `tenant_id NOT NULL` (FK vers `tenants`). RLS activée sur chaque table. Une policy unique par table qui filtre sur une variable de session Postgres :

```sql
ALTER TABLE audit_missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON audit_missions
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

**Côté Fastify**, un plugin hook `preHandler` ouvre une transaction et pose la variable pour la durée de la requête :

```ts
await db.execute(sql`SET LOCAL app.current_tenant = ${tenantId}`);
```

Avantages :
- Un oubli de `WHERE tenant_id = …` dans une query ne peut plus fuiter.
- Les migrations restent simples (une seule structure).
- Scale jusqu'à des milliers de tenants sans effort.

Le super-admin utilise un rôle Postgres distinct avec `BYPASSRLS` pour les écrans cross-tenants.

**Mapping des entités au tenant** : le `tenant` est le cabinet d'audit. Les clients audités ne sont pas des tenants — ce sont des ressources appartenant au cabinet. Un même client audité par deux cabinets différents = deux enregistrements indépendants.

---

## 4. Modélisation des questionnaires

Les questionnaires sont paramétrables et vont évoluer. **Règle absolue : ne pas modéliser les questions comme des lignes de table relationnelle** (leçon de LogiBOP : header/ligne/type = dette permanente).

### Schéma retenu

```sql
-- Versioned template: one template = one identity + N immutable versions
CREATE TABLE questionnaire_templates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE questionnaire_template_versions (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES questionnaire_templates(id),
  tenant_id uuid NOT NULL,
  version int NOT NULL,
  schema jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
```

Le `schema` JSONB décrit :

```jsonc
{
  "sections": [
    {
      "id": "sec_1",
      "title": "Gouvernance",
      "questions": [
        {
          "id": "q_1",
          "type": "single_choice",
          "label": "...",
          "required": true,
          "options": [...],
          "scoring": { "weight": 3, "map": { "oui": 10, "non": 0, "partiel": 5 } },
          "visible_if": { "q_0": "oui" },
          "assignable_to": ["auditor", "auditee"]
        }
      ]
    }
  ],
  "scoring_rules": { ... },
  "ai_rewrite_targets": ["comments"]
}
```

Le schéma JSONB est lui-même validé par un méta-schéma (TypeBox). C'est le contrat.

### Missions et réponses

```sql
CREATE TABLE audit_missions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  template_version_id uuid NOT NULL REFERENCES questionnaire_template_versions(id),
  client_name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE audit_responses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  mission_id uuid NOT NULL REFERENCES audit_missions(id),
  question_id text NOT NULL,
  value jsonb NOT NULL,
  answered_by uuid REFERENCES users(id),
  answered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (mission_id, question_id)
);
```

### Invariants

- Une réponse pointe vers la **version** du template figée au moment de la mission.
- On ne modifie jamais une version publiée. On crée une nouvelle version.
- La validation d'une réponse contre son type se fait à l'insert, côté API, via un validateur dérivé du schema.
- Toutes les PK sont des UUID v7 (client-generable, préparation offline V2).
- Toutes les tables métier portent `created_at`, `updated_at`, `deleted_at` (soft-delete pour préparer la sync offline).

---

## 5. Génération du rapport

### Pipeline

1. L'utilisateur clique « Générer le rapport ».
2. Un job BullMQ est créé.
3. Le worker :
   - Charge mission + template version + réponses.
   - Applique les réécritures IA mises en cache (ou les déclenche si option activée).
   - Résout les placeholders du template de rapport.
   - Produit le livrable (docx en priorité, md→pdf en alternative).
   - Stocke sur S3.
4. Le front poll le statut ou reçoit via SSE.

### Templates de rapport (configurables par cabinet)

Chaque cabinet a 1 à N templates de rapport. Un template = un fichier `.docx` avec des placeholders docxtemplater (`{mission.client_name}`, boucles `{#sections}…{/sections}`, etc.) + un manifest JSON qui décrit les variables exposées. Le cabinet uploade son `.docx` via l'interface admin, on le valide et on le stocke.

Pour le markdown stylisé : un template Handlebars qui produit du markdown, pipeline `markdown-it` → HTML + CSS du cabinet (avec logo) → PDF via Puppeteer.

### Logos et branding

Stockés par tenant sur S3, chemin référencé dans `tenants.branding` (JSONB : `logo_url`, couleur primaire, pied de page, etc.). Injectés automatiquement dans les templates.

---

## 6. Couche IA

### Interface

```ts
interface AIProvider {
  rephrase(text: string, opts: RephraseOpts): Promise<string>;
  summarize(blocks: string[], opts?: SummarizeOpts): Promise<string>;
}
```

### Implémentations

- `AnthropicProvider` (Claude) — défaut.
- `OpenAIProvider` — fallback.
- `LocalProvider` (Ollama) — expérimental, pour les cabinets paranos.

Sélection via `AIProviderFactory.for(tenant)` qui lit la config du tenant.

### Config par tenant

```sql
CREATE TABLE tenant_ai_config (
  tenant_id uuid PRIMARY KEY,
  provider text NOT NULL,          -- 'anthropic' | 'openai' | 'local'
  mode text NOT NULL,              -- 'byok' | 'managed'
  encrypted_api_key bytea,         -- libsodium, never plaintext
  monthly_token_budget int,
  rewrite_style text
);
```

- **Managed** : la plateforme absorbe, facturé dans l'option Premium. Rate limit strict, quota mensuel.
- **BYOK** : le cabinet fournit sa clé, gratuit pour lui côté IA. Clé chiffrée avec une clé maître (libsodium).

### Où l'IA intervient

Bloc par bloc, à la demande. Bouton « Reformuler » sur chaque champ texte long. Jamais de « régénère tout le rapport » : nid à hallucinations et à factures salées. Les réécritures sont mises en cache au niveau `(mission_id, question_id, input_hash)`.

### Garde-fous

- Rate limiting par tenant (BullMQ + Redis).
- Log des prompts/réponses dans `ai_usage` pour audit et facturation interne.
- Pas d'envoi au LLM sans consentement explicite du cabinet (flag global cabinet, surchargeable par mission).

---

## 7. RBAC

**Lib : CASL.** Abilities définies côté serveur, sérialisées vers le front pour un gating UI cohérent.

### Rôles de base

| Rôle | Scope | Capacités principales |
|---|---|---|
| `super_admin` | plateforme | Tout, bypass RLS via rôle DB dédié. |
| `cabinet_admin` | tenant | Manage users, templates questionnaires + rapports, config IA, facturation. |
| `auditor` | tenant, filtré par mission | CRUD sur ses missions assignées, lecture templates. |
| `auditee` | mission unique | Remplir les questions qui lui sont attribuées, uploader pièces. |
| `viewer` | tenant ou mission | Lecture seule. |

### Assignation à la mission

Table `mission_members` qui lie `user_id` + `role_on_mission` + `scope` (sections ou questions autorisées pour un auditee). L'audité est invité par email → user créé en `pending` + lien magique avec token signé scopé strictement à cette mission.

---

## 8. Structure du monorepo

```
/
├── apps/
│   ├── api/              # Fastify + Drizzle
│   ├── web/              # Vue 3 + Vite + PrimeVue
│   └── worker/           # BullMQ workers (AI, reports, emails)
├── packages/
│   ├── db/               # Drizzle schema, migrations, seeds
│   ├── shared-types/     # Shared TS types (API DTOs)
│   ├── shared-schemas/   # TypeBox + conversion helpers to Zod
│   ├── ai/               # AIProvider abstraction + implementations
│   ├── rbac/             # Shared CASL abilities
│   └── report-engine/    # docx + md→pdf generation
├── infra/
│   ├── docker-compose.yml   # postgres, redis, minio for local dev
│   └── terraform/           # Hetzner + Scaleway storage (later)
├── docs/
│   ├── architecture.md
│   └── adr/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 9. Plan de démarrage

Chaque étape est un incrément testable.

1. **Setup monorepo** — pnpm + Turbo + TS references, Biome. *(en cours)*
2. **Infra locale** — docker-compose avec Postgres 16, Redis, MinIO. Script `pnpm dev:up`.
3. **Package db** — Drizzle, schéma initial (`tenants`, `users`, `memberships`, `sessions`). Migration + seed.
4. **RLS** — activation sur les tables métier, policies, rôle `app_user` pour la connexion API.
5. **API squelette** — Fastify, plugin tenant context, plugin auth (JWT access court + refresh httpOnly), route `/me`.
6. **Front squelette** — Vue 3 + Vite + PrimeVue + vue-router + Pinia + layout responsive. Page login, dashboard vide.
7. **Admin tenants** (super-admin) — création cabinet + premier cabinet_admin.
8. **Gestion users** (cabinet_admin) — inviter auditors.
9. **Templates questionnaires** — éditeur JSON Schema-driven (Monaco JSON editor, pas de WYSIWYG au MVP). Versionnage.
10. **Missions** — création, assignation auditors.
11. **Remplissage** — écran de réponse dynamique généré depuis le schema du template.
12. **Invitation auditee** — lien magique, scope mission, écran de remplissage allégé.
13. **Génération rapport docx** — template par défaut, placeholders simples, docxtemplater, job worker.
14. **Couche IA** — interface + AnthropicProvider, bouton reformuler sur champs texte.
15. **Mode BYOK** — écran de config clé API, chiffrement libsodium.
16. **Templates de rapport par cabinet** — upload docx, validation placeholders.
17. **Export markdown → PDF** — si le besoin est confirmé après tests utilisateurs.

**À ne surtout pas faire au MVP** : éditeur visuel de questionnaire WYSIWYG, marketplace de templates, i18n du contenu des questionnaires, mobile natif, mode offline.

---

## 10. Décisions reportées

- **Hébergement prod** — probablement Hetzner. Postgres managé vs auto-hébergé : à trancher au déploiement.
- **Emails transactionnels** — Postmark, Resend, ou SMTP directe.
- **Observabilité** — Pino + un agrégateur (Loki, Axiom, Better Stack).
- **Signature électronique** des rapports finaux : intégration DocuSign/Yousign en V2.
- **API publique** — pas avant 10 clients demandeurs.
- **Offline mode** — V2.
- **Mobile natif** — pas au programme, responsive web suffit.
