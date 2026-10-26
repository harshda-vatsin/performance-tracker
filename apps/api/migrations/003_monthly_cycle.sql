-- Slice 3: scorecards per unit, monthly submissions, results, calculation runs, workflow, reopen.
-- Source of truth: docs/design/02-data-model.md (ERD 2 and 3), 05-scoring-and-bonus.md, 06-workflows.md.

-- ------------------------------------------------ plant type settings --

-- Which org-unit level carries the scorecard (doc 02 "is_scoring_unit"); scoring parameters per plant type.
ALTER TABLE core.plant_type
  ADD COLUMN scoring_unit_type text NOT NULL DEFAULT 'DEPARTMENT' CHECK (scoring_unit_type IN ('DEPARTMENT','CELL'));
-- Base score B: 60 Forge, 50 Machine (doc 05 §1.2). Placeholders until the client answers questions 2 and 3.
UPDATE core.plant_type SET defaults = defaults || '{"scoring":{"baseScoreB":60}}' WHERE code = 'FORGE';
UPDATE core.plant_type SET defaults = defaults || '{"scoring":{"baseScoreB":50}}', scoring_unit_type = 'CELL' WHERE code = 'MACHINE';

CREATE FUNCTION core.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LOCKED: % is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

-- --------------------------------------------------------- scorecards --

CREATE TABLE core.scorecard (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id         uuid NOT NULL REFERENCES core.org_unit(id),
  fiscal_year         int NOT NULL,            -- start year of the Apr-Mar year, e.g. 2026 = FY 2026-27
  source_template_id  uuid NOT NULL REFERENCES core.kra_template(id),
  created_by          uuid NOT NULL REFERENCES core.user_account(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_unit_id, fiscal_year)
);

CREATE TABLE core.scorecard_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id  uuid NOT NULL REFERENCES core.scorecard(id),
  version       int NOT NULL,
  status        text NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED','SUPERSEDED')),
  effective_from date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scorecard_id, version)
);

CREATE TABLE core.scorecard_kra (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_version_id  uuid NOT NULL REFERENCES core.scorecard_version(id),
  name_en               text NOT NULL,
  name_ta               text,
  pqcdsm                char(1) NOT NULL,
  direction             text NOT NULL CHECK (direction IN ('HIGHER_BETTER','LOWER_BETTER')),
  unit                  text NOT NULL,
  present_level         numeric NOT NULL,
  q1_target             numeric NOT NULL,
  q2_target             numeric NOT NULL,
  q3_target             numeric NOT NULL,
  q4_target             numeric NOT NULL,
  sort_order            int NOT NULL DEFAULT 0
);

CREATE TABLE core.scorecard_kra_weight (
  scorecard_kra_id  uuid NOT NULL REFERENCES core.scorecard_kra(id),
  people_level_id   uuid NOT NULL REFERENCES core.people_level(id),
  weight            numeric(5,2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  PRIMARY KEY (scorecard_kra_id, people_level_id)
);

-- Versions never change once created; plant-level adjustments (slice 4) add a new version instead.
CREATE TRIGGER scorecard_version_append_only BEFORE UPDATE OR DELETE ON core.scorecard_version
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
CREATE TRIGGER scorecard_kra_append_only BEFORE UPDATE OR DELETE ON core.scorecard_kra
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
CREATE TRIGGER scorecard_kra_weight_append_only BEFORE UPDATE OR DELETE ON core.scorecard_kra_weight
  FOR EACH ROW EXECUTE FUNCTION core.append_only();

-- ------------------------------------------------ monthly submissions --

CREATE TABLE core.monthly_submission (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id           uuid NOT NULL REFERENCES core.org_unit(id),
  period                char(7) NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  scorecard_version_id  uuid NOT NULL REFERENCES core.scorecard_version(id),
  state                 text NOT NULL DEFAULT 'DRAFT'
                        CHECK (state IN ('DRAFT','SUBMITTED','VERIFIED','APPROVED','REJECTED','LOCKED','REOPENED')),
  revision              int NOT NULL DEFAULT 1,
  created_by            uuid NOT NULL REFERENCES core.user_account(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  submitted_at          timestamptz,
  UNIQUE (org_unit_id, period)
);

-- Only the transitions in doc 06 §1 are legal, whatever code path attempts them.
CREATE FUNCTION core.submission_transition_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> OLD.state AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('DRAFT','SUBMITTED'), ('SUBMITTED','VERIFIED'), ('SUBMITTED','REJECTED'),
      ('VERIFIED','APPROVED'), ('VERIFIED','REJECTED'), ('REJECTED','DRAFT'),
      ('APPROVED','LOCKED'), ('APPROVED','REJECTED'), ('LOCKED','REOPENED'), ('REOPENED','SUBMITTED')
    ) AS t(from_state, to_state) WHERE t.from_state = OLD.state AND t.to_state = NEW.state
  ) THEN
    RAISE EXCEPTION 'WORKFLOW: transition % -> % is not allowed', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_transition_check BEFORE UPDATE OF state ON core.monthly_submission
  FOR EACH ROW EXECUTE FUNCTION core.submission_transition_check();

