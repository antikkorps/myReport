import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../primitives/isoDateTime.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';

// Slug constraints for questionnaire templates. Same DNS-label shape
// as tenant slugs (3-63 chars, lowercase letters/digits/dashes, no
// leading or trailing dash). Picked to keep the door open for routes
// like /t/<tenant>/templates/<slug> without further encoding.
const TEMPLATE_SLUG_PATTERN = '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$';
const TEMPLATE_SLUG_REGEX = new RegExp(TEMPLATE_SLUG_PATTERN);

export const TBQuestionnaireTemplateSlug = Type.String({
  pattern: TEMPLATE_SLUG_PATTERN,
  minLength: 3,
  maxLength: 63,
});

export const ZQuestionnaireTemplateSlug = z
  .string()
  .min(3, { message: 'slug too short' })
  .max(63, { message: 'slug too long' })
  .regex(TEMPLATE_SLUG_REGEX, { message: 'invalid slug' });

// Request body for POST /templates. `tenantId` is only consumed when
// the caller is super_admin; cabinet_admin operations always derive
// the tenant from the session. The route layer enforces both rules
// (super_admin missing tenantId -> 400; cabinet_admin sending one ->
// 400 to avoid accidental cross-tenant writes).
export const TBCreateQuestionnaireTemplateRequest = Type.Object(
  {
    name: TBNonEmptyString,
    slug: TBQuestionnaireTemplateSlug,
    description: Type.Optional(Type.String()),
    tenantId: Type.Optional(TBUuid),
  },
  { additionalProperties: false },
);

export const ZCreateQuestionnaireTemplateRequest = z
  .object({
    name: ZNonEmptyString,
    slug: ZQuestionnaireTemplateSlug,
    description: z.string().optional(),
    tenantId: ZUuid.optional(),
  })
  .strict();

export type CreateQuestionnaireTemplateRequest = Static<
  typeof TBCreateQuestionnaireTemplateRequest
>;

// Update body. Slug is immutable (mirrors `tenants.slug`) and
// `currentVersionId` is managed by the publish/promote flow (PR 3b),
// not by direct PATCH — so it is intentionally absent here.
export const TBUpdateQuestionnaireTemplateRequest = Type.Object(
  {
    name: Type.Optional(TBNonEmptyString),
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ZUpdateQuestionnaireTemplateRequest = z
  .object({
    name: ZNonEmptyString.optional(),
    description: z.string().optional(),
  })
  .strict();

export type UpdateQuestionnaireTemplateRequest = Static<
  typeof TBUpdateQuestionnaireTemplateRequest
>;

// Response row. `description` and `currentVersionId` are nullable on
// the DB; we surface that explicitly rather than collapsing to
// `Optional` so the front does not have to discriminate undefined vs
// null when binding to a form field.
export const TBQuestionnaireTemplate = Type.Object({
  id: TBUuid,
  tenantId: TBUuid,
  name: TBNonEmptyString,
  slug: TBQuestionnaireTemplateSlug,
  description: Type.Union([Type.String(), Type.Null()]),
  currentVersionId: Type.Union([TBUuid, Type.Null()]),
  createdAt: TBIsoDateTime,
  updatedAt: TBIsoDateTime,
});

export const ZQuestionnaireTemplate = z.object({
  id: ZUuid,
  tenantId: ZUuid,
  name: ZNonEmptyString,
  slug: ZQuestionnaireTemplateSlug,
  description: z.string().nullable(),
  currentVersionId: ZUuid.nullable(),
  createdAt: ZIsoDateTime,
  updatedAt: ZIsoDateTime,
});

export type QuestionnaireTemplate = Static<typeof TBQuestionnaireTemplate>;

export const TBQuestionnaireTemplateListResponse = Type.Object({
  items: Type.Array(TBQuestionnaireTemplate),
});

export const ZQuestionnaireTemplateListResponse = z.object({
  items: z.array(ZQuestionnaireTemplate),
});

export type QuestionnaireTemplateListResponse = Static<typeof TBQuestionnaireTemplateListResponse>;
