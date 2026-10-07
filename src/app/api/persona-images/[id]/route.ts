import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { handlePassportImage } from "@/server/personas/http";

export const dynamic = "force-dynamic";

/** GET → 302 to a short-lived URL of one passport picture (TASK-024), members of its organization only. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePassportImage(req, id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
