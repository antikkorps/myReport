import { describe, expect, it } from 'vitest';
import { validateQuestionnaireSchema } from '../src/index.ts';
import { expectIssue, FIXED_ID, singleSection, uuid } from './helpers.ts';

describe('top-level shape', () => {
  it('rejects unknown version', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 2,
        title: 'T',
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'S',
            questions: [{ kind: 'boolean', id: uuid(), label: 'q' }],
          },
        ],
      }),
      'SHAPE',
    );
  });

  it('rejects empty sections array', () => {
    expectIssue(validateQuestionnaireSchema({ version: 1, title: 'T', sections: [] }), 'SHAPE');
  });

  it('rejects missing title', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 1,
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'S',
            questions: [{ kind: 'boolean', id: uuid(), label: 'q' }],
          },
        ],
      }),
      'SHAPE',
    );
  });

  it('rejects empty title', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 1,
        title: '',
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'S',
            questions: [{ kind: 'boolean', id: uuid(), label: 'q' }],
          },
        ],
      }),
      'SHAPE',
    );
  });

  it('rejects section with empty questions array', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 1,
        title: 'T',
        sections: [{ kind: 'section', id: uuid(), label: 'S', questions: [] }],
      }),
      'SHAPE',
    );
  });

  it('rejects nested section (section inside another section)', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 1,
        title: 'T',
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'outer',
            questions: [
              {
                kind: 'section',
                id: uuid(),
                label: 'inner',
                questions: [{ kind: 'boolean', id: uuid(), label: 'q' }],
              },
            ],
          },
        ],
      }),
      'SHAPE',
    );
  });

  it('rejects unknown question kind', () => {
    expectIssue(
      validateQuestionnaireSchema(singleSection([{ kind: 'mystery', id: uuid(), label: 'q' }])),
      'SHAPE',
    );
  });

  it('rejects malformed uuid', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'boolean', id: 'not-a-uuid', label: 'q' }]),
      ),
      'SHAPE',
    );
  });
});

describe('id uniqueness', () => {
  it('rejects duplicate question IDs across two sections', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 1,
        title: 'T',
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'A',
            questions: [{ kind: 'boolean', id: FIXED_ID, label: 'q' }],
          },
          {
            kind: 'section',
            id: uuid(),
            label: 'B',
            questions: [{ kind: 'boolean', id: FIXED_ID, label: 'q' }],
          },
        ],
      }),
      'DUPLICATE_ID',
    );
  });

  it('rejects duplicate question IDs within a single section', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          { kind: 'boolean', id: FIXED_ID, label: 'q1' },
          { kind: 'text', id: FIXED_ID, label: 'q2' },
        ]),
      ),
      'DUPLICATE_ID',
    );
  });

  it('rejects question id colliding with section id', () => {
    expectIssue(
      validateQuestionnaireSchema({
        version: 1,
        title: 'T',
        sections: [
          {
            kind: 'section',
            id: FIXED_ID,
            label: 'S',
            questions: [{ kind: 'boolean', id: FIXED_ID, label: 'q' }],
          },
        ],
      }),
      'DUPLICATE_ID',
    );
  });

  it('rejects duplicate id between a repeater and its leaf child', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'repeater',
            id: FIXED_ID,
            label: 'r',
            questions: [{ kind: 'text', id: FIXED_ID, label: 't' }],
          },
        ]),
      ),
      'DUPLICATE_ID',
    );
  });
});

describe('text / longText', () => {
  it('rejects text minLength > maxLength', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'text', id: uuid(), label: 'q', minLength: 5, maxLength: 2 }]),
      ),
      'INVALID_RANGE',
    );
  });

  it('rejects text with invalid regex pattern', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'text', id: uuid(), label: 'q', pattern: '(' }]),
      ),
      'INVALID_PATTERN',
    );
  });

  it('rejects longText minLength > maxLength', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'longText', id: uuid(), label: 'q', minLength: 9, maxLength: 1 }]),
      ),
      'INVALID_RANGE',
    );
  });
});

describe('number', () => {
  it('rejects min > max', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'number', id: uuid(), label: 'q', min: 10, max: 1 }]),
      ),
      'INVALID_RANGE',
    );
  });

  it('rejects non-integer min when integer:true', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'number', id: uuid(), label: 'q', integer: true, min: 1.5 }]),
      ),
      'INVALID_INTEGER_BOUND',
    );
  });

  it('rejects non-integer max when integer:true', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'number', id: uuid(), label: 'q', integer: true, max: 2.5 }]),
      ),
      'INVALID_INTEGER_BOUND',
    );
  });
});

