-- Slice 7: configurable approval steps, and a plant itself as a scoring unit.
-- The extra steps of the shop-floor month and the senior appraisal become settings, set by Corporate HR. Nothing is
-- removed: every step, state and guard still exists; a switched-off step is simply skipped.
--   monthly.hod_verify          HOD verifies a submitted month                       (default OFF)
--   monthly.plant_head_approve  Plant Head approves before Corporate HR locks        (default OFF)
--   senior.reviewer_step        a reviewer signs off between manager and HR          (default OFF)
-- The two-person rules (maker <> checker) for templates, target changes and reopen are untouched, and are not settings.

-- ------------------------------------------------------------ settings --

CREATE TABLE core.workflow_setting (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL,
  updated_by  uuid REFERENCES core.user_account(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO core.workflow_setting (key, enabled) VALUES
  ('monthly.hod_verify', false),
  ('monthly.plant_head_approve', false),
  ('senior.reviewer_step', false);

INSERT INTO core.permission (code) VALUES ('settings:write');
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r, core.permission p WHERE r.code = 'CHR' AND p.code = 'settings:write';

-- ------------------------------------------------ shop-floor month steps --

-- Shortcuts for the steps that are switched off: SUBMITTED -> APPROVED (no HOD verify), SUBMITTED -> LOCKED and
-- VERIFIED -> LOCKED (no Plant Head approval). The full chain stays legal.
CREATE OR REPLACE FUNCTION core.submission_transition_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> OLD.state AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('DRAFT','SUBMITTED'), ('SUBMITTED','VERIFIED'), ('SUBMITTED','REJECTED'),
      ('VERIFIED','APPROVED'), ('VERIFIED','REJECTED'), ('REJECTED','DRAFT'),
      ('APPROVED','LOCKED'), ('APPROVED','REJECTED'), ('LOCKED','REOPENED'), ('REOPENED','SUBMITTED'),
      ('SUBMITTED','APPROVED'), ('SUBMITTED','LOCKED'), ('VERIFIED','LOCKED')
    ) AS t(from_state, to_state) WHERE t.from_state = OLD.state AND t.to_state = NEW.state
  ) THEN
    RAISE EXCEPTION 'WORKFLOW: transition % -> % is not allowed', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------- scoring unit = plant --

-- A plant type may be scored at the plant itself (one scorecard per plant, no shops or cells beneath it).
ALTER TABLE core.plant_type DROP CONSTRAINT plant_type_scoring_unit_type_check;
ALTER TABLE core.plant_type
  ADD CONSTRAINT plant_type_scoring_unit_type_check CHECK (scoring_unit_type IN ('PLANT','DEPARTMENT','CELL'));

-- ------------------------------------------------------ senior appraisal --

-- Same guard as 006 with two differences: the reviewer is required only while the reviewer step is switched on, and
-- MANAGER_ASSESSMENT <-> HR_FINALISATION is a legal move for appraisals that skip the reviewer.
CREATE OR REPLACE FUNCTION core.senior_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  emp uuid;
  rev uuid;
  emp_user uuid;
  reviewer_step boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'FINALISED' THEN
      RAISE EXCEPTION 'LOCKED: the appraisal is finalised and can no longer change' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT a.employee_id, a.reviewer_user_id INTO emp, rev FROM core.appraisal a WHERE a.id = NEW.appraisal_id;
  SELECT id INTO emp_user FROM core.user_account WHERE employee_id = emp;
  SELECT enabled INTO reviewer_step FROM core.workflow_setting WHERE key = 'senior.reviewer_step';

  IF TG_OP = 'INSERT' THEN
    IF rev IS NULL AND COALESCE(reviewer_step, false) THEN
      RAISE EXCEPTION 'WORKFLOW: the appraisal needs a reviewer before a goal sheet can start' USING ERRCODE = 'check_violation';
    END IF;
    IF rev = NEW.manager_id THEN
      RAISE EXCEPTION 'SOD: the manager and the reviewer must be different people' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.state = 'REVIEWER_REVIEW' AND rev IS NULL THEN
    RAISE EXCEPTION 'WORKFLOW: the appraisal needs a reviewer before it can go to review' USING ERRCODE = 'check_violation';
  END IF;
  IF emp_user IS NOT NULL AND emp_user = NEW.manager_id THEN
    RAISE EXCEPTION 'SOD: an employee cannot manage their own appraisal' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.finalised_by IS NOT NULL THEN
    IF NEW.finalised_by = NEW.manager_id OR NEW.finalised_by = rev OR NEW.finalised_by = emp_user THEN
      RAISE EXCEPTION 'SOD: the employee, manager and reviewer cannot also finalise the appraisal' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.state <> OLD.state AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('GOALS_DRAFT','PENDING_ACK'), ('PENDING_ACK','ACKNOWLEDGED'), ('PENDING_ACK','GOALS_DRAFT'),
        ('ACKNOWLEDGED','SELF_ASSESSMENT'), ('SELF_ASSESSMENT','MANAGER_ASSESSMENT'),
        ('MANAGER_ASSESSMENT','REVIEWER_REVIEW'), ('MANAGER_ASSESSMENT','SELF_ASSESSMENT'),
        ('REVIEWER_REVIEW','HR_FINALISATION'), ('REVIEWER_REVIEW','MANAGER_ASSESSMENT'),
        ('HR_FINALISATION','FINALISED'), ('HR_FINALISATION','REVIEWER_REVIEW'),
        ('MANAGER_ASSESSMENT','HR_FINALISATION'), ('HR_FINALISATION','MANAGER_ASSESSMENT')
      ) AS t(from_state, to_state) WHERE t.from_state = OLD.state AND t.to_state = NEW.state
    ) THEN
      RAISE EXCEPTION 'WORKFLOW: transition % -> % is not allowed', OLD.state, NEW.state USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
