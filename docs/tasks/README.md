# Tasks

Status: Planned · In progress · PARTIAL (waits for owner step) · Done (merged) · Live on dev

| Task | Title | Depends on | Status |
|---|---|---|---|
| TASK-001 | Scaffold: Next.js app, tooling, DB, health, Docker, CI, Kamal config | — | Done (PR #1) |
| TASK-002 | First deploy to dev (`dev-postaja.inzenirji.si`) — server check, DNS, secrets, deploy workflow on | TASK-001 | PARTIAL — live on dev; owner checks + rollback drill open |
| TASK-003 | Auth + organizations + super admin bootstrap (Better Auth, `org_settings`, `forOrg`, cross-tenant test harness) | TASK-002 | Planned |
| TASK-004 | Platform rules + format presets (tables, seed, rule engine with boundary tests) | TASK-003 | Planned |
| TASK-005 | Brands + profile versions + brand sources upload (S3) | TASK-003 | Planned |
| TASK-006 | Brand ingestion: extract + synthesize proposal + review/accept | TASK-005 | Planned |

Order and scope beyond TASK-003 may change; the next free numbers are always checked here first.
