-- 0002_auth_identities: extract login credentials from `users` into a
-- dedicated table.
--
-- Why now: the next phases introduce SSO (Google, Microsoft) and
-- magic-link invitations for auditees. Carrying a NOT NULL
-- `password_hash` on `users` would force fictitious hashes for SSO
-- accounts and prevent a user from holding multiple linked providers.
-- Splitting credentials into a per-(user, provider) table lets the
-- login flow uniformly look up an identity row and keeps the door open
-- for account-linking flows ("Alice signed up with email/password and
-- later linked her Google account").
--
-- Migration shape:
--   1. Create the auth_identities table + indexes.
--   2. Backfill: every existing `users.password_hash` becomes a row in
--      auth_identities with provider='password'. UUIDv4 from
--      gen_random_uuid() is acceptable for backfilled rows since
--      nothing relies on the time-ordered property here.
--   3. DROP the column from users only after the backfill succeeds.
--   4. Apply RLS: an identity is only visible to its own user; INSERT
--      and DELETE go through app_admin (login bootstrap, registration,
--      provider linking).

CREATE TYPE "public"."auth_provider" AS ENUM('password', 'google', 'microsoft', 'magic_link');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_subject" text,
	"secret_hash" text,
	"email_at_link" "citext",
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_unique" ON "auth_identities" USING btree ("provider","provider_subject") WHERE "auth_identities"."deleted_at" is null and "auth_identities"."provider_subject" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_user_provider_unique" ON "auth_identities" USING btree ("user_id","provider") WHERE "auth_identities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_identities_deleted_at_idx" ON "auth_identities" USING btree ("deleted_at");--> statement-breakpoint

-- Backfill existing password-based logins. `email_at_link` mirrors the
-- user email at migration time so future debugging can spot
-- post-migration email changes.
INSERT INTO "auth_identities" ("id", "user_id", "provider", "secret_hash", "email_at_link")
  SELECT gen_random_uuid(), "id", 'password', "password_hash", "email"
  FROM "users"
  WHERE "password_hash" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint

-- RLS: auth_identities are visible only to their owner. INSERT/DELETE
-- stay on app_admin since the login lookup happens before any per-user
-- GUC is set.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_identities" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_identities" TO app_admin;--> statement-breakpoint

ALTER TABLE "auth_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_identities" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "auth_identities_select" ON "auth_identities"
  FOR SELECT TO app_user
  USING ("user_id" = app_current_uuid('app.current_user_id'));--> statement-breakpoint

-- A user can soft-delete (revoke) one of their own identities (e.g.
-- "unlink Google"). Hard delete and INSERT remain on app_admin.
CREATE POLICY "auth_identities_update_self" ON "auth_identities"
  FOR UPDATE TO app_user
  USING      ("user_id" = app_current_uuid('app.current_user_id'))
  WITH CHECK ("user_id" = app_current_uuid('app.current_user_id'));
