import { describe, it } from 'vitest';
import { TBEmail, ZEmail } from '../src/primitives/email.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../src/primitives/isoDateTime.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../src/primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../src/primitives/uuid.ts';
import { expectParity } from './parity.ts';

describe('Uuid', () => {
  it('accepts canonical uuids and rejects malformed strings', () => {
    expectParity(TBUuid, ZUuid, {
      valid: [
        '00000000-0000-0000-0000-000000000000',
        '0190b3f9-3a7c-7c3a-9b29-1e9c0f3a4b21', // uuid v7
        'A1B2C3D4-E5F6-7890-ABCD-EF1234567890',
      ],
      invalid: [
        '',
        'not-a-uuid',
        '0190b3f9-3a7c-7c3a-9b29-1e9c0f3a4b2', // too short
        '0190b3f9-3a7c-7c3a-9b29-1e9c0f3a4b211', // too long
        '0190b3f9_3a7c_7c3a_9b29_1e9c0f3a4b21', // wrong separator
        42,
        null,
      ],
    });
  });
});

describe('Email', () => {
  it('accepts simple emails and rejects malformed inputs', () => {
    expectParity(TBEmail, ZEmail, {
      valid: ['user@example.com', 'a.b+tag@sub.example.co', 'x@y.z'],
      invalid: [
        '',
        'no-at-sign',
        'no-domain@',
        '@no-local',
        'spaces in@example.com',
        'a@b',
        // 321-char local part exceeds maxLength 320
        `${'a'.repeat(310)}@example.com`,
        42,
        null,
      ],
    });
  });
});

describe('NonEmptyString', () => {
  it('accepts any non-empty string and rejects empty/non-strings', () => {
    expectParity(TBNonEmptyString, ZNonEmptyString, {
      valid: ['a', 'hello world', ' '],
      invalid: ['', 0, null, undefined, []],
    });
  });
});

describe('IsoDateTime', () => {
  it('accepts ISO 8601 with timezone designator and rejects naive/loose forms', () => {
    expectParity(TBIsoDateTime, ZIsoDateTime, {
      valid: [
        '2026-04-27T12:34:56Z',
        '2026-04-27T12:34:56.123Z',
        '2026-04-27T12:34:56+02:00',
        '2026-04-27T12:34:56.123456789-05:00',
      ],
      invalid: [
        '',
        '2026-04-27', // date only
        '2026-04-27 12:34:56Z', // space separator
        '2026-04-27T12:34:56', // missing zone
        'not a date',
        42,
      ],
    });
  });
});
