## ADR 0004 — Questionnaire schema: TypeBox DSL + immutable versioning

- **Status**: Accepted
- **Date**: 2026-05-12
- **Deciders**: Franck

## Context

Phase 3 builds the audit core: templates → missions → answers → reports. The questionnaire schema sits at the very bottom of that stack. Every downstream concern reads it:

- **Missions** reference a specific template version and never see another shape.
- **Answer rendering** (mission filling UI) generates a Vue form from it.
- **Validation** of submitted answers is type-aware (a `number` answer must be a number, a `singleChoice` must reference a declared option, etc.).
- **Report generation** (`@myreport/report-engine`, Phase 4) reads answers via question IDs declared in the schema.
- **AI rewrite** (`@myreport/ai`, Phase 4) caches results keyed by `question_id`.

So the schema format is load-bearing: a wrong shape here forces multi-package refactors later. Two orthogonal decisions are needed before any code lands.

## Decision drivers

1. **Static safety end-to-end.** A `kind: 'singleChoice'` question must surface its `options` field in TypeScript without runtime narrowing. The same union must constrain answer values (a `singleChoice` answer is one of the declared `value`s).
2. **Bounded surface.** Cabinet admins should not be able to invent question types we cannot render or validate. The set of `kind`s is closed and lives in source.
3. **Editor support.** Templates are edited in Monaco. The editor needs a JSON Schema to drive autocomplete and inline errors — without it, authoring is unusable.
4. **In-flight stability.** A mission already filled by an auditee must not break because someone edited the template. Once a version is published, its schema is immutable.
5. **No user-supplied code execution.** The template is data, not code.

## Decision

### 1. DSL: discriminated TypeBox union

The schema is a `Static` type built from a TypeBox `Type.Union` discriminated on the literal `kind` field. The kinds available in V1:

- structural: `section`, `repeater`
- scalar: `text`, `longText`, `number`, `boolean`, `date`
- choice: `singleChoice`, `multiChoice`, `scale`
- file: `attachment`

A separate JSON Schema (Draft 2020-12) is exported from the same TypeBox source via the built-in serializer; it ships to the front to feed Monaco's `json` worker. Single source of truth, two consumers.

#### Alternatives rejected

- **Raw JSON Schema as the canonical format.** Loses static typing on the API and renderer side — every downstream consumer would need runtime narrowing for every property. Re-implements the union discrimination Monaco/Ajv already give us via TypeBox. The "extensibility" win is theoretical: cabinets do not author JSON Schema fragments, they pick from a fixed palette.
- **TypeBox runtime exported by user-written TS.** Would mean executing user-supplied JavaScript inside the API. Sandbox surface (vm2-class issues, prototype pollution, infinite loops) outweighs any DX win. Ruled out unconditionally.
- **Adopt Survey.js / Formly schemas.** Couples the data model to a third-party renderer with its own release cadence and a much wider feature set than we need (page logic, expressions, custom widgets). Worse for static typing in TS.

### 2. Versioning: immutable snapshot per published version

Two-table model:

| Table | Mutable? | Purpose |
|---|---|---|
| `questionnaire_templates` | yes (soft-delete, rename) | Identity of a template within a tenant. |
| `questionnaire_template_versions` | **no** once `status='published'` | Frozen snapshot of the schema JSONB. |

Rules:

- Editing a published version is forbidden — a new draft version is created instead.
- Missions reference `template_version_id`, never `template_id` alone.
- `archived` versions can no longer be picked for *new* missions but stay readable for missions already pointing at them.
- A constraint trigger blocks `UPDATE`/`DELETE` on rows whose pre-image had `status='published'`. (The trigger lives in the DB migration of PR 2 — calling it out here so the contract is explicit.)
- Soft-delete (`deleted_at`) lives on `questionnaire_templates` only. A version is never soft-deleted: either it's draft (mutable, deletable), published (frozen forever), or archived (frozen, hidden from picker).

#### Alternatives rejected

- **Patch-based versioning (deltas + forward migrations).** Elegant for diff history, but every consumer (renderer, validator, reporter) would need to either materialise a version on read or carry a migration runner. Overkill for an MVP where templates evolve monthly, not weekly.
- **Single mutable schema.** Contradicts driver #4 directly: an in-flight mission can break on every edit. Non-starter.

### 3. Schema format version

The schema JSON itself carries `version: 1` at the root. This is **not** the template version (which lives in the DB). It is the *DSL format* version, reserved so a future "renamed `attachment` to `file`" or "added question type" can ship behind a check rather than corrupting old data. V1 hard-rejects any other value.

## Consequences

### Positive

- Static types flow from `@myreport/questionnaire-schema` to API DTOs (`@myreport/shared-schemas`), to the renderer, to the report engine. No `any`, no manual narrowing.
- Monaco autocomplete works out of the box — it consumes the JSON Schema we already maintain.
- An auditee filling a mission is shielded from any template edit landing after they started.
- Adding a new `kind` is a localised change: extend the union, write the renderer branch, write the answer validator branch. The compiler enumerates the call sites.

### Negative / trade-offs

- The kinds palette is closed. Adding "rating with custom icons" or "ranking drag-and-drop" requires a code release, not a template edit. Acceptable: the same property is what makes downstream typing tractable.
- Two schema artefacts (TypeBox + JSON Schema) live in the same package. The JSON Schema is *generated* from TypeBox at module load, so they cannot drift — but reviewers should know not to hand-edit the JSON Schema.
- Immutable versions mean a mistyped published version is dead weight. Mitigation: a "duplicate as draft" UX in PR 4 lets the author start from a known-good snapshot rather than from blank.

### Future / deferred

- A *migration* between schema format versions (`version: 1 → 2`) is out of scope until we ship V2. When that happens, this ADR is superseded — we expect to add a `migrate(v1Schema): v2Schema` function and bump the constant in lockstep.
- Conditional logic (`showIf`/`requiredIf`) is intentionally not in V1. It would require an expression sub-language and runtime evaluator on both sides; deferred until a real customer asks.
- Localisation (multi-language `label`/`description`) is deferred. V1 ships single-language strings; the future shape will likely be `label: string | { [lang]: string }`, which is a non-breaking widening.
