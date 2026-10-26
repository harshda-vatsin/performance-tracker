# 09 · Security, Audit and Compliance

## 1. Threat model summary

| Asset | Threat | Primary controls |
|---|---|---|
| Pay data (bonus, incentive, salary base) | Insider snooping, over-broad access, exfiltration by export | Separate `pay` schema/DB role, `pay:read` permission, aggregate-only views for most roles, watermarked + logged exports, RLS |
| Scores and rules | Tampering to inflate pay; collusion | Maker-checker with DB-enforced SoD, immutable versions, input hashes, hash-chained audit, lock + controlled reopen |
| Accounts | Credential stuffing, OTP abuse, SIM-swap | Argon2id, lockout, rate-limits, MFA for privileged roles, step-up, breached-password check, alerts |
| Uploads | Malicious files, formula injection, zip bombs | Type sniffing, macro-free .xlsx only, size and decompression caps, AV scan, sandboxed parsing, export sanitisation |
| Personal data | Leak, over-retention | Encryption, minimisation, RLS, retention jobs, access logging |
| Availability at month-end | Overload, DB loss | Autoscaling stateless tier, managed DB with PITR/standby, queues, tested restore |

## 2. OWASP Top 10 (2021) mapping

| Risk | Design response |
|---|---|
| A01 Broken access control | Role × scope policy engine, scoped repositories, Postgres RLS, deny by default, automated authorisation tests per endpoint and per role |
| A02 Cryptographic failures | TLS 1.2+ (HSTS), AES-256 at rest (KMS), field-level encryption for mobile numbers and TOTP secrets, Argon2id, secrets in a vault |
| A03 Injection | Parameterised queries only (Prisma/SQL params), no string-built SQL, zod validation on every input, output encoding, CSV/Excel injection guard |
| A04 Insecure design | Threat model per feature, SoD in the schema, abuse cases in acceptance criteria |
| A05 Security misconfiguration | IaC with policy checks, hardened container images (non-root, read-only FS), security headers (CSP, X-Content-Type-Options, frame-ancestors none), no default credentials, separate environments |
| A06 Vulnerable components | Lockfiles, Dependabot/Renovate, SCA + container scan in CI, SBOM, patch SLA (critical ≤ 7 days) |
| A07 Identification and auth failures | Doc 03: MFA, lockout, secure sessions, no user enumeration, OTP limits, session revocation |
| A08 Software and data integrity | Signed images, protected main branch with reviews, CI-only deploys, hash-chained audit, `input_hash` on calculations, SHA-256 on payroll files |
| A09 Logging and monitoring failures | Structured logs, audit log, alerting on auth anomalies, privileged actions, bulk exports |
| A10 SSRF | No user-supplied URLs fetched; outbound allow-list for SMS/WhatsApp/IdP; egress firewall |

Also: **CSRF** (SameSite + token), **clickjacking** (frame-ancestors), **DoS** (rate limits, request caps, queue back-pressure), **mass assignment** (explicit DTO allow-lists).

## 3. Encryption and key management

- **In transit**: TLS 1.2+ at the edge and between app and DB; internal service traffic over private network with TLS.
- **At rest**: managed disk/DB encryption (AES-256) with customer-managed keys in the cloud KMS (India region); object storage SSE-KMS; encrypted backups.
- **Field-level**: mobile numbers, TOTP secrets, SSO client secret (envelope encryption, per-record data keys). Search on mobile uses a keyed hash.
- **Secrets**: cloud secret manager; no secrets in code, images or env files committed; rotation policy (DB creds 90 days, API keys 180 days).

## 4. Audit design

- **What**: all create/update/delete of business entities, rule and scorecard changes (before/after JSON diff), every workflow transition, approvals and rejections with comments, imports and exports (file hash, row counts), pay-data reads of per-employee amounts, authentication and access events, admin actions, delegations.
- **How**: written in the same DB transaction as the change (cannot be skipped by a crash), append-only `audit_log` with `prev_hash`/`row_hash` chaining; DB role used by the app has `INSERT` only. A nightly job verifies the chain and alerts on a break; the head hash is periodically written to external object storage (WORM bucket) for tamper evidence.
- **Who sees it**: Corporate HR (business events), Admin (system events), each user their own activity. Pay-value fields in audit rows are masked for roles without `pay:read`.
- **Retention**: 8 years (doc 02), cold-archived after 2.
- **Usability**: searchable by entity, actor, date, action; "show full history" on every scorecard, submission and rule.

## 5. DPDP Act 2023 compliance design

| Obligation | Design response |
|---|---|
| Lawful purpose and notice | Employee-facing privacy notice (English/Tamil) covering what is processed (identity, contact, performance, pay-related), purposes (performance management, variable pay) and retention. Employment-related processing is documented; consent captured where required (e.g. mobile OTP via personal number). **Confirm legal basis with counsel.** |
| Data minimisation | No Aadhaar, bank account, or PAN in this portal (payroll holds them). Only fields needed for scoring and bonus. |
| Purpose limitation | Role/scope RBAC; no secondary use of performance data without an approved change. |
| Accuracy | Employees can view their own data and raise correction requests through HR. |
| Storage limitation | Retention schedule (doc 02) enforced by scheduled jobs; leavers' PII minimised after the period, scores pseudonymised. |
| Security safeguards | Sections 2–4 of this document. |
| Breach handling | Incident runbook: detect, contain, assess, notify the Data Protection Board and affected persons as prescribed by the DPDP Rules (confirm current timelines with counsel), post-incident review. Breach register maintained. |
| Data principal rights | Access, correction, erasure (subject to statutory retention), grievance redressal: named Grievance Officer, in-app "Raise a data request" form, tracked SLAs. |
| Processors and transfers | Data Processing Agreements with the hosting, SMS and WhatsApp providers; data stored in India; any cross-border transfer disabled by default. |
| Children's data | Not applicable; minimum employee age validated on onboarding. |
| Significant Data Fiduciary | Assess whether the thresholds could apply (volume/sensitivity); the design supports a DPIA and audit if so. |

## 6. Application security lifecycle

- **SDLC**: threat modelling at design review; mandatory code review; SAST + dependency scan + secret scan on every PR; DAST against UAT per release.
- **Testing**: automated authorisation matrix tests (every role × endpoint × scope), SoD tests, injection and file-upload fuzzing, scoring golden tests.
- **Pen test**: before go-live and annually; fixes tracked to closure.
- **Privileged access**: no standing prod DB access; just-in-time break-glass with approval, session recording, and automatic audit entry.
- **Environments**: production data is never copied to dev/UAT; UAT uses anonymised data (scrambled names/codes/mobiles, same shape).

## 7. Operational security

- WAF with managed rules and rate limiting; DDoS protection at the CDN.
- Network: private subnets for app and DB, DB not internet-reachable, egress allow-list, bastion/Zero-trust access for admins.
- Logging with PII redaction (no passwords, OTPs, full mobile numbers, pay amounts); logs retained 1 year.
- Vulnerability SLA: critical ≤ 7 days, high ≤ 30 days.
- Backup encryption and quarterly restore test (doc 10).
