# 05 · Scoring Engine and Bonus Engine

## 1. Scoring engine

### 1.1 Shape

`@mmf/scoring` is a **pure, deterministic library**: `(inputs, rule parameters) → scores + flags`. No I/O, no clock, no randomness. It uses decimal arithmetic (not binary floats) so results match Excel to the paisa and are reproducible across runs.

```text
score_kra(result, present_level, target, direction, params)  -> { raw, final, flags[] }
score_level(kra_scores[], weights_for_level[], params)       -> level_score
score_quarter(monthly_level_scores[3], params)               -> quarter_score
score_year(quarter_scores[4], params)                        -> year_score
score_employee(level_scores_by_unit[], days_by_unit[])       -> employee_score
```

### 1.2 KRA score

```
Score = B + (100 − B) × (Result − PL) / (Target − PL)
Final = min(cap, max(floor, Score))
```

- **Direction is handled by the sign of the denominator.** For a lower-is-better KRA, Target < PL and an improving Result < PL gives a positive ratio, so one formula serves both directions. Direction is still stored and used to **validate** that the target sits on the improving side of PL.
- `B` (base score at present level), `cap` and `floor` come from the scoring rule set. Today: B = 60 for Forge, 50 for Machine; defaults cap 120, floor 0 (all configurable).

### 1.3 Parameters (scoring rule set JSON, validated by schema)

```json
{
  "base_score_B": 60,
  "cap": 120,
  "floor": 0,
  "target_equals_present_level": {
    "met_or_better": "FULL_SCORE",
    "worse": "PROPORTIONAL_FROM_BASE"
  },
  "zero_tolerance": { "breach_score": 0 },
  "missing_result": { "on_submit": "BLOCK", "not_applicable": "RENORMALISE_WEIGHTS" },
  "outlier": { "abs_raw_score_gt": 200, "pl_multiple_gt": 3, "mad_multiple_gt": 3, "history_months": 6 },
  "rollup": { "quarter": "AVERAGE_OF_MONTHS", "year": "AVERAGE_OF_QUARTERS" },
  "rounding": { "kra": 2, "level_monthly": 2, "quarter": 2, "year": 2, "monthly_basis_for_quarter": "ROUNDED" }
}
```

Resolution: PLANT override → PLANT_TYPE → GLOBAL; the latest version with `effective_from` ≤ the period start applies.

### 1.4 Edge-case decision table

| Case | Default behaviour | Flag |
|---|---|---|
| Target = PL, result meets or beats | Score = 100 (full) | `TARGET_EQ_PL` |
| Target = PL, result worse | `B × (1 − \|R − PL\| / \|PL\|)`, floored | `TARGET_EQ_PL` |
| Target = 0 and PL ≠ 0 (e.g. unsafe conditions 4 → 0) | Normal formula; result 0 scores 100 | none |
| PL = 0 **and** Target = 0 (zero-tolerance, e.g. fatalities) | Result 0 → 100; any result > 0 → `breach_score` (default 0) | `ZERO_TOLERANCE` |
| Raw score above cap / below floor | Clamped | `CAPPED` / `FLOORED` |
| Result missing at submit | Submission **blocked** unless the row is explicitly marked N/A with a reason | `MISSING` |
| N/A row | Excluded; remaining weights renormalised to 100 for that level | `NA` |
| Result of the wrong type or unit (e.g. 140% on a % KRA) | Rejected at entry (validation) | n/a |
| Outlier (raw outside [−100, 200], result > 3× PL, or > 3 MAD from trailing 6 months) | Allowed but needs a comment from the submitter and shows to verifier | `OUTLIER` |
| Target contradicts direction | Rejected when the scorecard is saved/approved | n/a |
| Weights not totalling 100 for a level | Scorecard version cannot be approved | n/a |
| Level with all-zero weights (no applicable KRAs) | Level shows "n/a"; employees at that level inherit no score and are listed on the plant exception report | `NO_WEIGHTS` |
| Plant missing a PQCDSM category (e.g. no Safety KRA) | Allowed, but surfaced on plant and management dashboards | `GAP_<CAT>` |

### 1.5 Level, quarter, year, employee

- **Level score** = Σ (KRA final score × level weight ÷ 100).
- **Quarter** = average of the 3 monthly level scores (a month not yet locked is excluded and shown as "partial").
- **Year** = default average of 4 quarters; alternatives `WEIGHTED_BY_MONTHS_LOCKED`, `LATEST_QUARTER` (config).
- **Employee score** = the level score of the person's `LEVEL_ASSIGNMENT` in the month. If they moved units mid-month: `Σ(level_score_unit × days_in_unit) ÷ Σ days`.

### 1.6 Worked examples (Forge shop, B = 60, cap 120, floor 0)

