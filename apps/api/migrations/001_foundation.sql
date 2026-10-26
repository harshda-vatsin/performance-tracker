-- Slice 1 foundation: identity, RBAC, minimal org tree, tamper-evident audit log.
-- Source of truth: docs/design/02-data-model.md (ERD 1 org part, ERD 4) and 04-rbac.md.

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS core;

-- ---------------------------------------------------------------- org --

CREATE TABLE core.plant_type (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  defaults   jsonb NOT NULL DEFAULT '{}',
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE core.org_unit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     uuid REFERENCES core.org_unit(id),
  unit_type     text NOT NULL CHECK (unit_type IN ('COMPANY','PLANT','DEPARTMENT','CELL')),
  plant_type_id uuid REFERENCES core.plant_type(id),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  path          ltree NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  CHECK (unit_type <> 'PLANT' OR plant_type_id IS NOT NULL)
);
CREATE INDEX org_unit_path_gist ON core.org_unit USING gist (path);

-- path = parent path + this unit's code (non-alphanumerics become '_').
CREATE FUNCTION core.org_unit_set_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_path ltree;
  label text := regexp_replace(NEW.code, '[^A-Za-z0-9]', '_', 'g');
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := text2ltree(label);
  ELSE
    SELECT path INTO parent_path FROM core.org_unit WHERE id = NEW.parent_id;
    NEW.path := parent_path || text2ltree(label);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER org_unit_path BEFORE INSERT OR UPDATE OF parent_id, code ON core.org_unit
  FOR EACH ROW EXECUTE FUNCTION core.org_unit_set_path();

