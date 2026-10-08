import { getDb } from "@/server/db/client";
import { demoMediaUrl } from "@/server/demos/service";
import { getStorage } from "@/server/files/storage";

export const dynamic = "force-dynamic";

/** A picture of a demo (TASK-040): 302 to a short-lived URL while the link works, else 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  try {
    const url = await demoMediaUrl(getDb(), getStorage(), token, id);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
