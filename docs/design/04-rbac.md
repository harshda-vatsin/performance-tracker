# 04 · RBAC: Role, Scope, Maker-Checker, Delegation

## 1. Model

**Permission = `resource:action`** (e.g. `submission:verify`, `payroll:release`, `rules:approve`).
**Role** = a named set of permissions.
**Role assignment** = `(user, role, scope_type, scope_id, valid_from..valid_to)`.
**Scope types:** `COMPANY`, `PLANT`, `DEPARTMENT`, `CELL`, `TEAM` (the user's reporting-line subtree), `SELF`, `ASSIGNED` (reserved for future per-record lists; no role uses it today: reviewers are an assignment on the appraisal, see §2).

A user may hold several assignments (e.g. HOD of Forge Dept at Plant 3 **and**, separately, the reviewer on two senior-staff appraisals at Plant 5). Effective permission on a resource is the union of all assignments whose scope covers it.

## 2. Roles

Seven roles (revised from eleven; migration `005_role_simplification.sql` remaps existing assignments in place).

| Code | Role | Intent |
|---|---|---|
| ADMIN | Admin (IT) | System configuration, users, roles, sessions; reads the **system** audit log. **No pay data, no business approvals, no business roles on the same account.** |
| MGMT | Management | Read-only analytics across all plants. Sets KRAs for direct reports (Module A). May be assigned as an appraisal reviewer. |
| CHR | Corporate HR | Templates, rules, cycles, process/lock, bonus calculation, payroll preparation, **and** the approvals that follow (template activation, reopen, scorecard changes). A user never approves a record they made or requested: approval needs a **different** Corporate HR user (§3 note ‡, §5). Reads the **business** audit log. Assigns appraisal reviewers. |
| PHR | Plant HR | Enters/uploads monthly data for their plant. Cannot change rules or approve own entries. |
| PH | Plant Head | Views and approves plant results; approves plant scorecard changes. May be assigned as an appraisal reviewer. |
| HOD | HOD / Manager | Views their department/cell, verifies monthly results, sets KRAs for team (Module A). May be assigned as an appraisal reviewer. |
| EMP | Employee | Own records only: the official unit-level results of months in which they were placed at a people level in a unit ("My results"). Replaces Supervisor, Senior employee, Reviewer and Auditor. |

**Reviewer is an assignment, not a role.** Each senior-staff appraisal (`core.appraisal`: employee + fiscal year) carries one reviewer. Any user who currently holds HOD / Manager, Plant Head or Management can be assigned; the database refuses anyone else and refuses the appraisee reviewing their own appraisal. Corporate HR (company) and Plant Head (own plant) assign reviewers. A reviewer sees the appraisals assigned to them even outside their unit scope.

**What an Employee sees depends on what exists for them.** An individual scorecard (Module A) would show their own KRAs; it is not built yet. A unit-level assignment (the monthly `level_assignment` placing them at a people level in a unit) shows that level's official score once the month is locked. With neither, the screen is empty.

**Audit log.** Read-only, hash-chained, two categories: *system* events (sign-ins, lockouts, user and role changes, access denials, system configuration) for Admin, and *business* events (everything else) for Corporate HR. Neither role can change or delete entries.

## 3. Permission matrix

Legend: **R** read · **W** write/propose · **A** approve/decide · `·C` company · `·P` plant · `·D` department/cell · `·T` team · `·S` self · `·As` assigned (the reviewer of that appraisal) · **—** none. "Propose" (W) never takes effect until a different user holds the A permission (maker-checker).

| # | Capability | ADMIN | MGMT | CHR | PHR | PH | HOD | EMP |
|---|---|---|---|---|---|---|---|---|
| 1 | Manage users, roles, assignments | W·C | — | — | — | — | — | — |
| 2 | System config (plant types, levels, categories, channels) | W·C | — | R·C | — | — | — | — |
| 3 | Maintain org units and employee master | R·C* | — | W·C, A·C‡ | W·P | R·P | R·D | — |
| 4 | Bulk import (employees, org, monthly data) | — | — | W·C | W·P | — | — | — |
| 5 | KRA templates (per plant type / senior role) | — | R·C | W·C, A·C‡ | R·P | R·P | — | — |
| 6 | Plant scorecard targets and present levels | — | R·C | W·C, A·C‡ | W·P | A·P | R·D | — |
| 7 | Propose scoring rules | — | — | W·C | — | — | — | — |
| 8 | Approve and activate scoring rules | — | R·C | A·C‡ | — | — | — | — |
| 9 | Propose bonus / incentive rules | — | — | W·C | — | — | — | — |
| 10 | Approve bonus / incentive rules | — | A·C | A·C‡ | — | — | — | — |
| 11 | Open/close cycles, set deadlines | — | — | W·C, A·C‡ | — | — | — | — |
| 12 | Enter / upload monthly data | — | — | W·C† | W·P | — | — | — |
| 13 | Verify monthly results | — | — | — | — | — | A·D | — |
| 14 | Approve monthly results | — | — | — | — | A·P | — | — |
| 15 | Process and lock month | — | — | A·C | — | — | — | — |
| 16 | Request reopen | — | — | W·C | — | W·P | — | — |
| 17 | Approve reopen | — | — | A·C‡ | — | — | — | — |
| 18 | View KRA scores and dashboards | — | R·C | R·C | R·P | R·P | R·D | R·S (own unit-level results) |
| 19 | View individual employee scores | — | R·C | R·C | R·P | R·P | R·D | R·S |
| 20 | View pay data (bonus/incentive amounts) | — | R·C (aggregate) | R·C | — (configurable) | R·P (aggregate) | — | R·S |
| 21 | Calculate bonus, prepare payroll batch | — | — | W·C | — | — | — | — |
| 22 | Release payroll export | — | — | A·C‡ | — | — | — | — |
| 23 | Module A: set KRAs / KPIs | — | W·T | W·C, A·C‡ | — | W·P | W·T | — |
| 24 | Module A: acknowledge, comment | — | — | — | — | — | — | W·S |
| 25 | Module A: monthly result entry | — | — | — | — | — | W·T | W·S (draft) |
| 26 | Module A: review and sign-off | — | A·As | — | — | A·P, A·As | A·T, A·As | — |
| 27 | View audit log (read-only) | R·C (system events) | — | R·C (business events) | — | — | — | — |
| 28 | Delegate own approval rights | — | W | W | — | W | W | — |
| 29 | Assign the reviewer of a senior-staff appraisal | — | — | W·C | — | W·P | — | — |

\* Admin sees identity fields only (name, code, mobile) needed to provision accounts; never salary, bonus or scores.
† Corporate HR data entry on behalf of a plant is allowed only with a reason, is flagged on the submission and audited, and that user is then barred from verifying or locking the same submission (SoD).
‡ Corporate HR holds both the write and the approve permission, but **never on the same record**: the approver must be a different Corporate HR user from the maker or requester. Enforced in the API and, independently of any role, by the database (§3 SoD table). An organisation therefore needs at least two Corporate HR users.

### Separation-of-duties matrix (enforced at role-assignment time and at transition time)

| Pair | Rule |
|---|---|
| ADMIN + any business role | Not allowed on the same account (pay-data protection). |
| PHR + PH at the same plant | Not allowed. |
| Same user on one submission | Cannot be maker (entered/edited any result) **and** verifier **and** approver **and** locker. Each stage needs a person who has not acted at an earlier stage. |
| Template, scorecard change: author vs approver | Different users, including two Corporate HR users (`CHECK checker_id <> maker_id`). |
| Rule author vs rule approver | Different users. |
| Payroll preparer vs releaser | Different users. |
| Requester vs approver of reopen | Different users, including two Corporate HR users (`CHECK decided_by <> requested_by`). |
| Appraisal reviewer | Must hold HOD / Manager, Plant Head or Management when assigned (trigger `appraisal_reviewer_check`); cannot be the appraisee. |

The Corporate HR / Co-HR Head pairing is no longer a role rule. The record-level checks above replace it, so they hold for any two users whatever roles they hold.

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

Because Corporate HR is one role, the checker of a template, scorecard change, reopen request or rule is simply **a different user** who holds the approve permission; there is no separate approver role. Two Corporate HR users are the minimum for the company. Each check is a database constraint on the record (`maker_id <> checker_id`, `requested_by <> decided_by`), so it cannot be bypassed by a code path that forgets the API check.

Implementation:
- Records have `maker_id` and `checker_id`; a **constraint trigger** rejects `checker_id = maker_id` and, for submissions, rejects any actor who appears earlier in the submission's `WORKFLOW_EVENT` chain or as `updated_by` on any result row.
- Changes to rules are expressed as **change requests** holding the proposed JSON; nothing takes effect until the checker approves, which materialises a new immutable version.
- UI shows a field-level diff of the proposal for the checker.

## 6. Delegation

- A delegator (e.g. Plant Head on leave) grants a **subset of their own role assignments** to another user for a fixed `[from, to]` window (max 30 days by default).
- The delegate must hold no SoD conflict with the delegated role at that scope; the system checks before accepting.
- Delegation expires automatically (a scheduled job and a validity check in `can()`); it is not transitive (a delegate cannot re-delegate).
- Actions taken under delegation are recorded as `actor = delegate, on_behalf_of = delegator`, and are shown that way in the audit log and on the workflow history.
- Corporate HR can also grant emergency delegation (a user other than the delegator's requester), with a mandatory reason, visible on the Management dashboard and in the business audit log.

## 7. Pay-data protection

- All pay tables live in schema `pay`, readable only through the DB role `app_pay`, used by a code path that requires permission `pay:read` and a role with `pay_access = true`.
- Scores (non-monetary) are separate from payouts, so most users never need pay access.
- Aggregate views (plant totals) are exposed to PH/MGMT without per-employee amounts.
- Exports containing pay data are generated only for roles with pay access, carry a watermark (user, timestamp) and are logged.
- Field-level masking in API responses when the caller lacks `pay:read`: fields are absent, not nulled, so the client cannot infer anything.
