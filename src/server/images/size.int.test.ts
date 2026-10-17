import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetAndMigrate } from "../../../tests/db";
import { createDb } from "../db/client";
import { assertSize, ImageJobError, PLATFORM_DEFAULT, slideSize } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = createDb(url, { max: 2 });

beforeAll(async () => { await resetAndMigrate(url); });
afterAll(async () => { await sql.end({ timeout: 5 }); });

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#12172B" } }).png().toBuffer().then((b) => new Uint8Array(b));

describe("post image size (ADR-020, ADR-090)", () => {
  it("a Facebook channel without its own preset gets a square 1080×1080 image", async () => {
    expect(await slideSize(db, "facebook", null)).toEqual({ width: 1080, height: 1080, preset: "fb_feed_square" });
  });

  it("Instagram stays 4:5; a channel's own preset always wins", async () => {
    expect(await slideSize(db, "instagram", null)).toEqual({ width: 1080, height: 1350, preset: "ig_feed_portrait" });
    expect(await slideSize(db, "facebook", "fb_feed_portrait")).toEqual({ width: 1080, height: 1350, preset: "fb_feed_portrait" });
    expect(await slideSize(db, "facebook", "fb_link")).toEqual({ width: 1200, height: 628, preset: "fb_link" });
  });

  it("every platform default is a seeded, enabled image preset (no silent 1080×1080 fallback)", async () => {
    for (const [platform, key] of Object.entries(PLATFORM_DEFAULT)) {
      const s = await slideSize(db, platform as never, null);
      expect(s.preset, platform).toBe(key);
    }
  });

  it("a disabled or video preset falls back to the platform default", async () => {
    await sql`update format_presets set enabled = false where key = 'fb_feed_portrait'`;
    expect((await slideSize(db, "facebook", "fb_feed_portrait")).preset).toBe("fb_feed_square");
    await sql`update format_presets set enabled = true where key = 'fb_feed_portrait'`;
    expect((await slideSize(db, "facebook", "fb_story_reel")).preset).toBe("fb_feed_square");
  });

  it("a rendered image must match its preset to the pixel", async () => {
    await expect(assertSize(await png(1080, 1080), { width: 1080, height: 1080 })).resolves.toBeUndefined();
    for (const [w, h] of [[1080, 1350], [1080, 1079], [1081, 1080]]) {
      await expect(assertSize(await png(w, h), { width: 1080, height: 1080 }), `${w}×${h}`).rejects.toBeInstanceOf(ImageJobError);
    }
  });
});
