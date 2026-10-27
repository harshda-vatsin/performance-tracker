# MMF Performance Portal

Replaces MM Forgings Ltd's plant-wise Excel PMS sheets with an auditable web portal for monthly KRA scores, which feed variable pay. Design lives in [`docs/design/`](docs/design/00-README.md); start there.

## Layout

| Path | What it is |
|---|---|
| `apps/demo` | The original clickable, front-end-only demo (mock data, no login). Kept as a UX reference. |
| `apps/api` | Fastify + `pg` API: login, sessions, RBAC, audit log, workflows, configurable approval steps and the bonus module. SQL migrations in `apps/api/migrations`. |
| `apps/web` | React + Vite portal (role-aware shell, master data, monthly entry and workflow, dashboards, and the senior-staff screens: My goals, Team goals, Review queue, Appraisal board). Playwright end-to-end specs in `apps/web/e2e`. |
| `packages/scoring` | `@mmf/scoring`: pure scoring engine, tested against the worked examples in doc 05. |
| `docs/design` | System design (architecture, data model, auth, RBAC, scoring, workflows, plan). |

## Running it

```bash
npm install
docker compose up -d --wait db      # Postgres 16 on localhost:5442
npm run migrate -w @mmf/api
npm run seed -w @mmf/api            # dev data; prints the generated logins
npm run dev -w @mmf/api             # http://127.0.0.1:4000
npm run dev -w @mmf/web             # http://127.0.0.1:5173, proxies /api to the API
npm test                            # all workspaces
```

### Client demo

```bash
npm run demo      # loads fresh demo data into the separate mmf_demo database, then starts the API and web app
```

Open http://127.0.0.1:5173; every demo login shares the password `Demo-2026-Pass`. The 10-minute walkthrough, logins and what to say are in [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md). `npm run demo:load` / `npm run demo:start` do the two halves separately. `npm run test:demo -w @mmf/web` runs the whole script in a browser against `mmf_demo`.

End-to-end tests (Playwright, Chromium) run against a private database, API and web server, so they never touch your dev data. Run `npx playwright install chromium` once, then `npm run test:e2e -w @mmf/web`. They also write a screenshot of every screen each seeded role can reach to `apps/web/screenshots/` (git-ignored).

Configuration is by environment variable (`DATABASE_URL`, `PORT`, `MFA_BYPASS`). Never commit a `.env` file or real credentials; the database password in `docker-compose.yml` is for local development only.

## Approval steps are settings

The default shop-floor flow is *Plant HR submits, Corporate HR locks*; the senior appraisal is *self, manager, Corporate HR*. HOD verification, Plant Head approval and the appraisal reviewer step are **off by default** and Corporate HR can switch each on under **Approval steps** (`GET/PUT /settings/workflow`). Every step, state and guard stays in the code; a switched-off step is skipped. Two-person approval (maker is never checker, enforced in the database) is **not** a setting: templates, scorecard target changes, reopen requests and bonus batches always need a second person.

## Rules that must not be broken

- **Money is never floating point.** All bonus, incentive and payout amounts use integer paise (or a decimal type) in the database and in code. Scores may use plain numbers; money may not. Enforced in the `pay` schema (`bigint` paise, basis points; a test rejects any floating-point column) and by the bonus arithmetic in `apps/api/src/bonus/calc.ts` (see doc 05 §1.10).
- **Scoring parameters are configuration.** Base score, cap, floor and edge-case policies live in `ScoringParams`, not in code paths.
- **Authorisation is enforced on the server**, and every sensitive action is written to the hash-chained audit log.
- **Not production-ready.** MFA/OTP, password reset, rate limiting, CSRF and row-level security are not built yet and are a release gate for any production deployment.
