import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBEmail, ZEmail } from '../primitives/email.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../primitives/isoDateTime.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';
import {
  TBAuthenticatedTenant,
  TBAuthenticatedUser,
  ZAuthenticatedTenant,
  ZAuthenticatedUser,
} from './auth.ts';

// Tenant-level role granted by an invitation. Mirrors the Postgres
// `membership_role` enum and the CASL `TenantRole` union.
export const TBMembershipRole = Type.Union([
  Type.Literal('cabinet_admin'),
  Type.Literal('auditor'),
]);
export const ZMembershipRole = z.union([z.literal('cabinet_admin'), z.literal('auditor')]);

export type MembershipRole = Static<typeof TBMembershipRole>;

// Computed status. The DB stores three timestamps (consumed_at,
// revoked_at, expires_at); the API surface flattens them so the front
// can render and filter without re-deriving the rule.
export const TBInvitationStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('expired'),
  Type.Literal('consumed'),
  Type.Literal('revoked'),
]);
export const ZInvitationStatus = z.union([
  z.literal('pending'),
  z.literal('expired'),
  z.literal('consumed'),
  z.literal('revoked'),
]);

export type InvitationStatus = Static<typeof TBInvitationStatus>;

// Create. `tenantId` is required for super_admin (no implicit tenant
// context) and rejected for cabinet_admin (their tenant comes from the
// auth context — accepting it in the body would invite confusion).
// The route enforces the role-aware rule; the schema only checks shape.
export const TBCreateInvitationRequest = Type.Object({
  email: TBEmail,
  role: TBMembershipRole,
  tenantId: Type.Optional(TBUuid),
});

export const ZCreateInvitationRequest = z.object({
  email: ZEmail,
  role: ZMembershipRole,
  tenantId: ZUuid.optional(),
});

export type CreateInvitationRequest = Static<typeof TBCreateInvitationRequest>;

// Returned on successful create. `acceptUrl` includes the clear token —
// safe because the inviter is authorised and they would receive it via
// the email anyway. Exposing it in the HTTP response makes dev (with
// the console driver) and admin tooling much easier.
export const TBCreateInvitationResponse = Type.Object({
  id: TBUuid,
  email: TBEmail,
  role: TBMembershipRole,
  tenantId: TBUuid,
  expiresAt: TBIsoDateTime,
  acceptUrl: TBNonEmptyString,
});

export const ZCreateInvitationResponse = z.object({
  id: ZUuid,
  email: ZEmail,
  role: ZMembershipRole,
  tenantId: ZUuid,
  expiresAt: ZIsoDateTime,
  acceptUrl: ZNonEmptyString,
});

export type CreateInvitationResponse = Static<typeof TBCreateInvitationResponse>;

// List item. The `invitedByEmail` field is denormalised from
// `users.email` for the listing UI; nullable when the inviter was a
// super_admin who is not a member of the target tenant.
export const TBInvitationListItem = Type.Object({
  id: TBUuid,
  email: TBEmail,
  role: TBMembershipRole,
  tenantId: TBUuid,
  status: TBInvitationStatus,
  expiresAt: TBIsoDateTime,
  createdAt: TBIsoDateTime,
  consumedAt: Type.Union([TBIsoDateTime, Type.Null()]),
  revokedAt: Type.Union([TBIsoDateTime, Type.Null()]),
  invitedByEmail: Type.Union([TBEmail, Type.Null()]),
});

export const ZInvitationListItem = z.object({
  id: ZUuid,
  email: ZEmail,
  role: ZMembershipRole,
  tenantId: ZUuid,
  status: ZInvitationStatus,
  expiresAt: ZIsoDateTime,
  createdAt: ZIsoDateTime,
  consumedAt: z.union([ZIsoDateTime, z.null()]),
  revokedAt: z.union([ZIsoDateTime, z.null()]),
  invitedByEmail: z.union([ZEmail, z.null()]),
});

export type InvitationListItem = Static<typeof TBInvitationListItem>;

export const TBInvitationListResponse = Type.Object({
  items: Type.Array(TBInvitationListItem),
});

export const ZInvitationListResponse = z.object({
  items: z.array(ZInvitationListItem),
});

export type InvitationListResponse = Static<typeof TBInvitationListResponse>;

// Accept. The invitee picks their own displayName at this step — the
// inviter rarely knows the right one, and it keeps the invitation
// surface minimal (email + role only).
export const TBAcceptInvitationRequest = Type.Object({
  password: Type.String({ minLength: 8, maxLength: 1024 }),
  displayName: TBNonEmptyString,
});

export const ZAcceptInvitationRequest = z.object({
  password: z.string().min(8).max(1024),
  displayName: ZNonEmptyString,
});

export type AcceptInvitationRequest = Static<typeof TBAcceptInvitationRequest>;

// Mirrors the login response so the front can drop the user straight
// into an authenticated session after accepting (no extra round-trip).
export const TBAcceptInvitationResponse = Type.Object({
  accessToken: TBNonEmptyString,
  user: TBAuthenticatedUser,
  tenant: TBAuthenticatedTenant,
});

export const ZAcceptInvitationResponse = z.object({
  accessToken: ZNonEmptyString,
  user: ZAuthenticatedUser,
  tenant: ZAuthenticatedTenant,
});

export type AcceptInvitationResponse = Static<typeof TBAcceptInvitationResponse>;
