# MMF Performance Tracker (sales demo)

Clickable, front-end-only demo of an employee performance management system for MM Forgings (plants at Trichy, Singampunari and Viralimalai, Tamil Nadu; corporate office in Chennai).
No backend, no real authentication — all data is mock data held in memory (refresh the page to reset).

React 18 · TypeScript · Tailwind CSS 3 · Recharts · Vite · Vitest

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the scoring logic
npm run build      # type-check + production build into dist/
```

## Using the demo

Use **View as** in the top bar to switch role: Employee (senior staff), Reporting Manager, HR Admin, Plant Head / Management, Shift Supervisor.
Each role sees only its own menus and data. Employee and Reporting Manager (Rajagopal Iyer – Trichy, Venkatesh Reddy – Singampunari, Muthuraman Pandian – Viralimalai) also have a person picker next to the avatar.
The **Demo guide** button lists a suggested walkthrough.

The story built into the data:
- **Karthik Subramanian** (Production Manager) — strong, Outstanding. **Murugan Pillai** (Maintenance Manager) — weak, Unsatisfactory.
- **Arumugam Selvaraj** (2500 T press, Trichy, Shift A, permanent) — standout operator. **Ramesh Babu Chelladurai** (2500 T press, Trichy, Shift C, contract) — struggling.
- Breakdown days: 19 Aug (2500 T press), 9 Sep (Singampunari power cut), 23 Sep (8000 T press), 7 Oct (IF-1 furnace), 14 Oct (6 T hammer).
- Ramya Krishnamurthy (Viralimalai, new joiner) has no goals yet: as **Reporting Manager → Muthuraman Pandian** (Viralimalai Plant Head) assign KRAs and send them, then as **Employee → Ramya** acknowledge.

## Where to change things

| What | File |
| --- | --- |
| **Achievement cap (120%)**, **rating bands**, increment guideline, KRA weightage total | `src/config/scoring.config.ts` |
| **PQCDSM role weightages**, dimension formulas' parameters, operator grade bands | `src/config/scoring.config.ts` |
| Shifts, defect types, downtime reasons, "today" | `src/config/floor.config.ts` |
| Role menus (which sidebar items each role sees) | `src/config/roles.ts` |
| Accent colour | `tailwind.config.js` (`accent`) |
| KRA / KPI library seed (weightages per role, targets) | `src/data/kras.ts`, `src/data/kpiCatalog.ts` |
| Which KPIs are SAP-synced vs manual | `source` in `src/data/kpiCatalog.ts` / per KRA in the library UI |

KRA weightages for each role must total 100%: the library enforces it (use *Auto-balance others* in the editor).

## Structure

```
src/
  config/      scoring + floor + role configuration
  data/        mock data (plants, lines, machines, staff, operators, KRAs, appraisals, generated shift data)
  utils/       pure scoring logic (scoring.ts, operatorScoring.ts) + tests, aggregation, export
  store/       in-memory app state (React context)
  components/  layout, ui primitives, charts, appraisal and floor components
  pages/       Dashboard, KRA Library, Goals, Appraisals, Shift Entry, Operator Scorecards, Skill Matrix, Reports, Overview
```

## Scoring rules

**Track A** — achievement % = actual / target (higher is better) or target / actual (lower is better), capped at the configured cap.
Weighted total score → rating band.

**Track B** — each PQCDSM dimension is scored 0–100 from shift data, then combined with role weights.
Downtime that is not the operator's fault is removed from the productivity standard (see `adjustedStandardQty` in `src/utils/operatorScoring.ts`);
downtime flagged "Operator's fault" in Shift Entry still counts against the operator.

## Notes

- Excel export uses SheetJS (`xlsx`), loaded on demand. CSV export needs nothing extra.
- Sample data only; names are fictional.

## Real-setup data (MM Forgings)

- **Plants:** Trichy, Singampunari, Viralimalai (`src/data/org.ts`); corporate office Chennai.
- **Products:** crankshafts, connecting rods, front axle beams, steering knuckles, universal joint crosses, steering arms. Every shift record carries a product (selectable in Shift Entry, included in the shift-data report).
- **Presses:** 1,600 T to 8,000 T (plus hammers and trimming presses).
- **Workforce mix:** 46 operators and crew: 32 contract (~70%), 10 permanent, 4 trainees (`src/data/operators.ts`). The employment-type dashboard shows each group's share.
- **Plant Head Overview:** Safety tile (recordable injuries for the month and year to date) and performance review coverage for staff vs workers incl. contract (baseline ~91% / ~64%, in `src/data/plantKpis.ts`; headcounts are illustrative).
- **Skill Matrix:** "Skill upgradation coverage %" = share of operators who moved up at least one level this quarter (baseline snapshot in `src/data/skills.ts`).
