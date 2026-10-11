# In-app user guide (TASK-026, ADR-056)

**Status:** Built.

- Content: `docs/guides/user/<locale>/NN-slug.md`, Slovenian (`sl`) for now; English falls back to Slovenian. The number
  orders the chapters, the slug is the URL (`/app/help/<slug>`). The first `#` heading is the chapter title; `##`
  headings are its sections (anchors made from the text, shown as "Na tej strani").
- Rendering: `src/server/guide/markdown.ts` parses a small Markdown subset (headings, paragraphs, `-`/`1.` lists, `>`,
  `**bold**`, `` `code` ``, `\*` escapes, links) into data; `src/components/guide/guide-blocks.tsx` renders it with
  React — never raw HTML. Links are kept only for `/app…`, `/login`, `#anchor` and `https://`.
- Loading: `src/server/guide/guide.ts` lists the directory and matches the slug against the listing, so a URL cannot
  name a file. The files reach the standalone build through `outputFileTracingIncludes` in `next.config.ts`.
- Pages: `src/app/app/help/page.tsx` (chapters with their sections), `src/app/app/help/[slug]/page.tsx` (chapter, "Na
  tej strani", previous/next). Menu: "Pomoč → Navodila za uporabo" in `src/components/shell/app-shell.tsx`.
- Tests: `src/server/guide/*.test.ts` (parser, every in-guide link resolves), `tests/e2e/help.spec.ts`.

## English and PDF (TASK-044)
English chapters live in `docs/guides/user/en/` with the **same file names** as the Slovenian ones, so chapter URLs and
links between chapters are the same in both languages (anchors follow each language's headings). Bold UI labels use the
exact strings of `messages/en.json`. `GET /api/help/pdf` (members) renders the guide in the member's language with
`src/server/guide/pdf.ts` (pdf-lib + fontkit): cover, contents with page numbers, each chapter from a new page, page
numbers; real text in Inter / JetBrains Mono subsets, symbols (→ …) from Noto Sans Symbols. The route is in
`outputFileTracingIncludes` so the Markdown ships with it. Tests: `guide/pdf.test.ts` (text read back with unpdf),
E2E `help.spec.ts` (PDF in both languages, English chapters).

## Keeping it current
Every PR that changes what a customer sees updates the matching chapter (DEVELOPMENT-RULES §7). Use the exact labels of
the UI (from `messages/sl.json`) in **bold**.
