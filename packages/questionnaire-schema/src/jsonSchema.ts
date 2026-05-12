import { TQuestionnaireSchema } from './schema.ts';

// Detached deep copy: TypeBox schemas are JSON Schema (Draft 2020-12)
// compatible, but Monaco workers may mutate the object they receive.
export function toJsonSchema(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(TQuestionnaireSchema));
}
