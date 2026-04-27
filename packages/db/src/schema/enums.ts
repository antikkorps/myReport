import { pgEnum } from 'drizzle-orm/pg-core';

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
