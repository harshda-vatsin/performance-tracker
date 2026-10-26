# 02 · Data Model

## 1. Conventions

- Primary keys are UUIDv7 (time-ordered). Business keys (employee code, org code) are unique constraints.
- **Effective-dated tables** carry `valid daterange` and an exclusion constraint such as `EXCLUDE USING gist (employee_id WITH =, valid WITH &&)` to prevent overlaps. Open-ended ranges are `[from,)`.
- **Immutable once used**: scorecard versions, rule sets and calculation runs are insert-only. Changes create a new version.
- Standard audit columns on all mutable tables: `created_at, created_by, updated_at, updated_by, version`.
- JSONB is used only where the shape is configuration (rule parameters, layout profiles) and is validated against a JSON Schema at write time.
- Pay data lives in a separate schema `pay` (own DB role, see doc 04 and 09). Everything else is in `core`.
- Hierarchy lookups use `ltree` paths on `org_unit` (maintained by trigger) for fast "all descendants of plant X".

## 2. ERD 1: Organisation, people, reporting, levels

```mermaid
erDiagram
  PLANT_TYPE {
    uuid id PK
    text code UK "FORGE, MACHINE, ..."
    text name
    jsonb defaults "scoring overrides, deadlines"
    bool active
  }
  ORG_UNIT {
    uuid id PK
    uuid parent_id FK
    text unit_type "COMPANY, PLANT, DEPARTMENT, CELL"
    uuid plant_type_id FK "set on PLANT rows"
    text code UK
    text name
    ltree path
    daterange valid
    bool active
  }
  EMPLOYEE_CATEGORY {
    uuid id PK
    text code UK "STAFF, PERMANENT_WORKER, CONTRACT_WORKER, TRAINEE"
    bool bonus_eligible_default
  }
  EMPLOYEE {
    uuid id PK
    text employee_code UK
    text full_name
    text mobile_enc "encrypted"
    text email
    date date_of_joining
    date date_of_leaving
    text status
  }
  EMPLOYEE_ASSIGNMENT {
    uuid id PK
    uuid employee_id FK
    uuid org_unit_id FK
    uuid category_id FK
    text designation
    text grade
    daterange valid
  }
  REPORTING_LINE {
    uuid id PK
    uuid employee_id FK
    uuid manager_id FK
    daterange valid
  }
  PEOPLE_LEVEL {
    uuid id PK
    uuid plant_type_id FK
    text code "HOD, SHIFT_INCHARGE, CELL_INCHARGE, ..."
    text name_en
    text name_ta
    int rank
  }
  LEVEL_ASSIGNMENT {
    uuid id PK
    uuid org_unit_id FK
    uuid people_level_id FK
    uuid employee_id FK
    char7 period "YYYY-MM"
    int days_in_unit
  }

  PLANT_TYPE ||--o{ ORG_UNIT : classifies
  ORG_UNIT ||--o{ ORG_UNIT : parent_of
  ORG_UNIT ||--o{ EMPLOYEE_ASSIGNMENT : hosts
  EMPLOYEE ||--o{ EMPLOYEE_ASSIGNMENT : has
  EMPLOYEE_CATEGORY ||--o{ EMPLOYEE_ASSIGNMENT : classifies
  EMPLOYEE ||--o{ REPORTING_LINE : reports_via
  EMPLOYEE ||--o{ REPORTING_LINE : manages_via
  PLANT_TYPE ||--o{ PEOPLE_LEVEL : defines
  PEOPLE_LEVEL ||--o{ LEVEL_ASSIGNMENT : filled_by
  ORG_UNIT ||--o{ LEVEL_ASSIGNMENT : staffed_in
  EMPLOYEE ||--o{ LEVEL_ASSIGNMENT : holds
```

Key rules:
- `ORG_UNIT` is a tree: COMPANY → PLANT → DEPARTMENT → CELL. A forge-shop plant uses DEPARTMENT units; a machine-shop plant uses CELL units under a DEPARTMENT ("Measuring Shop"). The scorecard attaches to the **leaf unit that is scored** (department or cell). That attachment point is a flag `is_scoring_unit` per plant type, so new plant types need no code.
- `EMPLOYEE_ASSIGNMENT` and `REPORTING_LINE` are independent effective-dated histories. A person can report to someone outside their org unit.
- `LEVEL_ASSIGNMENT` is **monthly** and holds `days_in_unit` to support mid-month transfers. Unique on `(org_unit_id, employee_id, period)`.
- Exclusion constraints prevent two active assignments overlapping for the same employee, except where the business allows dual assignment (flagged).

