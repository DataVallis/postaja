# Development Rules — AI-assisted engineering

General rules for building a product with AI agents. Distilled from a real project
(Web3 platform, monorepo, CI/CD, three environments) and made project-neutral.

How to use this file:
- Copy it into the new repo as `docs/DEVELOPMENT-RULES.md`.
- Point the agent at it from `CLAUDE.md` / `AGENTS.md` ("Read docs/DEVELOPMENT-RULES.md before any task").
- Fill in the `<placeholders>` in section 13 (project-specific values) once, at project start.
- Project-specific ADRs in `docs/03-DECISIONS.md` override this file. Newest decision wins.

---

## 1. Roles and working modes

| Role | Who | Responsibilities |
|---|---|---|
| Owner | <owner name> | Product decisions, accounts, keys/secrets, server access, anything on uat/prod, anything irreversible |
| CTO | AI (chat/project or cloud session) | Specs, ADRs, task files, plan review, code review against the files (not the summary) |
| Implementer | AI coding agent (Claude Code, Augment, …) | Implements one task at a time, proves it with real outputs |

Pick one mode per project and write it into `docs/HANDOFF.md`:

**Mode A — Supervised (owner commits).**
The agent implements and writes feedback. The owner creates branches, commits, pushes, merges and deploys.
The agent never commits, pushes, merges, deploys or changes a server.

**Mode B — Autonomous (agent is CTO + implementer).**
The agent implements, tests, commits on `feat/*`, `fix/*` or `docs/*`, opens a PR to `dev`,
waits for CI and merges to `dev` **only when every check is green**, then verifies the deploy on dev.
Standing permissions (e.g. "may merge green PRs to dev") are recorded in HANDOFF with date and the owner's words.
The agent still never touches uat/prod, servers or secrets.

In both modes the agent asks the owner **only** for: keys/secrets, accounts, server actions,
product decisions, anything on uat/prod, anything irreversible. Everything else it decides and documents.

---

## 2. Start of every session

1. Read `docs/HANDOFF.md` (state, working mode, git rules, environment setup, next steps).
2. Read `docs/00-MANIFEST.md` and `docs/03-DECISIONS.md` (ADRs override everything else).
3. Sync the repo: switch to `dev`, pull. Always branch fresh from `origin/dev`.
4. Bring up the local test environment per HANDOFF "Bootstrap" and prove tests run (one real command + output).
5. Summarise the state to the owner in a few lines and propose the next step from HANDOFF —
   unless the owner already gave a concrete task.

---

## 3. Documentation structure (source of truth)

```
docs/
  HANDOFF.md              current state, working mode, how to bootstrap, next steps, owner's open actions
  00-MANIFEST.md          rules for agents (roles, never-list, stack, git, quality bar)
  01-PRODUCT-SPEC.md      what the product does: users, flows, exact rules and numbers
  02-ARCHITECTURE.md      how it is built: components, data, auth, infra, environments, CI/CD, backups
  03-DECISIONS.md         ADR log (append-only)
  CHEATSHEET.md           operator sheet for the owner: URLs, hosts, where each secret lives (never values)
  tasks/
    README.md             task list, order, dependencies, status
    TASK-XXX-name.md      task spec
    TASK-XXX.feedback.md  implementer's report with real outputs
  technical/              how each part works today (+ README with a maintenance map: which doc covers which code)
  guides/                 end-user / owner guides (non-technical)
  runbooks/               rare step-by-step procedures (launch, restore, rotate a key)
  incidents/              YYYY-MM-DD-short-name.md
```

Rules:
- **ADRs are append-only.** Never delete one; supersede it with a new ADR that says which part it replaces.
- **Numbering:** other chats/sessions may reuse task or ADR numbers. Before creating one, check
  `tasks/README.md` and `03-DECISIONS.md` and take the next free number. HANDOFF records the latest numbers.
- **Status labels** everywhere in technical docs: **Live** (in use on an environment) · **Built** (in the repo,
  not yet exercised on the target) · **Planned** (spec/ADR only). Never label something Live without proof.
