import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { handleMedia } from "@/server/images/http";

export const dynamic = "force-dynamic";

/** GET → 302 to a 5-minute presigned URL of a post image, only for members of its organization (ADR-043). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleMedia(req, id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
