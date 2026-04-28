import { describe, it } from 'vitest';
import {
  TBCreateTenantRequest,
  TBCreateTenantResponse,
  TBTenantListItem,
  TBTenantSlug,
  ZCreateTenantRequest,
  ZCreateTenantResponse,
  ZTenantListItem,
  ZTenantSlug,
} from '../src/dtos/tenants.ts';
import { expectParity } from './parity.ts';

describe('TenantSlug', () => {
  it('accepts DNS-label slugs of 3-63 chars and rejects others', () => {
    expectParity(TBTenantSlug, ZTenantSlug, {
      valid: ['demo', 'demo-cabinet', 'ab1', 'a-b', /* exact 63 */ 'a'.repeat(63)],
      invalid: [
        '',
        'ab', // too short
        'a'.repeat(64), // too long
        '-leading-dash',
        'trailing-dash-',
        'CamelCase',
        'has space',
        'snake_case',
        'éèà',
      ],
    });
  });
});

describe('CreateTenantRequest', () => {
  it('requires name + slug + firstAdmin block, with min password length', () => {
    expectParity(TBCreateTenantRequest, ZCreateTenantRequest, {
      valid: [
        {
          name: 'Acme',
          slug: 'acme',
          firstAdmin: {
            email: 'admin@acme.test',
            displayName: 'Alice',
            password: 'hunter2hunter2',
          },
        },
      ],
      invalid: [
        {},
        { name: 'A', slug: 'acme', firstAdmin: {} },
        {
          name: '',
          slug: 'acme',
          firstAdmin: { email: 'a@b.c', displayName: 'A', password: 'longenough' },
        },
        {
          name: 'A',
          slug: 'BadSlug',
          firstAdmin: { email: 'a@b.c', displayName: 'A', password: 'longenough' },
        },
        {
          name: 'A',
          slug: 'ok-slug',
          firstAdmin: { email: 'not-an-email', displayName: 'A', password: 'longenough' },
        },
        {
          name: 'A',
          slug: 'ok-slug',
          firstAdmin: { email: 'a@b.c', displayName: 'A', password: 'short' },
        },
      ],
    });
  });
});

describe('CreateTenantResponse', () => {
  it('requires tenant + firstAdmin summaries with valid uuids', () => {
    expectParity(TBCreateTenantResponse, ZCreateTenantResponse, {
      valid: [
        {
          tenant: {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Acme',
            slug: 'acme',
          },
          firstAdmin: {
            id: '00000000-0000-0000-0000-000000000002',
            email: 'admin@acme.test',
            displayName: 'Alice',
          },
        },
      ],
      invalid: [
        {},
        {
          tenant: { id: 'not-uuid', name: 'A', slug: 'acme' },
          firstAdmin: {
            id: '00000000-0000-0000-0000-000000000002',
            email: 'admin@acme.test',
            displayName: 'Alice',
          },
        },
      ],
    });
  });
});

describe('TenantListItem', () => {
  it('requires non-negative integer membershipCount and ISO createdAt', () => {
    expectParity(TBTenantListItem, ZTenantListItem, {
      valid: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
          slug: 'acme',
          createdAt: '2026-04-28T12:00:00Z',
          membershipCount: 0,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
          slug: 'acme',
          createdAt: '2026-04-28T12:00:00.123+02:00',
          membershipCount: 12,
        },
      ],
      invalid: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
          slug: 'acme',
          createdAt: 'not-a-date',
          membershipCount: 0,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
          slug: 'acme',
          createdAt: '2026-04-28T12:00:00Z',
          membershipCount: -1,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Acme',
          slug: 'acme',
          createdAt: '2026-04-28T12:00:00Z',
          membershipCount: 1.5,
        },
      ],
    });
  });
});
