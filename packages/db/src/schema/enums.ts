import { pgEnum } from 'drizzle-orm/pg-core';

// Authentication provider for an identity row. `password` carries an
// argon2id hash; the SSO providers carry a `provider_subject` (the OIDC
// `sub` claim) and no secret. `magic_link` is a future passwordless
// flow scoped to a single mission invitation.
export const authProvider = pgEnum('auth_provider', [
  'password',
  'google',
  'microsoft',
  'magic_link',
]);

// Tenant-scoped role carried by `memberships`. Drives coarse-grained
// permissions (managing users, cabinet settings). Fine-grained access
// is further refined per mission via `mission_member_role`.
export const membershipRole = pgEnum('membership_role', ['cabinet_admin', 'auditor']);

// Role of a user inside a specific mission. A user can be 'auditor' at
// the cabinet level and hold different mission roles across missions.
export const missionMemberRole = pgEnum('mission_member_role', ['lead', 'contributor', 'observer']);

// Lifecycle of a mission. Terminal state is `closed`; `submitted` is
// the auditor-facing "awaiting cabinet review" state.
export const missionStatus = pgEnum('mission_status', [
  'draft',
  'in_progress',
  'submitted',
  'closed',
]);
