import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { expect } from 'vitest';
import type { ZodType } from 'zod';

/**
 * Asserts that a TypeBox schema and its Zod counterpart accept and reject
 * the same inputs. Catches drift between the two declarations.
 */
export function expectParity<T extends TSchema, Z extends ZodType>(
  tb: T,
  zod: Z,
  cases: { valid: readonly unknown[]; invalid: readonly unknown[] },
): void {
  for (const input of cases.valid) {
    expect(Value.Check(tb, input), `TypeBox should accept ${JSON.stringify(input)}`).toBe(true);
    const zResult = zod.safeParse(input);
    expect(zResult.success, `Zod should accept ${JSON.stringify(input)}`).toBe(true);
  }
  for (const input of cases.invalid) {
    expect(Value.Check(tb, input), `TypeBox should reject ${JSON.stringify(input)}`).toBe(false);
    const zResult = zod.safeParse(input);
    expect(zResult.success, `Zod should reject ${JSON.stringify(input)}`).toBe(false);
  }
}
