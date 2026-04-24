-- 0001_rls: enable Row-Level Security and install per-table policies.
--
-- Two database roles carry the application traffic:
--   * app_user  -- NOLOGIN, NOBYPASSRLS. Used for regular requests.
--                 Fastify does `SET LOCAL ROLE app_user` and sets the
--                 GUCs `app.current_user_id` / `app.current_tenant_id`
--                 at the start of each transaction.
--   * app_admin -- NOLOGIN, BYPASSRLS. Reserved for super-admin flows
--                 and a few bootstrap writes (tenant creation, user
--                 creation-via-invite) where RLS would otherwise block.
--
-- RLS isolates tenants; fine-grained authorisation is CASL's job in
-- the `rbac` package, so policies stay deliberately coarse.
--
-- Every tenant-scoped table gets FORCE ROW LEVEL SECURITY so even the
-- table owner (`myreport` in dev, the deployment user in prod) is
-- subject to the policies -- otherwise the owner-bypass would silently
-- void the protection.

--------------------------------------------------------------------
-- Roles
--------------------------------------------------------------------

-- Idempotent role creation -- CREATE ROLE would error on second apply.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- Grant both roles to the current database owner so `SET ROLE` works
-- from the application connection. In production we expect the
-- migration to run as the same user that the apps connect with.
GRANT app_user  TO CURRENT_USER;
GRANT app_admin TO CURRENT_USER;

--------------------------------------------------------------------
-- Table privileges
--------------------------------------------------------------------

-- app_user gets DML on every business table; RLS narrows what it
-- actually sees.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, memberships, sessions, missions, mission_members
  TO app_user;

-- app_admin has the same DML surface but its BYPASSRLS attribute
-- means policies do not apply.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, memberships, sessions, missions, mission_members
  TO app_admin;

--------------------------------------------------------------------
-- Enable + force RLS
--------------------------------------------------------------------

ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants          FORCE  ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            FORCE  ROW LEVEL SECURITY;
ALTER TABLE memberships      ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships      FORCE  ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         FORCE  ROW LEVEL SECURITY;
ALTER TABLE missions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions         FORCE  ROW LEVEL SECURITY;
ALTER TABLE mission_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_members  FORCE  ROW LEVEL SECURITY;

--------------------------------------------------------------------
-- Helper: safely read a UUID from a GUC. Returns NULL when the GUC
-- is unset or empty, instead of raising, so policies can short-circuit.
--------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_uuid(setting_name text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting(setting_name, true), '')::uuid;
$$;

--------------------------------------------------------------------
-- Policies -- tenants
--------------------------------------------------------------------

-- Read only the tenant the current session is bound to.
CREATE POLICY tenants_select ON tenants
  FOR SELECT TO app_user
  USING (id = app_current_uuid('app.current_tenant_id'));

-- Cabinet-admin operations (rename, branding) scoped to the current tenant.
CREATE POLICY tenants_update ON tenants
  FOR UPDATE TO app_user
  USING      (id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (id = app_current_uuid('app.current_tenant_id'));

-- Creation and deletion stay on app_admin (bootstrap + platform ops).
-- Intentionally no INSERT/DELETE policy for app_user.

--------------------------------------------------------------------
-- Policies -- users
--------------------------------------------------------------------

-- Visibility: your own row, plus users who share the current tenant
-- with you via memberships. Joining on memberships keeps the check
-- tenant-scoped even though `users` itself is global.
CREATE POLICY users_select ON users
  FOR SELECT TO app_user
  USING (
    id = app_current_uuid('app.current_user_id')
    OR EXISTS (
      SELECT 1
      FROM memberships m
      WHERE m.user_id = users.id
        AND m.tenant_id = app_current_uuid('app.current_tenant_id')
    )
  );

-- A user can update or soft-delete their own row (profile, password).
CREATE POLICY users_update_self ON users
  FOR UPDATE TO app_user
  USING      (id = app_current_uuid('app.current_user_id'))
  WITH CHECK (id = app_current_uuid('app.current_user_id'));

CREATE POLICY users_delete_self ON users
  FOR DELETE TO app_user
  USING (id = app_current_uuid('app.current_user_id'));

-- INSERT on users (registration / invitation) is funnelled through
-- app_admin: the API layer escalates the connection for that single
-- statement. Keeps the policy surface minimal.

--------------------------------------------------------------------
-- Policies -- memberships
--------------------------------------------------------------------

-- Read your own memberships (needed during multi-tenant login to list
-- the cabinets you belong to, before current_tenant_id is picked),
-- plus all memberships of the current tenant.
CREATE POLICY memberships_select ON memberships
  FOR SELECT TO app_user
  USING (
    user_id   = app_current_uuid('app.current_user_id')
    OR tenant_id = app_current_uuid('app.current_tenant_id')
  );

-- Write operations are tenant-scoped; authorisation (only cabinet_admin
-- can invite/revoke) is enforced in the app layer via CASL.
CREATE POLICY memberships_insert ON memberships
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY memberships_update ON memberships
  FOR UPDATE TO app_user
  USING      (tenant_id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY memberships_delete ON memberships
  FOR DELETE TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));

--------------------------------------------------------------------
-- Policies -- sessions
--------------------------------------------------------------------

-- Sessions live per-user; no tenant check (a session can exist before
-- the user has picked a tenant after login).
CREATE POLICY sessions_select ON sessions
  FOR SELECT TO app_user
  USING (user_id = app_current_uuid('app.current_user_id'));

CREATE POLICY sessions_insert ON sessions
  FOR INSERT TO app_user
  WITH CHECK (user_id = app_current_uuid('app.current_user_id'));

CREATE POLICY sessions_update ON sessions
  FOR UPDATE TO app_user
  USING      (user_id = app_current_uuid('app.current_user_id'))
  WITH CHECK (user_id = app_current_uuid('app.current_user_id'));

CREATE POLICY sessions_delete ON sessions
  FOR DELETE TO app_user
  USING (user_id = app_current_uuid('app.current_user_id'));

--------------------------------------------------------------------
-- Policies -- missions
--------------------------------------------------------------------

CREATE POLICY missions_select ON missions
  FOR SELECT TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY missions_insert ON missions
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY missions_update ON missions
  FOR UPDATE TO app_user
  USING      (tenant_id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY missions_delete ON missions
  FOR DELETE TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));

--------------------------------------------------------------------
-- Policies -- mission_members
--------------------------------------------------------------------

CREATE POLICY mission_members_select ON mission_members
  FOR SELECT TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY mission_members_insert ON mission_members
  FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY mission_members_update ON mission_members
  FOR UPDATE TO app_user
  USING      (tenant_id = app_current_uuid('app.current_tenant_id'))
  WITH CHECK (tenant_id = app_current_uuid('app.current_tenant_id'));

CREATE POLICY mission_members_delete ON mission_members
  FOR DELETE TO app_user
  USING (tenant_id = app_current_uuid('app.current_tenant_id'));
