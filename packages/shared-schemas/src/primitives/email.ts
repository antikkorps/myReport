import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';

const EMAIL_PATTERN = '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$';
const EMAIL_REGEX = new RegExp(EMAIL_PATTERN);

export const TBEmail = Type.String({
  format: 'email',
  pattern: EMAIL_PATTERN,
  maxLength: 320,
  $id: 'Email',
});

export const ZEmail = z
  .string()
  .max(320, { message: 'email too long' })
  .regex(EMAIL_REGEX, { message: 'invalid email' });

export type Email = Static<typeof TBEmail>;
