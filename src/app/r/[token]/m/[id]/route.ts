import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { clientMediaUrl } from "@/server/reviews/service";

export const dynamic = "force-dynamic";

/** An image or video of a post the client link covers (TASK-041): 302 to a short-lived URL, else 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  try {
    const url = await clientMediaUrl(getDb(), getStorage(), token, id);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
