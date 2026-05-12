import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../primitives/isoDateTime.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';

// `schema` carries the questionnaire DSL payload (see ADR 0004 and
// the @myreport/questionnaire-schema package). Validating its shape
// at the TypeBox layer would duplicate the DSL; the route layer runs
// `validateQuestionnaireSchema` on every write to enforce it
// authoritatively. We therefore accept "any object" here (the DSL is
// always an object at the root) and rely on the stricter check
// downstream. `Type.Unknown()` would make the field implicitly
// optional on both sides — `Type.Object({}, { additionalProperties:
// true })` keeps it required.
const TBQuestionnaireSchemaBody = Type.Object({}, { additionalProperties: true });
const ZQuestionnaireSchemaBody = z.record(z.string(), z.unknown());

export const TBQuestionnaireTemplateVersionStatus = Type.Union([
  Type.Literal('draft'),
  Type.Literal('published'),
  Type.Literal('archived'),
]);

export const ZQuestionnaireTemplateVersionStatus = z.union([
  z.literal('draft'),
  z.literal('published'),
  z.literal('archived'),
]);

export type QuestionnaireTemplateVersionStatus = Static<
  typeof TBQuestionnaireTemplateVersionStatus
>;

export const TBCreateQuestionnaireTemplateVersionRequest = Type.Object(
  {
    schema: TBQuestionnaireSchemaBody,
  },
  { additionalProperties: false },
);

export const ZCreateQuestionnaireTemplateVersionRequest = z
  .object({
    schema: ZQuestionnaireSchemaBody,
  })
  .strict();

export type CreateQuestionnaireTemplateVersionRequest = Static<
  typeof TBCreateQuestionnaireTemplateVersionRequest
>;

// Same body shape as create — both reuse the DSL-validation path.
export const TBUpdateQuestionnaireTemplateVersionRequest = Type.Object(
  {
    schema: TBQuestionnaireSchemaBody,
  },
  { additionalProperties: false },
);

export const ZUpdateQuestionnaireTemplateVersionRequest = z
  .object({
    schema: ZQuestionnaireSchemaBody,
  })
  .strict();

export type UpdateQuestionnaireTemplateVersionRequest = Static<
  typeof TBUpdateQuestionnaireTemplateVersionRequest
>;

export const TBQuestionnaireTemplateVersion = Type.Object({
  id: TBUuid,
  templateId: TBUuid,
  tenantId: TBUuid,
  version: Type.Integer({ minimum: 1 }),
  status: TBQuestionnaireTemplateVersionStatus,
  schema: TBQuestionnaireSchemaBody,
  publishedAt: Type.Union([TBIsoDateTime, Type.Null()]),
  publishedByUserId: Type.Union([TBUuid, Type.Null()]),
  createdAt: TBIsoDateTime,
  updatedAt: TBIsoDateTime,
});

export const ZQuestionnaireTemplateVersion = z.object({
  id: ZUuid,
  templateId: ZUuid,
  tenantId: ZUuid,
  version: z.number().int().min(1),
  status: ZQuestionnaireTemplateVersionStatus,
  schema: ZQuestionnaireSchemaBody,
  publishedAt: ZIsoDateTime.nullable(),
  publishedByUserId: ZUuid.nullable(),
  createdAt: ZIsoDateTime,
  updatedAt: ZIsoDateTime,
});

export type QuestionnaireTemplateVersion = Static<typeof TBQuestionnaireTemplateVersion>;

// Lightweight list item — same as the full version. We considered
// omitting `schema` to keep list payloads small, but the editor needs
// it to preview a row inline. If the list view grows expensive later,
// add a `?fields=` query parameter rather than splitting the type.
export const TBQuestionnaireTemplateVersionListResponse = Type.Object({
  items: Type.Array(TBQuestionnaireTemplateVersion),
});

export const ZQuestionnaireTemplateVersionListResponse = z.object({
  items: z.array(ZQuestionnaireTemplateVersion),
});

export type QuestionnaireTemplateVersionListResponse = Static<
  typeof TBQuestionnaireTemplateVersionListResponse
>;

export const TBQuestionnaireTemplateVersionListQuery = Type.Object({
  status: Type.Optional(Type.Union([TBQuestionnaireTemplateVersionStatus, Type.Literal('all')])),
});

export const ZQuestionnaireTemplateVersionListQuery = z.object({
  status: z.union([ZQuestionnaireTemplateVersionStatus, z.literal('all')]).optional(),
});

// Structured 400 payload when DSL validation rejects the body.
// Re-uses the issue shape exposed by @myreport/questionnaire-schema
// (path / code / message) so the front can render inline errors next
// to the Monaco gutter.
export const TBQuestionnaireSchemaIssue = Type.Object({
  path: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

export const ZQuestionnaireSchemaIssue = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export const TBQuestionnaireSchemaValidationError = Type.Object({
  code: Type.Literal('SCHEMA_INVALID'),
  message: Type.String(),
  issues: Type.Array(TBQuestionnaireSchemaIssue),
});

export const ZQuestionnaireSchemaValidationError = z.object({
  code: z.literal('SCHEMA_INVALID'),
  message: z.string(),
  issues: z.array(ZQuestionnaireSchemaIssue),
});

export type QuestionnaireSchemaValidationError = Static<
  typeof TBQuestionnaireSchemaValidationError
>;
