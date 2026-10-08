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

## Keeping it current
Every PR that changes what a customer sees updates the matching chapter (DEVELOPMENT-RULES §7). Use the exact labels of
the UI (from `messages/sl.json`) in **bold**.
