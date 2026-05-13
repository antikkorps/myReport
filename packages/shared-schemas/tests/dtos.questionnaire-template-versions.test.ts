import { describe, it } from 'vitest';
import {
  TBCreateQuestionnaireTemplateVersionRequest,
  TBQuestionnaireSchemaValidationError,
  TBQuestionnaireTemplateVersion,
  TBQuestionnaireTemplateVersionListQuery,
  TBQuestionnaireTemplateVersionListResponse,
  TBQuestionnaireTemplateVersionStatus,
  TBStaleVersionError,
  TBUpdateQuestionnaireTemplateVersionRequest,
  ZCreateQuestionnaireTemplateVersionRequest,
  ZQuestionnaireSchemaValidationError,
  ZQuestionnaireTemplateVersion,
  ZQuestionnaireTemplateVersionListQuery,
  ZQuestionnaireTemplateVersionListResponse,
  ZQuestionnaireTemplateVersionStatus,
  ZStaleVersionError,
  ZUpdateQuestionnaireTemplateVersionRequest,
} from '../src/dtos/questionnaire-template-versions.ts';
import { expectParity } from './parity.ts';

const UUID = '019e1b86-892b-7c75-bf6e-dff67cf530d1';
const ISO = '2026-05-12T10:00:00.000Z';
const SAMPLE = { version: 1, title: 'Sample', sections: [] };

describe('QuestionnaireTemplateVersionStatus', () => {
  it('accepts the three lifecycle states', () => {
    expectParity(TBQuestionnaireTemplateVersionStatus, ZQuestionnaireTemplateVersionStatus, {
      valid: ['draft', 'published', 'archived'],
      invalid: ['', 'frozen', 'DRAFT', 42, null],
    });
  });
});

describe('CreateVersionRequest', () => {
  it('accepts any schema body and rejects unknown keys', () => {
    expectParity(
      TBCreateQuestionnaireTemplateVersionRequest,
      ZCreateQuestionnaireTemplateVersionRequest,
      {
        valid: [
          { schema: SAMPLE },
          { schema: {} },
          { schema: { version: 1, title: 'X', sections: [] } },
        ],
        invalid: [
          {}, // missing schema
          { schema: 'not-an-object' },
          { schema: 42 },
          { schema: SAMPLE, extra: 'rejected' },
        ],
      },
    );
  });
});

describe('UpdateVersionRequest', () => {
  it('accepts schema + expectedUpdatedAt and rejects missing/extra fields', () => {
    expectParity(
      TBUpdateQuestionnaireTemplateVersionRequest,
      ZUpdateQuestionnaireTemplateVersionRequest,
      {
        valid: [
          { schema: SAMPLE, expectedUpdatedAt: ISO },
          { schema: {}, expectedUpdatedAt: ISO },
        ],
        invalid: [
          {},
          { schema: SAMPLE }, // missing expectedUpdatedAt
          { expectedUpdatedAt: ISO }, // missing schema
          { schema: SAMPLE, expectedUpdatedAt: 'not-a-date' },
          { schema: SAMPLE, expectedUpdatedAt: ISO, extra: true },
        ],
      },
    );
  });
});

describe('QuestionnaireTemplateVersion response', () => {
  it('accepts a full version row including the schema payload', () => {
    expectParity(TBQuestionnaireTemplateVersion, ZQuestionnaireTemplateVersion, {
      valid: [
        {
          id: UUID,
          templateId: UUID,
          tenantId: UUID,
          version: 1,
          status: 'draft',
          schema: SAMPLE,
          publishedAt: null,
          publishedByUserId: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
        {
          id: UUID,
          templateId: UUID,
          tenantId: UUID,
          version: 2,
          status: 'published',
          schema: SAMPLE,
          publishedAt: ISO,
          publishedByUserId: UUID,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
      invalid: [
        // bad status
        {
          id: UUID,
          templateId: UUID,
          tenantId: UUID,
          version: 1,
          status: 'frozen',
          schema: SAMPLE,
          publishedAt: null,
          publishedByUserId: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
        // version < 1
        {
          id: UUID,
          templateId: UUID,
          tenantId: UUID,
          version: 0,
          status: 'draft',
          schema: SAMPLE,
          publishedAt: null,
          publishedByUserId: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    });
  });
});

describe('ListResponse + ListQuery', () => {
  it('list response wraps items', () => {
    expectParity(
      TBQuestionnaireTemplateVersionListResponse,
      ZQuestionnaireTemplateVersionListResponse,
      {
        valid: [{ items: [] }],
        invalid: [{}],
      },
    );
  });

  it('list query accepts status filter and "all"', () => {
    expectParity(TBQuestionnaireTemplateVersionListQuery, ZQuestionnaireTemplateVersionListQuery, {
      valid: [{}, { status: 'draft' }, { status: 'all' }],
      invalid: [{ status: 'frozen' }, { status: 42 }],
    });
  });
});

describe('StaleVersionError envelope', () => {
  it('shapes the 409 payload returned when the optimistic lock fails', () => {
    expectParity(TBStaleVersionError, ZStaleVersionError, {
      valid: [
        {
          code: 'STALE_VERSION',
          message: 'version was modified',
          details: { currentUpdatedAt: ISO, currentSchema: SAMPLE },
        },
      ],
      invalid: [
        // wrong code
        {
          code: 'OTHER',
          message: 'x',
          details: { currentUpdatedAt: ISO, currentSchema: SAMPLE },
        },
        // missing details
        { code: 'STALE_VERSION', message: 'x' },
        // missing currentSchema
        { code: 'STALE_VERSION', message: 'x', details: { currentUpdatedAt: ISO } },
        // currentUpdatedAt not ISO
        {
          code: 'STALE_VERSION',
          message: 'x',
          details: { currentUpdatedAt: 'bad', currentSchema: SAMPLE },
        },
      ],
    });
  });
});

describe('SchemaValidationError envelope', () => {
  it('shapes the 400 payload returned when DSL validation rejects the body', () => {
    expectParity(TBQuestionnaireSchemaValidationError, ZQuestionnaireSchemaValidationError, {
      valid: [
        { code: 'SCHEMA_INVALID', message: 'invalid schema', issues: [] },
        {
          code: 'SCHEMA_INVALID',
          message: 'invalid schema',
          issues: [{ path: 'sections[0]', code: 'DUPLICATE_ID', message: 'oops' }],
        },
      ],
      invalid: [
        { code: 'OTHER', message: 'x', issues: [] },
        { code: 'SCHEMA_INVALID', message: 'x' }, // missing issues
      ],
    });
  });
});
