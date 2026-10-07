import { AdError, adCopyCsv } from "@/server/ads/service";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** GET → the ad set's copy.csv (one row per network × placement × variant), for the ad managers' bulk upload. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const org = await orgContextForAction();
  if (!org) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { filename, csv } = await adCopyCsv(getDb(), org, id);
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AdError && e.code === "NOT_FOUND") return new Response("Not found", { status: 404 });
    throw e;
  }
}