| # | Situation | Calculation | Result |
|---|---|---|---|
| 1 | Higher-is-better. PL 82, Target 90, Result 86 | 60 + 40 × (86−82)/(90−82) = 60 + 40 × 0.5 | **80.00** |
| 2 | Lower-is-better (scrap %). PL 5.0, Target 3.0, Result 4.0 | 60 + 40 × (4−5)/(3−5) = 60 + 40 × 0.5 | **80.00** |
| 3 | Same KRA, worse than PL: Result 6.0 | 60 + 40 × (6−5)/(3−5) = 60 + 40 × (−0.5) | **40.00** |
| 4 | Runaway: PL 10, Target 12, Result 40 | 60 + 40 × 30/2 = 660 → capped | **120.00** (`CAPPED`) |
| 5 | Collapse: raw −224 | clamped at floor | **0.00** (`FLOORED`) |
| 6 | Machine shop (B = 50): PL 100, Target 110, Result 108 | 50 + 50 × 8/10 | **90.00** |
| 7 | Target = PL = 95 (OTD %), Result 97 | meets or beats | **100.00** (`TARGET_EQ_PL`) |
| 8 | Same, Result 93 | 60 × (1 − 2/95) = 60 × 0.97895 | **58.74** |
| 9 | Safety: unsafe conditions PL 4, Target 0, Result 1 | 60 + 40 × (1−4)/(0−4) = 60 + 40 × 0.75 | **90.00** |
| 10 | Zero-tolerance: PL 0, Target 0, Result 0 / Result 2 | meets / breach | **100.00** / **0.00** (`ZERO_TOLERANCE`) |
| 11 | Level score. KRA scores 80, 100, 120 with HOD weights 50, 30, 20 | (80×50 + 100×30 + 120×20)/100 = 40 + 30 + 24 | **94.00** |
| 12 | N/A renormalisation. KRA3 (weight 20) is N/A; others 80 @50, 100 @30 | (80×50 + 100×30)/80 | **87.50** (vs 70.00 if wrongly treated as zero) |
| 13 | Quarter. Monthly 94.00, 88.00, 100.00 | average | **94.00** |
| 14 | Year. Quarters 94, 90, 85, 95 | average | **91.00** |
| 15 | Mid-month transfer. Unit X 90 for 20 days, unit Y 80 for 10 days | (90×20 + 80×10)/30 | **86.67** |

These become the first rows of the **golden test suite**; the client's real Excel sheets add hundreds more.

### 1.7 Validation rules (at scorecard save and monthly entry)

1. Direction vs target: HIGHER_BETTER ⇒ Target ≥ PL; LOWER_BETTER ⇒ Target ≤ PL (equal is a warning).
2. Per-level weights total exactly 100 (zero allowed for individual KRAs).
3. Numeric/unit sanity per unit type (percentages 0–100 unless declared otherwise, counts are integers ≥ 0).
4. Outlier flags as in 1.4 (comment required, does not block).
5. Cross-field: quarterly targets must be monotone only if the KRA is flagged "progressive".
6. Every plant-type template includes the six PQCDSM categories, or the plant is flagged with a gap.

### 1.8 Rule versioning and recalculation

- Rule sets are **immutable and versioned**; activation is maker-checker (doc 04) with an `effective_from` month.
- Each `CALC_RUN` stores `scoring_rule_set_id`, `engine_version` and an `input_hash` (SHA-256 of canonicalised inputs), so a run is reproducible and tamper-evident.
- **Recalculating a past month** always selects the rule version in force for that month, so results change only if inputs change.
- Applying new rules retroactively is a separate, explicit "re-base" action: needs a reason, CHR-H approval, creates new OFFICIAL runs, and, if the month was released to payroll, an adjustment batch.
- The engine is semantically versioned; changing its behaviour requires a new `engine_version` and regression run against the golden suite.

### 1.9 Performance

About 12 plants × 15 scored units × 35 KRAs × 3 levels is on the order of 10⁴ calculations per month. The worker loads one plant at a time and computes in memory in tens of milliseconds, then bulk-inserts. A full 12-plant official run is expected in **seconds**, against the 1-minute budget. Per-plant jobs run in parallel and are idempotent.

### 1.10 Number representation (decided)

- **Scores** (this section) use plain JavaScript numbers with a half-up rounding helper (`roundHalfUp`). Every worked example in §1.6 matches to 2 decimals. Scores are not money.
- **Money must never use floating point.** All bonus, incentive and payout amounts are stored and computed as **integer paise** (`bigint` in Postgres, integer-only arithmetic in code) or a decimal type (`numeric` in the database and a decimal library in code). This applies to base amounts, payouts, batch totals and payroll files.
- Percentage and pro-rating factors applied to money are applied once, on the integer paise value, with a single explicit rounding step (see §2.2 `rounding`) so the result is reproducible.
- **Enforced when the pay module is built (Phase 2):** the schema uses `bigint`/`numeric` only for amount columns (no `real`/`double precision`/`float`), a test rejects floating-point types in the `pay` schema, and the payout engine is covered by golden tests with paise-exact expectations.

