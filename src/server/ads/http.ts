// HTTP for ad creatives (TASK-021b): one image (302 to a short presigned URL) and the ad set's ZIP. Members of the
// ad set's organization only; everything is looked up through the org's rows.
import type { Db } from "../db/client";
import { contentDisposition, type Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { adMediaUrl, adZip } from "./creatives";
import { AdError } from "./service";

type Deps = { db: Db; storage: Storage; getCtx: () => Promise<OrgContext | null> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function handleAdMedia(req: Request, mediaId: string, deps: Deps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const url = await adMediaUrl(deps.db, deps.storage, ctx, mediaId, new URL(req.url).searchParams.get("download") === "1");
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof AdError) return json({ error: e.code }, 404);
    throw e;
  }
}

export async function handleAdZip(adSetId: string, deps: Deps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const { filename, stream } = await adZip(deps.db, deps.storage, ctx, adSetId);
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition(filename, false), "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AdError) return json({ error: e.detail ?? e.code }, e.code === "NOT_FOUND" ? 404 : 409);
    throw e;
  }
}
