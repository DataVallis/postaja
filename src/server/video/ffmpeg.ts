// Video with ffmpeg (TASK-022, ADR-021): the provider's clip is never trusted — ffprobe checks it is one short video
// stream before anything else; then ffmpeg crops it to the post's exact size, burns in the template overlay drawn by
// Postaja (text, logo, shapes) and writes H.264 + a silent AAC track, faststart. Files only in a private temp folder,
// local file protocol only, hard timeouts.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export class VideoError extends Error {
  constructor(public readonly code: "VIDEO_INVALID" | "VIDEO_TOOL" | "VIDEO_TIMEOUT") {
    super(code);
  }
}

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
export const MAX_CLIP_SECONDS = 15;

function exec(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { if (stdout.length < 1_000_000) stdout += d; });
    child.stderr.on("data", (d) => { if (stderr.length < 20_000) stderr += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new VideoError("VIDEO_TIMEOUT")); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); reject(new VideoError("VIDEO_TOOL")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new VideoError("VIDEO_TOOL"), { detail: stderr.slice(-500) }));
    });
  });
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "postaja-video-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type ProbeResult = { width: number; height: number; durationS: number; codec: string };

async function probeFile(file: string): Promise<ProbeResult> {
  let out: string;
  try {
    out = (await exec(FFPROBE, ["-v", "error", "-protocol_whitelist", "file", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration,format_name", "-of", "json", file], 30_000)).stdout;
  } catch (e) {
    if (e instanceof VideoError && e.code === "VIDEO_TIMEOUT") throw e;
    throw new VideoError("VIDEO_INVALID");
  }
  const j = JSON.parse(out) as { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[]; format?: { duration?: string; format_name?: string } };
  const video = (j.streams ?? []).filter((s) => s.codec_type === "video");
  const durationS = Number(j.format?.duration ?? NaN);
  if (video.length !== 1 || !video[0].width || !video[0].height || !Number.isFinite(durationS)) throw new VideoError("VIDEO_INVALID");
  if (!/mp4|mov|webm|matroska/.test(j.format?.format_name ?? "")) throw new VideoError("VIDEO_INVALID");
  if (durationS <= 0 || durationS > MAX_CLIP_SECONDS + 1 || video[0].width > 4096 || video[0].height > 4096) throw new VideoError("VIDEO_INVALID");
  return { width: video[0].width, height: video[0].height, durationS, codec: video[0].codec_name ?? "" };
}

/** Checks a clip is one short video stream of sane size. */
export function probeVideo(bytes: Uint8Array): Promise<ProbeResult> {
  return withTemp(async (dir) => {
    const f = path.join(dir, "in.bin");
    await writeFile(f, bytes);
    return probeFile(f);
  });
}

/**
 * The finished video: `clip` scaled to cover `width`×`height` and cropped (never stretched), the transparent `overlay`
 * PNG (same size) on top, at most `maxS` seconds, 25 fps, H.264 yuv420p + silent stereo AAC, +faststart.
 */
export function composeVideo(clip: Uint8Array, overlay: Uint8Array, o: { width: number; height: number; maxS: number }): Promise<{ bytes: Uint8Array; probe: ProbeResult }> {
  return withTemp(async (dir) => {
    const input = path.join(dir, "in.bin");
    const over = path.join(dir, "overlay.png");
    const out = path.join(dir, "out.mp4");
    await writeFile(input, clip);
    await writeFile(over, overlay);
    const src = await probeFile(input);
    const t = Math.min(o.maxS, src.durationS);
    const filter = `[0:v]scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height},setsar=1,fps=25[bg];[bg][1:v]overlay=0:0:format=auto,format=yuv420p[v]`;
    await exec(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe,lavfi",
      "-i", input, "-loop", "1", "-i", over, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-filter_complex", filter, "-map", "[v]", "-map", "2:a",
      "-t", t.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-y", out,
    ], 180_000);
    const bytes = new Uint8Array(await readFile(out));
    return { bytes, probe: await probeFile(out) };
  });
}
