import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { handleUpload } from "@/server/brands/files-http";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** POST multipart (field `file`) with ?slot=logo|font|source — brand owner only (ADR-033). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const appOrigin = new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;
  return handleUpload(req, id, { db: getDb(), storage: getStorage(), appOrigin, getCtx: orgContextForAction });
}
