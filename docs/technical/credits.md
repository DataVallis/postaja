# Credits

Status: **Built** (TASK-038). Decision: ADR-071.

## What
- `/admin/credits` (super admins): price per action, open purchase requests (*Plačano – dodeli* / *Zavrni*), granting
  a pack to any organization (credits, months valid, note). `/admin` shows a notice while requests are open; the
  organization page shows this month's use and its packs.
- Admin → organization → **Krediti na mesec** (plan limit; empty = not limited).
- **Ekipa in paket** → **Krediti**: monthly credits used / allowance, credits in packs, available, 80 % / used-up notice,
  owner's *Kupi kredite* (500 for 25 €, 2,000 for 80 €) and the requests' status. Every app page shows a notice at
  80 % and when credits are used up, linking there.

## How
- Migration 0043: `credit_prices` (seeded), `credit_packs` (credits, remaining, expires_at, source grant/purchase),
  `credit_requests` (pack small/large, pending/granted/declined), `usage_ledger.action/credits/pack_draws`.
- `src/server/llm/spend.ts` `reserve(..., action)`: under the org-settings lock, after the € cap check: price → month
  allowance (`monthlyCreditsUsed` = credits − pack draws this month) → packs soonest-expiring first (`for update`) →
  `CreditLimitError` when short. `release` gives pack draws back. `cappedCall` passes `who.action`.
- Actions at the call sites: post text (first try `text`, fix `assist`), ad copy (same), illustrations
  (`images/service.ts` `illustration`), persona pictures (`persona_image`), animation (first try `animation`), persona
  video (`persona_video_5s` ≤ 5 s else `_10s`), competitor find/analyse (`research`); everything else `assist`.
- `src/server/credits/service.ts`: `listCreditPrices`, `setCreditPrices`, `creditStatus`, `grantCredits`, `listPacks`,
  `requestCredits`, `orgCreditRequests`, `pendingCreditRequests`, `resolveCreditRequest` (claimed first, so once).
- UI: `src/app/admin/credits/*`, `src/app/admin/orgs/[id]/page.tsx`, `src/app/app/team/*`, `src/app/app/credit-banner.tsx`.

## Tests
`credits.int.test.ts` (prices per action, allowance then packs by expiry, refunds on release, expired packs, new
month, 80 % and used up, unlimited orgs, fix rounds as assist, € cap still first, price edits audited, requests:
owners only, ≤ 3 open, grant once / decline), E2E `credits.spec.ts` (allowance 0 → banner → request → grant → 500
available; price edit; axe).
