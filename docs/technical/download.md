# One-click download (TASK-016)

- **Post**: `/api/posts/[id]/download` (button "Prenesi ZIP" on the post) → `besedilo.txt` (the text exactly as posted,
  hashtags included; thread parts separated by `---`), `prvi-komentar.txt` (if the plan has one), images `1.png …` in
  order. File name `<brand>-<day>-<platform>-<time>-<topic>.zip`.
- **Day**: `/api/plan/download?date=YYYY-MM-DD[&brand=<id>]` (plan day view, dashboard "Danes") → one folder per post
  `<brand-slug>/<platform>-<HH-MM>-<topic>/` with the same files, plus `pregled.csv` (UTF-8 with BOM, `;`-separated
  for Slovenian Excel). Skipped posts and other orgs' posts are never included; at most 200 posts.
- The ZIP is streamed (`src/server/files/zip-writer.ts`): each image is read from S3 only when it is written; text is
  deflated, images stored. Members only (same access as the post).
- Tests: `zip-writer.test.ts` (round trip with our reader and the system `unzip`), `download.int.test.ts`, E2E in
  `images.spec.ts`.

## LinkedIn carousel as PDF (TASK-018)
LinkedIn posts carousels as a document. A LinkedIn post with two or more images gets `karusel.pdf` in its folder (post
and day ZIP), and the post page offers *Prenesi PDF karusel* (`/api/posts/[id]/pdf`, members of the org).
`src/server/files/pdf-writer.ts` writes the PDF in-house: one page per image at the image's size (1 px = 1 pt), the
image embedded as JPEG (DCTDecode; slides flattened on white, quality 90, 4:4:4), title in UTF-16 so č š ž survive.
Tests: `pdf-writer.test.ts` (read back with pdf.js: page count, sizes, title, refusals), `download.int.test.ts`
(ZIP content and order, PDF alone, other org 404, no PDF for Instagram or a single image).
