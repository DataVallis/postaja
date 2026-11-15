// The user guide's chapters (TASK-026): every chapter has a title, and every in-guide link points to a chapter (and
// section) that exists, so the guide never sends a customer to a dead page.
import { describe, expect, it } from "vitest";
import { planFeatures } from "../billing/catalog";
import { guideChapter, guideChapters, visibleChapters } from "./guide";
import type { Block, Inline } from "./markdown";

const links = (blocks: Block[]): string[] => {
  const out: string[] = [];
  const walk = (v: Inline[]) => v.forEach((n) => { if (n.t === "link") out.push(n.href); if (n.t === "strong" || n.t === "link") walk(n.v); });
  for (const b of blocks) {
    if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
    else if (b.t === "p" || b.t === "quote" || b.t === "h") walk(b.v);
  }
  return out;
};

describe("user guide", () => {
  it("has chapters in order, each with a title and sections", async () => {
    const chapters = await guideChapters("sl");
    expect(chapters.map((c) => c.slug)).toEqual(["zacetek", "brand", "vizualna-podoba", "objave", "plan", "oglasi", "persona", "claude", "stroski", "konkurenca"]);
    for (const c of chapters) {
      expect(c.title).not.toBe(c.slug);
      expect(c.blocks.some((b) => b.t === "h" && b.level === 2)).toBe(true);
    }
  });

  it("links only to chapters and sections that exist", async () => {
    const chapters = await guideChapters("sl");
    for (const c of chapters) {
      for (const href of links(c.blocks)) {
        const m = href.match(/^\/app\/help\/([a-z0-9-]+)(?:#([\w-]+))?$/);
        if (!m) continue;
        const target = chapters.find((x) => x.slug === m[1]);
        expect(target, `${c.slug} → ${href}`).toBeDefined();
        if (m[2]) expect(target!.blocks.some((b) => b.t === "h" && b.id === m[2]), `${c.slug} → ${href}`).toBe(true);
      }
    }
  });

  it("falls back to Slovenian and never resolves a path from the URL", async () => {
    expect((await guideChapters("en")).length).toBeGreaterThan(0);
    expect(await guideChapter("sl", "../../package")).toBeNull();
    expect(await guideChapter("sl", "01-zacetek")).toBeNull();
  });

  it("launch scope (ADR-094): Solo sees no chapter about hidden tools and no link into one; hand-managed organizations see all", async () => {
    for (const locale of ["sl", "en"]) {
      const all = await guideChapters(locale);
      const solo = visibleChapters(all, planFeatures("solo"));
      expect(solo.map((c) => c.slug)).toEqual(["zacetek", "brand", "vizualna-podoba", "objave", "plan", "persona", "claude", "stroski"]);
      const slugs = new Set(solo.map((c) => c.slug));
      for (const c of solo) for (const href of links(c.blocks)) {
        const m = /^\/app\/help\/([a-z0-9-]+)/.exec(href);
        if (m) expect(slugs.has(m[1]), `${locale}/${c.slug} links to ${href}`).toBe(true);
      }
      expect(visibleChapters(all, planFeatures("comped"))).toHaveLength(all.length);
      expect(visibleChapters(all, planFeatures("solo", {}, ["ads"])).map((c) => c.slug)).toContain("oglasi");
    }
  });
});
