// fal.ai queue API client (TASK-015, ADR-043): submit → poll status → read result → download the picture. Only the
// background is generated; Postaja draws every letter itself (ADR-009). FAL_BASE_URL exists for the E2E stand-in.
import sharp from "sharp";
import { MAX_INPUT_PIXELS } from "../files/images";

export type ImageRequest = {
  model: string; prompt: string; width: number; height: number;
  /** Style references (data: URIs of the brand's example images), for models that take them. */
  references?: string[];
  negativePrompt?: string;
};
export type ImageResult = { bytes: Uint8Array; contentType: string; width: number; height: number };
/** Image-to-video (TASK-022): the clean illustration (data: URI) moves as `prompt` says; no text is ever asked for. */
export type VideoRequest = { model: string; prompt: string; image: string; durationS: number };
export type VideoResult = { bytes: Uint8Array };
export interface ImageClient {
  generate(req: ImageRequest): Promise<ImageResult>;
  /** Optional: clients without video (older stand-ins) leave it out. */
  video?(req: VideoRequest): Promise<VideoResult>;
}

export class ImageError extends Error {
  /** `detail`: the provider's own reason (e.g. fal's 422 message), short and plain, for the owner to see. */
  constructor(public readonly code: "NO_IMAGE_KEY" | "IMAGE_PROVIDER" | "IMAGE_TIMEOUT" | "IMAGE_BLOCKED" | "IMAGE_INVALID", public readonly detail?: string) {
    super(code);
  }
}

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** fal's error body → one short plain line ({detail: string} or {detail: [{msg, type}]}). Never the request. */
export async function falReason(r: Response): Promise<string | undefined> {
  try {
    const j = (await r.json()) as { detail?: unknown };
    const d = j.detail;
    const text = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => (x && typeof x === "object" ? String((x as { msg?: unknown; type?: unknown }).msg ?? (x as { type?: unknown }).type ?? "") : String(x))).join("; ") : "";
    const clean = text.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    return clean || undefined;
  } catch {
    return undefined;
  }
}

type FalOptions = { key?: string; baseUrl?: string; fetch?: typeof fetch; pollMs?: number; timeoutMs?: number };

/** Hosts fal serves results from. Anything else is refused (the URL comes from a response, never from a user). */
function allowedResultUrl(u: string, base: URL): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.origin === base.origin) return true;
  if (url.protocol !== "https:") return false;
  return /(^|\.)fal\.(media|run|ai)$/.test(url.hostname) || (url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/falserverless/"));
}

