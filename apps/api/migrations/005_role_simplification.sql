-- Slice 5: simplify roles from 11 to 7 (doc 04 §2).
--   Admin, Management, Corporate HR, Plant HR, Plant Head, HOD / Manager, Employee.
-- Existing databases are upgraded in place: assignments are remapped, never dropped.
--   SA -> ADMIN, MD -> MGMT, CHR_H -> CHR, SUP / SEN / REV / AUD -> EMP (self scope).
-- Self-approval stays blocked at the database level by the maker <> checker CHECKs (002, 004), the reopen
-- requester <> decider CHECK and the submission workflow trigger (003); none of them depend on role codes.

-- Codes are renamed in place so grants and assignments follow the role row.
UPDATE core.role SET code = 'ADMIN', name = 'Admin' WHERE code = 'SA';
UPDATE core.role SET code = 'MGMT',  name = 'Management' WHERE code = 'MD';
UPDATE core.role SET code = 'EMP',   name = 'Employee', mfa_required = false, pay_access = false WHERE code = 'SUP';
UPDATE core.role SET name = 'HOD / Manager' WHERE code = 'HOD';

-- SoD guard: Admin stays separate from business roles; PHR and PH still cannot meet at one plant. CHR + CHR_H is gone:
-- a Corporate HR user may now both author and approve, but never the same record (maker <> checker).
CREATE OR REPLACE FUNCTION core.role_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF (new_code = 'ADMIN' AND other.code <> 'ADMIN') OR (other.code = 'ADMIN' AND new_code <> 'ADMIN') THEN
      RAISE EXCEPTION 'SOD: Admin cannot be combined with business role %', CASE WHEN new_code = 'ADMIN' THEN other.code ELSE new_code END
        USING ERRCODE = 'check_violation';
    END IF;
    IF ((new_code = 'PHR' AND other.code = 'PH') OR (new_code = 'PH' AND other.code = 'PHR'))
       AND other.scope_id IS NOT DISTINCT FROM NEW.scope_id THEN
      RAISE EXCEPTION 'SOD: PHR and PH cannot be held at the same plant' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- Remap assignments before the old roles are removed.
UPDATE core.role_assignment
SET role_id = (SELECT id FROM core.role WHERE code = 'CHR')
WHERE role_id = (SELECT id FROM core.role WHERE code = 'CHR_H');

-- Auditor and Reviewer had company / assigned scope; as Employees they keep nothing but their own records.
UPDATE core.role_assignment
SET role_id = (SELECT id FROM core.role WHERE code = 'EMP'), scope_type = 'SELF', scope_id = NULL
WHERE role_id IN (SELECT id FROM core.role WHERE code IN ('SEN', 'REV', 'AUD'));

-- Corporate HR absorbs everything Co-HR Head could do (templates:approve, reopen:approve, audit:read_business ...).
INSERT INTO core.role_permission (role_id, permission_id)
SELECT (SELECT id FROM core.role WHERE code = 'CHR'), rp.permission_id
FROM core.role_permission rp JOIN core.role r ON r.id = rp.role_id
WHERE r.code = 'CHR_H'
ON CONFLICT DO NOTHING;

DELETE FROM core.role_permission WHERE role_id IN (SELECT id FROM core.role WHERE code IN ('CHR_H', 'SEN', 'REV', 'AUD', 'EMP'));
DELETE FROM core.role WHERE code IN ('CHR_H', 'SEN', 'REV', 'AUD');

-- ---------------------------------------------------------- new grants --

INSERT INTO core.permission (code) VALUES ('myscores:read'), ('appraisals:read'), ('appraisals:assign');

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  -- An Employee sees only their own unit-level results, through the self-scoped /me/scores endpoint.
  ('EMP','myscores:read'),
  ('CHR','appraisals:read'), ('MGMT','appraisals:read'), ('PH','appraisals:read'), ('HOD','appraisals:read'),
  ('CHR','appraisals:assign'), ('PH','appraisals:assign')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;

-- ------------------------------------------------------------ appraisals --

-- A senior-staff appraisal for one fiscal year. The reviewer is an assignment on the appraisal, not a role:
-- any user who currently holds HOD / Manager, Plant Head or Management can be assigned (doc 04 §2).
CREATE TABLE core.appraisal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES core.employee(id),
  fiscal_year       int NOT NULL,            -- start year of the Apr-Mar year, e.g. 2026 = FY 2026-27
  reviewer_user_id  uuid REFERENCES core.user_account(id),
  assigned_by       uuid REFERENCES core.user_account(id),
  created_by        uuid NOT NULL REFERENCES core.user_account(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, fiscal_year)
);
CREATE INDEX appraisal_reviewer ON core.appraisal (reviewer_user_id);

CREATE FUNCTION core.appraisal_reviewer_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reviewer_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM core.user_account u WHERE u.id = NEW.reviewer_user_id AND u.employee_id = NEW.employee_id) THEN
    RAISE EXCEPTION 'SOD: an employee cannot review their own appraisal' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.role_assignment ra JOIN core.role r ON r.id = ra.role_id
    WHERE ra.user_id = NEW.reviewer_user_id AND ra.valid @> current_date AND r.code IN ('HOD', 'PH', 'MGMT')
  ) THEN
    RAISE EXCEPTION 'SOD: a reviewer must hold HOD / Manager, Plant Head or Management' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appraisal_reviewer_check BEFORE INSERT OR UPDATE OF reviewer_user_id, employee_id ON core.appraisal
  FOR EACH ROW EXECUTE FUNCTION core.appraisal_reviewer_check();
