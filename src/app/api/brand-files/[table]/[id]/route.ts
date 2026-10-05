import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { handleDownload } from "@/server/brands/files-http";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** GET → 302 to a 5-minute presigned URL, only for members of the file's organization (ADR-033). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await ctx.params;
  return handleDownload(table, id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
