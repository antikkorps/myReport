import { describe, it } from 'vitest';
import {
  TBUpdateMembershipRequest,
  TBUserListItem,
  ZUpdateMembershipRequest,
  ZUserListItem,
} from '../src/dtos/users.ts';
import { expectParity } from './parity.ts';

describe('UserListItem', () => {
  it('accepts the full payload, with lastLoginAt nullable', () => {
    expectParity(TBUserListItem, ZUserListItem, {
      valid: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          displayName: 'Alice',
          membershipId: '00000000-0000-0000-0000-000000000002',
          role: 'cabinet_admin',
          joinedAt: '2026-04-29T12:00:00Z',
          lastLoginAt: '2026-04-29T13:00:00Z',
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          displayName: 'Alice',
          membershipId: '00000000-0000-0000-0000-000000000002',
          role: 'auditor',
          joinedAt: '2026-04-29T12:00:00Z',
          lastLoginAt: null,
        },
      ],
      invalid: [
        {},
        {
          id: 'not-uuid',
          email: 'a@b.test',
          displayName: 'Alice',
          membershipId: '00000000-0000-0000-0000-000000000002',
          role: 'auditor',
          joinedAt: '2026-04-29T12:00:00Z',
          lastLoginAt: null,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          displayName: '',
          membershipId: '00000000-0000-0000-0000-000000000002',
          role: 'auditor',
          joinedAt: '2026-04-29T12:00:00Z',
          lastLoginAt: null,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          displayName: 'Alice',
          membershipId: '00000000-0000-0000-0000-000000000002',
          role: 'super_admin',
          joinedAt: '2026-04-29T12:00:00Z',
          lastLoginAt: null,
        },
      ],
    });
  });
});

describe('UpdateMembershipRequest', () => {
  it('accepts only the two membership roles', () => {
    expectParity(TBUpdateMembershipRequest, ZUpdateMembershipRequest, {
      valid: [{ role: 'cabinet_admin' }, { role: 'auditor' }],
      invalid: [{}, { role: '' }, { role: 'super_admin' }, { role: null }],
    });
  });
});
