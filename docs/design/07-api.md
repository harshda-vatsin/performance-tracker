# 07 · API Design

## 1. Conventions

- **REST/JSON**, base path `/api/v1`, OpenAPI 3.1 spec generated from the code and published to the dev team and the future payroll integrator.
- **Auth**: session cookie (HttpOnly, SameSite) + CSRF token header `X-CSRF-Token` on non-GET. Machine clients (future payroll integration) use short-lived OAuth2 client-credentials tokens scoped to `payroll:read`.
- **Errors**: RFC 9457 `application/problem+json` with a stable `code` (e.g. `SOD_VIOLATION`, `VALIDATION_FAILED`, `STATE_CONFLICT`) and field-level `errors[]`.
- **Pagination**: `?page=1&pageSize=50` or cursor for audit logs; filtering `?filter[plant]=…`; sorting `?sort=-period`.
- **Concurrency**: `ETag`/`If-Match` on updates; 409 on stale write; 412 if `If-Match` missing on guarded resources.
- **Idempotency**: `Idempotency-Key` header on POSTs that create imports, run calculations or release batches.
- **i18n**: `Accept-Language: ta|en`; labels returned in both languages where defined (`name_en`, `name_ta`).
- **Authorisation**: every route lists its required permission; results are always scope-filtered (doc 04).

## 2. Endpoints by module

### Auth and identity
| Method · Path | Purpose | Permission |
|---|---|---|
| POST `/auth/login` | Password step | public |
| POST `/auth/mfa/verify` | TOTP/SMS OTP step | pre-auth token |
| POST `/auth/otp/request` · `/auth/otp/verify` | OTP-primary login | public |
| GET `/auth/sso/start` · `/auth/sso/callback` | OIDC | public |
| POST `/auth/logout` · GET `/auth/me` | Session | authenticated |
| POST `/auth/reset/request` · `/auth/reset/confirm` | Self-service reset | public |
| GET/DELETE `/auth/sessions[/{id}]` | My devices | self |
| POST `/admin/users/{id}/force-logout` | Forced logout | `users:manage` |
| CRUD `/admin/users`, `/admin/role-assignments`, `/delegations` | Access admin | `users:manage` / own delegation |

### Org and people
| Method · Path | Purpose |
|---|---|
| CRUD `/plant-types`, `/people-levels`, `/employee-categories` | Config |
| CRUD `/org-units` (+ `GET /org-units/{id}/tree`) | Org tree, effective-dated |
| CRUD `/employees`, `/employees/{id}/assignments`, `/employees/{id}/reporting-lines` | People history |
| GET/PUT `/org-units/{id}/level-assignments?period=2026-10` | Who holds which people level this month |
| POST `/imports` (profile `EMPLOYEES`, `ORG`) | Bulk import |

### Templates and scorecards
| Method · Path | Purpose |
|---|---|
| CRUD `/kra-templates` (+ `/versions`, `POST /{id}/activate`) | Per plant type / senior role |
| GET `/scorecards?orgUnit=&fy=` · POST `/scorecards` | Create from template |
| POST `/scorecards/{id}/versions` | Propose edit (maker) |
| POST `/scorecards/{id}/versions/{v}/approve` · `/reject` | Checker |
| GET `/scorecards/{id}/validate` | Weight and direction checks |

### Rules
| Method · Path | Purpose |
|---|---|
| GET `/scoring-rule-sets?scope=` · POST (proposal) · POST `/{id}/approve` | Versioned scoring rules |
| GET `/bonus-rule-sets` · POST · POST `/{id}/approve` | Bonus/incentive rules |
| POST `/rules/simulate` | Dry-run a proposed rule on a past month and show diffs |

### Module B: monthly cycle
| Method · Path | Purpose |
|---|---|
| GET `/monthly-submissions?plant=&period=&state=` | List |
| GET `/monthly-submissions/{id}` | Detail with results, preview scores, flags, timeline |
| PUT `/monthly-submissions/{id}/results` | Bulk save results (draft) |
| POST `/monthly-submissions/{id}/transitions` | `{ "action": "SUBMIT|VERIFY|APPROVE|REJECT|LOCK|REQUEST_REOPEN|APPROVE_REOPEN", "comment": "…" }` |
| POST `/plants/{id}/periods/{period}/approve-all` · `/lock` | Plant-level batch actions |
| GET `/scores/rollups?orgUnit=&fy=&grain=` | Dashboard data |
| GET `/employees/{id}/scores?fy=` | Individual history |

### Module A: senior staff
| Method · Path | Purpose |
|---|---|
| GET/POST `/kra-cycles?fy=&employee=` | Cycle per employee |
| PUT `/kra-cycles/{id}/segments/{sid}/kras` | Author KRAs/KPIs |
| POST `/kra-cycles/{id}/transitions` | `ISSUE`, `ACKNOWLEDGE`, `DISPUTE`, `SIGN_QUARTER`, `FINALISE`, `REOPEN` |
| PUT `/kra-cycles/{id}/results?period=` | Monthly KPI results |
| GET `/kra-cycles/{id}/scorecard` | Computed KPI/KRA/total scores |