CREATE TABLE core.employee (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code    text NOT NULL UNIQUE,
  full_name        text NOT NULL,
  mobile           text,
  email            text,
  date_of_joining  date,
  date_of_leaving  date,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

-- ----------------------------------------------------------- identity --

CREATE TABLE core.role (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  mfa_required  boolean NOT NULL DEFAULT false,
  pay_access    boolean NOT NULL DEFAULT false
);

CREATE TABLE core.permission (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code  text NOT NULL UNIQUE
);

CREATE TABLE core.role_permission (
  role_id       uuid NOT NULL REFERENCES core.role(id),
  permission_id uuid NOT NULL REFERENCES core.permission(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE core.user_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL UNIQUE REFERENCES core.employee(id),
  login_id        text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOCKED','DISABLED')),
  auth_mode       text NOT NULL DEFAULT 'PASSWORD' CHECK (auth_mode IN ('PASSWORD','OTP_ONLY','SSO')),
  failed_attempts int NOT NULL DEFAULT 0,
  lock_count      int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES core.user_account(id),
  password_hash  text NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  must_change    boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX credential_one_current ON core.credential (user_id);

CREATE TABLE core.auth_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES core.user_account(id),
  device_label  text,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX auth_session_user ON core.auth_session (user_id);

CREATE TABLE core.login_event (
  id        bigserial PRIMARY KEY,
  user_id   uuid,
  login_id  text,
  outcome   text NOT NULL,
  method    text NOT NULL,
  ip        inet,
  at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.role_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES core.user_account(id),
  role_id     uuid NOT NULL REFERENCES core.role(id),
  scope_type  text NOT NULL CHECK (scope_type IN ('COMPANY','PLANT','DEPARTMENT','CELL','TEAM','SELF','ASSIGNED')),
  scope_id    uuid REFERENCES core.org_unit(id),
  valid       daterange NOT NULL DEFAULT daterange(current_date, NULL, '[)'),
  granted_by  uuid REFERENCES core.user_account(id),
  CHECK ((scope_type IN ('PLANT','DEPARTMENT','CELL')) = (scope_id IS NOT NULL))
);
CREATE INDEX role_assignment_user ON core.role_assignment (user_id);

-- Separation of duties and MFA guard, enforced at role-assignment time (doc 04 §3, doc 03 §4).
CREATE FUNCTION core.role_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_code text;
  new_mfa boolean;
  mode text;
  other record;
BEGIN
  SELECT code, mfa_required INTO new_code, new_mfa FROM core.role WHERE id = NEW.role_id;
  SELECT auth_mode INTO mode FROM core.user_account WHERE id = NEW.user_id;

  IF mode = 'OTP_ONLY' AND new_mfa THEN
    RAISE EXCEPTION 'MFA: OTP-only users cannot hold role % (MFA required)', new_code USING ERRCODE = 'check_violation';
  END IF;

  FOR other IN
    SELECT r.code, ra.scope_id
    FROM core.role_assignment ra JOIN core.role r ON r.id = ra.role_id
    WHERE ra.user_id = NEW.user_id AND ra.id IS DISTINCT FROM NEW.id AND ra.valid @> current_date
  LOOP
    IF (new_code = 'SA' AND other.code <> 'SA') OR (other.code = 'SA' AND new_code <> 'SA') THEN
      RAISE EXCEPTION 'SOD: Super Admin cannot be combined with business role %', CASE WHEN new_code = 'SA' THEN other.code ELSE new_code END
        USING ERRCODE = 'check_violation';
    END IF;
    IF (new_code = 'CHR' AND other.code = 'CHR_H') OR (new_code = 'CHR_H' AND other.code = 'CHR') THEN
      RAISE EXCEPTION 'SOD: CHR and CHR_H cannot be held by the same account' USING ERRCODE = 'check_violation';
    END IF;
    IF ((new_code = 'PHR' AND other.code = 'PH') OR (new_code = 'PH' AND other.code = 'PHR'))
       AND other.scope_id IS NOT DISTINCT FROM NEW.scope_id THEN
      RAISE EXCEPTION 'SOD: PHR and PH cannot be held at the same plant' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER role_assignment_guard BEFORE INSERT OR UPDATE ON core.role_assignment
  FOR EACH ROW EXECUTE FUNCTION core.role_assignment_guard();

-- --------------------------------------------------------------- audit --

CREATE TABLE core.audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  on_behalf_of uuid,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  ip           inet,
  prev_hash    text NOT NULL,
  row_hash     text NOT NULL
);

-- Hash chain: each row commits to the previous row_hash. A global advisory lock keeps the chain linear.
CREATE FUNCTION core.audit_log_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(7770001);
  SELECT row_hash INTO prev FROM core.audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(prev, repeat('0', 64));
  NEW.at := clock_timestamp();
  NEW.row_hash := encode(digest(
    NEW.prev_hash || '|' || to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    COALESCE(NEW.actor_id::text, '') || '|' || COALESCE(NEW.on_behalf_of::text, '') || '|' ||
    NEW.action || '|' || COALESCE(NEW.entity_type, '') || '|' || COALESCE(NEW.entity_id, '') || '|' ||
    COALESCE(NEW.before::text, '') || '|' || COALESCE(NEW.after::text, ''),
    'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON core.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.audit_log_chain();

CREATE FUNCTION core.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON core.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON core.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_log_immutable();

-- Verifies the whole chain; returns the id of the first broken row, or NULL when intact.
CREATE FUNCTION core.audit_log_verify() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  r record;
  prev text := repeat('0', 64);
  expected text;
BEGIN
  FOR r IN SELECT * FROM core.audit_log ORDER BY id LOOP
    expected := encode(digest(
      prev || '|' || to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      COALESCE(r.actor_id::text, '') || '|' || COALESCE(r.on_behalf_of::text, '') || '|' ||
      r.action || '|' || COALESCE(r.entity_type, '') || '|' || COALESCE(r.entity_id, '') || '|' ||
      COALESCE(r.before::text, '') || '|' || COALESCE(r.after::text, ''),
      'sha256'), 'hex');
    IF r.prev_hash <> prev OR r.row_hash <> expected THEN RETURN r.id; END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN NULL;
END $$;

-- -------------------------------------------------- roles & permissions --

INSERT INTO core.role (code, name, mfa_required, pay_access) VALUES
  ('SA',    'Super Admin (IT)',        true,  false),
  ('MD',    'Management / MD',         true,  false),
  ('CHR',   'Corporate HR',            true,  true),
  ('CHR_H', 'Co-HR Head',              true,  true),
  ('PHR',   'Plant HR',                true,  false),
  ('PH',    'Plant Head',              true,  false),
  ('HOD',   'HOD / Cell Incharge',     false, false),
  ('SUP',   'Shift Incharge / Supervisor / Setter', false, false),
  ('SEN',   'Senior employee',         false, false),
  ('REV',   'Reviewer',                false, false),
  ('AUD',   'Auditor (read-only)',     true,  false);

INSERT INTO core.permission (code) VALUES
  ('users:manage'),
  ('org:read'),
  ('org:write'),
  ('audit:read_system'),
  ('audit:read_business'),
  ('scores:read');

-- Role -> permission grants for this slice (subset of doc 04 §3 rows 1, 3, 18, 27).
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('SA','users:manage'), ('SA','org:read'), ('SA','audit:read_system'),
  ('CHR','org:read'), ('CHR','org:write'), ('CHR','scores:read'),
  ('CHR_H','org:read'), ('CHR_H','scores:read'), ('CHR_H','audit:read_business'),
  ('MD','scores:read'),
  ('PHR','org:read'), ('PHR','org:write'), ('PHR','scores:read'),
  ('PH','org:read'), ('PH','scores:read'),
  ('HOD','org:read'), ('HOD','scores:read'),
  ('SUP','scores:read'),
  ('SEN','scores:read'),
  ('REV','scores:read'),
  ('AUD','audit:read_system'), ('AUD','audit:read_business')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;
