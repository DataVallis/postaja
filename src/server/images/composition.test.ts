// TASK-062 quality round: on aibuilders.si's cover (full-bleed picture) the drawn objects reached up under the subtitle.
// The image model is now told which part of a full-bleed picture stays free for the template's text.
import { describe, expect, it } from "vitest";
import { cardDesign } from "../../../tests/fixtures/design";
import { designSpecSchema, type Template } from "../design/spec";
import { compositionHint, illustrationPrompt } from "./service";

const spec = designSpecSchema.parse(cardDesign);
const text = (slot: "headline" | "body" | "footer" | "label", x: number, y: number, w: number, h: number) =>
  ({ type: "text" as const, slot, x, y, w, h, font: "heading" as const, weight: 700 as const, maxSize: 8, minSize: 3, color: "text", align: "left" as const, valign: "top" as const, lineHeight: 1.1, letterSpacing: 0, uppercase: false, padding: 0, radius: 0, opacity: 1 });
const full = (elements: Template["elements"]): Template => ({ ...spec.templates[0], background: { type: "illustration", color: "background", angle: 180 }, elements });

describe("composition hint for full-bleed pictures", () => {
  it("text at the top → the subject goes to the bottom; footers and labels do not count", () => {
    const t = full([text("label", 5, 3, 40, 3), text("headline", 5, 15, 80, 25), text("body", 5, 45, 60, 10), text("footer", 5, 92, 30, 4)]);
    expect(compositionHint(t)).toBe("Composition: the top 59% of the picture carries text later, so keep it plain, calm background with no objects; place the subject only in the bottom 41%.");
    expect(illustrationPrompt("A desk with a laptop", spec, t).split("\n")).toEqual([
      "A desk with a laptop", compositionHint(t), `Style: ${spec.illustrationStyle}`, "No text, no letters, no numbers, no logos, no watermarks.",
    ]);
  });

  it("text at the bottom, on the left, on the right; nothing when text is everywhere or the picture is not full-bleed", () => {
    expect(compositionHint(full([text("headline", 5, 60, 90, 30)]))).toContain("the bottom 44% of the picture carries text");
    expect(compositionHint(full([text("headline", 5, 10, 50, 80)]))).toContain("the left 59% of the picture carries text");
    expect(compositionHint(full([text("headline", 50, 10, 45, 80)]))).toContain("the right 54% of the picture carries text");
    expect(compositionHint(full([text("headline", 5, 5, 90, 90)]))).toBeNull();
    expect(compositionHint({ ...full([text("headline", 5, 5, 90, 20)]), background: { type: "color", color: "background", angle: 180 } })).toBeNull();
    expect(illustrationPrompt("A desk", spec)).not.toContain("Composition");
  });

  it("an illustration element with the headline over it gets the hint in % of its own box", () => {
    const pic = { type: "image" as const, source: "illustration" as const, x: 0, y: 20, w: 100, h: 70, fit: "cover" as const, radius: 0, opacity: 1 };
    const t: Template = { ...spec.templates[0], background: { type: "color", color: "background", angle: 180 }, elements: [pic, text("headline", 5, 30, 90, 20)] };
    expect(compositionHint(t)).toBe("Composition: the top 47% of the picture carries text later, so keep it plain, calm background with no objects; place the subject only in the bottom 53%.");
    expect(compositionHint({ ...t, elements: [pic, text("headline", 5, 2, 90, 15)] })).toBeNull(); // text above the picture
  });
});