- Docs describe **reality**, not intentions. A rule that is no longer true is deleted or corrected.
- Language: code, specs, commits, PRs and docs in English; conversation with the owner in <owner language>.

---

## 4. Task lifecycle

Build order for a new project: **scaffold** (repo, tooling, lint/test, CI) → **infra + deploy to the first
environment** → features. Ship an empty skeleton to dev before any feature.

Per task:

1. **Spec** — `docs/tasks/TASK-XXX-name.md` (template in §12): goal, scope, decisions already made,
   tests, must-not-touch, allowed dependencies, acceptance criteria.
2. **Plan** — the implementer reads the files listed under "Read first" and replies with a plan:
   approach, files, data flow end to end, failure modes, tests, risks, open questions with proposed answers.
   Mode A: **stop and wait for OK.** Mode B: proceed unless a product decision is open.
3. **Plan review** — use the Plan checklist (§11).
4. **Implement** — only the approved scope. Unrelated issues are reported, not fixed.
5. **Prove** — run every check the task lists; paste real outputs into the feedback file (§6).
6. **Document** — update technical docs, guides, cheat sheet, HANDOFF (§7).
7. **Review** — the CTO reviews the code in the files, not the summary (Code checklist §11).
   Findings go back as "Review round N" sections in the same feedback file.
8. **Ship** — PR → CI green → merge to dev → verify deploy → status flip to "Live on dev".

A task that needs an owner step (server, GitHub setting, secret) stays **PARTIAL** until the owner
has done it and the output is pasted.

---

## 5. Git, PRs and CI

- Branches: `feat/TASK-XXX-short-name`, `fix/short-name`, `docs/short-name`, `hotfix/*` (from `main` only).
- Flow: `feat/* → dev → uat → main (prod)`. Only the owner promotes `dev → uat → main`.
- Default branch: `dev`. `main` = production releases only.
- One task = one branch = one PR. Don't mix a feature, a fix, a refactor and formatting in one PR.
- **PR size:** aim for ≤ ~800 changed lines (tests count). If a task is bigger, split it (033a, 033b, …)
  or report the overshoot in the PR.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).
- **AI-use marking** (required if the project has a GenAI policy, recommended always): every commit with
  generated code ends with a `Co-Authored-By: <model> …` trailer and has a `Prompt:` line in the body —
  the task spec path, or a one-line summary of the owner's instruction for ad-hoc work.
