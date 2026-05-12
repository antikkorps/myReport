-- 0005_questionnaire_templates: identity + immutable versions for
-- questionnaire templates. See docs/adr/0004-questionnaire-schema.md
-- for the design (DSL TypeBox + immutable snapshot per published
-- version).
--
-- Two tables:
--   * questionnaire_templates: mutable identity within a tenant
--     (name, slug, description, current-version pointer). Soft-deleted
--     via deleted_at; partial unique on (tenant_id, slug) so a retired
--     template's slug can be reused.
--   * questionnaire_template_versions: snapshot of the schema JSON at
--     a point in time. Lifecycle: draft (mutable) -> published
--     (frozen) -> archived (frozen, hidden from picker). Hard-deletion
--     is restricted to drafts; a constraint trigger enforces the
--     transitions and the immutability of published rows.
--
-- RLS picture (mirrors invitations / memberships):
--   * cabinet_admin manages templates and versions of *their* tenant
--     -> app_user with tenant GUC, 4 policies per table.
--   * super_admin operates with app_admin (BYPASSRLS).
--   * Auditor read access (during mission filling) lands later; the
--     SELECT policy on app_user is already open here and the
--     application code further filters by mission membership when
--     needed.
--
-- The trigger lives at the bottom of this file. It is BEFORE UPDATE
-- OR DELETE so failures short-circuit and surface as SQLSTATE 23514
-- (check_violation), which the API layer maps to a 409.

CREATE TYPE "public"."questionnaire_template_version_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "questionnaire_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"status" "questionnaire_template_version_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "questionnaire_template_versions" ADD CONSTRAINT "questionnaire_template_versions_template_id_questionnaire_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."questionnaire_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_template_versions" ADD CONSTRAINT "questionnaire_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_template_versions" ADD CONSTRAINT "questionnaire_template_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_templates" ADD CONSTRAINT "questionnaire_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_templates" ADD CONSTRAINT "questionnaire_templates_current_version_id_questionnaire_template_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."questionnaire_template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_template_versions_template_version_unique" ON "questionnaire_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "questionnaire_template_versions_template_idx" ON "questionnaire_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "questionnaire_template_versions_tenant_idx" ON "questionnaire_template_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "questionnaire_template_versions_template_status_idx" ON "questionnaire_template_versions" USING btree ("template_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_templates_tenant_slug_active_unique" ON "questionnaire_templates" USING btree ("tenant_id","slug") WHERE "questionnaire_templates"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "questionnaire_templates_tenant_idx" ON "questionnaire_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "questionnaire_templates_deleted_at_idx" ON "questionnaire_templates" USING btree ("deleted_at");--> statement-breakpoint

-- Domain invariants enforced at the DB level (defence in depth).
ALTER TABLE "questionnaire_template_versions"
  ADD CONSTRAINT "qtv_version_positive_check" CHECK ("version" >= 1);--> statement-breakpoint
ALTER TABLE "questionnaire_template_versions"
  ADD CONSTRAINT "qtv_published_at_matches_status_check" CHECK (
    (status = 'draft'     AND published_at IS NULL) OR
    (status IN ('published', 'archived') AND published_at IS NOT NULL)
  );--> statement-breakpoint

-- RLS: tenant-scoped policies on both tables. Same pattern as
-- invitations/memberships/missions: GRANT, ENABLE+FORCE RLS, one
-- policy per operation matching tenant_id against the GUC.
GRANT SELECT, INSERT, UPDATE, DELETE ON "questionnaire_templates" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "questionnaire_templates" TO app_admin;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "questionnaire_template_versions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "questionnaire_template_versions" TO app_admin;--> statement-breakpoint

ALTER TABLE "questionnaire_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "questionnaire_templates" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "questionnaire_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "questionnaire_template_versions" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "questionnaire_templates_select" ON "questionnaire_templates"
  FOR SELECT TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_templates_insert" ON "questionnaire_templates"
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_templates_update" ON "questionnaire_templates"
  FOR UPDATE TO app_user
  USING      (tenant_id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_templates_delete" ON "questionnaire_templates"
  FOR DELETE TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_template_versions_select" ON "questionnaire_template_versions"
  FOR SELECT TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_template_versions_insert" ON "questionnaire_template_versions"
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_template_versions_update" ON "questionnaire_template_versions"
  FOR UPDATE TO app_user
  USING      (tenant_id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

CREATE POLICY "questionnaire_template_versions_delete" ON "questionnaire_template_versions"
  FOR DELETE TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));--> statement-breakpoint

-- Immutability trigger on questionnaire_template_versions. Lives in
-- the DB rather than only in the API so the published/archived
-- contract holds regardless of which code path attempted the change
-- (manual SQL, future workers, admin scripts).
--
-- Logic, by OLD.status (applied only to direct app_user actions):
--   draft     -> any UPDATE allowed (including draft -> published).
--                DELETE allowed.
--   published -> UPDATE allowed only when status stays 'published' or
--                moves to 'archived'; all immutable fields (schema,
--                version, template_id, tenant_id, published_at,
--                published_by_user_id) must not change. DELETE
--                rejected.
--   archived  -> UPDATE rejected entirely. DELETE rejected.
--
-- All rejections raise SQLSTATE 23514 (check_violation) so callers
-- can branch on the SQL state without parsing messages.
--
-- The `WHEN (current_user = 'app_user')` clause means the trigger
-- only fires when a request comes through `app_user` (cabinet_admin
-- via the API). Everything else bypasses by *not firing at all*:
--   * `app_admin` — super-admin tooling, manual migrations, tenant
--     purges; this role already bypasses RLS and is reserved for
--     deliberate, privileged operations.
--   * Referential-integrity cascades — Postgres executes RI actions
--     under the role that owns the table (the connection superuser),
--     not under the caller's SET ROLE. So a tenant hard-delete that
--     cascades through published versions resolves cleanly.
--   * Direct connections by the DB owner (migrations, ops shells).

CREATE OR REPLACE FUNCTION qtv_enforce_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'questionnaire_template_versions: cannot delete a non-draft version (id=%, status=%)',
        OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION
      'questionnaire_template_versions: archived version is frozen (id=%)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- OLD.status = 'published'
  IF NEW.status NOT IN ('published', 'archived') THEN
    RAISE EXCEPTION
      'questionnaire_template_versions: published version can only stay published or move to archived (id=%, attempted=%)',
      OLD.id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.schema IS DISTINCT FROM OLD.schema
     OR NEW.version <> OLD.version
     OR NEW.template_id <> OLD.template_id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id THEN
    RAISE EXCEPTION
      'questionnaire_template_versions: published version fields are immutable (id=%)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER qtv_immutability
BEFORE UPDATE OR DELETE ON questionnaire_template_versions
FOR EACH ROW
WHEN (current_user = 'app_user')
EXECUTE FUNCTION qtv_enforce_immutability();
