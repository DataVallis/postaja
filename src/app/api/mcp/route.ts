import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { createMcpHttpHandler } from "@/server/mcp/http";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

let handler: ((req: Request) => Promise<Response>) | undefined;
/** MCP endpoint for Claude (ADR-038): bearer token verified by Better Auth, org re-resolved per request. */
async function handle(request: Request) {
  handler ??= createMcpHttpHandler(getAuth(), { db: getDb(), storage: getStorage(), appUrl: appUrl() });
  return handler(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
