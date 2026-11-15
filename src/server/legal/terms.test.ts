// The terms of use text (TASK-060): both languages exist, carry the current version and the same clauses, and state
// what the owner decided (business users only, no refunds, 30 days after the subscription ends, 60 days notice).
import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/lib/legal/terms";
import { plain, type Block } from "../guide/markdown";
import { termsText } from "./terms";

const text = (blocks: Block[]) => blocks.map((b) => (b.t === "p" || b.t === "h" || b.t === "quote" ? plain(b.v) : b.t === "ul" || b.t === "ol" ? b.items.map(plain).join(" ") : "")).join("\n");
const clauses = (s: string) => [...s.matchAll(/^(\d+\.\d+) /gm)].map((m) => m[1]);

describe("terms of use", () => {
  it("Slovenian and English: a title, the current version, the same 13 sections and the same numbered clauses", async () => {
    const sl = await termsText("sl");
    const en = await termsText("en");
    expect(sl.title).toBe("Pogoji uporabe");
    expect(en.title).toBe("Terms of use");
    for (const t of [sl, en]) {
      expect(text(t.blocks)).toContain(TERMS_VERSION);
      expect(t.blocks.filter((b) => b.t === "h" && b.level === 2)).toHaveLength(13);
    }
    expect(clauses(text(sl.blocks)).length).toBeGreaterThan(50);
    expect(clauses(text(en.blocks))).toEqual(clauses(text(sl.blocks)));
    expect((await termsText("de")).title).toBe("Pogoji uporabe"); // other languages read the binding Slovenian text
  });

  it("states the owner's decisions: business users only, no refunds, 30 days of content, 60 days notice, contact", async () => {
    const sl = text((await termsText("sl")).blocks);
    expect(sl).toContain("izključno poslovnim uporabnikom");
    expect(sl).toContain("Plačila se ne vračajo.");
    expect(sl).toContain("še 30 dni");
    expect(sl).toContain("vsaj 60 dni vnaprej");
    expect(sl).toContain("hello@postaja.eu");
    expect(sl).not.toMatch(/potrošnik ima pravico/i);
  });
});
