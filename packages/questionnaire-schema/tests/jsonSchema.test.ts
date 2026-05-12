import { describe, expect, it } from 'vitest';
import { QUESTION_KINDS, toJsonSchema } from '../src/index.ts';

describe('toJsonSchema', () => {
  it('returns a JSON-serialisable object with the root version pinned to 1', () => {
    const schema = toJsonSchema();
    expect(schema).toMatchObject({
      type: 'object',
      properties: { version: { const: 1 } },
    });
  });

  it('mentions every question kind plus "section"', () => {
    const serialised = JSON.stringify(toJsonSchema());
    for (const kind of QUESTION_KINDS) {
      expect(serialised).toContain(`"${kind}"`);
    }
    expect(serialised).toContain('"section"');
  });

  it('returns a fresh deep copy on every call', () => {
    const a = toJsonSchema();
    const b = toJsonSchema();
    expect(a).not.toBe(b);
    (a as Record<string, unknown>)['type'] = 'tampered';
    expect((b as Record<string, unknown>)['type']).toBe('object');
  });
});
