import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { handlePostZip } from "@/server/download/http";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** GET → ZIP of one post: text, first comment, images (TASK-016). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handlePostZip(id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
