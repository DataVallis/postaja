// The user guide (TASK-026, ADR-056): Markdown chapters in docs/guides/user/<locale>/NN-slug.md, shown in the app under
// /app/help. The files are read at request time (traced into the standalone build via next.config); a chapter is found
// by its slug only from the directory listing, so a URL can never name a file.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseMarkdown, plain, type Block } from "./markdown";

export type Chapter = { slug: string; title: string; blocks: Block[] };

// Not traced by the bundler (it would pull in the whole project); next.config ships docs/guides/user with the help pages.
const dirFor = (locale: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), "docs", "guides", "user", locale === "en" ? "en" : "sl");

async function files(locale: string): Promise<{ slug: string; file: string }[]> {
  for (const loc of [locale, "sl"]) {
    try {
      const names = (await readdir(/*turbopackIgnore: true*/ dirFor(loc))).filter((n) => /^\d{2}-[a-z0-9-]+\.md$/.test(n)).sort();
      if (names.length) return names.map((n) => ({ slug: n.slice(3, -3), file: path.join(/*turbopackIgnore: true*/ dirFor(loc), n) }));
    } catch { /* no guide in this language: fall back to Slovenian */ }
  }
  return [];
}

async function load(file: string, slug: string): Promise<Chapter> {
  const blocks = parseMarkdown(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
  const h1 = blocks.find((b) => b.t === "h" && b.level === 1);
  return { slug, title: h1 && h1.t === "h" ? plain(h1.v) : slug, blocks: blocks.filter((b) => b !== h1) };
}

/** All chapters in order (titles and contents). */
export async function guideChapters(locale: string): Promise<Chapter[]> {
  return Promise.all((await files(locale)).map((f) => load(f.file, f.slug)));
}

/** One chapter by slug, or null. */
export async function guideChapter(locale: string, slug: string): Promise<Chapter | null> {
  const f = (await files(locale)).find((x) => x.slug === slug);
  return f ? load(f.file, f.slug) : null;
}