CREATE TABLE core.monthly_result (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       uuid NOT NULL REFERENCES core.monthly_submission(id),
  scorecard_kra_id    uuid NOT NULL REFERENCES core.scorecard_kra(id),
  -- Snapshots so an old month never depends on the current scorecard (doc 02 ERD 3).
  target_used         numeric NOT NULL,
  present_level_used  numeric NOT NULL,
  result              numeric,
  na_reason           text,
  remarks             text,
  updated_by          uuid REFERENCES core.user_account(id),
  updated_at          timestamptz,
  UNIQUE (submission_id, scorecard_kra_id),
  CHECK (result IS NULL OR na_reason IS NULL)
);

CREATE TABLE core.level_assignment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id    uuid NOT NULL REFERENCES core.monthly_submission(id),
  org_unit_id      uuid NOT NULL REFERENCES core.org_unit(id),
  people_level_id  uuid NOT NULL REFERENCES core.people_level(id),
  employee_id      uuid NOT NULL REFERENCES core.employee(id),
  period           char(7) NOT NULL,
  days_in_unit     int NOT NULL CHECK (days_in_unit BETWEEN 1 AND 31),
  UNIQUE (submission_id, employee_id)
);
CREATE INDEX level_assignment_employee_period ON core.level_assignment (employee_id, period);

-- Inputs are editable only while the submission is a DRAFT or REOPENED.
CREATE FUNCTION core.submission_inputs_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  st text;
BEGIN
  SELECT state INTO st FROM core.monthly_submission WHERE id = sid;
  IF st IS NOT NULL AND st NOT IN ('DRAFT','REOPENED') THEN
    RAISE EXCEPTION 'LOCKED: submission is % and its inputs can no longer change', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER monthly_result_lock BEFORE INSERT OR UPDATE OR DELETE ON core.monthly_result
  FOR EACH ROW EXECUTE FUNCTION core.submission_inputs_lock();
CREATE TRIGGER level_assignment_lock BEFORE INSERT OR UPDATE OR DELETE ON core.level_assignment
  FOR EACH ROW EXECUTE FUNCTION core.submission_inputs_lock();

-- ------------------------------------------------ calculation results --

CREATE TABLE core.calc_run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES core.monthly_submission(id),
  revision       int NOT NULL,
  kind           text NOT NULL DEFAULT 'OFFICIAL' CHECK (kind IN ('OFFICIAL')),
  params         jsonb NOT NULL,       -- the exact scoring parameters used (reproducibility)
  engine_version text NOT NULL,
  input_hash     text NOT NULL,        -- SHA-256 of canonicalised inputs
  inputs         jsonb NOT NULL,
  ran_by         uuid NOT NULL REFERENCES core.user_account(id),
  ran_at         timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz
);
-- One live OFFICIAL run per submission.
CREATE UNIQUE INDEX calc_run_one_official ON core.calc_run (submission_id) WHERE superseded_at IS NULL;

CREATE FUNCTION core.calc_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LOCKED: calc_run is append-only' USING ERRCODE = 'check_violation';
  END IF;
  -- The only permitted change is marking a run superseded.
  IF OLD.superseded_at IS NOT NULL OR
     (NEW.id, NEW.submission_id, NEW.revision, NEW.kind, NEW.params, NEW.engine_version, NEW.input_hash, NEW.inputs, NEW.ran_by, NEW.ran_at)
       IS DISTINCT FROM
     (OLD.id, OLD.submission_id, OLD.revision, OLD.kind, OLD.params, OLD.engine_version, OLD.input_hash, OLD.inputs, OLD.ran_by, OLD.ran_at) THEN
    RAISE EXCEPTION 'LOCKED: calc_run is append-only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calc_run_guard BEFORE UPDATE OR DELETE ON core.calc_run
  FOR EACH ROW EXECUTE FUNCTION core.calc_run_guard();

