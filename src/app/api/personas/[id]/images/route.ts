import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { handlePassportUpload } from "@/server/personas/http";

export const dynamic = "force-dynamic";

/** POST multipart (`file`, optional `angle`) — one passport picture of the persona, brand owner only (TASK-024). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const appOrigin = new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;
  return handlePassportUpload(req, id, { db: getDb(), storage: getStorage(), appOrigin, getCtx: orgContextForAction });
}
