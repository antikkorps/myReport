import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const UUID_REGEX = new RegExp(UUID_PATTERN);

export const TBUuid = Type.String({
  format: 'uuid',
  pattern: UUID_PATTERN,
});

export const ZUuid = z.string().regex(UUID_REGEX, { message: 'invalid uuid' });

export type Uuid = Static<typeof TBUuid>;
