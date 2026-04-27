import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';

export const TBErrorResponse = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'ErrorResponse' },
);

export const ZErrorResponse = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ErrorResponse = Static<typeof TBErrorResponse>;
