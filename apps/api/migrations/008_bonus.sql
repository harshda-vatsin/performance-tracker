-- Slice 8: monthly bonus. Source of truth: docs/design/05-scoring-and-bonus.md §1.10 and §2.
-- Pay data lives in its own schema. Every amount is a bigint count of paise and every percentage an integer count of
-- basis points (1 bp = 0.01%): there is no floating-point column in this schema (a test checks that).
-- Pipeline: a plant-month is locked -> Corporate HR calculates a batch -> a DIFFERENT Corporate HR user approves, which
-- locks it -> nothing in a locked batch ever changes; corrections are a separate ADJUSTMENT batch with the same approval.
-- Admin holds none of the permissions below, so pay data is invisible to Admin.

CREATE SCHEMA IF NOT EXISTS pay;

-- ----------------------------------------------------------- rule bands --

-- Example rules (doc 05 §2.2, illustrative, not the client's numbers): a monthly score band pays a percentage of the
-- employee's base amount. A score takes the band with the highest min_score it reaches.
CREATE TABLE pay.bonus_band (
  min_score   numeric PRIMARY KEY CHECK (min_score >= 0),
  percent_bp  int NOT NULL CHECK (percent_bp BETWEEN 0 AND 100000),
  label       text NOT NULL
);
INSERT INTO pay.bonus_band (min_score, percent_bp, label) VALUES
  (0,   0,     'Below 50: no bonus'),
  (50,  4000,  '50 to 70: 40%'),
  (70,  7000,  '70 to 85: 70%'),
  (85,  10000, '85 to 100: 100%'),
  (100, 11000, '100 and above: 110%');

-- The monthly base amount each employee's bonus is a percentage of (doc 05 §2.4: supplied by HR).
CREATE TABLE pay.employee_base (
  employee_id  uuid PRIMARY KEY REFERENCES core.employee(id),
  base_paise   bigint NOT NULL CHECK (base_paise >= 0),
  updated_by   uuid REFERENCES core.user_account(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- batches --

CREATE TABLE pay.bonus_batch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period           char(7) NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  plant_id         uuid NOT NULL REFERENCES core.org_unit(id),
  kind             text NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR','ADJUSTMENT')),
  parent_batch_id  uuid REFERENCES pay.bonus_batch(id),
  state            text NOT NULL DEFAULT 'CALCULATED' CHECK (state IN ('CALCULATED','LOCKED','REJECTED','SUPERSEDED')),
  rules            jsonb NOT NULL,                       -- the bands in force when it was calculated
  reason           text,                                 -- why an adjustment was made
  calculated_by    uuid NOT NULL REFERENCES core.user_account(id),
  calculated_at    timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid REFERENCES core.user_account(id),
  decided_at       timestamptz,
  decision_comment text,
  CHECK ((kind = 'ADJUSTMENT') = (parent_batch_id IS NOT NULL)),
  CHECK ((kind = 'ADJUSTMENT') = (reason IS NOT NULL)),
  -- Maker and checker are never the same person: enforced here, not only in the API.
  CHECK (decided_by IS NULL OR decided_by <> calculated_by),
  CHECK (state NOT IN ('LOCKED','REJECTED') OR decided_by IS NOT NULL)
);
-- One live regular batch per plant-month; adjustments are unlimited.
CREATE UNIQUE INDEX bonus_batch_one_live_regular ON pay.bonus_batch (period, plant_id)
  WHERE kind = 'REGULAR' AND state IN ('CALCULATED','LOCKED');

CREATE TABLE pay.bonus_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES pay.bonus_batch(id),
  employee_id   uuid NOT NULL REFERENCES core.employee(id),
  score         numeric,                -- the day-weighted monthly score the band was read from
  days          int,
  base_paise    bigint NOT NULL DEFAULT 0,
  percent_bp    int NOT NULL DEFAULT 0,
  amount_paise  bigint NOT NULL,        -- an adjustment line may be negative; a regular line may not
  note          text,                   -- why a line is zero (no base, not eligible), or an adjustment's explanation
  UNIQUE (batch_id, employee_id)
);

-- A batch can only be decided once, and a decided batch never changes.
CREATE FUNCTION pay.bonus_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LOCKED: bonus batches are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state <> 'CALCULATED' THEN
    RAISE EXCEPTION 'LOCKED: the bonus batch is % and can no longer change', OLD.state USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.period, NEW.plant_id, NEW.kind, NEW.parent_batch_id, NEW.rules, NEW.reason, NEW.calculated_by, NEW.calculated_at)
     IS DISTINCT FROM
     (OLD.id, OLD.period, OLD.plant_id, OLD.kind, OLD.parent_batch_id, OLD.rules, OLD.reason, OLD.calculated_by, OLD.calculated_at) THEN
    RAISE EXCEPTION 'LOCKED: a calculated bonus batch can only be approved, rejected or superseded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bonus_batch_guard BEFORE UPDATE OR DELETE ON pay.bonus_batch
  FOR EACH ROW EXECUTE FUNCTION pay.bonus_batch_guard();

-- Lines can be added only while the batch is CALCULATED, and are never edited afterwards.
CREATE FUNCTION pay.bonus_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'LOCKED: bonus lines are append-only' USING ERRCODE = 'check_violation';
  END IF;
  SELECT state, kind INTO b FROM pay.bonus_batch WHERE id = NEW.batch_id;
  IF b.state <> 'CALCULATED' THEN
    RAISE EXCEPTION 'LOCKED: the bonus batch is % and no lines can be added', b.state USING ERRCODE = 'check_violation';
  END IF;
  IF b.kind = 'REGULAR' AND NEW.amount_paise < 0 THEN
    RAISE EXCEPTION 'WORKFLOW: a regular bonus line cannot be negative; use an adjustment batch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bonus_line_guard BEFORE INSERT OR UPDATE OR DELETE ON pay.bonus_line
  FOR EACH ROW EXECUTE FUNCTION pay.bonus_line_guard();

-- --------------------------------------------------------- permissions --

INSERT INTO core.permission (code) VALUES
  ('bonus:read'),       -- batch list with totals (Management sees aggregates only)
  ('bonus:lines'),      -- per-employee lines
  ('bonus:calculate'),  -- bases, rules, calculate, adjustments
  ('bonus:approve'),    -- approve (locks) or reject a batch someone else calculated
  ('bonus:export'),     -- payroll CSV / Excel
  ('bonus:own');        -- an Employee's own statement

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('CHR','bonus:read'), ('CHR','bonus:lines'), ('CHR','bonus:calculate'), ('CHR','bonus:approve'), ('CHR','bonus:export'),
  ('MGMT','bonus:read'),
  ('EMP','bonus:own')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;
