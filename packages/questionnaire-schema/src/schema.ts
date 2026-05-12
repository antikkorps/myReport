import { TBNonEmptyString } from '@myreport/shared-schemas/primitives';
import { type Static, Type } from '@sinclair/typebox';
import { TSection } from './questions.ts';

export const QUESTIONNAIRE_SCHEMA_FORMAT_VERSION = 1 as const;

export const TQuestionnaireSchema = Type.Object({
  version: Type.Literal(QUESTIONNAIRE_SCHEMA_FORMAT_VERSION),
  title: TBNonEmptyString,
  description: Type.Optional(Type.String()),
  sections: Type.Array(TSection, { minItems: 1 }),
});

export type QuestionnaireSchema = Static<typeof TQuestionnaireSchema>;
