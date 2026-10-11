import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { handleScreenshotUpload } from "@/server/competitors/http";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** POST multipart (`file`) — one screenshot of a competitor's post or ad, any member of the org (TASK-050). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const appOrigin = new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;
  return handleScreenshotUpload(req, id, { db: getDb(), storage: getStorage(), appOrigin, getCtx: orgContextForAction });
}
