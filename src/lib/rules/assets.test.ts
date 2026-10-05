import { describe, expect, it } from "vitest";
import { checkAsset, insideSafeArea, safeArea, type FormatPreset } from "./assets";

const story: FormatPreset = { key: "ig_story", width: 1080, height: 1920, media: "video", maxBytes: 4_000_000_000, minDurationS: 3, maxDurationS: 60, safeZone: { top: 270, right: 65, bottom: 672, left: 65 } };
const feed: FormatPreset = { key: "ig_feed_portrait", width: 1080, height: 1350, media: "image", maxBytes: 30_000_000, safeZone: { top: 0, right: 0, bottom: 0, left: 0 } };

describe("checkAsset", () => {
  it("exact size passes; 1 px off fails", () => {
    expect(checkAsset({ width: 1080, height: 1350, bytes: 1000, media: "image" }, feed)).toEqual([]);
    expect(checkAsset({ width: 1080, height: 1349, bytes: 1000, media: "image" }, feed)).toEqual([{ code: "wrong_size", actual: "1080x1349", limit: "1080x1350" }]);
  });
  it("file size: limit passes, limit+1 fails; wrong media", () => {
    expect(checkAsset({ width: 1080, height: 1350, bytes: 30_000_000, media: "image" }, feed)).toEqual([]);
    expect(checkAsset({ width: 1080, height: 1350, bytes: 30_000_001, media: "image" }, feed).map((v) => v.code)).toEqual(["file_too_large"]);
    expect(checkAsset({ width: 1080, height: 1350, bytes: 1, media: "video" }, feed).map((v) => v.code)).toEqual(["wrong_media"]);
  });
  it("video duration boundaries", () => {
    const base = { width: 1080, height: 1920, bytes: 1, media: "video" as const };
    expect(checkAsset({ ...base, durationS: 3 }, story)).toEqual([]);
    expect(checkAsset({ ...base, durationS: 60 }, story)).toEqual([]);
    expect(checkAsset({ ...base, durationS: 2.9 }, story).map((v) => v.code)).toEqual(["video_too_short"]);
    expect(checkAsset({ ...base, durationS: 60.1 }, story).map((v) => v.code)).toEqual(["video_too_long"]);
  });
});

describe("safe area", () => {
  it("computes the usable rectangle", () => {
    expect(safeArea(story)).toEqual({ x: 65, y: 270, width: 950, height: 978 });
  });
  it("box on the edge is inside; 1 px into the bottom zone is outside", () => {
    expect(insideSafeArea({ x: 65, y: 270, width: 950, height: 978 }, story)).toBe(true);
    expect(insideSafeArea({ x: 65, y: 270, width: 950, height: 979 }, story)).toBe(false);
    expect(insideSafeArea({ x: 64, y: 300, width: 100, height: 100 }, story)).toBe(false);
  });
});
