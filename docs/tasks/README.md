# Tasks

Status: Planned · In progress · PARTIAL (waits for owner step) · Done (merged) · Live on dev

| Task | Title | Depends on | Status |
|---|---|---|---|
| TASK-001 | Scaffold: Next.js app, tooling, DB, health, Docker, CI, Kamal config | — | Done (PR #1) |
| TASK-002 | First deploy to dev (`dev-postaja.inzenirji.si`) — server check, DNS, secrets, deploy workflow on | TASK-001 | PARTIAL — live on dev; owner checks + rollback drill open |
| TASK-003a | Magic-link sign-in, SMTP, superadmin bootstrap | TASK-002 | Live on dev (PR #6) |
| TASK-003b | Organizations, `org_settings`, `forOrg`, cross-tenant harness, invitations | TASK-003a | Live on dev (PR #7) |
| TASK-003c | Super admin `/admin` basics + audit log; create Data Vallis (comped) there | TASK-003b | Live on dev (PR #8) |
| TASK-004 | Platform rules + format presets (tables, sourced seed, rule engine with boundary tests, admin view) | TASK-003 | Live on dev (PR #9) |
| TASK-004b | Super admin edits platform rules / presets (audited) + quarterly re-verification reminder | TASK-004 | Planned |
| TASK-005a | Brands, profile versions, channels, effective rules (no uploads) | TASK-004 | Live on dev (PR #10) |
| TASK-005b | S3 storage + uploads: logo, fonts (diacritics check), brand sources; strict per-org separation | TASK-005a | In progress — part 1 (server) in review, part 2 (upload UI) next |
| TASK-006 | Brand ingestion: extract + synthesize proposal + review/accept | TASK-005 | Planned |

Order and scope beyond TASK-003 may change; the next free numbers are always checked here first.
