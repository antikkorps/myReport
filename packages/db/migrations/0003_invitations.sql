-- 0003_invitations: pending invitations to join a tenant.
--
-- See docs/adr/0002-invitations-model.md for the full rationale. In
-- short: a dedicated table tracks one-shot, time-bound, revocable
-- invitations that pre-date the user/membership rows they will create
-- on acceptance. Reusing `auth_identities.provider='magic_link'` was
-- rejected to keep "long-lived login methods" and "short-lived offers"
-- semantically separate.
--
-- The hot paths and the RLS picture they require:
--   * cabinet_admin issues an invitation        -> app_user (tenant GUC set), INSERT policy
--   * cabinet_admin lists / revokes invitations -> app_user (tenant GUC set), SELECT/UPDATE policies
--   * super_admin creates a tenant + the first
--     cabinet_admin invitation                  -> app_admin (BYPASSRLS), no policy needed
--   * invitee accepts via token (no auth yet)   -> app_admin (BYPASSRLS), no policy needed
--
-- An invitation is *active* iff
--   consumed_at IS NULL AND revoked_at IS NULL AND deleted_at IS NULL
--   AND expires_at > now().
-- The first three conditions live in the partial unique index. The
-- expiry check is enforced in the application layer (Postgres requires
-- immutable index predicates, so `now()` cannot appear there).

CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" "membership_role" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_tenant_email_active_unique" ON "invitations" USING btree ("tenant_id","email") WHERE "invitations"."consumed_at" is null and "invitations"."revoked_at" is null and "invitations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "invitations_token_hash_idx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invitations_deleted_at_idx" ON "invitations" USING btree ("deleted_at");--> statement-breakpoint

-- RLS: tenant-scoped policies, identical pattern to memberships/missions.
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invitations" TO app_admin;--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "invitations_select" ON "invitations"
  FOR SELECT TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "invitations_insert" ON "invitations"
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "invitations_update" ON "invitations"
  FOR UPDATE TO app_user
  USING      (tenant_id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "invitations_delete" ON "invitations"
  FOR DELETE TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));
