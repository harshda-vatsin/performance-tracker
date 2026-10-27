# MMF Performance Portal

Replaces MM Forgings Ltd's plant-wise Excel PMS sheets with an auditable web portal. Scores feed variable pay. The design docs are in `docs/design/` (start at `00-README.md`); `README.md` has the rules that must not be broken (no floating-point money, scoring parameters are configuration, server-side authorisation plus the hash-chained audit log, not production-ready).

## Working rules

- **Work only in this folder** (`performance_tracker_client`). **Never run git in the Desktop repo** (`C:\Users\Harshda\Desktop`) or in the old `Desktop\performance_tracker` folder. Both sit under the parent Desktop git repo, which is full of unrelated personal files.
- Remote is `origin` (`github.com/harshda-vatsin/performance-tracker`), branch `main`. Normal pushes only, no force.
- Commit in small steps, one concern each.

## Folder structure

| Path | What it is |
|---|---|
| `apps/api` | **The real API.** Fastify + `pg`: login, sessions, RBAC, audit log, shop-floor and senior-staff workflows. SQL migrations in `apps/api/migrations` (001 to 006), tests in `apps/api/tests`. |
| `apps/web` | **The real UI.** React + Vite portal. Playwright e2e specs in `apps/web/e2e`. |
| `packages/scoring` | `@mmf/scoring`: the pure scoring engine, tested against the worked examples in doc 05. Both tracks use it. |
| `apps/demo` | **Old front-end-only mock (mock data, no login). Kept only as a UX reference. Do not build on it.** |
| `docs/design` | System design: architecture, data model, auth, RBAC, scoring, workflows, plan. |

## The 7 roles

Admin (`ADMIN`), Management (`MGMT`), Corporate HR (`CHR`), Plant HR (`PHR`), Plant Head (`PH`), HOD / Manager (`HOD`), Employee (`EMP`).

- Down from 11 in migration 005. There is no Co-HR Head and no Reviewer role. Employees are the senior staff.
- **Reviewer is an assignment, not a role**: HOD, Plant Head or Management users can be assigned as the reviewer on an appraisal.
- Admin cannot be combined with any business role. PHR and PH cannot meet at one plant. Maker and checker can never be the same person.

## The two tracks

1. **Shop-floor monthly scorecards.** Units are scored every month against KPI templates. Entries go through submission, approval and lock, with plant-month bulk approve. Scores roll up to quarters and the year.
2. **Senior-staff appraisals** (individual KRA track, `apps/api/src/senior`, migration 006). Each senior cycle is **anchored on an existing appraisal**, which holds the employee, fiscal year and reviewer. Goal sheets are owned by Corporate HR. Monthly scores are entered, then rolled up to quarters and a year-end appraisal. The year score is computed from **unrounded** quarter scores and rounded once, for display only. The reviewer cannot sign off their own cycle. Screens: My goals, Team goals, Review queue, Appraisal board.

Both tracks reuse the same scoring engine, approvals, audit log and roll-ups. Extend them; do not build parallel versions.

## Running it

```bash
npm install
docker compose up -d --wait db      # Postgres 16 on localhost:5442 (needs Docker Desktop running)
npm run migrate -w @mmf/api
npm run seed -w @mmf/api            # dev data; prints the generated logins
npm run dev -w @mmf/api             # http://127.0.0.1:4000
npm run dev -w @mmf/web             # http://127.0.0.1:5173, proxies /api to the API
```

Defaults: `DATABASE_URL=postgres://mmf:mmf_dev_only@localhost:5442/mmf`, `PORT`, `MFA_BYPASS`. Set `SEED_PASSWORD` before seeding to give every dev user one known password. Without it each user gets a random password.

### Manual testing: the `mmf_local` database

Use a separate `mmf_local` database on the same Postgres container for hands-on testing, so the `mmf` dev data stays clean. Create it if it is missing, then migrate and seed with `DATABASE_URL=postgres://mmf:mmf_dev_only@localhost:5442/mmf_local` and `SEED_PASSWORD=Mmf-Local-Dev1`, and run the API and web against it. Never point manual testing at `mmf_test` or `mmf_e2e`: the test runs drop and recreate them.

## Tests

```bash
npm run typecheck                           # all workspaces
npm test                                    # all workspaces: scoring, API, web, demo
npx playwright install chromium             # once
npm run test:e2e -w @mmf/web                # full browser suite, one worker
```

- **The API tests need Postgres running** on localhost:5442. Without it, every suite fails in setup with `ECONNREFUSED` (looks like `Cannot read properties of undefined (reading 'close')`), not with a real assertion failure. They use a fresh `mmf_test` database each run.
- **The e2e suite is self-contained**: it uses its own database (`mmf_e2e`), API (port 4100) and Vite server (port 5273), and runs specs in order on one worker because each spec builds on the previous one's data. It writes screenshots to `apps/web/screenshots/` (git-ignored).
- **Windows note, `99-screenshots.spec.ts`:** late in a full run (about 6 minutes in) one test can fail with `WebSocket connection to 'ws://127.0.0.1:5273/...' failed: net::ERR_NO_BUFFER_SPACE`. That is the Windows socket-buffer limit hit by the Vite HMR websocket after many browser sessions, **not an app bug**. The spec runs serially, so the tests after the failure are skipped. Do not "fix" app code for it. Skip that spec or run it on its own (`npx playwright test e2e/99-screenshots.spec.ts --workers=1`).
- `apps/web/guide-check/` is a throwaway Playwright run that walks the testing guide against the `mmf_local` stack. It is git-ignored; leave it out of commits.
