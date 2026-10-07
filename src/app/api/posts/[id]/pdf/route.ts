import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { handlePostPdf } from "@/server/download/http";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** GET → the post's images as one PDF, a LinkedIn document carousel (TASK-018). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePostPdf(id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
