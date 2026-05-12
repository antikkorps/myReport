import { describe, it } from 'vitest';
import {
  TBCreateQuestionnaireTemplateRequest,
  TBQuestionnaireTemplate,
  TBQuestionnaireTemplateListResponse,
  TBQuestionnaireTemplateSlug,
  TBUpdateQuestionnaireTemplateRequest,
  ZCreateQuestionnaireTemplateRequest,
  ZQuestionnaireTemplate,
  ZQuestionnaireTemplateListResponse,
  ZQuestionnaireTemplateSlug,
  ZUpdateQuestionnaireTemplateRequest,
} from '../src/dtos/questionnaire-templates.ts';
import { expectParity } from './parity.ts';

const UUID = '019e1b86-892b-7c75-bf6e-dff67cf530d1';
const ISO = '2026-05-12T10:00:00.000Z';

describe('QuestionnaireTemplateSlug', () => {
  it('accepts DNS-label slugs of 3-63 chars and rejects others', () => {
    expectParity(TBQuestionnaireTemplateSlug, ZQuestionnaireTemplateSlug, {
      valid: ['demo', 'compta-2026', 'a-b', 'a'.repeat(63)],
      invalid: ['', 'ab', 'a'.repeat(64), '-leading', 'trailing-', 'CamelCase', 'has space'],
    });
  });
});

describe('CreateQuestionnaireTemplateRequest', () => {
  it('accepts minimal and full payloads, rejects unknown keys and invalid slugs', () => {
    expectParity(TBCreateQuestionnaireTemplateRequest, ZCreateQuestionnaireTemplateRequest, {
      valid: [
        { name: 'Compta', slug: 'compta-2026' },
        { name: 'Compta', slug: 'compta-2026', description: 'desc' },
        { name: 'Compta', slug: 'compta-2026', tenantId: UUID },
      ],
      invalid: [
        {},
        { name: '', slug: 'compta-2026' },
        { name: 'Compta', slug: 'BAD-SLUG' },
        { name: 'Compta', slug: 'compta', extra: 'rejected' },
      ],
    });
  });
});

describe('UpdateQuestionnaireTemplateRequest', () => {
  it('accepts partial updates and rejects unknown keys', () => {
    expectParity(TBUpdateQuestionnaireTemplateRequest, ZUpdateQuestionnaireTemplateRequest, {
      valid: [{}, { name: 'New name' }, { description: 'new desc' }, { description: '' }],
      invalid: [
        { name: '' },
        { slug: 'compta-2027' }, // slug is immutable, must not appear
        { currentVersionId: UUID }, // managed by publish flow, not PATCH
        { unknown: true },
      ],
    });
  });
});

describe('QuestionnaireTemplate response', () => {
  it('accepts a full row and rejects malformed fields', () => {
    expectParity(TBQuestionnaireTemplate, ZQuestionnaireTemplate, {
      valid: [
        {
          id: UUID,
          tenantId: UUID,
          name: 'Compta',
          slug: 'compta-2026',
          description: null,
          currentVersionId: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
        {
          id: UUID,
          tenantId: UUID,
          name: 'Compta',
          slug: 'compta-2026',
          description: 'a desc',
          currentVersionId: UUID,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
      invalid: [
        // missing required field
        {
          tenantId: UUID,
          name: 'Compta',
          slug: 'compta-2026',
          description: null,
          currentVersionId: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
        // bad uuid
        {
          id: 'not-a-uuid',
          tenantId: UUID,
          name: 'Compta',
          slug: 'compta-2026',
          description: null,
          currentVersionId: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    });
  });
});

describe('QuestionnaireTemplateListResponse', () => {
  it('wraps a list of templates', () => {
    expectParity(TBQuestionnaireTemplateListResponse, ZQuestionnaireTemplateListResponse, {
      valid: [
        { items: [] },
        {
          items: [
            {
              id: UUID,
              tenantId: UUID,
              name: 'Compta',
              slug: 'compta-2026',
              description: null,
              currentVersionId: null,
              createdAt: ISO,
              updatedAt: ISO,
            },
          ],
        },
      ],
      invalid: [{}, { items: 'not-an-array' }],
    });
  });
});
