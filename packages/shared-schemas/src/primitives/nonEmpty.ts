import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';

export const TBNonEmptyString = Type.String({
  minLength: 1,
  $id: 'NonEmptyString',
});

export const ZNonEmptyString = z.string().min(1, { message: 'must not be empty' });

export type NonEmptyString = Static<typeof TBNonEmptyString>;
