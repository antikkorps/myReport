import { TBNonEmptyString, TBUuid } from '@myreport/shared-schemas/primitives';
import { type Static, Type } from '@sinclair/typebox';

const QuestionBase = {
  id: TBUuid,
  label: TBNonEmptyString,
  description: Type.Optional(Type.String()),
  required: Type.Optional(Type.Boolean()),
};

export const TText = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('text'),
  minLength: Type.Optional(Type.Integer({ minimum: 0 })),
  maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
  pattern: Type.Optional(Type.String({ minLength: 1 })),
});
export type TextQuestion = Static<typeof TText>;

export const TLongText = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('longText'),
  minLength: Type.Optional(Type.Integer({ minimum: 0 })),
  maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type LongTextQuestion = Static<typeof TLongText>;

export const TNumber = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('number'),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  integer: Type.Optional(Type.Boolean()),
});
export type NumberQuestion = Static<typeof TNumber>;

export const TBoolean = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('boolean'),
});
export type BooleanQuestion = Static<typeof TBoolean>;

export const TChoiceOption = Type.Object({
  value: TBNonEmptyString,
  label: TBNonEmptyString,
});
export type ChoiceOption = Static<typeof TChoiceOption>;

export const TSingleChoice = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('singleChoice'),
  options: Type.Array(TChoiceOption, { minItems: 1 }),
});
export type SingleChoiceQuestion = Static<typeof TSingleChoice>;

export const TMultiChoice = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('multiChoice'),
  options: Type.Array(TChoiceOption, { minItems: 1 }),
  minSelected: Type.Optional(Type.Integer({ minimum: 0 })),
  maxSelected: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type MultiChoiceQuestion = Static<typeof TMultiChoice>;

export const TScale = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('scale'),
  min: Type.Integer(),
  max: Type.Integer(),
  minLabel: Type.Optional(TBNonEmptyString),
  maxLabel: Type.Optional(TBNonEmptyString),
});
export type ScaleQuestion = Static<typeof TScale>;

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const TDate = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('date'),
  min: Type.Optional(Type.String({ pattern: ISO_DATE_PATTERN })),
  max: Type.Optional(Type.String({ pattern: ISO_DATE_PATTERN })),
});
export type DateQuestion = Static<typeof TDate>;

export const TAttachment = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('attachment'),
  maxFiles: Type.Optional(Type.Integer({ minimum: 1 })),
  maxSizeBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  mimeTypes: Type.Optional(Type.Array(TBNonEmptyString, { minItems: 1 })),
});
export type AttachmentQuestion = Static<typeof TAttachment>;

export const TLeafQuestion = Type.Union([
  TText,
  TLongText,
  TNumber,
  TBoolean,
  TSingleChoice,
  TMultiChoice,
  TScale,
  TDate,
  TAttachment,
]);
export type LeafQuestion = Static<typeof TLeafQuestion>;

export const TRepeater = Type.Object({
  ...QuestionBase,
  kind: Type.Literal('repeater'),
  minItems: Type.Optional(Type.Integer({ minimum: 0 })),
  maxItems: Type.Optional(Type.Integer({ minimum: 1 })),
  addLabel: Type.Optional(TBNonEmptyString),
  questions: Type.Array(TLeafQuestion, { minItems: 1 }),
});
export type RepeaterQuestion = Static<typeof TRepeater>;

export const TSectionContent = Type.Union([TLeafQuestion, TRepeater]);
export type SectionContent = Static<typeof TSectionContent>;

export const TSection = Type.Object({
  kind: Type.Literal('section'),
  id: TBUuid,
  label: TBNonEmptyString,
  description: Type.Optional(Type.String()),
  questions: Type.Array(TSectionContent, { minItems: 1 }),
});
export type Section = Static<typeof TSection>;

export type AnyNode = Section | LeafQuestion | RepeaterQuestion;

export const QUESTION_KINDS = [
  'text',
  'longText',
  'number',
  'boolean',
  'singleChoice',
  'multiChoice',
  'scale',
  'date',
  'attachment',
  'repeater',
] as const;

export type LeafKind = Exclude<(typeof QUESTION_KINDS)[number], 'repeater'>;
export type AnyKind = (typeof QUESTION_KINDS)[number] | 'section';
