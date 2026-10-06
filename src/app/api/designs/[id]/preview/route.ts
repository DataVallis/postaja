import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { handleDesignPreview } from "@/server/images/http";

export const dynamic = "force-dynamic";

/** GET ?template=<id>&shape=portrait|square|landscape → PNG preview of a brand design template (TASK-017). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleDesignPreview(req, id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
