// Safe zones (TASK-021b): with insets the background still fills the canvas, every element is laid out inside them.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardDesign } from "../../../tests/fixtures/design";
import { renderTemplate } from "./render";
import { designSpecSchema, templateSchema } from "./spec";

const spec = designSpecSchema.parse(cardDesign);
// A full-width bar across the top 10 % of the layout box, on the plain background colour.
const bar = templateSchema.parse({
  ...cardDesign.templates[0], id: "bar", background: { type: "color", color: "background" },
  elements: [{ type: "shape", x: 0, y: 0, w: 100, h: 10, color: "accent" }],
});
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
async function pixel(png: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 3);

describe("renderTemplate safe zone", () => {
  it("without insets the bar starts at the top edge", async () => {
    const png = await renderTemplate(spec, bar, { width: 1080, height: 1920 }, { slots: {} });
    expect(near(await pixel(png, 540, 50), hex(spec.palette.accent))).toBe(true);
  });

  it("with a Story's insets the bar moves below the top UI and keeps clear of the sides; the background still fills the canvas", async () => {
    const safe = { top: 270, right: 65, bottom: 672, left: 65 };
    const png = await renderTemplate(spec, bar, { width: 1080, height: 1920 }, { slots: {}, safe });
    expect(await sharp(png).metadata()).toMatchObject({ width: 1080, height: 1920 });
    expect(near(await pixel(png, 540, 50), hex(spec.palette.background))).toBe(true); // under the UI: background only
    expect(near(await pixel(png, 540, 300), hex(spec.palette.accent))).toBe(true); // inside the safe box: the bar
    expect(near(await pixel(png, 30, 300), hex(spec.palette.background))).toBe(true); // left inset stays clear
    expect(near(await pixel(png, 540, 1800), hex(spec.palette.background))).toBe(true);
  });
});
