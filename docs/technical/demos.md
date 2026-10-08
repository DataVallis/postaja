# Demo from a website

Status: **Built** (TASK-040). Decision: ADR-070.

## What
Admin → **Demo iz spletne strani** (`/admin/demos`, super admins only): website, optional brand name, optionally the
site's text pasted by hand (for sites that only render in a browser) → *Ustvari demo* → the view link `/d/<token>` is
shown once with *Kopiraj*. The list refreshes itself while a demo is built and shows the step, the result
(*Pripravljen* / *Ni uspelo* with the reason), what could not be made (*Ni uspelo: DESIGN:PROVIDER, …*), link validity,
last viewed. Per demo: *Odpri brand* (switches to the sales organization and opens the brand to refine it),
*Nova povezava* (new link for 14 more days, the old one stops), *Prekliči povezavo*.

The prospect opens the link without an account: brand name and logo, 3 posts for the next weekdays with images and
text, the Meta ad (creatives + 3 copy variants), a note that texts and images are AI-made, the link's expiry.

## How
- Table (migration 0042): `demos` (sales org, brand, url, name hint, pasted text, status queued/running/ready/failed,
  step, error, warnings[], post_ids[], ad_set_id, token sha256, expires_at, revoked_at, last_viewed_at).
- `src/server/demos/site.ts` `readSite`: text (`htmlToText`), logo (an `<img>` named logo, else the touch icon), up to
  4 pictures (og:image + large content images), colours (theme-color + most used non-grey CSS hex). Only http(s).
- `src/server/demos/ai.ts`: `submit_demo_brand` tool; the page sits in `<website>`, instructions in it are ignored.
- No people in demo pictures (ADR-072): the site's photos are not stored (they would be style references and get copied);
  the profile's image style forbids people and `NO_PEOPLE` is its negative prompt, which `generateIllustration` sends to
  the image model and appends as "Avoid: …".
- `src/server/demos/service.ts`: `ensureSalesOrg` ("Data Vallis – prodaja", comped, cap 30 USD), `startDemo`
  (≤ 20/day, audited), `listDemos`, `demoBrandFor`, `newDemoLink`, `revokeDemoLink`, `runDemoJob` (one job drives
  `requestDesign`/`runDesignJob`, `generateForPost`, `requestImages`/`runImageJob`, `createAdSet`,
  `requestAdImages`/`runAdImageJob` in order), `demoByToken`, `demoView`, `demoMediaUrl` (only this demo's current
  slides, creatives and logo).
- Queue `demo-build` (no retry, 1 h) in `jobs/boss.ts` and `jobs/worker.ts`.
- Pages: `src/app/admin/demos/*`, public `src/app/d/[token]/page.tsx` (`noindex`, no Referer) and
  `src/app/d/[token]/m/[id]/route.ts` (302).

## Tests
`site.test.ts` (logo, pictures, colours, unsafe links), `demos.int.test.ts` (super admin only, sales org once with its
cap, hash only, full build with logo SVG rasterised without fetching its links, posts + images + ad creatives, pasted
text when the site fails, warnings kept, retry on invalid answer, spend cap, link rotate / revoke / expiry, media scope,
daily limit), E2E `demo.spec.ts` (create → built → prospect view without login, axe → open brand → revoke).
