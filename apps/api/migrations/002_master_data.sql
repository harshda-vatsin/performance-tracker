-- Slice 2: employee master, people levels, KPI library, KRA templates with weight-per-level validation.
-- Source of truth: docs/design/02-data-model.md (ERD 1 and ERD 2) and 04-rbac.md.

-- ---------------------------------------------------------- employees --

CREATE TABLE core.employee_category (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE,
  name                    text NOT NULL,
  -- Placeholder defaults until the client answers question 8 (who receives bonus / incentive).
  bonus_eligible_default  boolean NOT NULL DEFAULT true
);
INSERT INTO core.employee_category (code, name, bonus_eligible_default) VALUES
  ('STAFF',            'Staff',            true),
  ('PERMANENT_WORKER', 'Permanent worker', true),
  ('CONTRACT_WORKER',  'Contract worker',  false),
  ('TRAINEE',          'Trainee',          false);

-- Effective-dated placement of an employee in an org unit; no two ranges may overlap per employee.
CREATE TABLE core.employee_assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES core.employee(id),
  org_unit_id  uuid NOT NULL REFERENCES core.org_unit(id),
  category_id  uuid NOT NULL REFERENCES core.employee_category(id),
  designation  text,
  grade        text,
  valid        daterange NOT NULL,
  EXCLUDE USING gist (employee_id WITH =, valid WITH &&)
);
CREATE INDEX employee_assignment_unit ON core.employee_assignment (org_unit_id);

-- ------------------------------------------------------ people levels --

CREATE TABLE core.people_level (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_type_id  uuid NOT NULL REFERENCES core.plant_type(id),
  code           text NOT NULL,
  name_en        text NOT NULL,
  name_ta        text,
  rank           int NOT NULL,
  UNIQUE (plant_type_id, code)
);

-- --------------------------------------------------------- KPI library --

CREATE TABLE core.kpi_library (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name_en      text NOT NULL,
  name_ta      text,
  pqcdsm       char(1) NOT NULL CHECK (pqcdsm IN ('P','Q','C','D','S','M')),
  direction    text NOT NULL CHECK (direction IN ('HIGHER_BETTER','LOWER_BETTER')),
  unit         text NOT NULL,
  description  text,
  active       boolean NOT NULL DEFAULT true
);

-- ----------------------------------------------------------- templates --

