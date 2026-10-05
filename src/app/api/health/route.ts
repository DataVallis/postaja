import { getDb } from "@/server/db/client";
import { checkHealth } from "@/server/health/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { code, body } = await checkHealth(getDb);
  return Response.json(body, { status: code, headers: { "Cache-Control": "no-store" } });
}
