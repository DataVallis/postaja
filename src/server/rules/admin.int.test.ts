import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkText } from "@/lib/rules";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { ForbiddenError } from "../orgs/service";
import { updateFormatPreset, updatePlatformRule, type FormatPresetInput, type PlatformRuleInput } from "./admin";
import { countDueForReverification, getPlatformRuleSet, getPreset } from "./repo";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const NOW = new Date("2026-10-10T10:00:00Z"); // seed rows are verified 2026-10-05

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  await resetAndMigrate(url); // seeded platform data back to the original values
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function boss() {
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  return { userId: s.user.id, role: "superadmin" as const };
}
// Non-super-admin actor: the role check runs before any DB access.
async function plainUser() {
  return { userId: "someone", role: "user" as const };
}

async function ruleRow(platform: string): Promise<PlatformRuleInput> {
  const [r] = await sql`select * from platform_rules where platform = ${platform}`;
  return {
    counting: r.counting, captionMax: r.caption_max, visibleChars: r.visible_chars, hashtagsMax: r.hashtags_max,
    mentionsMax: r.mentions_max, linksClickable: r.links_clickable, threadPartMax: r.thread_part_max,
    threadPartsMax: r.thread_parts_max, slidesMin: r.slides_min, slidesMax: r.slides_max,
    source: r.source, confidence: r.confidence, notes: r.notes, verifiedAt: r.verified_at.toISOString?.().slice(0, 10) ?? r.verified_at,
  };
}
async function presetRow(key: string): Promise<FormatPresetInput> {
  const [p] = await sql`select * from format_presets where key = ${key}`;
  return {
    width: p.width, height: p.height, maxBytes: p.max_bytes === null ? null : Number(p.max_bytes),
    minDurationS: p.min_duration_s, maxDurationS: p.max_duration_s, safeZone: p.safe_zone, enabled: p.enabled,
    source: p.source, confidence: p.confidence, notes: p.notes, verifiedAt: p.verified_at.toISOString?.().slice(0, 10) ?? p.verified_at,
  };
}
const audits = () => sql`select action, target, org_id, actor_user_id, meta from audit_log order by created_at`;