## 2. Bonus and incentive engine (rules unknown, so fully configurable)

### 2.1 Pipeline

```
finalised score (locked) ─► eligibility ─► base amount ─► payout function ─► adjustments ─► rounding ─► PAYOUT row
```

Each stage is driven by a versioned **bonus rule set** (JSON, schema-validated, maker-checker). One rule set per `component` (`MONTHLY_BONUS`, `INCENTIVE`); a rule set contains an ordered list of rules, and the first rule whose `applies_to` matches the employee wins (category, plant type, plant, grade).

### 2.2 Example rule (illustrative, not the client's real numbers)

```json
{
  "component": "MONTHLY_BONUS",
  "applies_to": { "categories": ["STAFF", "PERMANENT_WORKER"], "plant_types": ["FORGE", "MACHINE"] },
  "eligibility": [
    { "all": [
      { "field": "attendance_days", "op": ">=", "value": 20 },
      { "field": "disciplinary_hold", "op": "==", "value": false },
      { "field": "level_score", "op": ">=", "value": 50 }
    ]}
  ],
  "base": { "source": "salary_structure", "field": "bonus_base" },
  "payout": {
    "type": "BANDS",
    "input": "level_score",
    "bands": [
      { "from": 0,   "to": 50,   "pct": 0 },
      { "from": 50,  "to": 70,   "pct": 40 },
      { "from": 70,  "to": 85,   "pct": 70 },
      { "from": 85,  "to": 100,  "pct": 100 },
      { "from": 100, "to": null, "pct": 110 }
    ]
  },
  "prorate": { "by": "days_present / working_days" },
  "cap": { "max_pct_of_base": 120 },
  "rounding": { "mode": "HALF_UP", "to": 1 }
}
```

Band convention: `from` inclusive, `to` exclusive. Supported payout types: `BANDS`, `LINEAR` (interpolate between two score points), `FIXED_BY_BAND` (amount, not %), `MATRIX` (score band × grade), `FORMULA` (restricted expression: arithmetic, `min/max/clamp`, no loops).

### 2.3 Worked examples

| # | Input | Calculation | Payout |
|---|---|---|---|
| 1 | Score 94.00 → band 85–100 ⇒ 100%. Base ₹3,000. Present 26 of 28 working days | 3000 × 100% × 26/28 = 2785.71 | **₹2,786** |
| 2 | Score 49.99 (< 50) | eligibility fails (`level_score ≥ 50`) | **₹0**, reason recorded |
| 3 | `LINEAR` incentive: 0% at score 70, 100% at 100. Score 94, base ₹5,000 | (94−70)/(100−70) = 0.8 → 5000 × 0.8 | **₹4,000** |
| 4 | Score 118 with 110% band, `cap` 120% | 3000 × 110% = 3300 ≤ 3600 | **₹3,300** |

Every `PAYOUT` row stores `explanation`: the matched rule, band, eligibility results and pro-rating factor, so a payslip query can be answered in one click.

### 2.4 Inputs the engine needs (and where they come from)

| Input | Source |
|---|---|
| Level score | Official calc run (locked submission) |
| Base amount (bonus base, incentive base) | `salary_structure` sheet uploaded by Co-HR/Plant HR, effective-dated |
| Attendance and working days | Monthly "Attendance and eligibility" sheet in the plant upload |
| Disciplinary / hold flags | Entered by Plant HR with reason, verified by Co-HR |

### 2.5 Approval and release

1. **Calculate** (Co-HR): produces `PAYROLL_BATCH` (state `CALCULATED`) per plant-month with all payouts; the system shows exceptions (no score, no base, ineligible).
2. **Review**: Co-HR compares to last month (variance report); can exclude individuals with reason.
3. **Release** (Co-HR Head, step-up auth): batch becomes `RELEASED`, locked, the file is generated, SHA-256 is stored and a consolidated all-plant file can be produced.
4. **After release**, nothing is edited. Corrections create an `ADJUSTMENT` batch (positive or negative deltas) referencing the original, with the same approval.

### 2.6 Integration point (future)

Payroll export is behind an interface `PayrollExporter { format(batch) → file; deliver(file) → receipt }`. Phase 1 implements `ExcelExporter` and `CsvExporter` with a configurable column map; a later `SftpExporter` or `ApiExporter` plugs in without changing the batch domain.

## 3. Testing strategy

- **Golden-file tests**: real PMS sheets from the client: input rows + the Excel result; engine output must match to 2 decimals (documented exceptions where the Excel result was wrong, e.g. scores of 460 or −224).
- **Property tests**: monotonicity (a better result never lowers the score), cap/floor invariants, level scores within [floor, cap], weight renormalisation sums to 100.
- **Replay test in CI**: re-run last month's locked inputs against the current engine and compare to stored `input_hash`/outputs.
- **Rule-schema tests** for bonus DSL, including boundary values of bands.
