# Client approval links

Status: **Built** (TASK-041). Decision: ADR-069.

## What
Brand → **Objave** → *Povezava za stranko*: who, from, to (≤ 31 days) → *Ustvari povezavo* → the URL `/r/<token>` is
shown once with *Kopiraj*. The list shows each link's range, last opened, valid until / expired / revoked, *Prekliči*.
The client opens the link without an account: the brand's posts of those days (not skipped or failed) in time order
with text, current images, videos and the latest review; *Odobri* or *Potrebni popravki* (comment required), optional
name. The agency sees *Odziv stranke* on the post page and "stranka: odobreno / popravki" in the brand's table.

## How
- Tables (migration 0041): `approval_links` (token sha256, label, from/to, expires_at = to + 14 days 23:59:59 UTC,
  revoked_at, last_viewed_at), `post_reviews` (decision approved/changes, comment, reviewer, link).
- `src/server/reviews/service.ts`: `createApprovalLink` (256-bit base64url token, audited), `listApprovalLinks`,
  `revokeApprovalLink` (audited), `linkByToken` (unknown / revoked / expired all → GONE), `clientView`, `submitReview`
  (ready → approved; approved → ready on changes; 300 reviews per link per hour), `clientMediaUrl` (only current slides
  and videos of in-scope posts), `postReviewsFor`, `latestReviews`.
- Public pages: `src/app/r/[token]/page.tsx` (no shell, `noindex`, `referrer: no-referrer`), action `src/app/r/actions.ts`,
  media `src/app/r/[token]/m/[id]/route.ts` (302). Agency UI: `approval-section.tsx`, `approval-form.tsx`
  (`useActionState`, the URL is returned once), `approval-actions.ts`.

## Tests
`reviews.int.test.ts` (hash only, scope by brand + range + status, approve / changes + status moves, reviews kept, other
org, expired / revoked / bad tokens, media scope), E2E `client-review.spec.ts` (agency creates → client without login
asks for changes, approves → agency sees status, feedback and badge → revoke → client sees "no longer works"; axe).
