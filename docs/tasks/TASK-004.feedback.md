# TASK-004 feedback
Status: **DONE** (PR to dev).

## What I implemented
- Migrations `0004_platform_rules_presets` (tables + CHECKs) and `0005_seed_platform_data` (7 platforms, 27 presets, idempotent).
- Dependency-free rule engine in `src/lib/rules` (server + browser), DB repository, read-only `/admin/platform`.

## Research and conflicts (verified 2026-10-05)
Sources: socialync.io platform limits guide 2026; postnitro.ai LinkedIn specs; billo.app Meta safe zones (unified March 2026); ruche-pollen.com (Instagram hashtag limit, 11 June 2026); Google display ad specs.
Conflicts resolved with the stricter value (ADR-030): Instagram hashtags 30 vs 5 → **5**; Instagram carousel 20 vs 10 → **10**; TikTok caption 4,000 vs 2,200 → **2,200**; 9:16 bottom safe zone 20–35 % → **35 %**.
Low-confidence rows (verify before ads): TikTok and YouTube Shorts safe zones.

## Deviations
- Preset/rule editing in admin split out as TASK-004b (read-only view now).
- X weighted counting implemented in-house instead of adding `twitter-text` (ADR-030).

## Test results (real outputs, this session)
```
2026-10-05T19:24:31+02:00
$ pnpm lint
lint: 0 problems
$ pnpm typecheck
typecheck: ok
$ pnpm test
 Test Files  8 passed (8)
      Tests  70 passed (70)
$ pnpm test:int
 Test Files  5 passed (5)
      Tests  51 passed (51)
$ pnpm build
build warnings+errors: 0
$ pnpm test:e2e
  1 skipped
  21 passed (22.2s)
```

## Deliberate breaks
```
2026-10-05T19:23:00+02:00
## Break A: a channel layer can loosen the platform (max instead of min)
     × numeric limits take the minimum across layers; undefined layers are ignored 8ms
     × a looser layer never relaxes the platform 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 68 passed (70)
## Break B: X counts URLs by their real length
     × every URL weighs 23 regardless of length 6ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 69 passed (70)
## Break C: asset check ignores height
     × exact size passes; 1 px off fails 10ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 69 passed (70)
     × presets validate real asset facts; disabled and unknown presets cannot be used 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 50 passed (51)
## Break D: re-seeding overwrites super-admin edits
     × seed is idempotent and never overwrites values a super admin changed 46ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 50 passed (51)
## Restored
      Tests  70 passed (70)
      Tests  51 passed (51)
```

## Docs updated
technical/rules.md (new), technical/admin.md, technical/README.md, 03-DECISIONS.md (ADR-030), tasks/README.md, tasks/TASK-004-platform-rules.md, HANDOFF.md.
