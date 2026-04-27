import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';

// RFC 3339 / ISO 8601 with mandatory time zone designator (Z or ±HH:MM).
const ISO_DATETIME_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$';
const ISO_DATETIME_REGEX = new RegExp(ISO_DATETIME_PATTERN);

export const TBIsoDateTime = Type.String({
  format: 'date-time',
  pattern: ISO_DATETIME_PATTERN,
  $id: 'IsoDateTime',
});

export const ZIsoDateTime = z
  .string()
  .regex(ISO_DATETIME_REGEX, { message: 'invalid ISO 8601 date-time' });

export type IsoDateTime = Static<typeof TBIsoDateTime>;
