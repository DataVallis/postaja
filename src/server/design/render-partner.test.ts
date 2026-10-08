// Partner logos (TASK-035): drawn next to the brand logo in the template's logo box (side by side when wide, stacked
// when tall), alone when the brand has no logo, and in the bottom-right corner when the template has no logo box.
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { cardDesign } from "../../../tests/fixtures/design";
import { renderTemplate } from "./render";
import { designSpecSchema, templateSchema } from "./spec";

const spec = designSpecSchema.parse(cardDesign);
const withBox = (w: number, h: number) => templateSchema.parse({
  ...cardDesign.templates[0], id: "logo", background: { type: "color", color: "background" },
  elements: [{ type: "image", source: "logo", x: 10, y: 10, w, h }],
});
const noBox = templateSchema.parse({ ...cardDesign.templates[0], id: "plain", background: { type: "color", color: "background" }, elements: [{ type: "shape", x: 0, y: 0, w: 5, h: 5, color: "accent" }] });
const RED = [220, 20, 20], BLUE = [20, 40, 220];
let red: Uint8Array, blue: Uint8Array;
const square = async (c: number[]) => new Uint8Array(await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: c[0], g: c[1], b: c[2], alpha: 1 } } }).png().toBuffer());
async function pixel(png: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 6);
const size = { width: 1000, height: 1000 };

beforeAll(async () => { red = await square(RED); blue = await square(BLUE); });

describe("partner logo", () => {
  it("a wide logo box: brand logo left, partner right, a gap between", async () => {
    // Box 100..500 × 100..200: halves of (400 - gap) wide, each logo a 100×100 square centred in its half.
    const png = await renderTemplate(spec, withBox(40, 10), size, { slots: {}, logo: red, partnerLogo: blue });
    expect(near(await pixel(png, 200, 150), RED)).toBe(true);
    expect(near(await pixel(png, 400, 150), BLUE)).toBe(true);
    expect(near(await pixel(png, 300, 150), RED) || near(await pixel(png, 300, 150), BLUE)).toBe(false);
  });

  it("a tall logo box stacks them; without a brand logo the partner fills the box", async () => {
    const tall = await renderTemplate(spec, withBox(10, 40), size, { slots: {}, logo: red, partnerLogo: blue });
    expect(near(await pixel(tall, 150, 200), RED)).toBe(true);
    expect(near(await pixel(tall, 150, 400), BLUE)).toBe(true);
    const alone = await renderTemplate(spec, withBox(40, 10), size, { slots: {}, logo: null, partnerLogo: blue });
    expect(near(await pixel(alone, 300, 150), BLUE)).toBe(true);
  });

  it("without a partner nothing changes; a template without a logo box gets the partner in the bottom-right corner", async () => {
    const plain = await renderTemplate(spec, withBox(40, 10), size, { slots: {}, logo: red });
    expect(near(await pixel(plain, 300, 150), RED)).toBe(true); // the brand logo alone, centred in the box
    const corner = await renderTemplate(spec, noBox, size, { slots: {}, logo: red, partnerLogo: blue });
    expect(near(await pixel(corner, 840, 920), BLUE)).toBe(true);
    expect(near(await pixel(corner, 100, 100), RED)).toBe(false);
  });
});
