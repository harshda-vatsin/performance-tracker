# MM Forgings Performance Portal: System Design

Status: **Draft v0.1 for client review** · Scope: design only, no application code · Fiscal year assumed Apr–Mar (FY 2026-27)

## 1. What this is

An enterprise web portal that replaces plant-wise Excel "PMS" sheets for ~5,000 people across 12 plants (4 Forge, 5 Machine, 3 Other). It produces **locked, auditable, payroll-ready monthly results** that drive the monthly performance bonus and incentive.

| # | Document | Brief item |
|---|---|---|
| 00 | This file: summary, assumptions, glossary | all |
| 01 | [Architecture and tech stack](01-architecture-and-stack.md) | 1, 2 |
| 02 | [Data model / ERD](02-data-model.md) | 3 |
| 03 | [Authentication](03-authentication.md) | 4 |
| 04 | [RBAC, maker-checker, delegation](04-rbac.md) | 5 |
| 05 | [Scoring engine and bonus engine](05-scoring-and-bonus.md) | 6 |
| 06 | [Workflow state machines](06-workflows.md) | 7 |
| 07 | [API design](07-api.md) | 8 |
| 08 | [Excel import / export](08-excel-import-export.md) | 9 |
| 09 | [Security, audit, compliance](09-security-audit-compliance.md) | 10 |
| 10 | [Deployment, environments, DR, monitoring](10-deployment-operations.md) | 11 |
| 11 | [Phased delivery plan](11-delivery-plan.md) | 12 |
| 12 | [Open questions](12-open-questions.md) | 13 |

## 2. The ten decisions that shape everything

1. **Modular monolith, not microservices.** ~200 concurrent users and ~5,000 employees do not justify distributed complexity. Strict module boundaries keep a later split possible.
2. **PostgreSQL is the single system of record.** It gives transactions, effective-dating exclusion constraints, row-level security, and a queue (pg-boss), so there is no Redis or message broker in the MVP.
3. **Configuration over code.** Plant types, people levels, PQCDSM categories, employee categories, scoring parameters, bonus rules and workflow deadlines are all rows in tables. A 13th plant, or a new "Other" plant type, is data entry.
4. **The scoring engine is a pure, deterministic, versioned library.** Same inputs plus same rule version always give the same output. Past months are recomputed only with the rule version active in that month.
5. **Everything time-varying is effective-dated** (org units, assignments, reporting lines, people-level assignments, rules). Facts are never overwritten. Corrections create new versions.
6. **Immutable snapshots at submission.** A monthly submission points at an immutable scorecard version (targets, present levels, weights), so later template or target edits cannot change history.
7. **Permissions = role × scope.** Scope is resolved from the org tree (company, plant, department, cell) plus self and team (reporting line). It is enforced in three layers: API guard, scoped repository queries, and Postgres RLS.
8. **Maker-checker is enforced by the database** (constraint triggers), not only by UI logic. Every monthly submission and every rule change needs two different people.
9. **Pay data is segregated** in its own schema and DB role with its own permission. Admin has no pay access by default.
10. **Released payroll is never edited.** Corrections after release become signed adjustment batches. Corrections before release go through a controlled, audited reopen.

## 3. Assumptions (confirm with client; each has a matching question in doc 12)

| ID | Assumption |
|---|---|
| A1 | Fiscal year is April–March; quarters are Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar. Period key is `YYYY-MM`. |
| A2 | One company, one deployment (single-tenant); the 12 plants are org units, not tenants. |
| A3 | Employee code is unique company-wide and never reused. |
| A4 | An employee holds **one people level per org unit per month**; if they move mid-month, the score is day-weighted across units. |
| A5 | There is no attendance or payroll integration. Attendance/days-present and base bonus amounts needed for eligibility and pro-rating are **supplied by Plant HR via Excel** each month (a dedicated sheet in the import). |
| A6 | Contract workers and trainees are tracked for performance. Whether they receive bonus/incentive through this payroll file is a rule setting. |
| A7 | Currency is INR; rounding rule is configurable (default round half up to whole rupee). |
| A8 | The client will supply Tamil translations; the UI externalises all strings. |
| A9 | SMS uses a TRAI **DLT-registered** sender and templates. WhatsApp uses an approved Business API provider. Both are pluggable. |
| A10 | SSO (Entra ID / Google Workspace) availability is unknown; the design supports both and password+OTP as the baseline. |
| A11 | Monthly cut-offs (e.g. plant submission by 3rd working day) are defaults and configurable per plant type. |
| A12 | Yearly roll-up default is the simple average of the four quarters; weighted-by-months is a configurable alternative. |

## 4. Glossary

**PMS** Performance Management System (the Excel sheets). **PQCDSM** Productivity, Quality, Cost, Delivery, Safety, Morale. **KRA** Key Result Area. **KPI** Key Performance Indicator under a KRA. **PL** Present Level (last year's baseline). **B** Base score awarded when result equals present level. **People level** a role tier inside a department/cell (HOD, Shift Incharge, Supervisor; Cell Incharge, Setter & Supervisor, Staff). **Scorecard** the set of KRAs, targets, PLs and weights for one org unit and fiscal year. **Co-HR** Corporate HR. **DLT** India's SMS sender/template registry. **DPDP** Digital Personal Data Protection Act 2023.

## 5. Relationship to the existing demo

The current `performance_tracker` repo is a front-end-only sales demo. It stays valuable as a **UX reference and click-through prototype**, but note two things:

- Its scoring uses `actual ÷ target` capped at 120%. The client's real formula is the interpolation formula in doc 05, so `src/utils/scoring.ts` is replaced, not reused.
- Its role switcher is a demo device. Real access control follows doc 04.

React components, layout and charts can be reused during Phase 1 after the data layer is swapped for the API.
