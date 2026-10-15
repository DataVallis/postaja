import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { homography, validQuad, warpInto, wholePicture, type Quad } from "./screen";

const solid = (w: number, h: number, c: string) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer().then((b) => new Uint8Array(b));
const pixel = async (img: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o], data[o + 1], data[o + 2]];
};

describe("screen placement (owner, 2026-10-15)", () => {
  it("homography maps the corners onto the corners", () => {
    const from: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    const to: Quad = [{ x: 10, y: 20 }, { x: 90, y: 30 }, { x: 95, y: 220 }, { x: 5, y: 210 }];
    const h = homography(from, to);
    for (let i = 0; i < 4; i++) {
      const w = h[6] * from[i].x + h[7] * from[i].y + h[8];
      expect((h[0] * from[i].x + h[1] * from[i].y + h[2]) / w).toBeCloseTo(to[i].x, 6);
      expect((h[3] * from[i].x + h[4] * from[i].y + h[5]) / w).toBeCloseTo(to[i].y, 6);
    }
  });

  it("only convex, not tiny quads inside the picture count", () => {
    expect(validQuad([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 110 }, { x: 10, y: 110 }], 200, 200)).toBe(true);
    expect(validQuad([{ x: 10, y: 10 }, { x: 60, y: 110 }, { x: 60, y: 10 }, { x: 10, y: 110 }], 200, 200)).toBe(false); // crossed
    expect(validQuad([{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 10, y: 12 }], 200, 200)).toBe(false); // tiny
    expect(validQuad([{ x: 10, y: 10 }, { x: 600, y: 10 }, { x: 600, y: 110 }, { x: 10, y: 110 }], 200, 200)).toBe(false); // outside
  });

  it("the picture fills a tilted screen exactly; outside stays as it was", async () => {
    const base = await solid(400, 400, "#000000");
    const picture = await solid(90, 180, "#ff0000");
    const quad: Quad = [{ x: 120, y: 60 }, { x: 280, y: 80 }, { x: 270, y: 360 }, { x: 110, y: 340 }];
    const out = await warpInto(base, picture, quad, 0.05);
    const [r] = await pixel(out, 195, 210); // the middle of the screen
    expect(r).toBeGreaterThan(220);
    expect((await pixel(out, 30, 30))[0]).toBeLessThan(20); // outside
    expect((await pixel(out, 300, 200))[0]).toBeLessThan(20); // right of the screen
    expect((await pixel(out, 121, 62))[0]).toBeLessThan(120); // the rounded corner leaves the very corner
  });

  it("as the whole picture: close proportions fill it; a tall mockup is shown whole on its own edge colour", async () => {
    const close = await wholePicture(await solid(410, 300, "#0000ff"), 400, 300);
    expect(await sharp(close).metadata()).toMatchObject({ width: 400, height: 300 });
    expect((await pixel(close, 2, 2))[2]).toBeGreaterThan(220);
    // A phone mockup: mint background, a dark phone in the middle — taller than the slot.
    const mockup = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#66ddb0" } })
      .composite([{ input: Buffer.from(await solid(120, 400, "#111111")), left: 90, top: 100 }]).png().toBuffer();
    const out = await wholePicture(new Uint8Array(mockup), 600, 600);
    expect(await sharp(out).metadata()).toMatchObject({ width: 600, height: 600 });
    const [r, g] = await pixel(out, 20, 300); // beside the picture: its own mint, not white or black
    expect(g).toBeGreaterThan(180);
    expect(r).toBeLessThan(140);
    expect((await pixel(out, 300, 300))[1]).toBeLessThan(40); // the phone, not cut away
    expect((await pixel(out, 300, 120))[1]).toBeLessThan(40);
  });
});