## 3. ERD 2: Templates, scorecards, rules, Module A

```mermaid
erDiagram
  KRA_TEMPLATE {
    uuid id PK
    uuid plant_type_id FK
    text name
    int version
    text status "DRAFT, ACTIVE, RETIRED"
  }
  TEMPLATE_KRA {
    uuid id PK
    uuid template_id FK
    text name_en
    text name_ta
    text pqcdsm "P,Q,C,D,S,M"
    text direction "HIGHER_BETTER, LOWER_BETTER"
    text unit
    numeric present_level
    numeric q1_target
    numeric q2_target
    numeric q3_target
    numeric q4_target
    int sort_order
  }
  TEMPLATE_KRA_WEIGHT {
    uuid template_kra_id FK
    uuid people_level_id FK
    numeric weight "0..100"
  }
  SCORECARD {
    uuid id PK
    uuid org_unit_id FK
    int fiscal_year
    uuid source_template_id FK
  }
  SCORECARD_VERSION {
    uuid id PK
    uuid scorecard_id FK
    int version
    text status "DRAFT, APPROVED, SUPERSEDED"
    date effective_from
    uuid maker_id
    uuid checker_id
  }
  SCORECARD_KRA {
    uuid id PK
    uuid scorecard_version_id FK
    text name_en
    text pqcdsm
    text direction
    text unit
    numeric present_level
    numeric q1_target
    numeric q2_target
    numeric q3_target
    numeric q4_target
  }
  SCORECARD_KRA_WEIGHT {
    uuid scorecard_kra_id FK
    uuid people_level_id FK
    numeric weight
  }
  SCORING_RULE_SET {
    uuid id PK
    text scope_type "GLOBAL, PLANT_TYPE, PLANT"
    uuid scope_id
    int version
    jsonb params "B, cap, floor, edge-case policies, rollup"
    date effective_from
    text status
    uuid maker_id
    uuid checker_id
  }
  KRA_CYCLE {
    uuid id PK
    uuid employee_id FK
    int fiscal_year
    text state
  }
  KRA_CYCLE_SEGMENT {
    uuid id PK
    uuid kra_cycle_id FK
    uuid org_unit_id FK
    text role_title
    daterange valid
    numeric weight_of_year "pro-rata"
  }
  EMP_KRA {
    uuid id PK
    uuid segment_id FK
    text name
    numeric weight
  }
  EMP_KPI {
    uuid id PK
    uuid emp_kra_id FK
    text name
    text unit
    text direction
    numeric present_level
    numeric q1_target
    numeric q2_target
    numeric q3_target
    numeric q4_target
    numeric weight
  }

  KRA_TEMPLATE ||--o{ TEMPLATE_KRA : contains
  TEMPLATE_KRA ||--o{ TEMPLATE_KRA_WEIGHT : weighted_per_level
  SCORECARD ||--o{ SCORECARD_VERSION : versioned_as
  SCORECARD_VERSION ||--o{ SCORECARD_KRA : contains
  SCORECARD_KRA ||--o{ SCORECARD_KRA_WEIGHT : weighted_per_level
  KRA_TEMPLATE ||--o{ SCORECARD : seeds
  KRA_CYCLE ||--o{ KRA_CYCLE_SEGMENT : split_into
  KRA_CYCLE_SEGMENT ||--o{ EMP_KRA : has
  EMP_KRA ||--o{ EMP_KPI : has
```

Key rules:
- A **scorecard** is created for a unit by copying the active template for its plant type. The plant may adjust present levels and targets (maker: Plant HR, checker: Plant Head); each approved change is a new `SCORECARD_VERSION`.
- Weights per level must total **exactly 100** across the scorecard's KRAs (deferred constraint checked at version approval).
- `SCORING_RULE_SET` resolution: most specific scope wins (PLANT → PLANT_TYPE → GLOBAL), then latest `effective_from` ≤ period start.
- Module A **segments** model mid-year joiners, transfers and role changes: each segment has its own KRAs/KPIs and a `weight_of_year` (pro-rata days). See doc 06.
- Quarterly targets are stored as columns because there are always four; this keeps the calculation set-based. If a client later wants other cadences, convert to a child table.

