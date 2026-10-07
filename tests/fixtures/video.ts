// A short test clip made with ffmpeg (TASK-022): what an image-to-video model would return.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function testClip(o: { width?: number; height?: number; seconds?: number } = {}): Uint8Array {
  const dir = mkdtempSync(path.join(tmpdir(), "clip-"));
  const out = path.join(dir, "clip.mp4");
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=${o.width ?? 768}x${o.height ?? 960}:rate=25`, "-t", String(o.seconds ?? 2), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", out]);
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
