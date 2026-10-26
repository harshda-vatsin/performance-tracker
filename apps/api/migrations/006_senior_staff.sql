-- Slice 6 (Module A): senior-staff individual KRA track, anchored on core.appraisal (005).
-- Source of truth: docs/design/06-workflows.md §3, 02-data-model.md ERD 2, 04-rbac.md.
-- The appraisal row already says who is appraised, for which fiscal year, and who reviews it; a senior cycle adds the
-- manager, the goal sheet, the monthly KPI results and the year-end chain on top of it, so none of that is stored twice.
-- Reuses the scoring engine, the audit log and core.workflow_event.

-- ------------------------------------------------------------ settings --

-- Scoring parameters for the SENIOR scope (doc 12 Q27: same engine, own B/cap/floor). Placeholder until the client answers.
CREATE TABLE core.senior_setting (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);
INSERT INTO core.senior_setting (key, value) VALUES ('scoring', '{"baseScoreB":60}');

-- Rating bands (doc 12 Q29, configurable). A final score takes the band with the highest min_score it reaches.
CREATE TABLE core.rating_band (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  min_score  numeric NOT NULL UNIQUE,
  rank       int NOT NULL UNIQUE
);
-- Placeholder bands: 100 = target met, 60 = present level (B). Replace when the client supplies the real scale.
INSERT INTO core.rating_band (code, label, min_score, rank) VALUES
  ('OUTSTANDING', 'Outstanding',          110, 5),
  ('EXCEEDS',     'Exceeds expectations',  95, 4),
  ('MEETS',       'Meets expectations',    80, 3),
  ('NEEDS_IMPR',  'Needs improvement',     60, 2),
  ('UNSATISFACT', 'Unsatisfactory',         0, 1);

-- ------------------------------------------------------------- cycles --

CREATE TABLE core.senior_cycle (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id         uuid NOT NULL UNIQUE REFERENCES core.appraisal(id),  -- employee, fiscal year and reviewer live there
  manager_id           uuid NOT NULL REFERENCES core.user_account(id),      -- an HOD / Manager
  state                text NOT NULL DEFAULT 'GOALS_DRAFT' CHECK (state IN
                         ('GOALS_DRAFT','PENDING_ACK','ACKNOWLEDGED','SELF_ASSESSMENT','MANAGER_ASSESSMENT',
                          'REVIEWER_REVIEW','HR_FINALISATION','FINALISED')),
  goal_version         int  NOT NULL DEFAULT 0,       -- bumped each time the sheet is issued
  acknowledged_at      timestamptz,
  acknowledged_version int,
  revision             int  NOT NULL DEFAULT 1,       -- bumped on every send-back
  -- Snapshot written at finalisation so later config changes never rewrite history.
  final_score          numeric,
  final_band_code      text,
  final_band_label     text,
  final_rollup         jsonb,
  final_params         jsonb,
  finalised_by         uuid REFERENCES core.user_account(id),
  finalised_at         timestamptz,
  created_by           uuid NOT NULL REFERENCES core.user_account(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'FINALISED') = (finalised_at IS NOT NULL))
);
CREATE INDEX senior_cycle_manager ON core.senior_cycle (manager_id);

CREATE TABLE core.senior_kra (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id    uuid NOT NULL REFERENCES core.senior_cycle(id) ON DELETE CASCADE,
  name_en     text NOT NULL,
  description text,
  weight      numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX senior_kra_cycle ON core.senior_kra (cycle_id);

CREATE TABLE core.senior_kpi (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kra_id        uuid NOT NULL REFERENCES core.senior_kra(id) ON DELETE CASCADE,
  kpi_id        uuid REFERENCES core.kpi_library(id),
  name_en       text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('HIGHER_BETTER','LOWER_BETTER')),
  unit          text NOT NULL,
  present_level numeric NOT NULL,
  q1_target     numeric NOT NULL,
  q2_target     numeric NOT NULL,
  q3_target     numeric NOT NULL,
  q4_target     numeric NOT NULL,
  weight        numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  sort_order    int NOT NULL DEFAULT 0
);
CREATE INDEX senior_kpi_kra ON core.senior_kpi (kra_id);

