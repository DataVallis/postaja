import { describe, expect, it } from "vitest";
import { backgroundState, elementState, motionSpecSchema, specIssues } from "./motion";

const spec = motionSpecSchema.parse({
  durationS: 6,
  background: { motion: "zoom_in", amount: 0.1 },
  elements: [
    { index: 0, enter: { effect: "rise", at: 1, duration: 1, ease: "linear" } },
    { index: 1, enter: { effect: "words", at: 2, duration: 2 } },
    { index: 2, enter: { effect: "grow_x", at: 0, duration: 1 }, loop: "pulse" },
  ],
});

describe("motion", () => {
  it("an entrance runs from hidden to its final place, then stays still", () => {
    expect(elementState(spec, 0, 0.5, 1080)).toMatchObject({ opacity: 0, dy: expect.any(Number) });
    expect(elementState(spec, 0, 0.5, 1080).dy).toBeCloseTo(1080 * 0.06);
    expect(elementState(spec, 0, 1.5, 1080)).toMatchObject({ opacity: 0.5 });
    expect(elementState(spec, 0, 5, 1080)).toEqual({ opacity: 1, dx: 0, dy: 0, sx: 1, sy: 1, words: 1, origin: "center" });
  });
  it("words appear in order; unlisted elements are visible from the start; rules grow from the left and stay hidden before", () => {
    expect(elementState(spec, 1, 1.9, 1080).words).toBe(0);
    expect(elementState(spec, 1, 3, 1080).words).toBeCloseTo(0.5);
    expect(elementState(spec, 9, 0, 1080)).toMatchObject({ opacity: 1, words: 1 });
    expect(elementState(spec, 2, 0, 1080)).toMatchObject({ opacity: 0, origin: "left" });
    expect(elementState(spec, 2, 0.5, 1080).sx).toBeGreaterThan(0.5);
  });
  it("loops start only after the entrance", () => {
    expect(elementState(spec, 2, 1, 1080).sx).toBe(1);
    const later = [1.3, 1.6, 1.9].map((t) => elementState(spec, 2, t, 1080).sx);
    expect(later.some((v) => v !== 1)).toBe(true);
    expect(Math.max(...later)).toBeLessThanOrEqual(1.031);
  });
  it("the illustration drifts linearly over the clip", () => {
    expect(backgroundState(spec, 0, { width: 1080, height: 1350 }).scale).toBe(1);
    expect(backgroundState(spec, 6, { width: 1080, height: 1350 }).scale).toBeCloseTo(1.1);
    expect(backgroundState(null, 3, { width: 1080, height: 1350 })).toEqual({ scale: 1, dx: 0, dy: 0 });
  });
  it("specIssues: missing elements, late entrances, duplicates", () => {
    expect(specIssues(spec, 3)).toEqual([]);
    const bad = motionSpecSchema.parse({ ...spec, elements: [...spec.elements, { index: 5, enter: { effect: "fade", at: 5.8, duration: 0.5 } }, { index: 0, enter: { effect: "fade", at: 0, duration: 1 } }] });
    expect(specIssues(bad, 3)).toEqual([
      "elements: index 5 does not exist (the template has 3 elements)",
      "elements[5]: enters until 6.3 s; it must be in place 0.5 s before the end (6 s)",
      "elements: an index is listed twice",
    ]);
  });
});
