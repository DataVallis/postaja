// HTTP layer for post images and the template preview (TASK-015). Free of Next.js imports so integration tests can
// call it with real Requests.
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "../db/client";
import { BrandError, getBrandDetail } from "../brands/service";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { renderSlides } from "./render";
import { brandAssetsFor, brandColors, brandTemplate, ImageJobError, postMediaUrl } from "./service";
import { DEFAULT_TEMPLATE, type BrandTemplate } from "./template";

export type MediaHttpDeps = { db: Db; storage: Storage; getCtx: () => Promise<OrgContext | null> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** GET → 302 to a 5-minute presigned URL for a member of the image's org; `?download=1` saves it as a file. */
export async function handleMedia(req: Request, mediaId: string, deps: MediaHttpDeps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const url = await postMediaUrl(deps.db, deps.storage, ctx, mediaId, new URL(req.url).searchParams.get("download") === "1");
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof ImageJobError) return json({ error: e.code }, 404);
    throw e;
  }
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const previewQuery = z.object({
  layout: z.enum(["card", "center", "photo"]).optional(),
  label: z.enum(["category", "none"]).optional(),
  accentLine: z.enum(["last", "first", "none"]).optional(),
  uppercase: z.enum(["0", "1"]).optional(),
  overlay: z.coerce.number().min(0).max(1).optional(),
  footerText: z.string().max(60).optional(),
  logoId: z.string().max(100).optional(),
  fontId: z.string().max(100).optional(),
  typeface: z.enum(["sans", "mono"]).optional(),
  background: z.enum(["ai", "plain"]).optional(),
  bg: hex.optional(),
  fg: hex.optional(),
  accent: hex.optional(),
  shape: z.enum(["portrait", "square", "landscape"]).optional(),
  text: z.string().max(300).optional(),
  labelText: z.string().max(40).optional(),
});

const SHAPES = { portrait: { width: 1080, height: 1350 }, square: { width: 1080, height: 1080 }, landscape: { width: 1600, height: 900 } } as const;

/** A stand-in photo for previews: soft diagonal light, so the overlay can be judged without an image cost. */
async function sampleBackground(w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa7b8"/><stop offset="0.5" stop-color="#4b5869"/><stop offset="1" stop-color="#1d232c"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.75}" cy="${h * 0.25}" r="${w * 0.22}" fill="#c8d1dc" opacity="0.45"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer());
}

/**
 * GET → PNG preview of the brand's template (saved values overridden by the query, so the form can preview unsaved
 * changes). Members only; nothing is stored and no provider is called.
 */
export async function handlePreview(req: Request, brandId: string, deps: MediaHttpDeps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const q = previewQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return json({ error: "INVALID" }, 400);
  let detail;
  try {
    detail = await getBrandDetail(deps.db, ctx, brandId);
  } catch (e) {
    if (e instanceof BrandError) return json({ error: "NOT_FOUND" }, 404);
    throw e;
  }
  const saved = brandTemplate(detail.profile?.visual);
  const v = q.data;
  const tpl: BrandTemplate = {
    ...DEFAULT_TEMPLATE,
    ...saved,
    ...(v.layout ? { layout: v.layout } : {}),
    ...(v.label ? { label: v.label } : {}),
    ...(v.accentLine ? { accentLine: v.accentLine } : {}),
    ...(v.uppercase ? { uppercase: v.uppercase === "1" } : {}),
    ...(v.overlay !== undefined ? { overlay: v.overlay } : {}),
    ...(v.footerText !== undefined ? { footerText: v.footerText } : {}),
    ...(v.logoId !== undefined ? { logoId: v.logoId || null } : {}),
    ...(v.fontId !== undefined ? { fontId: v.fontId || null } : {}),
    ...(v.typeface ? { typeface: v.typeface } : {}),
    ...(v.background ? { background: v.background } : {}),
  };
  const colors = brandColors({ ...detail.profile?.visual.colors, ...(v.bg ? { background: v.bg } : {}), ...(v.fg ? { text: v.fg } : {}), ...(v.accent ? { accent: v.accent } : {}) });
  const size = SHAPES[v.shape ?? "portrait"];
  const [{ logo, brandFont }, background] = await Promise.all([
    brandAssetsFor(deps.db, deps.storage, ctx, brandId, tpl),
    tpl.background === "ai" ? sampleBackground(size.width, size.height) : null,
  ]);
  const text = v.text?.trim() || "Tukaj bo naslov objave.\nZadnja vrstica v poudarku.";
  const [png] = await renderSlides(tpl, colors, size, [{ label: tpl.label === "category" ? v.labelText?.trim() || "Kategorija" : null, headline: tpl.layout === "photo" ? null : text }], { logo, brandFont, background });
  const small = await sharp(png).resize({ width: 540 }).png().toBuffer();
  return new Response(new Uint8Array(small), { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}

