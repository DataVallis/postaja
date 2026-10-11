import type { NextRequest } from "next/server";
import { orgContextForAction } from "@/server/auth/require";
import { handleScreenshot } from "@/server/competitors/http";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** 302 to a short-lived link of a competitor screenshot, members of its org only (TASK-050). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleScreenshot(id, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
