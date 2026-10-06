import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { handlePreview } from "@/server/images/http";

export const dynamic = "force-dynamic";

/** GET → PNG preview of the brand's image template with the query's unsaved changes (TASK-015). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePreview(req, id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
