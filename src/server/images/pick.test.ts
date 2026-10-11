// TASK-054: which images a correction may change, and that the others stay exactly as they were.
import { describe, expect, it } from "vitest";
import { postVisualRequest, reviseDesignRequest } from "../design/ai";
import { mergePickedTemplates } from "../design/service";
import { designSpecSchema } from "../design/spec";
import { cardDesign } from "../../../tests/fixtures/design";
import { mergePicked, pickedSlides } from "./service";

const s = (h: string, illustration: string | null = null) => ({ templateId: "cover", slots: { headline: h }, illustration });

describe("pickedSlides", () => {
  it("accepts 0 … count-1, sorted and unique", () => {
    expect(pickedSlides([2, 0, 2], 3)).toEqual([0, 2]);
    expect(pickedSlides([0], 1)).toEqual([0]);
  });
  it.each([[[3]], [[-1]], [[1.5]], [[Number.NaN]]])("refuses %j for 3 images", (only) => {
    expect(() => pickedSlides(only, 3)).toThrow("BAD_PICK");
  });
});

describe("mergePicked", () => {
  const before = [s("a", "A"), s("b"), s("c", "C")];
  it("keeps every image that was not picked and the number of images", () => {
    const answer = [s("x", "X"), s("y"), s("z", "Z"), s("extra")];
    expect(mergePicked(before, answer, [2], false)).toEqual([before[0], before[1], answer[2]]);
  });
  it("a picked image Claude left out stays as it was", () => {
    expect(mergePicked(before, [s("x")], [2], false)).toEqual(before);
  });
  it("redraw marks only picked images that have an illustration; Claude's redraw on others is dropped", () => {
    const answer = before.map((b) => ({ ...b, redraw: true }));
    const out = mergePicked(before, answer, [0, 1], true);
    expect(out.map((x) => !!x.redraw)).toEqual([true, false, false]);
  });
  it("without picks Claude's answer stands (it may add or remove images when asked); redraw covers all", () => {
    const answer = [s("x", "X"), s("y")];
    expect(mergePicked(before, answer, undefined, true)).toEqual([{ ...answer[0], redraw: true }, answer[1]]);
  });
});

describe("prompts", () => {
  const spec = designSpecSchema.parse(cardDesign);
  it("Claude is told which images were picked, counting from 1", () => {
    const req = postVisualRequest(spec, { brandName: "B", language: "sl", platform: "instagram", format: "carousel", brief: "b", plan: {}, caption: null },
      undefined, { current: [], instruction: "krajše", previews: [], only: [0, 2] });
    expect(req.user).toContain("The owner picked images 1, 3 (counting from 1)");
    const all = postVisualRequest(spec, { brandName: "B", language: "sl", platform: "instagram", format: "carousel", brief: "b", plan: {}, caption: null },
      undefined, { current: [], instruction: "krajše", previews: [] });
    expect(all.user).not.toContain("The owner picked");
  });
  it("a design revision names the picked templates", () => {
    const i = { brand: { name: "B", website: null, languages: ["sl"] }, cgp: "", colors: {}, imageStyle: "", negativePrompt: "", brief: "", hasLogo: false, brandFont: null, examples: [], logo: null };
    expect(reviseDesignRequest(i, spec, "večje", [], undefined, ["points"]).user).toContain('The owner picked only this template: "points"');
    expect(reviseDesignRequest(i, spec, "večje", [], undefined, null).user).toContain("Apply the owner's request to the design.");
  });
});

describe("mergePickedTemplates", () => {
  it("only the picked templates come from the answer; shared parts stay", () => {
    const base = designSpecSchema.parse(cardDesign);
    const answer = structuredClone(base);
    answer.summary = "other";
    answer.palette.accent = "#00ff00";
    answer.templates[0].name = "X";
    answer.templates[1].name = "Y";
    const out = mergePickedTemplates(base, answer, ["points"]);
    expect(out.summary).toBe(base.summary);
    expect(out.palette).toEqual(base.palette);
    expect(out.templates.map((t) => t.name)).toEqual([base.templates[0].name, "Y"]);
    expect(mergePickedTemplates(base, { ...answer, templates: [answer.templates[0]] }, ["points"]).templates[1]).toEqual(base.templates[1]);
  });
});
