import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAsset, checkText, effectiveRules, safeArea } from "@/lib/rules";
import { resetAndMigrate } from "../../../tests/db";
import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import { getPlatformRuleSet, getPreset, listPlatformRules, listPresets } from "./repo";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = createDb(url, { max: 2 });

beforeAll(async () => { await resetAndMigrate(url); });
afterAll(async () => { await sql.end({ timeout: 5 }); });

describe("seeded platform data", () => {
  it("every platform has rules with source, confidence and verification date", async () => {
    const rows = await listPlatformRules(db);
    expect(rows.map((r) => r.platform).sort()).toEqual(["facebook", "google_display", "instagram", "linkedin", "tiktok", "x", "youtube"]);
    for (const r of rows) {
      expect(r.source.length).toBeGreaterThan(5);
      expect(["high", "medium", "low"]).toContain(r.confidence);
      expect(r.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("presets: positive sizes, safe zones leave a usable area, every platform covered", async () => {
    const presets = await listPresets(db);
    expect(presets.length).toBeGreaterThanOrEqual(25);
    for (const p of presets) {
      const a = safeArea(p);
      expect(a.width, p.key).toBeGreaterThan(p.width / 2);
      expect(a.height, p.key).toBeGreaterThan(p.height / 3);
    }
    expect(new Set(presets.map((p) => p.platform)).size).toBe(7);
  });

  it("seed is idempotent and never overwrites values a super admin changed", async () => {
    await sql`update platform_rules set hashtags_max = 3 where platform = 'instagram'`;
    const before = (await sql`select count(*)::int n from format_presets`)[0].n;
    const seed = fs.readFileSync(path.join(process.cwd(), "drizzle/0005_seed_platform_data.sql"), "utf8");
    for (const stmt of seed.split("--> statement-breakpoint")) await sql.unsafe(stmt);
    await runMigrations(url);
    expect((await sql`select count(*)::int n from format_presets`)[0].n).toBe(before);
    expect((await sql`select hashtags_max from platform_rules where platform = 'instagram'`)[0].hashtags_max).toBe(3);
    await sql`update platform_rules set hashtags_max = 5 where platform = 'instagram'`;
  });

  it("CHECK constraints reject impossible data", async () => {
    await expect(sql`insert into format_presets (key, platform, placement, width, height, media, source, confidence, verified_at) values ('bad','x','f',0,100,'image','s','high','2026-10-05')`).rejects.toThrow();
    await expect(sql`insert into format_presets (key, platform, placement, width, height, media, source, confidence, verified_at) values ('bad2','x','f',10,10,'gif','s','high','2026-10-05')`).rejects.toThrow();
  });
});

describe("rules from the database through the engine", () => {
  it("Instagram: 5 hashtags pass, 6 fail; 2200/2201 chars", async () => {
    const ig = await getPlatformRuleSet(db, "instagram");
    expect(checkText("#a1 #b #c #d #e", ig).violations).toEqual([]);
    expect(checkText("#a1 #b #c #d #e #f", ig).violations.map((v) => v.code)).toEqual(["too_many_hashtags"]);
    expect(checkText("č".repeat(2200), ig).violations).toEqual([]);
    expect(checkText("č".repeat(2201), ig).violations.map((v) => v.code)).toEqual(["caption_too_long"]);
  });

  it("X uses weighted counting from the database", async () => {
    const x = await getPlatformRuleSet(db, "x");
    expect(x.counting).toBe("x_weighted");
    expect(checkText("😀".repeat(140), x).violations).toEqual([]);
    expect(checkText("😀".repeat(141), x).violations.map((v) => v.code)).toEqual(["caption_too_long"]);
  });

  it("a channel layer can only tighten the platform", async () => {
    const li = await getPlatformRuleSet(db, "linkedin");
    const r = effectiveRules(li, { captionMax: 1300, hashtagsMax: 3 }, { captionMax: 9999 });
    expect(r).toMatchObject({ captionMax: 1300, hashtagsMax: 3 });
  });

  it("presets validate real asset facts; disabled and unknown presets cannot be used", async () => {
    const p = await getPreset(db, "ig_feed_portrait");
    expect(checkAsset({ width: 1080, height: 1350, bytes: 500_000, media: "image" }, p)).toEqual([]);
    expect(checkAsset({ width: 1080, height: 1080, bytes: 500_000, media: "image" }, p).map((v) => v.code)).toEqual(["wrong_size"]);
    await sql`update format_presets set enabled = false where key = 'x_square'`;
    await expect(getPreset(db, "x_square")).rejects.toThrow("UNKNOWN_PRESET");
    await expect(getPreset(db, "nope")).rejects.toThrow("UNKNOWN_PRESET");
    await expect(getPlatformRuleSet(db, "myspace" as never)).rejects.toThrow("UNKNOWN_PLATFORM");
  });
});