export function createFalClient(opts: FalOptions = {}): ImageClient | null {
  const key = opts.key ?? process.env.FAL_KEY;
  if (!key) return null;
  const base = new URL(opts.baseUrl ?? process.env.FAL_BASE_URL ?? "https://queue.fal.run");
  const f = opts.fetch ?? fetch;
  const pollMs = opts.pollMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

  const getJson = async (url: string) => {
    if (!allowedResultUrl(url, base)) throw new ImageError("IMAGE_PROVIDER");
    const r = await f(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new ImageError(r.status === 422 ? "IMAGE_BLOCKED" : "IMAGE_PROVIDER", await falReason(r));
    return (await r.json()) as Record<string, unknown>;
  };

  /** Submit to the queue, poll until done, return the result JSON. Every URL is checked against fal's hosts. */
  async function run(model: string, body: Record<string, unknown>, timeout: number): Promise<Record<string, unknown>> {
    const app = model.replace(/^\/+/, "");
    if (!/^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(app) || app.includes("..")) throw new ImageError("IMAGE_PROVIDER");
    let submitted: Record<string, unknown>;
    try {
      const r = await f(new URL(`/${app}`, base), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new ImageError(r.status === 401 || r.status === 403 ? "NO_IMAGE_KEY" : r.status === 422 ? "IMAGE_BLOCKED" : "IMAGE_PROVIDER", r.status === 422 ? await falReason(r) : undefined);
      submitted = (await r.json()) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ImageError) throw e;
      throw new ImageError("IMAGE_PROVIDER");
    }
    const id = String(submitted.request_id ?? "");
    if (!/^[\w-]{1,100}$/.test(id)) throw new ImageError("IMAGE_PROVIDER");
    // fal returns the status/result URLs; they are built from the app id (owner/name), not the full model path.
    const root = app.split("/").slice(0, 2).join("/");
    const statusUrl = typeof submitted.status_url === "string" ? submitted.status_url : new URL(`/${root}/requests/${id}/status`, base).href;
    const responseUrl = typeof submitted.response_url === "string" ? submitted.response_url : new URL(`/${root}/requests/${id}`, base).href;
    const deadline = Date.now() + timeout;
    for (;;) {
      const st = await getJson(statusUrl).catch((e) => { throw e instanceof ImageError ? e : new ImageError("IMAGE_PROVIDER"); });
      if (st.status === "COMPLETED") break;
      if (st.status !== "IN_QUEUE" && st.status !== "IN_PROGRESS") throw new ImageError("IMAGE_PROVIDER");
      if (Date.now() > deadline) throw new ImageError("IMAGE_TIMEOUT");
      await new Promise((res) => setTimeout(res, pollMs));
    }
    return getJson(responseUrl).catch((e) => { throw e instanceof ImageError ? e : new ImageError("IMAGE_PROVIDER"); });
  }

  /** Downloads a result file from fal's hosts, at most `max` bytes. */
  async function download(url: unknown, max: number, timeout: number): Promise<Uint8Array> {
    if (typeof url !== "string" || !allowedResultUrl(url, base)) throw new ImageError("IMAGE_PROVIDER");
    try {
      const r = await f(url, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error("download");
      if (Number(r.headers.get("content-length") ?? 0) > max) throw new Error("too large");
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > max) throw new Error("size");
      return bytes;
    } catch {
      throw new ImageError("IMAGE_PROVIDER");
    }
  }

  return {
    async generate(req) {
      const out = await run(req.model, requestBody(req.model.replace(/^\/+/, ""), req), timeoutMs);
      const nsfw = out.has_nsfw_concepts;
      if (Array.isArray(nsfw) && nsfw[0] === true) throw new ImageError("IMAGE_BLOCKED");
      const bytes = await download((out.images as { url?: unknown }[] | undefined)?.[0]?.url, MAX_IMAGE_BYTES, 60_000);
      // Never trust the bytes: decode them and re-encode as JPEG (drops metadata, proves it is a picture).
      try {
        const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate().jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
        return { bytes: new Uint8Array(data), contentType: "image/jpeg", width: info.width, height: info.height };
      } catch {
        throw new ImageError("IMAGE_INVALID");
      }
    },
    async video(req) {
      // Videos take minutes in the provider's queue; the bytes are checked by ffprobe before use (src/server/video).
      const out = await run(req.model, videoBody(req.model.replace(/^\/+/, ""), req), Math.max(timeoutMs, 600_000));
      return { bytes: await download((out.video as { url?: unknown } | undefined)?.url, MAX_VIDEO_BYTES, 120_000) };
    },
  };
}

/**
 * Video model bodies (TASK-022). Kling 3.0: start image, 3–15 s as a string, no native audio (Postaja adds a silent
 * track), text kept out by the negative prompt too. Hailuo takes 6 or 10 s and the prompt optimizer off.
 */
export function videoBody(app: string, req: VideoRequest): Record<string, unknown> {
  if (app.startsWith("fal-ai/kling-video/v3/")) {
    return {
      prompt: req.prompt, start_image_url: req.image, duration: String(Math.min(15, Math.max(3, Math.round(req.durationS)))), generate_audio: false,
      negative_prompt: "text, letters, words, watermark, logo, blur, distort, low quality",
    };
  }
  if (app.startsWith("fal-ai/minimax/hailuo")) return { prompt: req.prompt, image_url: req.image, duration: String(req.durationS >= 10 ? 10 : 6), prompt_optimizer: false };
  return { prompt: req.prompt, image_url: req.image, duration: String(req.durationS) };
}

/** The body each model family expects. Ideogram takes style references and a negative prompt; FLUX neither. */
export function requestBody(app: string, req: ImageRequest): Record<string, unknown> {
  if (app.startsWith("fal-ai/ideogram/")) {
    return {
      prompt: req.prompt,
      image_size: { width: req.width, height: req.height },
      rendering_speed: "BALANCED",
      style: "AUTO",
      expand_prompt: false,
      num_images: 1,
      ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
      ...(req.references?.length ? { image_urls: req.references } : {}),
    };
  }
  // Reference models (TASK-024): the persona's passport pictures keep the person; the shape comes from the request.
  // Nano Banana Pro (TASK-024 follow-up): photoreal people; 2K costs the same as 1K. Text-to-image without references,
  // the /edit endpoint with them.
  if (app.startsWith("fal-ai/nano-banana-pro")) {
    return { prompt: req.prompt, ...(req.references?.length ? { image_urls: req.references } : {}), aspect_ratio: nearestAspect(req.width, req.height), resolution: "2K", num_images: 1, output_format: "jpeg" };
  }
  if (app.startsWith("fal-ai/nano-banana")) {
    return { prompt: req.prompt, ...(req.references?.length ? { image_urls: req.references } : {}), aspect_ratio: nearestAspect(req.width, req.height), num_images: 1, output_format: "jpeg" };
  }
  if (app.startsWith("fal-ai/bytedance/seedream/")) {
    // Seedream needs at least 921,600 px; ask for the shape at ~1 MP+.
    const s = generationSize(req.width, req.height, 1_100_000);
    return { prompt: req.prompt, image_urls: (req.references ?? []).slice(-10), image_size: s, num_images: 1, enable_safety_checker: true };
  }
  return { prompt: req.prompt, image_size: { width: req.width, height: req.height }, num_images: 1, output_format: "jpeg", enable_safety_checker: true };
}

const ASPECTS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"] as const;
/** The closest aspect ratio a model with fixed ratios offers (compared on a log scale). */
export function nearestAspect(width: number, height: number): (typeof ASPECTS)[number] {
  const want = Math.log(width / height);
  let best: (typeof ASPECTS)[number] = "1:1";
  let diff = Infinity;
  for (const a of ASPECTS) {
    const [w, h] = a.split(":").map(Number);
    const d = Math.abs(Math.log(w / h) - want);
    if (d < diff) { diff = d; best = a; }
  }
  return best;
}

/** Size to ask the model for: the slide's aspect ratio within `maxPixels`, sides multiples of 16 (≥ 256). */
export function generationSize(width: number, height: number, maxPixels = 1_000_000): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const snap = (v: number) => Math.max(256, Math.floor((v * scale) / 16) * 16);
  return { width: snap(width), height: snap(height) };
}

/** Billed megapixels (fal rounds each image up to the next megapixel). */
export const billedMegapixels = (w: number, h: number) => Math.max(1, Math.ceil((w * h) / 1_000_000));
