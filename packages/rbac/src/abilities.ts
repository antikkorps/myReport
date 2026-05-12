import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { Action } from './actions.ts';
import type { MissionRole, Subject, SubjectName, TenantRole } from './subjects.ts';

// CASL's matchers operate either on a subject *name* (string) or a
// typed instance. We expose both via a discriminated union so policies
// like `ability.can('update', mission)` work the same as
// `ability.can('read', 'Mission')`. `'all'` is CASL's built-in
// wildcard, used by super-admin rules.
export type AppAbility = MongoAbility<[Action, 'all' | SubjectName | Subject]>;

// Tells CASL how to extract the subject type from an instance. Without
// this it defaults to the constructor name, which doesn't apply to our
// plain-object subjects.
function detectSubjectType(value: object): SubjectName {
  return (value as { __subject: SubjectName }).__subject;
}

export interface MissionMembershipContext {
  missionId: string;
  role: MissionRole;
}

export interface AbilityContext {
  user: { id: string; isSuperAdmin: boolean };
  tenantId: string | null;
  tenantRole: TenantRole | null;
  // List of mission roles the user holds inside the current tenant.
  // Empty for cabinet_admins (they see everything in the tenant
  // anyway) and for users not yet assigned to any mission.
  missionMemberships: readonly MissionMembershipContext[];
}

export function defineAbilitiesFor(ctx: AbilityContext): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (ctx.user.isSuperAdmin) {
    can('manage', 'all');
    return build({ detectSubjectType });
  }

  if (!ctx.tenantId || !ctx.tenantRole) {
    // Authenticated user with no active tenant. They keep visibility on
    // their own profile (so the tenant picker UI can render) but can't
    // do anything else until a tenant is selected.
    can('read', 'User', { id: ctx.user.id } as never);
    return build({ detectSubjectType });
  }

  // Common to every member of the tenant.
  can('read', 'Tenant', { id: ctx.tenantId } as never);
  can('read', 'User', { id: ctx.user.id } as never);
  can('update', 'User', { id: ctx.user.id } as never);

  if (ctx.tenantRole === 'cabinet_admin') {
    // Full control over the tenant's own data. RLS still scopes the
    // query layer so we don't repeat tenantId conditions everywhere —
    // these abilities only narrow what's already tenant-bound.
    //
    // Tenant CRUD is intentionally restricted: cabinet_admin manages
    // content inside their tenant, not the tenant entity itself.
    // Creating or deleting Tenant rows is super_admin-only.
    can(['read', 'update'], 'Tenant', { id: ctx.tenantId } as never);
    can('manage', 'User');
    can('manage', 'Membership', { tenantId: ctx.tenantId } as never);
    can('manage', 'Mission', { tenantId: ctx.tenantId } as never);
    can('manage', 'MissionMember', { tenantId: ctx.tenantId } as never);
    can('manage', 'Invitation', { tenantId: ctx.tenantId } as never);
    can('manage', 'Template', { tenantId: ctx.tenantId } as never);
    return build({ detectSubjectType });
  }

  // Auditor — visibility on the tenant + on missions they participate
  // in. Per-mission permissions key off `mission_member_role`.
  can('read', 'Membership', { tenantId: ctx.tenantId, userId: ctx.user.id } as never);

  const leadMissionIds = ctx.missionMemberships
    .filter((m) => m.role === 'lead')
    .map((m) => m.missionId);
  const contributorMissionIds = ctx.missionMemberships
    .filter((m) => m.role === 'contributor')
    .map((m) => m.missionId);
  const visibleMissionIds = ctx.missionMemberships.map((m) => m.missionId);

  if (visibleMissionIds.length > 0) {
    can('read', 'Mission', { id: { $in: visibleMissionIds } } as never);
    can('read', 'MissionMember', { missionId: { $in: visibleMissionIds } } as never);
  }

  if (contributorMissionIds.length > 0) {
    can('update', 'Mission', { id: { $in: contributorMissionIds } } as never);
  }

  if (leadMissionIds.length > 0) {
    // Lead = own the mission lifecycle: edit metadata, submit for
    // cabinet review, manage who participates. Closing remains a
    // cabinet_admin operation by design.
    can('update', 'Mission', { id: { $in: leadMissionIds } } as never);
    can('submit', 'Mission', { id: { $in: leadMissionIds } } as never);
    can('manage', 'MissionMember', { missionId: { $in: leadMissionIds } } as never);
  }

  // Observers explicitly cannot mutate, even when bundled into the
  // visible-missions read above. The cannot() narrows the read-only
  // intent in case future rules grow looser.
  cannot('update', 'Mission', {
    id: {
      $in: ctx.missionMemberships.filter((m) => m.role === 'observer').map((m) => m.missionId),
    },
  } as never);

  return build({ detectSubjectType });
}