describe('choice', () => {
  it('rejects empty options (singleChoice)', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'singleChoice', id: uuid(), label: 'q', options: [] }]),
      ),
      'SHAPE',
    );
  });

  it('rejects empty options (multiChoice)', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'multiChoice', id: uuid(), label: 'q', options: [] }]),
      ),
      'SHAPE',
    );
  });

  it('rejects duplicate option values', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'singleChoice',
            id: uuid(),
            label: 'q',
            options: [
              { value: 'a', label: 'A' },
              { value: 'a', label: 'B' },
            ],
          },
        ]),
      ),
      'DUPLICATE_OPTION_VALUE',
    );
  });

  it('rejects multiChoice minSelected > maxSelected', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'multiChoice',
            id: uuid(),
            label: 'q',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
            minSelected: 2,
            maxSelected: 1,
          },
        ]),
      ),
      'INVALID_RANGE',
    );
  });

  it('rejects multiChoice maxSelected > options.length', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'multiChoice',
            id: uuid(),
            label: 'q',
            options: [{ value: 'a', label: 'A' }],
            maxSelected: 5,
          },
        ]),
      ),
      'INVALID_RANGE',
    );
  });
});

describe('scale', () => {
  it('rejects min == max', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'scale', id: uuid(), label: 'q', min: 3, max: 3 }]),
      ),
      'INVALID_RANGE',
    );
  });

  it('rejects min > max', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'scale', id: uuid(), label: 'q', min: 5, max: 1 }]),
      ),
      'INVALID_RANGE',
    );
  });

  it('rejects non-integer scale bounds via shape', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'scale', id: uuid(), label: 'q', min: 0.5, max: 10 }]),
      ),
      'SHAPE',
    );
  });
});

describe('date', () => {
  it('rejects calendar-invalid date (Feb 30)', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'date', id: uuid(), label: 'q', min: '2024-02-30' }]),
      ),
      'INVALID_DATE',
    );
  });

  it('rejects pattern-invalid date string at shape level', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'date', id: uuid(), label: 'q', min: 'not-a-date' }]),
      ),
      'SHAPE',
    );
  });

  it('rejects min > max', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          { kind: 'date', id: uuid(), label: 'q', min: '2025-01-01', max: '2020-01-01' },
        ]),
      ),
      'INVALID_RANGE',
    );
  });
});

describe('attachment', () => {
  it('rejects invalid mime type', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'attachment', id: uuid(), label: 'q', mimeTypes: ['not-a-mime'] }]),
      ),
      'INVALID_MIME',
    );
  });

  it('rejects empty mimeTypes array via shape', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'attachment', id: uuid(), label: 'q', mimeTypes: [] }]),
      ),
      'SHAPE',
    );
  });
});

describe('repeater', () => {
  it('rejects a repeater nested inside another repeater', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'repeater',
            id: uuid(),
            label: 'outer',
            questions: [
              {
                kind: 'repeater',
                id: uuid(),
                label: 'inner',
                questions: [{ kind: 'boolean', id: uuid(), label: 'b' }],
              },
            ],
          },
        ]),
      ),
      'SHAPE',
    );
  });

  it('rejects empty repeater children', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'repeater', id: uuid(), label: 'r', questions: [] }]),
      ),
      'SHAPE',
    );
  });

  it('rejects minItems > maxItems', () => {
    expectIssue(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'repeater',
            id: uuid(),
            label: 'r',
            minItems: 5,
            maxItems: 2,
            questions: [{ kind: 'text', id: uuid(), label: 't' }],
          },
        ]),
      ),
      'INVALID_RANGE',
    );
  });
});

describe('issue path formatting', () => {
  it('uses bracket index notation for arrays', () => {
    const result = validateQuestionnaireSchema(
      singleSection([{ kind: 'text', id: uuid(), label: 'q', minLength: 5, maxLength: 2 }]),
    );
    if (result.ok) throw new Error('expected failure');
    const issue = result.issues.find((i) => i.code === 'INVALID_RANGE');
    expect(issue?.path).toBe('sections[0].questions[0]');
  });

  it('extends the path for nested properties', () => {
    const result = validateQuestionnaireSchema(
      singleSection([{ kind: 'text', id: uuid(), label: 'q', pattern: '(' }]),
    );
    if (result.ok) throw new Error('expected failure');
    const issue = result.issues.find((i) => i.code === 'INVALID_PATTERN');
    expect(issue?.path).toBe('sections[0].questions[0].pattern');
  });

  it('points inside a repeater child', () => {
    const result = validateQuestionnaireSchema(
      singleSection([
        {
          kind: 'repeater',
          id: uuid(),
          label: 'r',
          questions: [
            {
              kind: 'singleChoice',
              id: uuid(),
              label: 'pick',
              options: [
                { value: 'a', label: 'A' },
                { value: 'a', label: 'B' },
              ],
            },
          ],
        },
      ]),
    );
    if (result.ok) throw new Error('expected failure');
    const issue = result.issues.find((i) => i.code === 'DUPLICATE_OPTION_VALUE');
    expect(issue?.path).toBe('sections[0].questions[0].questions[0].options[1]');
  });
});