describe("updatePlatformRule", () => {
  it("changes the value the rule engine uses and audits from → to per changed field only", async () => {
    const actor = await boss();
    const before = await ruleRow("instagram");
    expect(checkText("#a #b #c #d", await getPlatformRuleSet(db, "instagram")).violations).toEqual([]);

    const changes = await updatePlatformRule(db, actor, "instagram", { ...before, hashtagsMax: 3, source: "https://help.instagram.com (re-checked)", verifiedAt: "2026-10-10" }, NOW);
    expect(Object.keys(changes).sort()).toEqual(["hashtagsMax", "source", "verifiedAt"]);

    const ig = await getPlatformRuleSet(db, "instagram");
    expect(checkText("#a #b #c", ig).violations).toEqual([]);
    expect(checkText("#a #b #c #d", ig).violations.map((v) => v.code)).toEqual(["too_many_hashtags"]);

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "platform_rule.update", target: "instagram", org_id: null, actor_user_id: actor.userId });
    expect(rows[0].meta.hashtagsMax).toEqual({ from: "5", to: "3" });
    expect(rows[0].meta.verifiedAt).toEqual({ from: before.verifiedAt, to: "2026-10-10" });
  });

  it("saving unchanged values writes nothing (no update, no audit row)", async () => {
    const actor = await boss();
    const before = await ruleRow("linkedin");
    const [{ updated_at: t0 }] = await sql`select updated_at from platform_rules where platform = 'linkedin'`;
    expect(await updatePlatformRule(db, actor, "linkedin", before, NOW)).toEqual({});
    const [{ updated_at: t1 }] = await sql`select updated_at from platform_rules where platform = 'linkedin'`;
    expect(t1).toEqual(t0);
    expect(await audits()).toHaveLength(0);
  });

  it("a non-super-admin is refused and nothing changes", async () => {
    const user = await plainUser();
    const before = await ruleRow("x");
    await expect(updatePlatformRule(db, user, "x", { ...before, captionMax: 1 }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await ruleRow("x")).toEqual(before);
    expect(await audits()).toHaveLength(0);
  });

  it("exact boundaries: verified today ok, tomorrow refused; hashtags 0 ok, -1 refused; captionMax 1 ok, 0 refused", async () => {
    const actor = await boss();
    const base = await ruleRow("facebook");
    await expect(updatePlatformRule(db, actor, "facebook", { ...base, verifiedAt: "2026-10-11" }, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "facebook", { ...base, hashtagsMax: -1 }, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "facebook", { ...base, captionMax: 0, visibleChars: null }, NOW)).rejects.toThrow();
    expect(await ruleRow("facebook")).toEqual(base);
    await updatePlatformRule(db, actor, "facebook", { ...base, verifiedAt: "2026-10-10", hashtagsMax: 0, captionMax: 1, visibleChars: 1 }, NOW);
    expect(await ruleRow("facebook")).toMatchObject({ verifiedAt: "2026-10-10", hashtagsMax: 0, captionMax: 1, visibleChars: 1 });
  });

  it("refuses impossible combinations: visible > caption, slidesMin > slidesMax, bad enum, unknown platform, extra fields", async () => {
    const actor = await boss();
    const base = await ruleRow("instagram");
    await expect(updatePlatformRule(db, actor, "instagram", { ...base, captionMax: 100, visibleChars: 101 }, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "instagram", { ...base, slidesMin: 3, slidesMax: 2 }, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "instagram", { ...base, confidence: "certain" as never }, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "instagram", { ...base, source: "  " }, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "myspace" as never, base, NOW)).rejects.toThrow();
    await expect(updatePlatformRule(db, actor, "instagram", { ...base, platform: "x" } as never, NOW)).rejects.toThrow();
    expect(await ruleRow("instagram")).toEqual(base);
    // equal values are the boundary that passes
    await updatePlatformRule(db, actor, "instagram", { ...base, captionMax: 100, visibleChars: 100, slidesMin: 2, slidesMax: 2 }, NOW);
    expect(await ruleRow("instagram")).toMatchObject({ captionMax: 100, visibleChars: 100, slidesMin: 2, slidesMax: 2 });
  });

  it("concurrent edits serialize: every audit row's 'from' is the previous row's 'to' (no lost update in the log)", async () => {
    const actor = await boss();
    const base = await ruleRow("tiktok");
    await Promise.all(Array.from({ length: 10 }, (_, i) => updatePlatformRule(db, actor, "tiktok", { ...base, hashtagsMax: 10 + i }, NOW)));
    const rows = await audits();
    expect(rows).toHaveLength(10);
    // created_at is the transaction start, not the commit order, so follow the chain from the seeded value instead
    const byFrom = new Map(rows.map((r) => [r.meta.hashtagsMax.from, r.meta.hashtagsMax.to]));
    expect(byFrom.size).toBe(10); // two writers that read the same "from" would collide here
    let v: string | null = base.hashtagsMax === null ? null : String(base.hashtagsMax);
    for (let i = 0; i < 10; i++) v = byFrom.get(v) ?? "BROKEN_CHAIN";
    expect(v).toBe(String((await ruleRow("tiktok")).hashtagsMax));
  });
});

