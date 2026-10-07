// HTTP layer for downloads (TASK-016). Free of Next.js imports for integration tests.
import type { Db } from "../db/client";
import { contentDisposition, type Storage } from "../files/storage";
import { zipStream } from "../files/zip-writer";
import type { OrgContext } from "../tenancy/context";
import { dayArchive, DownloadError, postArchive } from "./service";

export type DownloadDeps = { db: Db; storage: Storage; getCtx: () => Promise<OrgContext | null> };
const STATUS: Record<DownloadError["code"], number> = { NOT_FOUND: 404, INVALID: 400, TOO_MANY: 413, EMPTY: 404 };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function send(deps: DownloadDeps, make: (ctx: OrgContext) => Promise<{ filename: string; entries: Parameters<typeof zipStream>[0] }>) {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const a = await make(ctx);
    return new Response(zipStream(a.entries), {
      status: 200,
      headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition(a.filename, false), "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof DownloadError) return json({ error: e.code }, STATUS[e.code]);
    throw e;
  }
}

export const handlePostZip = (postId: string, deps: DownloadDeps) => send(deps, (ctx) => postArchive(deps.db, deps.storage, ctx, postId));

export function handleDayZip(req: Request, deps: DownloadDeps) {
  const q = new URL(req.url).searchParams;
  return send(deps, (ctx) => dayArchive(deps.db, deps.storage, ctx, q.get("date") ?? "", q.get("brand") || null));
}
