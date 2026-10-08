import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { ImageJobError } from "@/server/images/service";
import { postVideoUrl } from "@/server/video/media";

export const dynamic = "force-dynamic";

/** GET → 302 to a short-lived URL of a post's video (`?poster=1`: its first frame; `?download=1`), members only (TASK-032). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const org = await orgContextForAction();
  if (!org) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const q = new URL(req.url).searchParams;
  try {
    const url = await postVideoUrl(getDb(), getStorage(), org, id, { download: q.get("download") === "1", poster: q.get("poster") === "1" });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof ImageJobError) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    throw e;
  }
}
