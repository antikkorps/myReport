import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBEmail, ZEmail } from '../primitives/email.ts';
import { TBIsoDateTime, ZIsoDateTime } from '../primitives/isoDateTime.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';

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

export const TBCreateTenantRequest = Type.Object({
  name: TBNonEmptyString,
  slug: TBTenantSlug,
  firstAdmin: Type.Object({
    email: TBEmail,
    displayName: TBNonEmptyString,
    password: Type.String({ minLength: 8, maxLength: 1024 }),
  }),
});

export const ZCreateTenantRequest = z.object({
  name: ZNonEmptyString,
  slug: ZTenantSlug,
  firstAdmin: z.object({
    email: ZEmail,
    displayName: ZNonEmptyString,
    password: z.string().min(8).max(1024),
  }),
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

const TBFirstAdminSummary = Type.Object({
  id: TBUuid,
  email: TBEmail,
  displayName: TBNonEmptyString,
});
const ZFirstAdminSummary = z.object({
  id: ZUuid,
  email: ZEmail,
  displayName: ZNonEmptyString,
});

export const TBCreateTenantResponse = Type.Object({
  tenant: TBTenantSummary,
  firstAdmin: TBFirstAdminSummary,
});

export const ZCreateTenantResponse = z.object({
  tenant: ZTenantSummary,
  firstAdmin: ZFirstAdminSummary,
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