CREATE TABLE core.kra_score (
  calc_run_id        uuid NOT NULL REFERENCES core.calc_run(id),
  monthly_result_id  uuid NOT NULL REFERENCES core.monthly_result(id),
  raw_score          numeric,
  final_score        numeric,            -- NULL when the KRA is N/A
  flags              text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (calc_run_id, monthly_result_id)
);

CREATE TABLE core.level_score (
  calc_run_id      uuid NOT NULL REFERENCES core.calc_run(id),
  people_level_id  uuid NOT NULL REFERENCES core.people_level(id),
  score            numeric,              -- NULL when the level has no applicable weight
  flags            text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (calc_run_id, people_level_id)
);

CREATE TABLE core.employee_score (
  calc_run_id      uuid NOT NULL REFERENCES core.calc_run(id),
  employee_id      uuid NOT NULL REFERENCES core.employee(id),
  period           char(7) NOT NULL,
  people_level_id  uuid NOT NULL REFERENCES core.people_level(id),
  days_in_unit     int NOT NULL,
  score            numeric,              -- this unit's level score for the employee
  PRIMARY KEY (calc_run_id, employee_id)
);

CREATE TRIGGER kra_score_append_only BEFORE UPDATE OR DELETE ON core.kra_score
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
CREATE TRIGGER level_score_append_only BEFORE UPDATE OR DELETE ON core.level_score
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
CREATE TRIGGER employee_score_append_only BEFORE UPDATE OR DELETE ON core.employee_score
  FOR EACH ROW EXECUTE FUNCTION core.append_only();

-- ------------------------------------------------------------ workflow --

CREATE TABLE core.workflow_event (
  id           bigserial PRIMARY KEY,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  revision     int NOT NULL,
  from_state   text NOT NULL,
  to_state     text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES core.user_account(id),
  comment      text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_event_entity ON core.workflow_event (entity_type, entity_id);
CREATE TRIGGER workflow_event_append_only BEFORE UPDATE OR DELETE ON core.workflow_event
  FOR EACH ROW EXECUTE FUNCTION core.append_only();

-- No self-approval: whoever verifies, approves, rejects or locks must not have acted earlier in the same
-- revision, nor have entered any result on the submission (doc 04 §3 SoD matrix).
CREATE FUNCTION core.workflow_event_sod() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type = 'SUBMISSION' AND NEW.to_state IN ('VERIFIED','APPROVED','REJECTED','LOCKED') THEN
    IF EXISTS (
      SELECT 1 FROM core.workflow_event e
      WHERE e.entity_type = 'SUBMISSION' AND e.entity_id = NEW.entity_id AND e.revision = NEW.revision AND e.actor_id = NEW.actor_id
    ) OR EXISTS (
      SELECT 1 FROM core.monthly_result r WHERE r.submission_id = NEW.entity_id AND r.updated_by = NEW.actor_id
    ) THEN
      RAISE EXCEPTION 'SOD: the same person cannot enter data and also verify, approve, reject or lock it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_event_sod BEFORE INSERT ON core.workflow_event
  FOR EACH ROW EXECUTE FUNCTION core.workflow_event_sod();

CREATE TABLE core.reopen_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES core.monthly_submission(id),
  requested_by   uuid NOT NULL REFERENCES core.user_account(id),
  reason         text NOT NULL,
  state          text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','APPROVED','REJECTED')),
  decided_by     uuid REFERENCES core.user_account(id),
  decision_comment text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX reopen_request_one_pending ON core.reopen_request (submission_id) WHERE state = 'PENDING';

-- --------------------------------------------------------- permissions --

INSERT INTO core.permission (code) VALUES
  ('scorecards:read'), ('scorecards:create'),
  ('submissions:read'), ('submissions:enter'), ('submissions:submit'),
  ('submissions:verify'), ('submissions:approve'), ('submissions:lock'),
  ('reopen:request'), ('reopen:approve');

-- Doc 04 §3 rows 6, 12-17, 18.
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('CHR','scorecards:read'), ('CHR_H','scorecards:read'), ('MD','scorecards:read'), ('PHR','scorecards:read'), ('PH','scorecards:read'), ('HOD','scorecards:read'),
  ('CHR','scorecards:create'), ('PHR','scorecards:create'),
  ('CHR','submissions:read'), ('CHR_H','submissions:read'), ('MD','submissions:read'), ('PHR','submissions:read'), ('PH','submissions:read'), ('HOD','submissions:read'),
  ('PHR','submissions:enter'), ('PHR','submissions:submit'),
  ('HOD','submissions:verify'),
  ('PH','submissions:approve'),
  ('CHR','submissions:lock'),
  ('CHR','reopen:request'), ('PH','reopen:request'),
  ('CHR_H','reopen:approve')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;
