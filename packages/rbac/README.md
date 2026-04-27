# @myreport/rbac

Isomorphic CASL abilities for myReport. Same rules drive the API
authorisation gates and the front-end UI guards (button enable/disable,
route guards) — no Node-only imports.

## Concepts

- **Subjects** — discriminated unions tagged by `__subject`:
  `Tenant`, `User`, `Membership`, `Mission`, `MissionMember`. Each
  carries the fields the rules condition on (`id`, `tenantId`,
  `missionId`, …).
- **Actions** — `manage`, `create`, `read`, `update`, `delete`, plus
  mission lifecycle verbs: `submit`, `close`.
- **`AbilityContext`** — input to `defineAbilitiesFor()`: the user
  identity, the active tenant + tenant role, the user's mission
  memberships within that tenant.

## Rules summary

| Caller                          | Tenant       | User                         | Membership          | Mission                                                           | MissionMember                                                |
| ------------------------------- | ------------ | ---------------------------- | ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| super_admin                     | manage       | manage                       | manage              | manage (any tenant, including close)                              | manage                                                       |
| no active tenant                | —            | read self                    | —                   | —                                                                 | —                                                            |
| cabinet_admin (own tenant)      | manage       | manage                       | manage              | manage (incl. close)                                              | manage                                                       |
| auditor — `lead` of M           | read         | read self / update self      | read own row        | read + update + submit M                                          | manage members of M                                          |
| auditor — `contributor` of M    | read         | read self / update self      | read own row        | read + update M                                                   | read members of M                                            |
| auditor — `observer` of M       | read         | read self / update self      | read own row        | read M (explicit `cannot('update')` even with broader rules)      | read members of M                                            |
| auditor — not a member of M     | read         | read self / update self      | read own row        | —                                                                 | —                                                            |

`close` is intentionally cabinet_admin-only — leads can submit, the
cabinet validates.

## Usage

```ts
import { defineAbilitiesFor } from '@myreport/rbac';

const ability = defineAbilitiesFor({
  user: { id: claims.sub, isSuperAdmin: claims.isSuperAdmin },
  tenantId: claims.tenantId,
  tenantRole: 'auditor',
  missionMemberships: [{ missionId: 'm-1', role: 'lead' }],
});

ability.can('submit', { __subject: 'Mission', id: 'm-1', tenantId: 't-1' }); // true
ability.can('close',  { __subject: 'Mission', id: 'm-1', tenantId: 't-1' }); // false
```

## Notes

- RLS is the **first** line of defence: users physically cannot read
  rows outside their tenant. Abilities narrow what they can do *within*
  the rows they already see.
- Rules use Mongo-style `$in` operators on id lists for batched checks
  (e.g. mission ids the user leads). CASL evaluates these in O(n) per
  rule, which is fine for the scale we operate at (a user typically
  has < 50 active mission memberships).
- The plain-object subjects need a `detectSubjectType` extractor
  (`__subject`); `defineAbilitiesFor` registers it on the built ability
  so consumers don't have to think about it.