-- Monthly entry: one month row per (cycle, period); results hang off the KPI.
CREATE TABLE core.senior_month (
  cycle_id       uuid NOT NULL REFERENCES core.senior_cycle(id),
  period         char(7) NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  state          text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','CONFIRMED')),
  -- Written at confirmation: the official calculation and exactly what produced it (as core.calc_run does).
  scores         jsonb,
  total_score    numeric,
  params         jsonb,
  engine_version text,
  input_hash     text,
  confirmed_by   uuid REFERENCES core.user_account(id),
  confirmed_at   timestamptz,
  PRIMARY KEY (cycle_id, period),
  CHECK ((state = 'CONFIRMED') = (confirmed_at IS NOT NULL))
);

CREATE TABLE core.senior_result (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id           uuid NOT NULL,
  period             char(7) NOT NULL,
  kpi_id             uuid NOT NULL REFERENCES core.senior_kpi(id),
  target_used        numeric NOT NULL,
  present_level_used numeric NOT NULL,
  result             numeric,
  na_reason          text,
  remarks            text,
  updated_by         uuid REFERENCES core.user_account(id),
  updated_at         timestamptz,
  FOREIGN KEY (cycle_id, period) REFERENCES core.senior_month(cycle_id, period),
  UNIQUE (cycle_id, period, kpi_id),
  CHECK (result IS NULL OR na_reason IS NULL)
);

-- Self and manager year-end assessments (one row per stage; send-back reopens it, audit keeps the history).
CREATE TABLE core.senior_assessment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid NOT NULL REFERENCES core.senior_cycle(id),
  stage         text NOT NULL CHECK (stage IN ('SELF','MANAGER')),
  author_id     uuid NOT NULL REFERENCES core.user_account(id),
  summary       text NOT NULL DEFAULT '',
  kra_comments  jsonb NOT NULL DEFAULT '{}',   -- { "<senior_kra id>": "text" }
  submitted_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, stage)
);

-- ------------------------------------------------------------ guards --

-- Only the transitions in doc 06 §3 (plus the send-backs) are legal, whatever code path attempts them, and the
-- people on a cycle must be distinct: the employee never manages, reviews or finalises their own appraisal.
CREATE FUNCTION core.senior_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  emp uuid;
  rev uuid;
  emp_user uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'FINALISED' THEN
      RAISE EXCEPTION 'LOCKED: the appraisal is finalised and can no longer change' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT a.employee_id, a.reviewer_user_id INTO emp, rev FROM core.appraisal a WHERE a.id = NEW.appraisal_id;
  SELECT id INTO emp_user FROM core.user_account WHERE employee_id = emp;

  IF TG_OP = 'INSERT' THEN
    IF rev IS NULL THEN
      RAISE EXCEPTION 'WORKFLOW: the appraisal needs a reviewer before a goal sheet can start' USING ERRCODE = 'check_violation';
    END IF;
    IF rev = NEW.manager_id THEN
      RAISE EXCEPTION 'SOD: the manager and the reviewer must be different people' USING ERRCODE = 'check_violation';
    END IF;
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
        ('HR_FINALISATION','FINALISED'), ('HR_FINALISATION','REVIEWER_REVIEW')
      ) AS t(from_state, to_state) WHERE t.from_state = OLD.state AND t.to_state = NEW.state
    ) THEN
      RAISE EXCEPTION 'WORKFLOW: transition % -> % is not allowed', OLD.state, NEW.state USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER senior_cycle_guard BEFORE INSERT OR UPDATE ON core.senior_cycle
  FOR EACH ROW EXECUTE FUNCTION core.senior_cycle_guard();

