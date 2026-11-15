// TASK-062 quality round: aibuilders.si has seven logos; the first upload is navy and its slides are navy, so the logo
// showed as a single orange dot. Each template now draws the logo that reads best on the colour under its logo box.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardDesign } from "../../../tests/fixtures/design";
import { colourUnder, pickLogo, renderTemplate } from "./render";
import { designSpecSchema, type Template } from "./spec";

/** A logo: a coloured wordmark-like bar on transparency, `w`×`h` visible inside `pad` px of empty border. */
async function logo(hex: string, w: number, h: number, pad = 0): Promise<Uint8Array> {
  const bar = await sharp({ create: { width: w, height: h, channels: 4, background: hex } }).png().toBuffer();
  return new Uint8Array(await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: bar, left: pad, top: pad }]).png().toBuffer());
}

describe("logo choice", () => {
  it("picks the logo with the best contrast to the background; then the one that fills the box; else the first", async () => {
    const navy = await logo("#141a3a", 600, 100);
    const white = await logo("#ffffff", 600, 100);
    const whiteStacked = await logo("#ffffff", 300, 300);
    expect(await pickLogo([navy, white], "#10163a", 6)).toBe(white); // navy slide → the white logo
    expect(await pickLogo([navy, white], "#ffffff", 6)).toBe(navy); // white slide → the navy logo
    expect(await pickLogo([whiteStacked, white], "#10163a", 6)).toBe(white); // a wide box → the horizontal one
    expect(await pickLogo([white, whiteStacked], "#10163a", 1)).toBe(whiteStacked); // a square box → the stacked one
    const sameA = await logo("#ffffff", 600, 100), sameB = await logo("#ffffff", 600, 100);
    expect(await pickLogo([sameA, sameB], "#000000", 6)).toBe(sameA); // tie → the first upload
    expect(await pickLogo([new Uint8Array([1, 2, 3]), white], "#000000", 6)).toBe(white); // unreadable → skipped
    expect(await pickLogo([], "#000000", 6)).toBeNull();
  });

  it("transparent padding does not count as the logo's shape", async () => {
    const paddedWide = await logo("#ffffff", 600, 100, 250); // file 1100×600, visible part 6:1
    const square = await logo("#ffffff", 300, 300);
    expect(await pickLogo([square, paddedWide], "#000000", 6)).toBe(paddedWide);
  });

  it("the colour under the logo box: a filled shape below it, the overlay of a full-bleed picture, or the background", () => {
    const spec = designSpecSchema.parse(cardDesign);
    const box = { x: 5, y: 5, w: 20, h: 6 };
    const base: Template = { ...spec.templates[0], background: { type: "color", color: "#112233", angle: 180 }, elements: [{ type: "image", source: "logo", ...box, fit: "contain", radius: 0, opacity: 1 }] };
    expect(colourUnder(spec, base, box, 0)).toBe("#112233");
    const onShape: Template = { ...base, elements: [{ type: "shape", x: 0, y: 0, w: 50, h: 20, color: "#fafafa", opacity: 1, radius: 0, borderWidth: 0 }, ...base.elements] };
    expect(colourUnder(spec, onShape, box, 1)).toBe("#fafafa");
    const picture: Template = { ...base, background: { type: "illustration", color: "background", angle: 180, overlay: { color: "#000000", opacity: 0.6, fade: "none" } } };
    expect(colourUnder(spec, picture, box, 0)).toBe("#000000");
  });

  it("renders the readable logo: on a dark slide the logo box holds light pixels", async () => {
    const spec = designSpecSchema.parse(cardDesign);
    const t: Template = {
      ...spec.templates[0], background: { type: "color", color: "#10163a", angle: 180 },
      elements: [{ type: "image", source: "logo", x: 10, y: 10, w: 60, h: 10, fit: "contain", radius: 0, opacity: 1 }],
    };
    const navy = await logo("#141a3a", 600, 100), white = await logo("#ffffff", 600, 100);
    const png = await renderTemplate(spec, t, { width: 1000, height: 1000 }, { slots: {}, logo: navy, logos: [navy, white] });
    const [r, g, b] = (await sharp(png).extract({ left: 400, top: 150, width: 1, height: 1 }).raw().toBuffer());
    expect(r + g + b).toBeGreaterThan(600); // white logo pixels
    const old = await renderTemplate(spec, t, { width: 1000, height: 1000 }, { slots: {}, logo: navy });
    const [r2, g2, b2] = (await sharp(old).extract({ left: 400, top: 150, width: 1, height: 1 }).raw().toBuffer());
    expect(r2 + g2 + b2).toBeLessThan(200); // only `logo`: the first upload, as before
  });
});