- Stage files by name. Never `git add .` by default. Check `git status` for secrets and build output before every commit.
- Never rewrite shared history (no force-push, no rebase of pushed branches).
- **Merge only on green.** Every CI job green. A single flaky job may be re-run **once**; a second failure is a bug.
- Waiting for CI: one long command that polls every ~30 s (stay under the tool's timeout), not many short checks.
  Right after a push the new SHA can have 0 check runs for a few seconds — wait until checks exist.
- After merge: find the Deploy run for the merge SHA and verify it finished green, then smoke-check dev.
- Docs-only PRs skip CI jobs and deploy. Status-label flips ("Live on dev") ride along in the next PR or a small docs PR.
- Pipelining (optional): while a PR's CI runs, prepare the next part **uncommitted** (or in a git worktree);
  after the squash-merge, branch fresh from `origin/dev` and move the work over.

CI must run on every PR: install with frozen lockfile → lint → typecheck → unit tests → migrate a test DB →
DB-backed/integration tests → build → (UI) E2E + accessibility → domain-specific suites
(contracts, indexer, …) → design/token guard if the project has a design system.
A "changed areas" job may skip unaffected jobs. Before pushing a CI change, run the exact CI command locally.

---

## 6. Testing and proof rules (non-negotiable)

1. **Proof by output.** A claim without a real command output from *this* session counts as not done.
   Anything that could not run is written as `NOT RUN — <reason>`. Never reuse an output from an earlier run.
2. **Tests must be able to fail.** No early `return`, swallowed `catch`, `.skip` or silent skips.
   A missing dependency (DB, env var, binary) **fails** the suite, never skips it.
3. **Deliberate break.** For every guard/critical test: break the code once, show the test fails, restore,
   show it passes. Paste both outputs in the feedback.
4. **Never weaken a test to get green.** Decide whether the code or the test is wrong; the spec/acceptance
   criteria are the tiebreaker.
5. **Exact boundaries.** Test 0, empty, the exact limit, one unit below and above, repeated calls (idempotency),
   concurrent calls where relevant.
6. **Authorization test** in every app with users: user B cannot read, change or delete user A's data —
   and verify the data itself afterwards (a denied update often affects zero rows without an error).
7. **Assert the right thing:** specific error/selector/status, not "any error". Selectors by role/label;
   beware substring matches (use exact matching or scope to a section).
8. **Real dependencies for integration tests** (real Postgres, local S3 stand-in, local chain) — mock only
   paid external APIs and things you can't run.
9. **Evidence sanity:** timestamps match the run, durations are plausible (5 DB tests in 3 ms didn't touch a DB),
   counts match the last real run.
10. Run heavy local suites (full build, full E2E) only when the change touches that area; otherwise rely on CI.
11. Every bug fix gets a regression test.

Test layers: unit (pure logic, money math) · integration (API + DB, migrations from zero, seed idempotency) ·
E2E + accessibility (critical journeys, both themes, desktop + mobile) · domain suites
(e.g. smart contracts: unit for every function, fuzz for amount math, invariants for balance conservation).

---

## 7. Documentation rules (every task)

"Everything must be documented, how it works."

Every task updates, in the same PR:
- `docs/technical/<chapter>.md` for each area it changed (follow the maintenance map in `docs/technical/README.md`);
- `docs/guides/*` when user- or owner-visible behaviour changed;
- `docs/CHEATSHEET.md` when URLs, hosts, commands, env var names or secret locations changed;
- `.env.example` for every new env var (name only);
- `docs/tasks/TASK-XXX.feedback.md` with real outputs and deliberate breaks;
- `docs/03-DECISIONS.md` when a decision was made (including the agent's own reading of an ambiguous spec —
  write it as an ADR and tell the owner);
- `docs/HANDOFF.md` at the end of every larger step: what was done (PR numbers, deploy run IDs),
  what is live, open owner actions, next step, latest task/ADR numbers.

Versioned owner documents (e.g. an owner guide PDF): every PR that changes the covered area bumps the version,
adds a change-log line and rebuilds the artefact.

Facts that change a published document (whitepaper, pitch) are logged in a `CORRECTIONS.md` (exact old → new text)
and applied in one pass at the end of the phase.

---

## 8. Security and secrets

- Secrets live only in: the owner's own secret store, server secret files (mode 600, outside the repo),
  CI/environment secret stores. **Never** in the repo, chat, agent context, logs, screenshots or shell history.
- The agent never reads, prints or asks for secret values — also not via `git show`, a PR diff or `cat`.
  It only **names** the variables and says where the owner pastes them.
- The owner never pastes passwords into chat. Remind the owner to keep their own copy (CI stores never show a secret again).
- A secret that appeared in chat, a log or a commit is compromised → rotate immediately. Deleting the commit doesn't help.
- Scan history for secrets before making a repo public (e.g. gitleaks).
- Deny-list for agents (configure in the agent's settings, e.g. `.claude/settings.json`):
  ssh/scp/rsync, deploy tools against servers, sudo, `.env*` and secret-file access,
  destructive git (`reset --hard`, `clean`, force-push) — plus whatever the mode requires.
  If the permission layer refuses an action, don't work around it — hand the owner the link/command.
- Server-side: validate all input on the server; never trust identity, roles, user IDs or wallet addresses from the client;
  auth check in every mutating route; rate limits on public endpoints; no tokens, cookies, emails or personal data in logs.
- Least privilege: separate keys per purpose; read-only tokens where possible; pinned SSH host keys in CI.
- Servers: root login off, firewall 22/80/443 only, databases on localhost/internal network only,
  all configuration as code (idempotent scripts with `--dry-run`).
- Hot keys on servers (relayers, operators) only as a deliberate owner decision: dedicated low-balance key,
  never the admin/treasury key.

---

## 9. Environments, deploy and data

- Environments: `local`, `dev`, `uat`, `prod`, each with its own database and secrets.
- Configuration at **runtime** via env vars; no environment-specific values baked into images or code.
- Deploy pipeline: image built in CI → registry → deploy tool → health check → traffic switch →
  migrations → smoke tests (health endpoint contains the deployed SHA, main page 200).
- A deploy guard allows only `dev→dev`, `uat→uat`, `main→prod`. Prod deploys are manual.
- **Migrations are backward compatible** with the previously deployed code: expand → migrate → contract
  (add first, remove later; new required columns need defaults). Never edit an applied migration — add a new one.
- Rollback command for every service is written in the cheat sheet and practised once.
- Backups: two layers, a restore drill done at least once. Git is not a backup of data.
- Irreversible steps (contract deploys, data migrations on prod): dry run → real run → verification,
  only with the owner.
- When the owner must check something on an environment, give exact URLs and the exact text to look for.

---

## 10. Code quality bar

- Lint, typecheck, tests and build pass. New logic has tests.
- Fixed stack — do not substitute frameworks or add dependencies without approval; justify every new package.
- Money as integer types (e.g. `bigint` in minor units), explicit rounding direction. Never floats for money.
- UI: all strings through i18n, design tokens only (no hard-coded colours/fonts), accessibility checks,
  screenshots for review (light/dark, desktop/mobile).
- Every state change in a domain core (contracts, state machines) is observable (events/audit log).
- Generated artefacts (types, ABIs, migrations, tokens) are present and current; CI fails on drift.
- Keep changes scoped; no refactors bundled with features; reuse existing patterns before creating new ones.
- Docker/deploy changes: local build + run + health output required.

---

## 11. Checklists

### Plan review
- [ ] Right branch, based on latest `dev`; previous task merged.
- [ ] Covers every scope item, nothing extra.
- [ ] Every ambiguity has an explicit answer; no silent assumptions.
- [ ] Trust boundaries: client input validated server-side; identity never from the client.
- [ ] Failure modes: external service / env var / migration fails → fails safe and loud.
- [ ] Money/data: integer types, rounding, exact boundaries, zero/empty cases.
- [ ] Config at runtime; privacy (no personal data in defaults, logs, public fields).
- [ ] Tests listed for every risky path, incl. boundaries and negative cases; proof outputs planned.

### Code review (read the code, not the summary)
- [ ] Every claim in the feedback is true in the code.
- [ ] Spec implemented exactly; every deviation listed.
- [ ] Edge cases, idempotency, concurrency.
- [ ] Security: auth on mutating routes, server validation, no client-trusted identity, no secrets/PII in logs, rate limits.
- [ ] Tests assert the right thing and can fail; deliberate break shown.
- [ ] Evidence real (timestamps, durations, counts).
- [ ] New env vars in `.env.example`, deploy config and CI — no values committed.
- [ ] UI matches design (screenshots), i18n, tokens.
- [ ] Docs updated (technical, guides, cheat sheet, HANDOFF).
- [ ] No unlisted system changes (packages, services, DB roles).

### Release
- [ ] CI green on the PR; merged; Deploy run for the merge SHA green; smoke check done.
- [ ] Migrations backward compatible; rollback known.
- [ ] `.dockerignore` excludes `**/node_modules`, build output and `**/.env*`.
- [ ] Status labels flipped to "Live on <env>"; HANDOFF updated.

---

## 12. Templates

### Task spec — `docs/tasks/TASK-XXX-name.md`
```markdown
# TASK-XXX — <title>
Depends on: <ids>
Read first: docs/00-MANIFEST.md, docs/03-DECISIONS.md (<ADRs>), docs/02-ARCHITECTURE.md §<x>, <feedback of dependencies>, <code paths>

## Goal
<what the user/owner can do after this task>

## Scope
### 1. <part>
- <precise requirement: files, functions, routes, env vars>

## Decisions already made (do not re-decide)
- ...

## Tests
- Unit: ...
- Integration: ...
- E2E: ...
- Exact boundaries: ...

## Must not touch
<paths>

## Allowed dependencies
<list> — anything else: ask first.

## Acceptance criteria
- <observable result in the running app/environment>
- All checks pass: <exact commands>
- Proof pasted: <outputs>
- Feedback written, every deviation listed; docs updated.
```

### Feedback — `docs/tasks/TASK-XXX.feedback.md`
```markdown
# TASK-XXX feedback
Status: DONE | PARTIAL | BLOCKED

## What I implemented
## Files changed (path — why)
## Deviations from the task (and why) — "None" only if truly none
## New dependencies (package@version — why)
## How to verify (command — expected result)
## Test results (real outputs, counts)
## Deliberate breaks (what was broken → failing output → restored → passing output)
## NOT RUN (item — reason)
## Docs updated
## Open questions / risks
## Suggested commit message
```

### ADR row — `docs/03-DECISIONS.md`
```markdown
| ADR-XXX | YYYY-MM-DD | Accepted | <one concrete decision> | <why; trade-offs accepted; supersedes ADR-YYY §z> |
```
Status values: Proposed · Accepted · Superseded by ADR-XXX · Open.

### HANDOFF skeleton — `docs/HANDOFF.md`
```markdown
# Handoff — state as of <date time>
## Working mode (mode A/B, standing permissions with date and owner's words, what to ask the owner)
## Git and CI specifics (allowed/denied commands, how to merge, how to wait for CI, known quirks)
## When to suggest a new session
## Bootstrap a fresh session (exact steps and commands, unreachable hosts, known test quirks)
## Repo / environments (URLs, what deploys where)
## Done (per session: tasks, PR numbers, deploy run IDs)
## Owner's open actions (exact URLs and what to look for)
## Parked ideas
## Next (task + spec path) · Latest TASK / ADR numbers
## Open items
```

---

## 13. Project-specific values (fill in once)

| Item | Value |
|---|---|
| Owner / language with owner | <name> / <language> |
| Working mode | A (supervised) / B (autonomous) — standing permissions: <…> |
| Repo | <org/repo>, default branch `dev` |
| Stack | <runtime, framework, DB/ORM, tests, infra> |
| Environments and URLs | dev: <url> · uat: <url> · prod: <url> |
| Test commands | lint: <cmd> · typecheck: <cmd> · unit: <cmd> · integration: <cmd> · e2e: <cmd> |
| CI duration / deploy duration | <~N min> / <~N min> |
| PR size guideline | ~800 changed lines |
| AI-use policy | trailer + `Prompt:` line: yes/no |

---

## 14. Session hygiene (cost and context)

- Long sessions get more expensive per step; a new session costs a one-time bootstrap.
- Suggest a new session (one line, at the end of a reply, never mid-task) when: a big task is finished and
  documented, the conversation was compacted, or ~4–5 PRs / ~3 hours of work were done.
- Before suggesting: no open PRs, everything merged and deployed, HANDOFF up to date.

---

## Golden rules (short version)

1. Plan before code.
2. Review the code, not the summary.
3. Proof by real output; `NOT RUN` when it didn't run.
4. Tests can fail — show it with a deliberate break.
5. Every deviation and every decision is written down (feedback, ADR).
6. Everything is documented, how it works — in the same PR.
7. Merge only on green; verify the deploy.
8. Secrets never in chat, repo, logs or agent context.
9. Ask the owner only for keys, accounts, servers, product decisions, prod and irreversible steps.
10. HANDOFF is always current — the next session starts from it.
