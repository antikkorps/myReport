import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, updatedAt, uuidFk } from './_shared.ts';
import { authProvider } from './enums.ts';
import { users } from './users.ts';

// Case-insensitive email type, mirrored from users.ts. Used to record
// the address returned by the IdP at link time (purely informational —
// the canonical user email lives on `users`).
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

// Per-user authentication credentials, decoupled from `users` so a
// single account can carry multiple login methods (password + Google,
// for example) and so SSO accounts don't need a fictitious password
// hash. The login flow looks up an identity by (provider, subject) for
// SSO or by user email + provider='password' for local accounts.
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: primaryId(),
    userId: uuidFk()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider().notNull(),
    // OIDC `sub` claim for SSO providers; NULL for `password` and
    // `magic_link` where the identity is keyed on user_id alone.
    providerSubject: text(),
    // argon2id hash for `password`; NULL for SSO providers.
    secretHash: text(),
    // Email returned by the IdP at link time. Diagnostic only — the
    // authoritative business email stays on `users.email`.
    emailAtLink: citext(),
    lastUsedAt: timestamp({ withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // One Google/Microsoft account maps to at most one identity. Partial
    // index: a soft-deleted row may keep its (provider, subject) tuple
    // for audit, but a new active link can replace it.
    uniqueIndex('auth_identities_provider_subject_unique')
      .on(t.provider, t.providerSubject)
      .where(sql`${t.deletedAt} is null and ${t.providerSubject} is not null`),
    // A user has at most one active identity per provider (one
    // password, one Google link, etc.). Re-linking after revocation
    // requires a soft-delete first.
    uniqueIndex('auth_identities_user_provider_unique')
      .on(t.userId, t.provider)
      .where(sql`${t.deletedAt} is null`),
    index('auth_identities_user_idx').on(t.userId),
    index('auth_identities_deleted_at_idx').on(t.deletedAt),
  ],
);
