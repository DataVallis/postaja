// Long plan documents are read in parts (ADR-078): no post is cut in two, order and text are kept.
import { describe, expect, it } from "vitest";
import { DOC_MAX_CHARS } from "./ai";
import { splitDocument } from "./service";

describe("splitDocument", () => {
  it("a short plan is one part", () => {
    expect(splitDocument("# Plan\n\n## Day 1\n\nHello")).toEqual(["# Plan\n\n## Day 1\n\nHello"]);
  });

  it("parts break at headings, each heading stays with its post, and nothing is lost", () => {
    const posts = Array.from({ length: 30 }, (_, i) => `## Day ${i + 1}\n\n${"x".repeat(900)}\n\n#PetPrep`);
    const text = `# Plan\n\n${posts.join("\n\n")}`;
    const parts = splitDocument(text, 5000);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(5000);
      expect(p.startsWith("## Day") || p.startsWith("# Plan")).toBe(true);
      expect(p.trimEnd().endsWith("#PetPrep")).toBe(true);
    }
    const squash = (s: string) => s.replace(/\s+/g, "");
    expect(squash(parts.join("\n"))).toBe(squash(text));
  });

  it("without headings it breaks at blank lines; a giant paragraph is its own part; the cap still applies", () => {
    const parts = splitDocument(`${"a".repeat(3000)}\n\n${"b".repeat(3000)}\n\n${"c".repeat(9000)}`, 5000);
    expect(parts.map((p) => p[0])).toEqual(["a", "b", "c"]);
    expect(splitDocument("z".repeat(DOC_MAX_CHARS + 500), 1_000_000)[0]).toHaveLength(DOC_MAX_CHARS);
  });
});
