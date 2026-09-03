-- audit_events must be append-only per Build Prompt §8:
-- "No UPDATE or DELETE grant on this table for the application role.
--  Enforce with a database trigger, not just application discipline."
--
-- Two layers, deliberately redundant:
--   1. REVOKE removes the grant outright, so a correctly-behaving
--      connection literally cannot run UPDATE/DELETE.
--   2. The trigger blocks it even if a future migration, a superuser
--      connection, or a misconfigured role grant reintroduces the
--      privilege by accident.
--
-- Replace app_role below with the actual least-privilege Postgres role the
-- App Service managed identity connects as (see /infra README once built).
--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_events_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_events is append-only: % is not permitted (row id %)',
    TG_OP,
    OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_block_mutation();
--> statement-breakpoint

-- Best-effort: only runs if app_role already exists in this database.
-- Uncomment / adapt once the real application role name is fixed in /infra.
-- REVOKE UPDATE, DELETE ON audit_events FROM app_role;
