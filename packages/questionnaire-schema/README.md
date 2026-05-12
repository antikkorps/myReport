# `@myreport/questionnaire-schema`

DSL types and structural validation for questionnaire templates.

See [ADR 0004](../../docs/adr/0004-questionnaire-schema.md) for the design rationale (TypeBox DSL + immutable versioning).

## Goal

A single source of truth for the shape of a questionnaire that flows from the template editor down to mission filling, answer validation, and report generation. The schema is:

- **Statically typed** — every `kind` is a discriminated branch in TypeScript; downstream code narrows without `any`.
- **Bounded** — the set of question kinds is closed and lives in source. Cabinets cannot invent kinds the renderer cannot handle.
- **Editor-friendly** — the same TypeBox schema is exported as JSON Schema (Draft 2020-12) and consumed by Monaco for autocomplete + inline errors.
- **Format-versioned** — the schema carries `version: 1` so a future DSL break is a typed migration, not data corruption.

## API

```ts
import {
  TQuestionnaireSchema,
  validateQuestionnaireSchema,
  toJsonSchema,
  walkQuestionnaire,
  QUESTIONNAIRE_SCHEMA_FORMAT_VERSION,
  QUESTION_KINDS,
  type QuestionnaireSchema,
  type Section,
  type LeafQuestion,
  type RepeaterQuestion,
  type AnyNode,
  type ValidationResult,
  type ValidationIssue,
} from '@myreport/questionnaire-schema';

const result = validateQuestionnaireSchema(input);
if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`${issue.path}: [${issue.code}] ${issue.message}`);
  }
} else {
  // result.schema is typed as QuestionnaireSchema.
}
```

`validateQuestionnaireSchema` runs in two passes:

1. **Shape** via TypeBox `Value.Check` — emits issues with `code: 'SHAPE'`.
2. **Structural rules** the type system cannot encode (globally unique IDs, range coherence, etc.) — emits issues with stable codes such as `DUPLICATE_ID`, `INVALID_RANGE`, `INVALID_PATTERN`, `DUPLICATE_OPTION_VALUE`, `INVALID_MIME`, `INVALID_DATE`, `INVALID_INTEGER_BOUND`.

Issue paths use a friendly notation (`sections[0].questions[2].options[1]`) regardless of which pass produced them.

## Question kinds

| `kind` | Purpose | Notable fields |
|---|---|---|
| `section` | Container | `label`, `questions[]` (leaf or repeater, no nested section) |
| `text` | Single-line text | `minLength?`, `maxLength?`, `pattern?` |
| `longText` | Multi-line text | `minLength?`, `maxLength?` |
| `number` | Numeric input | `min?`, `max?`, `integer?` |
| `boolean` | Yes/no | — |
| `singleChoice` | One value from a list | `options[]` (each `{ value, label }`) |
| `multiChoice` | Subset of values | `options[]`, `minSelected?`, `maxSelected?` |
| `scale` | Integer scale | `min`, `max`, `minLabel?`, `maxLabel?` |
| `date` | Calendar date (ISO `YYYY-MM-DD`) | `min?`, `max?` |
| `attachment` | File upload | `maxFiles?`, `maxSizeBytes?`, `mimeTypes?` |
| `repeater` | Repeating block | `questions[]` (leaves only — no nested repeater, no section), `minItems?`, `maxItems?`, `addLabel?` |

`QUESTION_KINDS` exports the runtime list (sections excluded — they are structural, not question kinds).

## Versioning

The schema declares its **DSL format version** at the root (`version: 1`). It is unrelated to template / template-version DB rows. Bumping it is reserved for breaking DSL evolution and will ship with a `migrate(v1, ): v2` function. The current package only accepts `version: 1`.

## Why this lives in its own package

Anything that touches the questionnaire shape (API DTOs, mission filling UI, renderer, report engine, AI cache key) imports the same types from here. A new `kind` is added once, and the compiler enumerates the call sites that need a branch. No drift between layers.
