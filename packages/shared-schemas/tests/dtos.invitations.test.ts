import { describe, it } from 'vitest';
import {
  TBAcceptInvitationRequest,
  TBCreateInvitationRequest,
  TBInvitationListItem,
  TBInvitationStatus,
  TBMembershipRole,
  ZAcceptInvitationRequest,
  ZCreateInvitationRequest,
  ZInvitationListItem,
  ZInvitationStatus,
  ZMembershipRole,
} from '../src/dtos/invitations.ts';
import { expectParity } from './parity.ts';

describe('MembershipRole', () => {
  it('accepts cabinet_admin and auditor only', () => {
    expectParity(TBMembershipRole, ZMembershipRole, {
      valid: ['cabinet_admin', 'auditor'],
      invalid: ['super_admin', 'admin', '', null, undefined, 0, 'AUDITOR'],
    });
  });
});

describe('InvitationStatus', () => {
  it('accepts the four computed states', () => {
    expectParity(TBInvitationStatus, ZInvitationStatus, {
      valid: ['pending', 'expired', 'consumed', 'revoked'],
      invalid: ['accepted', '', 'PENDING', null, 0],
    });
  });
});

describe('CreateInvitationRequest', () => {
  it('requires email + role and accepts an optional tenantId', () => {
    expectParity(TBCreateInvitationRequest, ZCreateInvitationRequest, {
      valid: [
        { email: 'a@b.test', role: 'auditor' },
        { email: 'a@b.test', role: 'cabinet_admin' },
        {
          email: 'a@b.test',
          role: 'cabinet_admin',
          tenantId: '00000000-0000-0000-0000-000000000001',
        },
      ],
      invalid: [
        {},
        { email: 'a@b.test' },
        { role: 'auditor' },
        { email: 'not-an-email', role: 'auditor' },
        { email: 'a@b.test', role: 'super_admin' },
        { email: 'a@b.test', role: 'auditor', tenantId: 'not-uuid' },
      ],
    });
  });
});

describe('AcceptInvitationRequest', () => {
  it('requires a >=8 char password and a non-empty displayName', () => {
    expectParity(TBAcceptInvitationRequest, ZAcceptInvitationRequest, {
      valid: [{ password: 'longenough', displayName: 'Alice' }],
      invalid: [
        {},
        { password: 'short', displayName: 'Alice' },
        { password: 'longenough', displayName: '' },
        { password: 'a'.repeat(1025), displayName: 'Alice' },
      ],
    });
  });
});

describe('InvitationListItem', () => {
  it('accepts the full payload with optional null timestamps', () => {
    expectParity(TBInvitationListItem, ZInvitationListItem, {
      valid: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          role: 'auditor',
          tenantId: '00000000-0000-0000-0000-000000000002',
          status: 'pending',
          expiresAt: '2026-05-01T00:00:00Z',
          createdAt: '2026-04-29T12:00:00Z',
          consumedAt: null,
          revokedAt: null,
          invitedByEmail: 'inviter@b.test',
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          role: 'cabinet_admin',
          tenantId: '00000000-0000-0000-0000-000000000002',
          status: 'consumed',
          expiresAt: '2026-05-01T00:00:00Z',
          createdAt: '2026-04-29T12:00:00Z',
          consumedAt: '2026-04-29T13:00:00Z',
          revokedAt: null,
          invitedByEmail: null,
        },
      ],
      invalid: [
        {},
        {
          id: 'not-uuid',
          email: 'a@b.test',
          role: 'auditor',
          tenantId: '00000000-0000-0000-0000-000000000002',
          status: 'pending',
          expiresAt: '2026-05-01T00:00:00Z',
          createdAt: '2026-04-29T12:00:00Z',
          consumedAt: null,
          revokedAt: null,
          invitedByEmail: null,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'a@b.test',
          role: 'auditor',
          tenantId: '00000000-0000-0000-0000-000000000002',
          status: 'pending',
          expiresAt: 'not-a-date',
          createdAt: '2026-04-29T12:00:00Z',
          consumedAt: null,
          revokedAt: null,
          invitedByEmail: null,
        },
      ],
    });
  });
});
