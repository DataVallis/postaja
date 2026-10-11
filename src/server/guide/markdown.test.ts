// The user guide's Markdown subset (TASK-026): structure, inline marks, anchors, and links only to safe places.
import { describe, expect, it } from "vitest";
import { inline, parseMarkdown, plain, slugify } from "./markdown";

describe("guide markdown", () => {
  it("headings with unique anchors, paragraphs joined, lists, quotes", () => {
    const b = parseMarkdown("# Naslov\n\n## Potne slike\nprva vrstica\ndruga vrstica\n\n- ena\n- dve\n  nadaljevanje\n1. prvi\n2. drugi\n\n> nasvet\n\n## Potne slike");
    expect(b.map((x) => x.t)).toEqual(["h", "h", "p", "ul", "ol", "quote", "h"]);
    expect(b[1]).toMatchObject({ level: 2, id: "potne-slike" });
    expect(b[6]).toMatchObject({ id: "potne-slike-2" });
    expect(b[2].t === "p" && plain(b[2].v)).toBe("prva vrstica druga vrstica");
    expect(b[3].t === "ul" && b[3].items.map(plain)).toEqual(["ena", "dve nadaljevanje"]);
    expect(slugify("Video s persono – Čšž!")).toBe("video-s-persono-csz");
  });

  it("bold, code, escapes and links; unsafe links become plain text", () => {
    expect(inline("**Ustvari** `besedilo.txt` \\*zvezdice\\*")).toEqual([
      { t: "strong", v: [{ t: "text", v: "Ustvari" }] }, { t: "text", v: " " }, { t: "code", v: "besedilo.txt" }, { t: "text", v: " *zvezdice*" },
    ]);
    expect(inline("[Brand](/app/help/brand)")).toEqual([{ t: "link", href: "/app/help/brand", v: [{ t: "text", v: "Brand" }] }]);
    expect(inline("[x](https://fal.ai)")[0]).toMatchObject({ t: "link", href: "https://fal.ai" });
    expect(inline("[klik](javascript:alert(1))")).toEqual([{ t: "text", v: "klik" }, { t: "text", v: ")" }]);
    expect(inline("[klik](http://evil.example)")).toEqual([{ t: "text", v: "klik" }]);
    expect(inline("<script>alert(1)</script>")).toEqual([{ t: "text", v: "<script>alert(1)</script>" }]);
  });
});
