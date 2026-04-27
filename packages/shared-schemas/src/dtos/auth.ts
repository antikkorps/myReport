import { type Static, Type } from '@sinclair/typebox';
import { z } from 'zod';
import '../formats.ts';
import { TBEmail, ZEmail } from '../primitives/email.ts';
import { TBNonEmptyString, ZNonEmptyString } from '../primitives/nonEmpty.ts';
import { TBUuid, ZUuid } from '../primitives/uuid.ts';

// Schemas avoid `$id` so they can be embedded inside multiple
// containers without colliding inside Fastify's serializer cache.

export const TBLoginRequest = Type.Object({
  email: TBEmail,
  password: Type.String({ minLength: 8, maxLength: 1024 }),
});

export const ZLoginRequest = z.object({
  email: ZEmail,
  password: z.string().min(8).max(1024),
});

export type LoginRequest = Static<typeof TBLoginRequest>;

export const TBAuthenticatedUser = Type.Object({
  id: TBUuid,
  email: TBEmail,
  displayName: TBNonEmptyString,
  isSuperAdmin: Type.Boolean(),
});

export const ZAuthenticatedUser = z.object({
  id: ZUuid,
  email: ZEmail,
  displayName: ZNonEmptyString,
  isSuperAdmin: z.boolean(),
});

export type AuthenticatedUser = Static<typeof TBAuthenticatedUser>;

export const TBAuthenticatedTenant = Type.Object({
  id: TBUuid,
  name: TBNonEmptyString,
  slug: TBNonEmptyString,
  role: Type.Union([Type.Literal('cabinet_admin'), Type.Literal('auditor')]),
});

export const ZAuthenticatedTenant = z.object({
  id: ZUuid,
  name: ZNonEmptyString,
  slug: ZNonEmptyString,
  role: z.union([z.literal('cabinet_admin'), z.literal('auditor')]),
});

export type AuthenticatedTenant = Static<typeof TBAuthenticatedTenant>;

export const TBLoginResponse = Type.Object({
  accessToken: TBNonEmptyString,
  user: TBAuthenticatedUser,
  tenant: Type.Union([TBAuthenticatedTenant, Type.Null()]),
});

export const ZLoginResponse = z.object({
  accessToken: ZNonEmptyString,
  user: ZAuthenticatedUser,
  tenant: z.union([ZAuthenticatedTenant, z.null()]),
});

export type LoginResponse = Static<typeof TBLoginResponse>;

export const TBMeResponse = Type.Object({
  user: TBAuthenticatedUser,
  memberships: Type.Array(TBAuthenticatedTenant),
  currentTenant: Type.Union([TBAuthenticatedTenant, Type.Null()]),
});

export const ZMeResponse = z.object({
  user: ZAuthenticatedUser,
  memberships: z.array(ZAuthenticatedTenant),
  currentTenant: z.union([ZAuthenticatedTenant, z.null()]),
});

export type MeResponse = Static<typeof TBMeResponse>;

export const TBRefreshResponse = Type.Object({
  accessToken: TBNonEmptyString,
});

export const ZRefreshResponse = z.object({
  accessToken: ZNonEmptyString,
});

export type RefreshResponse = Static<typeof TBRefreshResponse>;