describe("updateFormatPreset", () => {
  it("changes size and safe zone, audits JSON diff; disabling makes it untargetable", async () => {
    const actor = await boss();
    const before = await presetRow("ig_story_image");
    const changes = await updateFormatPreset(db, actor, "ig_story_image", { ...before, safeZone: { ...before.safeZone, top: 300 } }, NOW);
    expect(Object.keys(changes)).toEqual(["safeZone"]);
    expect((await getPreset(db, "ig_story_image")).safeZone.top).toBe(300);

    await updateFormatPreset(db, actor, "ig_story_image", { ...(await presetRow("ig_story_image")), enabled: false }, NOW);
    await expect(getPreset(db, "ig_story_image")).rejects.toThrow("UNKNOWN_PRESET:ig_story_image");
    const rows = await audits();
    expect(rows.map((r) => r.action)).toEqual(["format_preset.update", "format_preset.update"]);
    expect(rows[1].meta).toEqual({ enabled: { from: "true", to: "false" } });
  });

  it("saving an unchanged preset writes nothing even though jsonb reorders safe-zone keys (regression)", async () => {
    const actor = await boss();
    const base = await presetRow("ig_story_image");
    const sz = base.safeZone as Record<string, number>;
    const reordered = { left: sz.left, bottom: sz.bottom, right: sz.right, top: sz.top };
    expect(await updateFormatPreset(db, actor, "ig_story_image", { ...base, safeZone: reordered }, NOW)).toEqual({});
    expect(await audits()).toHaveLength(0);
  });

  it("safe zone boundary: leaves 1 px → ok; covers the whole height or width → refused", async () => {
    const actor = await boss();
    const base = await presetRow("ig_feed_square");
    const { width, height } = base as { width: number; height: number };
    await expect(updateFormatPreset(db, actor, "ig_feed_square", { ...base, safeZone: { top: height / 2, bottom: height / 2, left: 0, right: 0 } }, NOW)).rejects.toThrow();
    await expect(updateFormatPreset(db, actor, "ig_feed_square", { ...base, safeZone: { top: 0, bottom: 0, left: width, right: 0 } }, NOW)).rejects.toThrow();
    await updateFormatPreset(db, actor, "ig_feed_square", { ...base, safeZone: { top: height - 1, bottom: 0, left: 0, right: width - 1 } }, NOW);
    expect((await presetRow("ig_feed_square")).safeZone).toEqual({ top: height - 1, bottom: 0, left: 0, right: width - 1 });
  });

  it("refuses zero size, min > max duration, unknown preset and a non-super-admin", async () => {
    const actor = await boss();
    const base = await presetRow("ig_reel");
    await expect(updateFormatPreset(db, actor, "ig_reel", { ...base, width: 0 }, NOW)).rejects.toThrow();
    await expect(updateFormatPreset(db, actor, "ig_reel", { ...base, minDurationS: 61, maxDurationS: 60 }, NOW)).rejects.toThrow();
    await expect(updateFormatPreset(db, actor, "nope", base, NOW)).rejects.toThrow("NOT_FOUND");
    await expect(updateFormatPreset(db, await plainUser(), "ig_reel", { ...base, enabled: false }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await presetRow("ig_reel")).toEqual(base);
    expect(await audits()).toHaveLength(0);
  });
});

describe("countDueForReverification", () => {
  it("exact boundary: verified 89 days ago is fine, 90 days ago is due; counts rules and presets separately", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    await sql`update platform_rules set verified_at = '2026-10-05'`;
    await sql`update format_presets set verified_at = '2026-10-05'`;
    expect(await countDueForReverification(db, now)).toEqual({ rules: 0, presets: 0 });
    await sql`update platform_rules set verified_at = '2026-07-08' where platform = 'x'`; // 89 days
    expect(await countDueForReverification(db, now)).toEqual({ rules: 0, presets: 0 });
    await sql`update platform_rules set verified_at = '2026-07-07' where platform = 'x'`; // 90 days
    await sql`update format_presets set verified_at = '2026-07-06' where key in ('ig_reel', 'x_video')`; // 91 days
    expect(await countDueForReverification(db, now)).toEqual({ rules: 1, presets: 2 });
  });

  it("seeded data (verified 2026-10-05) becomes due on 2027-01-03", async () => {
    expect(await countDueForReverification(db, new Date("2027-01-02T23:00:00Z"))).toEqual({ rules: 0, presets: 0 });
    const due = await countDueForReverification(db, new Date("2027-01-03T00:30:00Z"));
    expect(due.rules).toBe(7);
    expect(due.presets).toBeGreaterThanOrEqual(25);
  });
});
