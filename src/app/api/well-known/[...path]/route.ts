import { getAuth } from "@/server/auth/auth";
import { wellKnown } from "@/server/mcp/well-known";

export const dynamic = "force-dynamic";

/** /.well-known/* is rewritten here (next.config.ts): the app router does not build dot-folders. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  url.pathname = `/.well-known/${path.map(encodeURIComponent).join("/")}`;
  return wellKnown(getAuth(), new Request(url, { headers: req.headers }));
}
