import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TBErrorResponse, ZErrorResponse } from '../src/envelopes/error.ts';
import {
  TBPaginatedResponse,
  TBPaginationMeta,
  TBPaginationQuery,
  ZPaginatedResponse,
  ZPaginationMeta,
  ZPaginationQuery,
} from '../src/envelopes/pagination.ts';
import { expectParity } from './parity.ts';

describe('ErrorResponse', () => {
  it('requires code and message, allows optional details', () => {
    expectParity(TBErrorResponse, ZErrorResponse, {
      valid: [
        { code: 'NOT_FOUND', message: 'resource missing' },
        { code: 'X', message: 'Y', details: { hint: 'try again' } },
      ],
      invalid: [
        {},
        { code: 'X' },
        { message: 'Y' },
        { code: '', message: 'Y' },
        { code: 'X', message: 'Y', details: 'not-an-object' },
      ],
    });
  });
});

describe('PaginationQuery', () => {
  it('accepts integers in [1, 200] and rejects out-of-range values', () => {
    expectParity(TBPaginationQuery, ZPaginationQuery, {
      valid: [
        { page: 1, pageSize: 1 },
        { page: 5, pageSize: 200 },
      ],
      invalid: [
        { page: 0, pageSize: 20 },
        { page: 1, pageSize: 0 },
        { page: 1, pageSize: 201 },
        { page: 1.5, pageSize: 20 },
      ],
    });
  });
});

describe('PaginationMeta', () => {
  it('requires non-negative totals', () => {
    expectParity(TBPaginationMeta, ZPaginationMeta, {
      valid: [
        { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        { page: 3, pageSize: 50, total: 137, totalPages: 3 },
      ],
      invalid: [
        { page: 0, pageSize: 20, total: 0, totalPages: 0 },
        { page: 1, pageSize: 20, total: -1, totalPages: 0 },
        { page: 1, pageSize: 20, total: 0 },
      ],
    });
  });
});

describe('PaginatedResponse', () => {
  it('wraps an item schema for both TypeBox and Zod', () => {
    const tb = TBPaginatedResponse(Type.String());
    const zod = ZPaginatedResponse(z.string());
    const ok = { data: ['a', 'b'], meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } };
    const bad = { data: ['a', 1], meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } };

    expect(Value.Check(tb, ok)).toBe(true);
    expect(zod.safeParse(ok).success).toBe(true);
    expect(Value.Check(tb, bad)).toBe(false);
    expect(zod.safeParse(bad).success).toBe(false);
  });
});
