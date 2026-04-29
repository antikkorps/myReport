-- 0004_memberships_soft_delete: keep an audit trail of who was in
-- which tenant when a cabinet_admin removes someone.
--
-- Why now: PR 4 of the "Gestion users" story introduces user removal
-- via DELETE /memberships/:id. Hard-deleting the row would lose the
-- audit trail (compliance + post-incident review) and would also
-- break ON DELETE cascade chains that may grow later. Soft-deletion
-- keeps the row, drops the partial unique to allow re-adding the same
-- user to the same tenant after a previous departure, and adds an
-- index on deleted_at so the listing query stays cheap.
--
-- Migration shape:
--   1. Drop the old (tenant_id, user_id) unique index.
--   2. Add `deleted_at` (nullable timestamptz).
--   3. Re-create uniqueness as a *partial* index filtered on active
--      rows. A soft-deleted membership no longer blocks a re-add.
--   4. Add an index on deleted_at to keep filtered listings fast.
--
-- RLS policies are unchanged. They isolate by tenant, not by row
-- lifecycle — application queries always include `deleted_at IS NULL`
-- when they want only active memberships, the same convention used by
-- `users` and `tenants`.

DROP INDEX "memberships_tenant_user_unique";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_active_unique" ON "memberships" USING btree ("tenant_id","user_id") WHERE "memberships"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "memberships_deleted_at_idx" ON "memberships" USING btree ("deleted_at");
