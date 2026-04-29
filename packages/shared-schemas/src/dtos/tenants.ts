import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBEmail, ZEmail } from '../primitives/email.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../primitives/isoDateTime.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';
import { TBMembershipRole, ZMembershipRole } from './invitations.ts';

// Slug constraints: 3-63 chars, lowercase letters, digits, dashes only.
// Same shape as DNS labels — keeps the door open for per-tenant
// subdomains (`<slug>.myreport.io`) without re-encoding.
const TENANT_SLUG_PATTERN = '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$';
const TENANT_SLUG_REGEX = new RegExp(TENANT_SLUG_PATTERN);

export const TBTenantSlug = Type.String({
  pattern: TENANT_SLUG_PATTERN,
  minLength: 3,
  maxLength: 63,
});

export const ZTenantSlug = z
  .string()
  .min(3, { message: 'slug too short' })
  .max(63, { message: 'slug too long' })
  .regex(TENANT_SLUG_REGEX, { message: 'invalid slug' });

// Tenant creation goes through the invitation flow: the super_admin
// names the cabinet and the email of the first cabinet_admin, but no
// password / displayName is set here — the invitee picks both at
// accept time. This avoids transmitting passwords out-of-band and
// guarantees the email address has been verified before any user
// account is materialised.
export const TBCreateTenantRequest = Type.Object({
  name: TBNonEmptyString,
  slug: TBTenantSlug,
  adminEmail: TBEmail,
});

export const ZCreateTenantRequest = z.object({
  name: ZNonEmptyString,
  slug: ZTenantSlug,
  adminEmail: ZEmail,
});

export type CreateTenantRequest = Static<typeof TBCreateTenantRequest>;

const TBTenantSummary = Type.Object({
  id: TBUuid,
  name: TBNonEmptyString,
  slug: TBTenantSlug,
});
const ZTenantSummary = z.object({
  id: ZUuid,
  name: ZNonEmptyString,
  slug: ZTenantSlug,
});

// Lightweight invitation summary returned alongside the new tenant —
// just enough for the super_admin to follow up (display the link in
// the success state, copy it to forward manually if the email driver
// is the dev console one). Full invitation listing lives at
// GET /invitations.
const TBTenantAdminInvitation = Type.Object({
  id: TBUuid,
  email: TBEmail,
  role: TBMembershipRole,
  expiresAt: TBIsoDateTime,
  acceptUrl: TBNonEmptyString,
});
const ZTenantAdminInvitation = z.object({
  id: ZUuid,
  email: ZEmail,
  role: ZMembershipRole,
  expiresAt: ZIsoDateTime,
  acceptUrl: ZNonEmptyString,
});

export const TBCreateTenantResponse = Type.Object({
  tenant: TBTenantSummary,
  invitation: TBTenantAdminInvitation,
});

export const ZCreateTenantResponse = z.object({
  tenant: ZTenantSummary,
  invitation: ZTenantAdminInvitation,
});

export type CreateTenantResponse = Static<typeof TBCreateTenantResponse>;

export const TBTenantListItem = Type.Object({
  id: TBUuid,
  name: TBNonEmptyString,
  slug: TBTenantSlug,
  createdAt: TBIsoDateTime,
  membershipCount: Type.Integer({ minimum: 0 }),
});

export const ZTenantListItem = z.object({
  id: ZUuid,
  name: ZNonEmptyString,
  slug: ZTenantSlug,
  createdAt: ZIsoDateTime,
  membershipCount: z.number().int().min(0),
});

export type TenantListItem = Static<typeof TBTenantListItem>;

export const TBTenantListResponse = Type.Object({
  items: Type.Array(TBTenantListItem),
});

export const ZTenantListResponse = z.object({
  items: z.array(ZTenantListItem),
});

export type TenantListResponse = Static<typeof TBTenantListResponse>;