-- The reviewer can still be reassigned while the appraisal is open (it is an assignment), but not once it is finalised.
CREATE FUNCTION core.appraisal_senior_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM core.senior_cycle c WHERE c.appraisal_id = NEW.id AND c.state = 'FINALISED') THEN
    RAISE EXCEPTION 'LOCKED: the appraisal is finalised and can no longer change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appraisal_senior_lock BEFORE UPDATE ON core.appraisal
  FOR EACH ROW EXECUTE FUNCTION core.appraisal_senior_lock();

-- The reviewer's sign-off is the one step whose actor is not fixed by the cycle row, so it is checked on the event:
-- whoever signs off must not be the employee or the cycle's manager (the reviewer may have been reassigned to them).
CREATE FUNCTION core.senior_event_sod() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mgr uuid;
  emp_user uuid;
BEGIN
  IF NEW.entity_type = 'SENIOR_CYCLE' AND NEW.from_state = 'REVIEWER_REVIEW' AND NEW.to_state = 'HR_FINALISATION' THEN
    SELECT c.manager_id, (SELECT u.id FROM core.user_account u WHERE u.employee_id = a.employee_id)
      INTO mgr, emp_user
      FROM core.senior_cycle c JOIN core.appraisal a ON a.id = c.appraisal_id WHERE c.id = NEW.entity_id;
    IF NEW.actor_id = mgr OR NEW.actor_id = emp_user THEN
      RAISE EXCEPTION 'SOD: the manager or the employee cannot sign off the appraisal as its reviewer' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER senior_event_sod BEFORE INSERT ON core.workflow_event
  FOR EACH ROW EXECUTE FUNCTION core.senior_event_sod();

-- Issue gate: KRA weights total exactly 100, KPI weights total exactly 100 inside each KRA, and every
-- target sits on the improving side of the present level (doc 05 §1.7, doc 06 §3).
CREATE FUNCTION core.senior_cycle_issue_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kra record;
  total numeric;
BEGIN
  IF NEW.state = 'PENDING_ACK' AND OLD.state = 'GOALS_DRAFT' THEN
    SELECT COALESCE(sum(weight), 0) INTO total FROM core.senior_kra WHERE cycle_id = NEW.id;
    IF NOT EXISTS (SELECT 1 FROM core.senior_kra WHERE cycle_id = NEW.id) THEN
      RAISE EXCEPTION 'WEIGHTS: the goal sheet has no KRAs' USING ERRCODE = 'check_violation';
    END IF;
    IF total <> 100 THEN
      RAISE EXCEPTION 'WEIGHTS: KRA weights total % (must be exactly 100)', total USING ERRCODE = 'check_violation';
    END IF;
    FOR kra IN
      SELECT k.name_en, COALESCE(sum(p.weight), 0) AS total, count(p.id) AS n
      FROM core.senior_kra k LEFT JOIN core.senior_kpi p ON p.kra_id = k.id
      WHERE k.cycle_id = NEW.id GROUP BY k.id, k.name_en
    LOOP
      IF kra.n = 0 THEN
        RAISE EXCEPTION 'WEIGHTS: KRA "%" has no KPIs', kra.name_en USING ERRCODE = 'check_violation';
      END IF;
      IF kra.total <> 100 THEN
        RAISE EXCEPTION 'WEIGHTS: KPI weights in KRA "%" total % (must be exactly 100)', kra.name_en, kra.total
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM core.senior_kpi p JOIN core.senior_kra k ON k.id = p.kra_id
      WHERE k.cycle_id = NEW.id AND (
        (p.direction = 'HIGHER_BETTER' AND LEAST(p.q1_target, p.q2_target, p.q3_target, p.q4_target) < p.present_level) OR
        (p.direction = 'LOWER_BETTER'  AND GREATEST(p.q1_target, p.q2_target, p.q3_target, p.q4_target) > p.present_level))
    ) THEN
      RAISE EXCEPTION 'TARGET: a target is on the wrong side of the present level for its direction'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER senior_cycle_issue_check BEFORE UPDATE OF state ON core.senior_cycle
  FOR EACH ROW EXECUTE FUNCTION core.senior_cycle_issue_check();

