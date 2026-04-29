import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBEmail, ZEmail } from '../primitives/email.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../primitives/isoDateTime.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';
import { TBMembershipRole, ZMembershipRole } from './invitations.ts';

// One row of the cabinet's user list. `joinedAt` reflects the active
// membership's `created_at` (i.e. the moment the user joined this
// tenant). `lastLoginAt` is the user's global last login — null until
// they log in for the first time.
export const TBUserListItem = Type.Object({
  id: TBUuid,
  email: TBEmail,
  displayName: TBNonEmptyString,
  membershipId: TBUuid,
  role: TBMembershipRole,
  joinedAt: TBIsoDateTime,
  lastLoginAt: Type.Union([TBIsoDateTime, Type.Null()]),
});

export const ZUserListItem = z.object({
  id: ZUuid,
  email: ZEmail,
  displayName: ZNonEmptyString,
  membershipId: ZUuid,
  role: ZMembershipRole,
  joinedAt: ZIsoDateTime,
  lastLoginAt: z.union([ZIsoDateTime, z.null()]),
});

export type UserListItem = Static<typeof TBUserListItem>;

export const TBUserListResponse = Type.Object({
  items: Type.Array(TBUserListItem),
});

export const ZUserListResponse = z.object({
  items: z.array(ZUserListItem),
});

export type UserListResponse = Static<typeof TBUserListResponse>;

// Membership update. Only the role is mutable today; future fields
// (per-tenant display name, etc.) extend this object rather than
// adding new endpoints.
export const TBUpdateMembershipRequest = Type.Object({
  role: TBMembershipRole,
});

export const ZUpdateMembershipRequest = z.object({
  role: ZMembershipRole,
});

export type UpdateMembershipRequest = Static<typeof TBUpdateMembershipRequest>;

export const TBUpdateMembershipResponse = Type.Object({
  id: TBUuid,
  tenantId: TBUuid,
  userId: TBUuid,
  role: TBMembershipRole,
});

export const ZUpdateMembershipResponse = z.object({
  id: ZUuid,
  tenantId: ZUuid,
  userId: ZUuid,
  role: ZMembershipRole,
});

export type UpdateMembershipResponse = Static<typeof TBUpdateMembershipResponse>;