## 4. ERD 3: Monthly results, scores, workflow, variable pay

```mermaid
erDiagram
  MONTHLY_SUBMISSION {
    uuid id PK
    uuid org_unit_id FK
    char7 period
    uuid scorecard_version_id FK
    text state
    int revision
    timestamptz submitted_at
  }
  MONTHLY_RESULT {
    uuid id PK
    uuid submission_id FK
    uuid scorecard_kra_id FK
    numeric target_used "snapshot"
    numeric present_level_used "snapshot"
    numeric result
    text na_reason "null unless not applicable"
    text remarks
  }
  CALC_RUN {
    uuid id PK
    uuid submission_id FK
    text kind "PREVIEW, OFFICIAL"
    uuid scoring_rule_set_id FK
    text engine_version
    text input_hash
    timestamptz ran_at
  }
  KRA_SCORE {
    uuid id PK
    uuid calc_run_id FK
    uuid monthly_result_id FK
    numeric raw_score
    numeric final_score
    text flags "CAPPED, FLOORED, ZERO_DIV, MISSING, OUTLIER"
  }
  LEVEL_SCORE {
    uuid id PK
    uuid calc_run_id FK
    uuid people_level_id FK
    numeric score
  }
  EMPLOYEE_SCORE {
    uuid id PK
    uuid calc_run_id FK
    uuid employee_id FK
    char7 period
    numeric score
    jsonb breakdown "per unit, days"
  }
  SCORE_ROLLUP {
    uuid id PK
    uuid org_unit_id FK
    uuid people_level_id FK
    int fiscal_year
    text grain "Q1,Q2,Q3,Q4,YEAR"
    numeric score
    uuid rule_set_id FK
  }
  WORKFLOW_EVENT {
    uuid id PK
    text entity_type
    uuid entity_id
    text from_state
    text to_state
    uuid actor_id
    uuid on_behalf_of
    text comment
    timestamptz at
  }
  CHANGE_REQUEST {
    uuid id PK
    text entity_type
    uuid entity_id
    jsonb proposed
    uuid maker_id
    uuid checker_id
    text state
    text comment
  }
  BONUS_RULE_SET {
    uuid id PK
    text component "MONTHLY_BONUS, INCENTIVE"
    int version
    jsonb definition
    date effective_from
    text status
    uuid maker_id
    uuid checker_id
  }
  PAYROLL_BATCH {
    uuid id PK
    uuid plant_id FK
    char7 period
    text kind "REGULAR, ADJUSTMENT"
    text state
    text file_sha256
    uuid prepared_by
    uuid released_by
    timestamptz released_at
  }
  PAYOUT {
    uuid id PK
    uuid batch_id FK
    uuid employee_id FK
    text component
    numeric base_amount
    numeric score_used
    numeric payout_pct
    numeric amount
    uuid bonus_rule_set_id FK
    jsonb explanation
  }

  MONTHLY_SUBMISSION ||--o{ MONTHLY_RESULT : holds
  MONTHLY_SUBMISSION ||--o{ CALC_RUN : calculated_by
  CALC_RUN ||--o{ KRA_SCORE : produces
  CALC_RUN ||--o{ LEVEL_SCORE : produces
  CALC_RUN ||--o{ EMPLOYEE_SCORE : produces
  MONTHLY_RESULT ||--o{ KRA_SCORE : scored_as
  MONTHLY_SUBMISSION ||--o{ WORKFLOW_EVENT : transitions
  PAYROLL_BATCH ||--o{ PAYOUT : contains
  BONUS_RULE_SET ||--o{ PAYOUT : applied_in
  EMPLOYEE_SCORE ||--o{ PAYOUT : drives
```

Key rules:
- `MONTHLY_RESULT` snapshots `target_used` and `present_level_used`, so reading an old month never depends on the current scorecard.
- Only the latest **OFFICIAL** `CALC_RUN` per submission feeds payouts. `PREVIEW` runs are ephemeral, pruned after the period closes.
- `PAYOUT` stores an `explanation` JSON (rule version, band hit, pro-rating factor), so any rupee can be explained.
- `SCORE_ROLLUP` is a derived table, rebuilt for the affected unit and quarter when a submission locks or reopens. Dashboards read only from it.
- `PAYROLL_BATCH` and `PAYOUT` live in the `pay` schema.

