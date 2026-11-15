# Postaja — launch plan (simple product, production)

Date: 2026-11-15 · Owner: David Tacer · Decisions: ADR-094 · Tasks: TASK-059…062.

## Goal (owner, 2026-11-15)
Postaja is sold as a simple program for making posts for projects: plan, create, import, follow the CGP —
"like using Claude chat when it makes nice posts". Fewer features, each one finished. Posts and images must be good
enough that users are satisfied. Anything hidden is asked about first.

## Owner decisions (2026-11-15)
| Topic | Decision |
|---|---|
| Hide at launch | **Ads** (brand tab Oglasi, ad sets, creatives) and **competitor research** (brand tab Konkurenca) |
| Stay visible | Persona + persona video, reel from several shots, animation, Claude connection (MCP), client approval link |
| Creation flow | **Conversation next to the post**: one page, conversation on the left (request, then corrections for text or images), post preview on the right. Plan and calendar stay. |
| Launch | **Invite only first**: 3–5 invited users for a week, public signup closed on prod until quality is confirmed |
| Plans | **Only Solo is sold**; Studio, Agencija and the agency pilot are disabled while ads and research are hidden |
| Server | Production stays on the same server as dev (ADR-084) |
| Buyers | **Business users only** (confirmed at signup and purchase); no consumer withdrawal |
| Refunds | **None** — subscriptions, add-ons and credits are not refunded; the free 7-day trial is the test |
| Content after cancellation | Available for 30 days, then may be deleted |
| Contact | hello@postaja.eu · 60 days notice if the service is shut down |

## Findings (repo at 5617fbc, 2026-10-30)
1. Too much surface: the brand page had 9 tabs, the post page 4 video sections; the core path was built but buried.
2. Hiding is cheap: ads, animation, research and persona were already behind plan features.
3. Image quality is the main risk: eight image fixes between 2026-10-09 and 2026-10-25, all found on the owner's brands.
4. No chat-like creation yet: "Nova objava" is a form; corrections in words are a separate field under the images.
5. Production is configured, not launched: `peron.postaja.eu`, workflow "Deploy prod", backups and Stripe exist;
   `main` is far behind `dev`; prod secrets, terms/privacy pages, restore drill and error monitoring are missing.

## Phases
| # | Phase | Task | Status |
|---|---|---|---|
| 1 | Simplify: hide ads and research, only Solo | TASK-059 | Done |
| 1b | Terms of use in the app, business-buyer confirmation (30-day deletion stays manual, ADR-095) | TASK-060 | Done |
| 2 | One creation path: conversation next to the post | TASK-061 | Planned |
| 3 | Quality round: ~60 posts scored, defects fixed with regression tests, ≥ 90 % usable | TASK-062 | Planned |
| 4 | Production: secrets (owner), Stripe live prices (owner), `dev → main`, first deploy, restore drill, monitoring | TASK-035 (rest) | Planned |
| 5 | Soft launch by invitation, then public signup | — | Planned |

## Open
- Privacy policy (referenced by the terms of use) is not written.
- Lawyer review of the terms of use (business-only clause, no refunds) before public launch.
- Whether the three video sections on the post page fold into one closed "Video" section.
