import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { testClip } from "../../../tests/fixtures/video";
import { composeVideo, probeVideo, VideoError } from "./ffmpeg";

/** The first frame of an MP4 as raw RGB. */
async function firstFrame(mp4: Uint8Array) {
  const dir = mkdtempSync(path.join(tmpdir(), "frame-"));
  try {
    writeFileSync(path.join(dir, "v.mp4"), mp4);
    execFileSync("ffmpeg", ["-loglevel", "error", "-i", path.join(dir, "v.mp4"), "-frames:v", "1", "-y", path.join(dir, "f.png")]);
    return sharp(readFileSync(path.join(dir, "f.png"))).raw().toBuffer({ resolveWithObject: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("video", () => {
  it("probes a clip and refuses what is not a short video", async () => {
    expect(await probeVideo(testClip({ seconds: 2 }))).toMatchObject({ width: 768, height: 960, codec: "h264" });
    await expect(probeVideo(new TextEncoder().encode("not a video at all"))).rejects.toMatchObject({ code: "VIDEO_INVALID" });
    const png = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer());
    await expect(probeVideo(png)).rejects.toBeInstanceOf(VideoError);
    await expect(probeVideo(testClip({ seconds: 20 }))).rejects.toMatchObject({ code: "VIDEO_INVALID" }); // too long
  }, 60_000);

  it("crops to the exact size (never stretched), burns in the overlay, adds a silent track, stops at maxS", async () => {
    // Overlay: an opaque red bar at the top, transparent elsewhere.
    const overlay = new Uint8Array(await sharp({ create: { width: 1080, height: 1350, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 1080, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), top: 0, left: 0 }])
      .png().toBuffer());
    const { bytes, probe } = await composeVideo(testClip({ width: 768, height: 1280, seconds: 3 }), overlay, { width: 1080, height: 1350, maxS: 2 });
    expect(probe).toMatchObject({ width: 1080, height: 1350, codec: "h264" });
    expect(probe.durationS).toBeGreaterThan(1.8);
    expect(probe.durationS).toBeLessThan(2.3);
    const info = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", "-"], { input: Buffer.from(bytes) }).toString();
    expect(info.split("\n").filter(Boolean).sort()).toEqual(["audio", "video"]);
    const { data, info: f } = await firstFrame(bytes);
    const at = (x: number, y: number) => { const i = (y * f.width + x) * f.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const [r, g, b] = at(540, 100);
    expect(r).toBeGreaterThan(200); // the overlay bar
    expect(g + b).toBeLessThan(80);
    const [r2, g2, b2] = at(540, 900);
    expect(r2 > 200 && g2 < 40 && b2 < 40).toBe(false); // the clip shows through below
  }, 120_000);
});
