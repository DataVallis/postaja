import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { handleCgpImport } from "@/server/brands/files-http";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** POST `file` or `sourceId` → the document's text for the CGP editor; nothing is saved (ADR-037). Owner only. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const appOrigin = new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;
  return handleCgpImport(req, id, { db: getDb(), storage: getStorage(), appOrigin, getCtx: orgContextForAction });
}
