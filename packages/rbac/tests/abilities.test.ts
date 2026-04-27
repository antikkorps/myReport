import { describe, expect, it } from 'vitest';
import { type AbilityContext, defineAbilitiesFor } from '../src/abilities.ts';

const TENANT_A = '0190b3f9-aaaa-7c3a-9b29-1e9c0f3a4b21';
const TENANT_B = '0190b3f9-bbbb-7c3a-9b29-1e9c0f3a4b21';
const USER_X = '0190b3f9-cccc-7c3a-9b29-1e9c0f3a4b21';
const USER_Y = '0190b3f9-dddd-7c3a-9b29-1e9c0f3a4b21';
const MISSION_LEAD = '0190b3f9-1111-7c3a-9b29-1e9c0f3a4b21';
const MISSION_CONTRIB = '0190b3f9-2222-7c3a-9b29-1e9c0f3a4b21';
const MISSION_OBS = '0190b3f9-3333-7c3a-9b29-1e9c0f3a4b21';
const MISSION_OUTSIDE = '0190b3f9-4444-7c3a-9b29-1e9c0f3a4b21';

function ctx(overrides: Partial<AbilityContext> = {}): AbilityContext {
  return {
    user: { id: USER_X, isSuperAdmin: false },
    tenantId: TENANT_A,
    tenantRole: 'auditor',
    missionMemberships: [],
    ...overrides,
  };
}

describe('super_admin', () => {
  it('can manage everything', () => {
    const a = defineAbilitiesFor(
      ctx({
        user: { id: USER_X, isSuperAdmin: true },
        tenantId: null,
        tenantRole: null,
      }),
    );
    expect(a.can('manage', 'Tenant')).toBe(true);
    expect(a.can('delete', 'Mission')).toBe(true);
    expect(a.can('close', 'Mission')).toBe(true);
  });
});

describe('user with no active tenant', () => {
  it('can read its own profile but nothing else', () => {
    const a = defineAbilitiesFor(ctx({ tenantId: null, tenantRole: null }));
    expect(a.can('read', { __subject: 'User', id: USER_X })).toBe(true);
    expect(a.can('read', { __subject: 'User', id: USER_Y })).toBe(false);
    expect(a.can('read', 'Mission')).toBe(false);
  });
});

describe('cabinet_admin', () => {
  const admin = defineAbilitiesFor(ctx({ tenantRole: 'cabinet_admin' }));

  it('manages everything inside the tenant', () => {
    expect(admin.can('update', { __subject: 'Tenant', id: TENANT_A })).toBe(true);
    expect(
      admin.can('manage', {
        __subject: 'Membership',
        id: 'm',
        tenantId: TENANT_A,
        userId: USER_Y,
        role: 'auditor',
      }),
    ).toBe(true);
    expect(
      admin.can('delete', { __subject: 'Mission', id: MISSION_LEAD, tenantId: TENANT_A }),
    ).toBe(true);
    expect(admin.can('close', { __subject: 'Mission', id: MISSION_LEAD, tenantId: TENANT_A })).toBe(
      true,
    );
  });

  it('does not see other tenants', () => {
    expect(admin.can('update', { __subject: 'Tenant', id: TENANT_B })).toBe(false);
    expect(
      admin.can('read', { __subject: 'Mission', id: MISSION_OUTSIDE, tenantId: TENANT_B }),
    ).toBe(false);
  });
});

describe('auditor — mission member', () => {
  const auditor = defineAbilitiesFor(
    ctx({
      missionMemberships: [
        { missionId: MISSION_LEAD, role: 'lead' },
        { missionId: MISSION_CONTRIB, role: 'contributor' },
        { missionId: MISSION_OBS, role: 'observer' },
      ],
    }),
  );

  it('reads tenant + own user', () => {
    expect(auditor.can('read', { __subject: 'Tenant', id: TENANT_A })).toBe(true);
    expect(auditor.can('read', { __subject: 'User', id: USER_X })).toBe(true);
  });

  it('cannot manage tenant or other users', () => {
    expect(auditor.can('update', { __subject: 'Tenant', id: TENANT_A })).toBe(false);
    expect(auditor.can('delete', { __subject: 'User', id: USER_Y })).toBe(false);
  });

  it('lead: update + submit + manage members for their missions only', () => {
    expect(
      auditor.can('update', { __subject: 'Mission', id: MISSION_LEAD, tenantId: TENANT_A }),
    ).toBe(true);
    expect(
      auditor.can('submit', { __subject: 'Mission', id: MISSION_LEAD, tenantId: TENANT_A }),
    ).toBe(true);
    expect(
      auditor.can('manage', {
        __subject: 'MissionMember',
        id: 'mm',
        tenantId: TENANT_A,
        missionId: MISSION_LEAD,
        userId: USER_Y,
        role: 'contributor',
      }),
    ).toBe(true);
  });

  it('lead never gets close (cabinet_admin only)', () => {
    expect(
      auditor.can('close', { __subject: 'Mission', id: MISSION_LEAD, tenantId: TENANT_A }),
    ).toBe(false);
  });

  it('contributor: update on their mission, no submit', () => {
    expect(
      auditor.can('update', { __subject: 'Mission', id: MISSION_CONTRIB, tenantId: TENANT_A }),
    ).toBe(true);
    expect(
      auditor.can('submit', { __subject: 'Mission', id: MISSION_CONTRIB, tenantId: TENANT_A }),
    ).toBe(false);
  });

  it('observer: read but never update', () => {
    expect(auditor.can('read', { __subject: 'Mission', id: MISSION_OBS, tenantId: TENANT_A })).toBe(
      true,
    );
    expect(
      auditor.can('update', { __subject: 'Mission', id: MISSION_OBS, tenantId: TENANT_A }),
    ).toBe(false);
  });

  it('cannot touch missions they are not a member of', () => {
    expect(
      auditor.can('read', { __subject: 'Mission', id: MISSION_OUTSIDE, tenantId: TENANT_A }),
    ).toBe(false);
    expect(
      auditor.can('update', { __subject: 'Mission', id: MISSION_OUTSIDE, tenantId: TENANT_A }),
    ).toBe(false);
  });
});

describe('auditor without missions', () => {
  it('can read tenant but no missions', () => {
    const a = defineAbilitiesFor(ctx());
    expect(a.can('read', { __subject: 'Tenant', id: TENANT_A })).toBe(true);
    expect(a.can('read', 'Mission')).toBe(false);
  });
});
