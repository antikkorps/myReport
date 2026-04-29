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
  it('requires name + slug + adminEmail (no password/displayName at this stage)', () => {
    expectParity(TBCreateTenantRequest, ZCreateTenantRequest, {
      valid: [{ name: 'Acme', slug: 'acme', adminEmail: 'admin@acme.test' }],
      invalid: [
        {},
        { name: 'A', slug: 'acme' },
        { name: '', slug: 'acme', adminEmail: 'a@b.c' },
        { name: 'A', slug: 'BadSlug', adminEmail: 'a@b.c' },
        { name: 'A', slug: 'ok-slug', adminEmail: 'not-an-email' },
        // Legacy shape must be rejected so a stale front cannot succeed
        // by accident against the new API.
        {
          name: 'A',
          slug: 'ok-slug',
          firstAdmin: { email: 'a@b.c', displayName: 'A', password: 'longenough' },
        },
      ],
    });
  });
});

describe('CreateTenantResponse', () => {
  it('requires tenant + invitation summaries with valid uuids and ISO expiresAt', () => {
    expectParity(TBCreateTenantResponse, ZCreateTenantResponse, {
      valid: [
        {
          tenant: {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Acme',
            slug: 'acme',
          },
          invitation: {
            id: '00000000-0000-0000-0000-000000000002',
            email: 'admin@acme.test',
            role: 'cabinet_admin',
            expiresAt: '2026-05-06T10:00:00Z',
            acceptUrl: 'http://localhost:5173/invitations/accept?token=abc',
          },
        },
      ],
      invalid: [
        {},
        {
          tenant: { id: 'not-uuid', name: 'A', slug: 'acme' },
          invitation: {
            id: '00000000-0000-0000-0000-000000000002',
            email: 'admin@acme.test',
            role: 'cabinet_admin',
            expiresAt: '2026-05-06T10:00:00Z',
            acceptUrl: 'http://localhost:5173/invitations/accept?token=abc',
          },
        },
        {
          tenant: { id: '00000000-0000-0000-0000-000000000001', name: 'A', slug: 'acme' },
          invitation: {
            id: '00000000-0000-0000-0000-000000000002',
            email: 'admin@acme.test',
            role: 'super_admin',
            expiresAt: '2026-05-06T10:00:00Z',
            acceptUrl: 'http://localhost:5173/invitations/accept?token=abc',
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
