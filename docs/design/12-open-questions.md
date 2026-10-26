# 12 · Open Questions and Assumptions to Confirm

Priority: **B** = blocks Phase 1 design/build, **P2** = needed before Phase 2, **L** = later. "Default" is what the design assumes until answered.

## A. Scoring

| # | Question | Default assumed | Pri |
|---|---|---|---|
| 1 | Is the formula `B + (100 − B) × (R − PL)/(T − PL)` identical for all 12 plants, or do some sheets use other formulas or lookups? | Same formula; B per plant type | B |
| 2 | Confirm base score B: 60 (Forge) and 50 (Machine). Any plant-level exceptions? What about the 3 "Other" plants? | Global 60, Machine override 50 | B |
| 3 | Cap and floor values, and whether they differ by plant type or by KRA category | cap 120, floor 0 | B |
| 4 | Policy when Target = PL: is "met or beats = 100" acceptable? | Yes (doc 05) | B |
| 5 | Zero-target KRAs (fatalities, unsafe conditions): what should a breach score? Is it plant-specific? | 0 on breach | B |
| 6 | Missing result: block submission, score as zero, or exclude and renormalise? | Block, N/A with reason renormalises | B |
| 7 | Are monthly scores rounded before averaging into the quarter? | Round to 2 dp, then average | B |
| 8 | Yearly roll-up rule: simple average of quarters, or weighted by months, or latest quarter? | Average of 4 quarters | P2 |
| 9 | Do monthly targets simply equal the quarter's target, or are there monthly targets? | Quarter target applies to each of its months | B |
| 10 | Can a plant change targets or PLs mid-year? If so, who approves and from which month? | Plant HR proposes, Plant Head approves, effective from the next open month | B |

## B. Variable pay

| # | Question | Default | Pri |
|---|---|---|---|
| 11 | Monthly bonus and incentive formulas: bands, linear, thresholds, caps? | Configurable DSL (doc 05) | P2 |
| 12 | Which employee categories get bonus and which get incentive (contract workers, trainees)? | Rule setting per category | P2 |
| 13 | Where do base amounts come from (grade, salary structure, fixed table)? Who maintains them? | Imported salary-structure sheet | P2 |
| 14 | Eligibility conditions: attendance, disciplinary, notice period, minimum service, plant-specific? | Attendance + hold flag | P2 |
| 15 | How are leavers, joiners and long leave pro-rated? | Days present ÷ working days | P2 |
| 16 | Which score drives incentive: individual level score, unit score, or a plant-wide figure? | Level score | P2 |
| 17 | Required payroll file layout and who loads it? Any sample? | Configurable columns | P2 |
| 18 | Approval chain before release (a second Corporate HR user only, or Finance/MD too)? | A different Corporate HR user | P2 |

## C. Organisation and people

| # | Question | Default | Pri |
|---|---|---|---|
| 19 | Exact list of departments (Forge) and cells (Machine) for each plant; are they uniform within a type? | Per-plant list via import | B |
| 20 | The 3 "Other" plant types: what are they and what do their sheets look like? | Configured later as new plant types | L |
| 21 | Are people levels fixed per plant type as stated (HOD / Shift Incharge / Supervisor; Cell Incharge / Setter & Supervisor / Staff)? | Yes, configurable | B |
| 22 | Who assigns people to levels each month, and how often does it change? | Plant HR, monthly | B |
| 23 | Can an employee hold two levels or two units in one month? | One level per unit; days-weighted if moved | B |
| 24 | Is the employee code unique across all plants and contractors? Do contract workers have company codes? | Unique, issued by HR | B |
| 25 | Do shop-floor workers appear individually in the system, or only the level in a department (with a named person)? | Named individuals (needed for bonus) | B |

## D. Module A

| # | Question | Default | Pri |
|---|---|---|---|
| 26 | Who counts as "senior staff" and roughly how many? | Grade-based list supplied by HR | L |
| 27 | Does Module A use the same scoring formula (with its own B/cap/floor)? | Same engine, scope `SENIOR` | L |
| 28 | Does Module A feed pay (increment, bonus) or only appraisal? | Appraisal only in v1 | L |
| 29 | Rating bands and increment guidelines? | Configurable | L |
| 30 | Who sets KRAs for the top level, and who signs off for them? | MD / board delegate | L |

## E. Workflow and governance

| # | Question | Default | Pri |
|---|---|---|---|
| 31 | Monthly deadlines per step and per plant; holiday calendars? | Doc 06 defaults | B |
| 32 | Is verification by HOD/Cell Incharge per unit, and is Plant Head approval per unit or per plant? | Verify per unit; approve in bulk | B |
| 33 | Who may request and approve a reopen after lock? Time limit? | Corporate HR / Plant Head request; a different Corporate HR user approves | B |
| 34 | Is Co-HR entry on behalf of a plant permitted? | Yes with reason; SoD applies | B |
| 35 | Does the client want an "employee dispute" channel for monthly scores? | Comment + HR ticket, later | L |

## F. Authentication and access

| # | Question | Default | Pri |
|---|---|---|---|
| 36 | Does the client have Microsoft Entra ID or Google Workspace? For whom? | Not assumed; SSO is optional | L |
| 37 | Do all floor staff have a personal mobile number on record? Shared phones? | Registered and verified mobile per person | B |
| 38 | Acceptable MFA method for HR and management: TOTP app, SMS, both? | Both, TOTP preferred | B |
| 39 | Should Plant HR see bonus amounts for their plant? | No (aggregate only), configurable | P2 |
| 40 | Preferred SMS/WhatsApp providers; has DLT registration been done? | Not done; start in Phase 0 | P2 |

## G. Data, migration and compliance

| # | Question | Default | Pri |
|---|---|---|---|
| 41 | Can we get all 2026-27 PMS workbooks, and are they consistent per plant type? | To be collected in Phase 0 | B |
| 42 | Do Excel computed scores need to be reproduced exactly even when wrong (e.g. 460, −224), or flagged? | Flag and show corrected score | B |
| 43 | Retention periods for pay and performance data under company policy and labour law? | 8 years | L |
| 44 | Legal basis and notice wording under DPDP; who is the Grievance Officer? | Employment purposes; officer to be named | L |
| 45 | Is cloud hosting permitted? Preferred provider and region? | Cloud, India region | B |
| 46 | Languages: should Tamil cover all screens or only employee/floor screens? Who provides translations? | Floor/employee screens first; client translates | P2 |

## H. Non-functional

| # | Question | Default | Pri |
|---|---|---|---|
| 47 | Business hours and acceptable downtime? Month-end freeze policy? | 7 am–9 pm IST Mon–Sat; freeze WD 1–10 | L |
| 48 | Existing IT standards (email gateway, firewall, endpoint rules) to comply with? | None assumed | L |
| 49 | Expected growth beyond 20 plants or other group companies (multi-company)? | Single company | L |
| 50 | Who will administer the system after go-live (IT, HR system admin)? | Co-HR system admin + IT | L |