CREATE TABLE core.kra_template (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_type_id  uuid NOT NULL REFERENCES core.plant_type(id),
  name           text NOT NULL,
  version        int NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  maker_id       uuid NOT NULL REFERENCES core.user_account(id),
  checker_id     uuid REFERENCES core.user_account(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  activated_at   timestamptz,
  UNIQUE (plant_type_id, name, version),
  CHECK (checker_id IS NULL OR checker_id <> maker_id),
  CHECK (status = 'DRAFT' OR checker_id IS NOT NULL)
);
-- One live version and one working draft per template name.
CREATE UNIQUE INDEX kra_template_one_active ON core.kra_template (plant_type_id, name) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX kra_template_one_draft  ON core.kra_template (plant_type_id, name) WHERE status = 'DRAFT';

CREATE TABLE core.template_kra (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES core.kra_template(id) ON DELETE CASCADE,
  kpi_id         uuid REFERENCES core.kpi_library(id),
  name_en        text NOT NULL,
  name_ta        text,
  pqcdsm         char(1) NOT NULL CHECK (pqcdsm IN ('P','Q','C','D','S','M')),
  direction      text NOT NULL CHECK (direction IN ('HIGHER_BETTER','LOWER_BETTER')),
  unit           text NOT NULL,
  present_level  numeric NOT NULL,
  q1_target      numeric NOT NULL,
  q2_target      numeric NOT NULL,
  q3_target      numeric NOT NULL,
  q4_target      numeric NOT NULL,
  sort_order     int NOT NULL DEFAULT 0
);
CREATE INDEX template_kra_template ON core.template_kra (template_id);

CREATE TABLE core.template_kra_weight (
  template_kra_id  uuid NOT NULL REFERENCES core.template_kra(id) ON DELETE CASCADE,
  people_level_id  uuid NOT NULL REFERENCES core.people_level(id),
  weight           numeric(5,2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  PRIMARY KEY (template_kra_id, people_level_id)
);

-- Only DRAFT templates may change; active and retired versions are immutable.
CREATE FUNCTION core.template_kra_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.template_id ELSE NEW.template_id END;
  st text;
BEGIN
  SELECT status INTO st FROM core.kra_template WHERE id = tid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'LOCKED: template is % and can no longer be edited', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER template_kra_lock BEFORE INSERT OR UPDATE OR DELETE ON core.template_kra
  FOR EACH ROW EXECUTE FUNCTION core.template_kra_lock();

CREATE FUNCTION core.template_kra_weight_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.template_kra_id ELSE NEW.template_kra_id END;
  st text;
BEGIN
  SELECT t.status INTO st FROM core.template_kra k JOIN core.kra_template t ON t.id = k.template_id WHERE k.id = kid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'LOCKED: template is % and can no longer be edited', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER template_kra_weight_lock BEFORE INSERT OR UPDATE OR DELETE ON core.template_kra_weight
  FOR EACH ROW EXECUTE FUNCTION core.template_kra_weight_lock();

-- Activation gate: weights must total exactly 100 for every people level of the plant type,
-- and every target must sit on the improving side of the present level (doc 05 §1.7).
CREATE FUNCTION core.kra_template_activation_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lvl record;
  level_count int;
BEGIN
  IF NEW.status = 'ACTIVE' AND OLD.status = 'DRAFT' THEN
    SELECT count(*) INTO level_count FROM core.people_level WHERE plant_type_id = NEW.plant_type_id;
    IF level_count = 0 THEN
      RAISE EXCEPTION 'WEIGHTS: plant type has no people levels defined' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM core.template_kra WHERE template_id = NEW.id) THEN
      RAISE EXCEPTION 'WEIGHTS: template has no KRAs' USING ERRCODE = 'check_violation';
    END IF;

    FOR lvl IN
      SELECT pl.code, COALESCE(sum(w.weight), 0) AS total
      FROM core.people_level pl
      LEFT JOIN core.template_kra k ON k.template_id = NEW.id
      LEFT JOIN core.template_kra_weight w ON w.template_kra_id = k.id AND w.people_level_id = pl.id
      WHERE pl.plant_type_id = NEW.plant_type_id
      GROUP BY pl.id, pl.code
    LOOP
      IF lvl.total <> 100 THEN
        RAISE EXCEPTION 'WEIGHTS: level % weights total % (must be exactly 100)', lvl.code, lvl.total
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM core.template_kra k
      WHERE k.template_id = NEW.id AND (
        (k.direction = 'HIGHER_BETTER' AND LEAST(k.q1_target, k.q2_target, k.q3_target, k.q4_target) < k.present_level) OR
        (k.direction = 'LOWER_BETTER'  AND GREATEST(k.q1_target, k.q2_target, k.q3_target, k.q4_target) > k.present_level))
    ) THEN
      RAISE EXCEPTION 'TARGET: a target is on the wrong side of the present level for its direction'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kra_template_activation_check BEFORE UPDATE OF status ON core.kra_template
  FOR EACH ROW EXECUTE FUNCTION core.kra_template_activation_check();

-- --------------------------------------------------------- permissions --

INSERT INTO core.permission (code) VALUES
  ('config:read'), ('config:write'),
  ('employees:read'), ('employees:write'),
  ('kpi:read'), ('kpi:write'),
  ('templates:read'), ('templates:write'), ('templates:approve');

-- Grants follow doc 04 §3: rows 2 (config), 3 (employees), 5 (templates; KPI library shares the template roles).
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('SA','config:read'), ('SA','config:write'),
  ('CHR','config:read'),
  ('CHR','employees:read'), ('CHR','employees:write'),
  ('CHR_H','employees:read'),
  ('PHR','employees:read'), ('PHR','employees:write'),
  ('PH','employees:read'),
  ('HOD','employees:read'),
  ('CHR','kpi:read'), ('CHR','kpi:write'), ('CHR_H','kpi:read'), ('MD','kpi:read'), ('PHR','kpi:read'), ('PH','kpi:read'),
  ('CHR','templates:read'), ('CHR','templates:write'),
  ('CHR_H','templates:read'), ('CHR_H','templates:approve'),
  ('MD','templates:read'), ('PHR','templates:read'), ('PH','templates:read')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;