### Variable pay (`pay` schema; requires `pay:read` etc.)
| Method · Path | Purpose |
|---|---|
| POST `/payroll-batches` | Calculate for `{plant, period}` |
| GET `/payroll-batches/{id}` (+ `/payouts`, `/variance`) | Review |
| POST `/payroll-batches/{id}/release` | Step-up required; maker ≠ checker |
| POST `/payroll-batches/{id}/adjustments` | Create adjustment batch |
| GET `/payroll-batches/{id}/export?format=xlsx|csv` | Download released file (watermarked, logged) |
| GET `/me/payouts` | Own bonus/incentive statement |
| POST `/imports` (profiles `SALARY_STRUCTURE`, `ATTENDANCE`) | Inputs |

### Imports, exports, reports, audit, notifications
| Method · Path | Purpose |
|---|---|
| POST `/imports` · GET `/imports/{id}` · GET `/imports/{id}/errors.xlsx` · POST `/imports/{id}/commit` | Two-step import |
| GET `/exports/pms-sheet?orgUnit=&period=` · `/exports/summary?fy=&grain=` | Reports |
| GET `/audit-logs?entity=&actor=&from=&to=` | Search (cursor) |
| GET/PUT `/me/notification-preferences` · GET `/notifications` | Notifications |
| GET `/health` · `/ready` | Ops |

## 3. Key request / response examples

### 3.1 Login (password step)
```http
POST /api/v1/auth/login
{ "loginId": "E10452", "password": "••••••••••" }
```
```json
200 { "status": "MFA_REQUIRED", "preAuthToken": "pa_8f1c…", "methods": ["TOTP", "SMS_OTP"], "expiresInSec": 300 }
```

### 3.2 Save monthly results (draft)
```http
PUT /api/v1/monthly-submissions/0192-ab12/results
If-Match: "rev-3"
{
  "results": [
    { "scorecardKraId": "k-prod-01", "result": 86.0, "targetUsed": 90.0 },
    { "scorecardKraId": "k-qual-02", "result": 4.0 },
    { "scorecardKraId": "k-safe-01", "notApplicable": true, "naReason": "Shop shut for 6 days" }
  ]
}
```
```json
200 {
  "revision": 4,
  "preview": {
    "kraScores": [
      { "scorecardKraId": "k-prod-01", "raw": 80.00, "final": 80.00, "flags": [] },
      { "scorecardKraId": "k-qual-02", "raw": 80.00, "final": 80.00, "flags": [] }
    ],
    "levelScores": [ { "level": "HOD", "score": 87.50, "note": "weights renormalised: 1 N/A" } ],
    "validation": [ { "code": "OUTLIER_COMMENT_REQUIRED", "kra": "k-cost-03", "severity": "warning" } ]
  }
}
```

### 3.3 Workflow transition
```http
POST /api/v1/monthly-submissions/0192-ab12/transitions
Idempotency-Key: 6c1d…
{ "action": "REJECT", "comment": "Scrap % for Cell TML looks like a unit error (should be 0.4 not 4.0)" }
```
```json
200 { "state": "REJECTED", "revision": 4, "timeline": [ { "at": "2026-11-04T09:12:00+05:30", "actor": "E20311", "from": "SUBMITTED", "to": "REJECTED" } ] }
409 { "type": "…/problem/sod-violation", "code": "SOD_VIOLATION", "detail": "You edited results in this submission and cannot verify it." }
```

### 3.4 Start an import
```http
POST /api/v1/imports   (multipart: file, profile=PMS_FORGE_V1, orgUnit=<id>, period=2026-10)
```
```json
202 { "id": "imp_77", "state": "VALIDATING" }
GET /api/v1/imports/imp_77
200 { "state": "NEEDS_FIXES", "summary": { "rows": 214, "errors": 6, "warnings": 11 },
      "errorReport": "/api/v1/imports/imp_77/errors.xlsx",
      "errors": [ { "sheet": "HOD", "row": 18, "column": "Result", "code": "DIRECTION_CONTRADICTION", "message": "Target 105 is below present level 110 for a higher-is-better KRA" } ] }
```

### 3.5 Release a payroll batch
```http
POST /api/v1/payroll-batches/pb_2026-10_P03/release
Idempotency-Key: 91ab…
X-Step-Up: <fresh re-auth token>
{ "comment": "Variance checked vs Sept: +2.1%" }
```
```json
200 { "state": "RELEASED", "file": { "name": "payroll_P03_2026-10.xlsx", "sha256": "3be4…", "downloadUrl": "/api/v1/payroll-batches/pb_2026-10_P03/export?format=xlsx" } }
```

### 3.6 Scores for dashboards
```http
GET /api/v1/scores/rollups?orgUnit=plant-03&fy=2026&grain=Q2
```
```json
200 { "unit": "Plant 03 / Forge Dept 1", "grain": "Q2", "ruleSet": "scoring-v4@2026-04",
      "levels": [ { "level": "HOD", "score": 91.40 }, { "level": "SHIFT_INCHARGE", "score": 88.10 }, { "level": "SUPERVISOR", "score": 85.75 } ],
      "pqcdsm": { "P": 92.1, "Q": 85.3, "C": 88.0, "D": 90.4, "S": 100.0, "M": 80.2 },
      "gaps": [] }
```

## 4. API security notes

- Rate limits per IP and per user; stricter on `/auth/*` and `/imports`.
- Request size limits (uploads ≤ 25 MB), content-type allow-lists, JSON schema validation on all bodies (zod).
- No sensitive data in URLs (IDs only); pay endpoints respond with `Cache-Control: no-store`.
- Response filtering removes fields the caller may not see (pay fields absent, not null).
- Correlation ID `X-Request-Id` on every response, logged end to end.
