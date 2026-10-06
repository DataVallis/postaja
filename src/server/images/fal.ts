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
export interface ImageClient {
  generate(req: ImageRequest): Promise<ImageResult>;
}

export class ImageError extends Error {
  constructor(public readonly code: "NO_IMAGE_KEY" | "IMAGE_PROVIDER" | "IMAGE_TIMEOUT" | "IMAGE_BLOCKED" | "IMAGE_INVALID") {
    super(code);
  }
}

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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
    if (!r.ok) throw new ImageError(r.status === 422 ? "IMAGE_BLOCKED" : "IMAGE_PROVIDER");
    return (await r.json()) as Record<string, unknown>;
  };

  return {
    async generate(req) {
      const app = req.model.replace(/^\/+/, "");
      if (!/^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(app) || app.includes("..")) throw new ImageError("IMAGE_PROVIDER");
      let submitted: Record<string, unknown>;
      try {
        const r = await f(new URL(`/${app}`, base), {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody(app, req)),
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) throw new ImageError(r.status === 401 || r.status === 403 ? "NO_IMAGE_KEY" : r.status === 422 ? "IMAGE_BLOCKED" : "IMAGE_PROVIDER");
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

      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const s = await getJson(statusUrl).catch((e) => { throw e instanceof ImageError ? e : new ImageError("IMAGE_PROVIDER"); });
        if (s.status === "COMPLETED") break;
        if (s.status !== "IN_QUEUE" && s.status !== "IN_PROGRESS") throw new ImageError("IMAGE_PROVIDER");
        if (Date.now() > deadline) throw new ImageError("IMAGE_TIMEOUT");
        await new Promise((res) => setTimeout(res, pollMs));
      }
      const out = await getJson(responseUrl).catch((e) => { throw e instanceof ImageError ? e : new ImageError("IMAGE_PROVIDER"); });
      const nsfw = out.has_nsfw_concepts;
      if (Array.isArray(nsfw) && nsfw[0] === true) throw new ImageError("IMAGE_BLOCKED");
      const img = (out.images as { url?: unknown }[] | undefined)?.[0];
      if (!img || typeof img.url !== "string" || !allowedResultUrl(img.url, base)) throw new ImageError("IMAGE_PROVIDER");

      let bytes: Uint8Array;
      try {
        const r = await f(img.url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error("download");
        const len = Number(r.headers.get("content-length") ?? 0);
        if (len > MAX_IMAGE_BYTES) throw new Error("too large");
        bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("size");
      } catch {
        throw new ImageError("IMAGE_PROVIDER");
      }
      // Never trust the bytes: decode them and re-encode as JPEG (drops metadata, proves it is a picture).
      try {
        const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate().jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
        return { bytes: new Uint8Array(data), contentType: "image/jpeg", width: info.width, height: info.height };
      } catch {
        throw new ImageError("IMAGE_INVALID");
      }
    },
  };
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
  return { prompt: req.prompt, image_size: { width: req.width, height: req.height }, num_images: 1, output_format: "jpeg", enable_safety_checker: true };
}

/** Size to ask the model for: the slide's aspect ratio within `maxPixels`, sides multiples of 16 (≥ 256). */
export function generationSize(width: number, height: number, maxPixels = 1_000_000): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const snap = (v: number) => Math.max(256, Math.floor((v * scale) / 16) * 16);
  return { width: snap(width), height: snap(height) };
}

/** Billed megapixels (fal rounds each image up to the next megapixel). */
export const billedMegapixels = (w: number, h: number) => Math.max(1, Math.ceil((w * h) / 1_000_000));
