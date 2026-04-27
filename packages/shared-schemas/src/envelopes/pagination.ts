import { type Static, type TSchema, Type } from '@sinclair/typebox';
import { type ZodType, z } from 'zod';

export const TBPaginationQuery = Type.Object(
  {
    page: Type.Integer({ minimum: 1, default: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 200, default: 20 }),
  },
  { $id: 'PaginationQuery' },
);

export const ZPaginationQuery = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(20),
});

export type PaginationQuery = Static<typeof TBPaginationQuery>;

export const TBPaginationMeta = Type.Object(
  {
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 0 }),
  },
  { $id: 'PaginationMeta' },
);

export const ZPaginationMeta = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export type PaginationMeta = Static<typeof TBPaginationMeta>;

export const TBPaginatedResponse = <T extends TSchema>(item: T) =>
  Type.Object({
    data: Type.Array(item),
    meta: TBPaginationMeta,
  });

export const ZPaginatedResponse = <T extends ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    meta: ZPaginationMeta,
  });
