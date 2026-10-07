import type { NextRequest } from "next/server";
import { handleAdMedia } from "@/server/ads/http";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** GET → 302 to a short-lived URL of one ad creative (TASK-021b), members of its organization only. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleAdMedia(req, id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