-- The goal sheet is editable only while the cycle is a draft; it is frozen from issue onwards.
CREATE FUNCTION core.senior_goals_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid uuid;
  st text;
BEGIN
  IF TG_TABLE_NAME = 'senior_kra' THEN
    cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.cycle_id ELSE NEW.cycle_id END;
  ELSE
    SELECT k.cycle_id INTO cid FROM core.senior_kra k WHERE k.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.kra_id ELSE NEW.kra_id END;
  END IF;
  SELECT state INTO st FROM core.senior_cycle WHERE id = cid;
  IF st IS NOT NULL AND st <> 'GOALS_DRAFT' THEN
    RAISE EXCEPTION 'LOCKED: the goal sheet is % and can no longer be edited', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER senior_kra_lock BEFORE INSERT OR UPDATE OR DELETE ON core.senior_kra
  FOR EACH ROW EXECUTE FUNCTION core.senior_goals_lock();
CREATE TRIGGER senior_kpi_lock BEFORE INSERT OR UPDATE OR DELETE ON core.senior_kpi
  FOR EACH ROW EXECUTE FUNCTION core.senior_goals_lock();

-- Monthly inputs: a confirmed month is immutable, and nothing changes once the manager's assessment is submitted.
CREATE FUNCTION core.senior_month_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.cycle_id ELSE NEW.cycle_id END;
  per text := CASE WHEN TG_OP = 'DELETE' THEN OLD.period ELSE NEW.period END;
  st text;
  mst text;
BEGIN
  SELECT state INTO st FROM core.senior_cycle WHERE id = cid;
  IF st IS NOT NULL AND st NOT IN ('ACKNOWLEDGED','SELF_ASSESSMENT','MANAGER_ASSESSMENT') THEN
    RAISE EXCEPTION 'LOCKED: monthly results cannot change while the appraisal is %', st USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'senior_month' THEN
    IF TG_OP <> 'INSERT' THEN
      IF OLD.state = 'CONFIRMED' THEN
        RAISE EXCEPTION 'LOCKED: month % is confirmed and immutable', per USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    SELECT state INTO mst FROM core.senior_month WHERE cycle_id = cid AND period = per;
    IF mst = 'CONFIRMED' THEN
      RAISE EXCEPTION 'LOCKED: month % is confirmed and immutable', per USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER senior_month_lock BEFORE INSERT OR UPDATE OR DELETE ON core.senior_month
  FOR EACH ROW EXECUTE FUNCTION core.senior_month_lock();
CREATE TRIGGER senior_result_lock BEFORE INSERT OR UPDATE OR DELETE ON core.senior_result
  FOR EACH ROW EXECUTE FUNCTION core.senior_month_lock();

-- Assessments are frozen once the cycle is finalised.
CREATE FUNCTION core.senior_assessment_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT state INTO st FROM core.senior_cycle WHERE id = NEW.cycle_id;
  IF st = 'FINALISED' THEN
    RAISE EXCEPTION 'LOCKED: the appraisal is finalised and can no longer change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER senior_assessment_lock BEFORE INSERT OR UPDATE ON core.senior_assessment
  FOR EACH ROW EXECUTE FUNCTION core.senior_assessment_lock();

-- --------------------------------------------------------- permissions --

INSERT INTO core.permission (code) VALUES
  ('senior:own'),       -- Employee: own goal sheet, acknowledgement, self-assessment
  ('senior:manage'),    -- HOD / Manager: the cycles they are named manager of
  ('senior:review'),    -- whoever is assigned as reviewer on an appraisal (HOD / Manager, Plant Head, Management)
  ('senior:hr'),        -- Corporate HR: create cycles, open the appraisal, finalise
  ('senior:read_all');  -- company-wide read (status board)

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('EMP','senior:own'),
  ('HOD','senior:manage'),
  ('HOD','senior:review'), ('PH','senior:review'), ('MGMT','senior:review'),
  ('CHR','senior:hr'), ('CHR','senior:read_all'), ('MGMT','senior:read_all')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;
