import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { createAnthropicClient } from "@/server/llm/anthropic";
import { handleImportUpload } from "@/server/plans/http";
import { bossQueue, getBoss } from "@/server/jobs/boss";

export const dynamic = "force-dynamic";
// The request only checks and stores the file; the AI reads it in the background (ADR-078).
export const maxDuration = 60;

/** POST multipart `file` (XLSX, CSV, DOCX, PDF, MD, TXT) → `{ id }` of a draft plan import (TASK-012). */
export async function POST(req: Request) {
  const appOrigin = new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;
  return handleImportUpload(req, { db: getDb(), storage: getStorage(), llm: createAnthropicClient(), appOrigin, getCtx: orgContextForAction, queue: async () => bossQueue(await getBoss()) });
}
