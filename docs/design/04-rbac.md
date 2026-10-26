# 04 · RBAC: Role, Scope, Maker-Checker, Delegation

## 1. Model

**Permission = `resource:action`** (e.g. `submission:verify`, `payroll:release`, `rules:approve`).
**Role** = a named set of permissions.
**Role assignment** = `(user, role, scope_type, scope_id, valid_from..valid_to)`.
**Scope types:** `COMPANY`, `PLANT`, `DEPARTMENT`, `CELL`, `TEAM` (the user's reporting-line subtree), `SELF`, `ASSIGNED` (explicit list, for Reviewers).

A user may hold several assignments (e.g. HOD of Forge Dept at Plant 3 **and** Reviewer for two senior staff at Plant 5). Effective permission on a resource is the union of all assignments whose scope covers it.

## 2. Roles

| Code | Role | Intent |
|---|---|---|
| SA | Super Admin (IT) | System configuration, users, roles, sessions. **No pay data, no business approvals.** |
| MD | Management / MD | Read-only analytics across all plants. Sets KRAs for direct reports (Module A). |
| CHR | Corporate HR (Co-HR) | Templates, rules (maker), cycles, process/lock, bonus calculation, payroll preparation. |
| CHR-H | Co-HR Head (approver) | Checker for rules, reopen and payroll release. A distinct role so approvals are always a second person. |
| PHR | Plant HR | Enters/uploads monthly data for their plant. Cannot change rules or approve own entries. |
| PH | Plant Head | Views and approves plant results; approves plant scorecard changes. |
| HOD | HOD / Cell Incharge | Views their department/cell, verifies monthly results, sets KRAs for team (Module A). |
| SUP | Shift Incharge / Supervisor / Setter | Own scores and own area dashboard. |
| SEN | Senior employee (Module A) | Own KRAs, acknowledgement, comments, self-reported results. |
| REV | Reviewer | Sign-off for assigned employees. |
| AUD | Auditor (read-only) | Audit log and compliance reports; no operational data edits, no pay amounts. |

## 3. Permission matrix

Legend: **R** read · **W** write/propose · **A** approve/decide · `·C` company · `·P` plant · `·D` department/cell · `·T` team · `·S` self · `·As` assigned · **—** none. "Propose" (W) never takes effect until a different user holds the A permission (maker-checker).

| # | Capability | SA | MD | CHR | CHR-H | PHR | PH | HOD | SUP | SEN | REV | AUD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Manage users, roles, assignments | W·C | — | — | — | — | — | — | — | — | — | — |
| 2 | System config (plant types, levels, categories, channels) | W·C | — | R·C | — | — | — | — | — | — | — | — |
| 3 | Maintain org units and employee master | R·C* | — | W·C | A·C | W·P | R·P | R·D | — | — | — | — |
| 4 | Bulk import (employees, org, monthly data) | — | — | W·C | — | W·P | — | — | — | — | — | — |
| 5 | KRA templates (per plant type / senior role) | — | R·C | W·C | A·C | R·P | R·P | — | — | — | — | — |
| 6 | Plant scorecard targets and present levels | — | R·C | A·C | — | W·P | A·P | R·D | — | — | — | — |
| 7 | Propose scoring rules | — | — | W·C | — | — | — | — | — | — | — | — |
| 8 | Approve and activate scoring rules | — | R·C | — | A·C | — | — | — | — | — | — | — |
| 9 | Propose bonus / incentive rules | — | — | W·C | — | — | — | — | — | — | — | — |
| 10 | Approve bonus / incentive rules | — | A·C | — | A·C | — | — | — | — | — | — | — |
| 11 | Open/close cycles, set deadlines | — | — | W·C | A·C | — | — | — | — | — | — | — |
| 12 | Enter / upload monthly data | — | — | W·C† | — | W·P | — | — | — | — | — | — |
| 13 | Verify monthly results | — | — | — | — | — | — | A·D | — | — | — | — |
| 14 | Approve monthly results | — | — | — | — | — | A·P | — | — | — | — | — |
| 15 | Process and lock month | — | — | A·C | — | — | — | — | — | — | — | — |
| 16 | Request reopen | — | — | W·C | — | — | W·P | — | — | — | — | — |
| 17 | Approve reopen | — | — | — | A·C | — | — | — | — | — | — | — |
| 18 | View KRA scores and dashboards | — | R·C | R·C | R·C | R·P | R·P | R·D | R·D | — | R·As | — |
| 19 | View individual employee scores | — | R·C | R·C | R·C | R·P | R·P | R·D | R·S | R·S | R·As | — |
| 20 | View pay data (bonus/incentive amounts) | — | R·C (aggregate) | R·C | R·C | — (configurable) | R·P (aggregate) | — | R·S | R·S | — | — |
| 21 | Calculate bonus, prepare payroll batch | — | — | W·C | A·C | — | — | — | — | — | — | — |
| 22 | Release payroll export | — | — | — | A·C | — | — | — | — | — | — | — |
| 23 | Module A: set KRAs / KPIs | — | W·T | W·C | A·C | — | W·P | W·T | — | — | — | — |
| 24 | Module A: acknowledge, comment | — | — | — | — | — | — | — | — | W·S | — | — |
| 25 | Module A: monthly result entry | — | — | — | — | — | — | W·T | — | W·S (draft) | — | — |
| 26 | Module A: review and sign-off | — | — | — | — | — | A·P | A·T | — | — | A·As | — |
| 27 | View audit log | R·C (system events) | — | — | R·C (business) | — | — | — | — | — | — | R·C |
| 28 | Delegate own approval rights | — | W | — | W | — | W | W | — | — | W | — |

\* Super Admin sees identity fields only (name, code, mobile) needed to provision accounts; never salary, bonus or scores.
† Co-HR data entry on behalf of a plant is allowed only with a reason, is flagged on the submission and audited, and that user is then barred from verifying or locking the same submission (SoD).

### Separation-of-duties matrix (enforced at role-assignment time and at transition time)

| Pair | Rule |
|---|---|
| SA + any business role | Not allowed on the same account (pay-data protection). |
| PHR + PH at the same plant | Not allowed. |
| CHR + CHR-H | Not allowed on the same account. |
| Same user on one submission | Cannot be maker (entered/edited any result) **and** verifier **and** approver **and** locker. Each stage needs a person who has not acted at an earlier stage. |
| Rule author vs rule approver | Different users. |
| Payroll preparer vs releaser | Different users. |
| Requester vs approver of reopen | Different users. |

## 4. Scope resolution

```text
can(user, permission, resource):
  assignments = active role assignments of user (including live delegations received)
  for each assignment a where a.role grants permission:
      if scope_covers(a.scope, resource): return ALLOW (record which assignment in decision log)
  return DENY

scope_covers(scope, resource):
  COMPANY    -> true
  PLANT      -> resource.org_path is a descendant-or-self of scope.org_unit.path   (ltree <@)
  DEPARTMENT -> same test against the department node
  CELL       -> same test against the cell node
  TEAM       -> resource.employee is in user's reporting subtree on the resource's date
                (recursive CTE over effective-dated reporting_line)
  SELF       -> resource.employee_id == user.employee_id
  ASSIGNED   -> resource.employee_id in reviewer_assignment list
```

Notes:
- Every resource is anchored to an org unit and/or an employee, so the check is always one of the tests above.
- **List endpoints** apply the same logic as a SQL predicate (never filter in memory): the scoped repository layer injects `WHERE org_unit.path <@ ANY(:allowed_paths)` etc.
- **Data in the past** is evaluated on the resource's effective date, so a transferred HOD loses access to the new unit's future data but retains audit-appropriate access to periods they were responsible for if the role assignment says so.

### Three enforcement layers (defence in depth)

1. **API guard**: decorator declares required permission; policy engine evaluates `can()`.
2. **Scoped repositories**: all queries accept an `AccessContext`; unscoped queries are forbidden by lint and by an integration test that scans repository methods.
3. **PostgreSQL RLS** on `core` tables keyed to `current_setting('app.allowed_paths')` and on the `pay` schema keyed to `app.pay_access`. A bug in layers 1–2 cannot leak other plants' or pay data.

Every authorisation decision on a sensitive resource logs `(user, permission, resource, assignment_id, outcome)`.

## 5. Maker-checker

Applies to:
- every monthly submission (stages: enter → verify → approve → lock);
- scoring rule set, bonus rule set, scorecard version, template version;
- reopen requests, payroll batch release, role assignments for privileged roles.

Implementation:
- Records have `maker_id` and `checker_id`; a **constraint trigger** rejects `checker_id = maker_id` and, for submissions, rejects any actor who appears earlier in the submission's `WORKFLOW_EVENT` chain or as `updated_by` on any result row.
- Changes to rules are expressed as **change requests** holding the proposed JSON; nothing takes effect until the checker approves, which materialises a new immutable version.
- UI shows a field-level diff of the proposal for the checker.

## 6. Delegation

- A delegator (e.g. Plant Head on leave) grants a **subset of their own role assignments** to another user for a fixed `[from, to]` window (max 30 days by default).
- The delegate must hold no SoD conflict with the delegated role at that scope; the system checks before accepting.
- Delegation expires automatically (a scheduled job and a validity check in `can()`); it is not transitive (a delegate cannot re-delegate).
- Actions taken under delegation are recorded as `actor = delegate, on_behalf_of = delegator`, and are shown that way in the audit log and on the workflow history.
- Co-HR Head can also grant emergency delegation, with a mandatory reason, visible on the MD/Auditor dashboard.

## 7. Pay-data protection

- All pay tables live in schema `pay`, readable only through the DB role `app_pay`, used by a code path that requires permission `pay:read` and a role with `pay_access = true`.
- Scores (non-monetary) are separate from payouts, so most users never need pay access.
- Aggregate views (plant totals) are exposed to PH/MD without per-employee amounts.
- Exports containing pay data are generated only for roles with pay access, carry a watermark (user, timestamp) and are logged.
- Field-level masking in API responses when the caller lacks `pay:read`: fields are absent, not nulled, so the client cannot infer anything.
