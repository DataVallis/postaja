import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { handleDayZip } from "@/server/download/http";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** GET ?date=YYYY-MM-DD[&brand=<id>] → ZIP of the day's posts with pregled.csv (TASK-016). */
export async function GET(req: Request) {
  return handleDayZip(req, { db: getDb(), storage: getStorage(), getCtx: orgContextForAction });
}
