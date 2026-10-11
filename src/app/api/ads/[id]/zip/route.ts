import { handleAdZip } from "@/server/ads/http";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** GET → the ad set as a ZIP: copy.csv and a folder per placement with its creatives (TASK-021b). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleAdZip(id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
