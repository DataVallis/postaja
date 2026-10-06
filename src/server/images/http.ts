// HTTP layer for post images and brand design previews (TASK-015/017). Free of Next.js imports so integration tests
// can call it with real Requests.
import sharp from "sharp";
import { z } from "zod";
import type { Db } from "../db/client";
import { brandAssetBytes, DesignError, getDesign, renderPreview } from "../design/service";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { ImageJobError, postMediaUrl } from "./service";

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

const previewQuery = z.object({ template: z.string().regex(/^[a-z0-9-]{2,40}$/), shape: z.enum(["portrait", "square", "landscape"]).default("portrait") });

/**
 * GET → PNG of one template of a brand design with its sample words, the brand's logo and font and a stand-in
 * illustration. Members of the design's org only; nothing is stored and no provider is called.
 */
export async function handleDesignPreview(req: Request, designId: string, deps: MediaHttpDeps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const q = previewQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return json({ error: "INVALID" }, 400);
  try {
    const d = await getDesign(deps.db, ctx, designId);
    if (!d.spec) return json({ error: "NOT_FOUND" }, 404);
    const assets = await brandAssetBytes(deps.db, deps.storage, ctx, d.brandId);
    const png = await renderPreview(d.spec, q.data.template, q.data.shape, assets);
    const small = await sharp(png).resize({ width: 540 }).png().toBuffer();
    // A design version never changes, so the browser may keep the picture (private: it is behind the session).
    return new Response(new Uint8Array(small), { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    if (e instanceof DesignError) return json({ error: e.code }, 404);
    throw e;
  }
}
