-- Slice 4a: plant-level scorecard adjustments with maker-checker approval (doc 02 ERD 2, doc 04 §3 row 6).
-- An approved request creates a new immutable scorecard_version effective from a chosen month.

CREATE TABLE core.scorecard_change_request (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id      uuid NOT NULL REFERENCES core.scorecard(id),
  base_version_id   uuid NOT NULL REFERENCES core.scorecard_version(id),
  effective_period  char(7) NOT NULL CHECK (effective_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  reason            text NOT NULL,
  -- [{ "kraId": "<scorecard_kra id of the base version>", "presentLevel": n?, "targets": [q1,q2,q3,q4]? }]
  changes           jsonb NOT NULL,
  maker_id          uuid NOT NULL REFERENCES core.user_account(id),
  checker_id        uuid REFERENCES core.user_account(id),
  state             text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','APPROVED','REJECTED')),
  decision_comment  text,
  new_version_id    uuid REFERENCES core.scorecard_version(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CHECK (checker_id IS NULL OR checker_id <> maker_id)
);
-- One open proposal per scorecard keeps version history linear.
CREATE UNIQUE INDEX scorecard_change_one_pending ON core.scorecard_change_request (scorecard_id) WHERE state = 'PENDING';

INSERT INTO core.permission (code) VALUES ('scorecards:propose'), ('scorecards:approve');

-- Doc 04 §3 row 6: Plant HR writes, Plant Head approves (plant scope); Corporate HR may both propose and approve (company scope),
-- never on the same request (maker <> checker).
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('PHR','scorecards:propose'), ('CHR','scorecards:propose'),
  ('PH','scorecards:approve'), ('CHR','scorecards:approve')
) AS g(role_code, perm_code)
JOIN core.role r ON r.code = g.role_code
JOIN core.permission p ON p.code = g.perm_code;
