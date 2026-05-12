import { describe, it } from 'vitest';
import { validateQuestionnaireSchema } from '../src/index.ts';
import { expectOk, singleSection, uuid } from './helpers.ts';

describe('happy paths — one example per kind', () => {
  it('accepts text with full options', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'text',
            id: uuid(),
            label: 'name',
            required: true,
            minLength: 1,
            maxLength: 80,
            pattern: '^[A-Za-z ]+$',
          },
        ]),
      ),
    );
  });

  it('accepts longText', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'longText', id: uuid(), label: 'notes', maxLength: 2000 }]),
      ),
    );
  });

  it('accepts number with integer constraint', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          { kind: 'number', id: uuid(), label: 'count', min: 0, max: 100, integer: true },
        ]),
      ),
    );
  });

  it('accepts boolean', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([{ kind: 'boolean', id: uuid(), label: 'agree', required: true }]),
      ),
    );
  });

  it('accepts singleChoice', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'singleChoice',
            id: uuid(),
            label: 'pick',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          },
        ]),
      ),
    );
  });

  it('accepts multiChoice with selection bounds', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'multiChoice',
            id: uuid(),
            label: 'pick',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
              { value: 'c', label: 'C' },
            ],
            minSelected: 1,
            maxSelected: 2,
          },
        ]),
      ),
    );
  });

  it('accepts scale', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'scale',
            id: uuid(),
            label: 'satisfaction',
            min: 0,
            max: 10,
            minLabel: 'low',
            maxLabel: 'high',
          },
        ]),
      ),
    );
  });

  it('accepts date with bounds', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'date',
            id: uuid(),
            label: 'when',
            min: '2020-01-01',
            max: '2025-12-31',
          },
        ]),
      ),
    );
  });

  it('accepts attachment with constraints', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'attachment',
            id: uuid(),
            label: 'proof',
            maxFiles: 3,
            maxSizeBytes: 1024 * 1024,
            mimeTypes: ['image/png', 'image/*', 'application/pdf'],
          },
        ]),
      ),
    );
  });

  it('accepts repeater with leaf children', () => {
    expectOk(
      validateQuestionnaireSchema(
        singleSection([
          {
            kind: 'repeater',
            id: uuid(),
            label: 'rows',
            minItems: 1,
            maxItems: 5,
            addLabel: 'Add row',
            questions: [
              { kind: 'text', id: uuid(), label: 'name' },
              { kind: 'number', id: uuid(), label: 'amount' },
            ],
          },
        ]),
      ),
    );
  });

  it('accepts schema with top-level + section descriptions', () => {
    expectOk(
      validateQuestionnaireSchema({
        version: 1,
        title: 'T',
        description: 'top-level description',
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'S',
            description: 'section description',
            questions: [{ kind: 'boolean', id: uuid(), label: 'q' }],
          },
        ],
      }),
    );
  });

  it('accepts a multi-section schema', () => {
    expectOk(
      validateQuestionnaireSchema({
        version: 1,
        title: 'T',
        sections: [
          {
            kind: 'section',
            id: uuid(),
            label: 'A',
            questions: [{ kind: 'boolean', id: uuid(), label: 'q1' }],
          },
          {
            kind: 'section',
            id: uuid(),
            label: 'B',
            questions: [{ kind: 'text', id: uuid(), label: 'q2' }],
          },
        ],
      }),
    );
  });
});