## 5. ERD 4: Identity, access, audit, integration

```mermaid
erDiagram
  USER_ACCOUNT {
    uuid id PK
    uuid employee_id FK
    text login_id UK "employee code"
    text status "ACTIVE, LOCKED, DISABLED"
    text auth_mode "PASSWORD, OTP_ONLY, SSO"
    int failed_attempts
    timestamptz locked_until
    bool mfa_required
  }
  CREDENTIAL {
    uuid id PK
    uuid user_id FK
    text password_hash "argon2id"
    timestamptz changed_at
    bool must_change
  }
  MFA_FACTOR {
    uuid id PK
    uuid user_id FK
    text kind "TOTP, SMS_OTP"
    text secret_enc
    bool verified
  }
  AUTH_SESSION {
    uuid id PK
    uuid user_id FK
    text device_label
    inet ip
    timestamptz created_at
    timestamptz last_seen
    timestamptz expires_at
    timestamptz revoked_at
  }
  LOGIN_EVENT {
    uuid id PK
    uuid user_id
    text outcome
    text method
    inet ip
    timestamptz at
  }
  ROLE {
    uuid id PK
    text code UK
    text name
    bool mfa_required
    bool pay_access
  }
  PERMISSION {
    uuid id PK
    text code UK "resource:action"
  }
  ROLE_PERMISSION {
    uuid role_id FK
    uuid permission_id FK
  }
  ROLE_ASSIGNMENT {
    uuid id PK
    uuid user_id FK
    uuid role_id FK
    text scope_type "COMPANY, PLANT, DEPARTMENT, CELL, SELF, TEAM"
    uuid scope_id
    daterange valid
    uuid granted_by
  }
  DELEGATION {
    uuid id PK
    uuid from_user_id FK
    uuid to_user_id FK
    uuid role_assignment_id FK
    daterange valid
    text reason
  }
  AUDIT_LOG {
    bigint id PK
    timestamptz at
    uuid actor_id
    uuid on_behalf_of
    text action
    text entity_type
    uuid entity_id
    jsonb before
    jsonb after
    inet ip
    text prev_hash
    text row_hash
  }
  NOTIFICATION_OUTBOX {
    uuid id PK
    uuid recipient_id
    text channel
    text template_code
    jsonb payload
    text state
  }
  IMPORT_JOB {
    uuid id PK
    text profile_code
    uuid uploaded_by
    text state
    text file_sha256
    jsonb summary
  }

  USER_ACCOUNT ||--o{ CREDENTIAL : has
  USER_ACCOUNT ||--o{ MFA_FACTOR : has
  USER_ACCOUNT ||--o{ AUTH_SESSION : opens
  USER_ACCOUNT ||--o{ LOGIN_EVENT : generates
  USER_ACCOUNT ||--o{ ROLE_ASSIGNMENT : granted
  ROLE ||--o{ ROLE_ASSIGNMENT : assigned_as
  ROLE ||--o{ ROLE_PERMISSION : includes
  PERMISSION ||--o{ ROLE_PERMISSION : included_in
  ROLE_ASSIGNMENT ||--o{ DELEGATION : delegated_via
```

## 6. Constraints that protect integrity

| Constraint | Mechanism |
|---|---|
| No overlapping effective ranges per employee/unit | `EXCLUDE USING gist` |
| Level weights total 100 per scorecard version | Deferred constraint trigger on version approval |
| Direction vs target sanity (target on the improving side of PL) | Check in service and trigger on approval |
| Maker ≠ checker on rule sets, scorecard versions, change requests, submissions | Constraint trigger comparing actor IDs |
| One OFFICIAL calc per submission revision | Partial unique index |
| Locked submissions are read-only | Trigger rejects UPDATE/DELETE on results when `state ≥ LOCKED` unless a reopen is active |
| Audit log append-only | No UPDATE/DELETE grants; hash chain verified nightly |
| Pay schema isolated | Separate DB role; app connects with scoped role per request type |

## 7. Retention

| Data | Retention (default; confirm with client/legal) |
|---|---|
| Scores, payouts, payroll files | 8 years (statutory pay records) |
| Audit log | 8 years, archived to cold storage after 2 |
| Login events | 2 years |
| Uploaded Excel files | 2 years, then deleted; file hash kept |
| Departed-employee PII | Minimised after retention period (DPDP), results kept pseudonymised |
