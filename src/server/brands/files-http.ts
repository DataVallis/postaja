// HTTP layer for brand files (TASK-005b part 2, ADR-033). Kept free of Next.js imports so integration tests can
// call it with real Requests: same-origin check, size check before reading the body, FileError → status.
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { brandFileUrl, FileError, MAX_BYTES, uploadBrandFile, type Slot } from "./files";

/** Multipart framing around the file (boundary, headers, name field). */
export const MULTIPART_OVERHEAD = 64 * 1024;

const STATUS: Record<FileError["code"], number> = {
  FORBIDDEN: 403, NOT_FOUND: 404, ARCHIVED: 409, EMPTY: 400, TOO_LARGE: 413, UNSUPPORTED_TYPE: 415,
  INVALID_FILE: 422, MISSING_GLYPHS: 422, DUPLICATE: 409, LIMIT_REACHED: 409,
};

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export type HttpDeps = { db: Db; storage: Storage; appOrigin: string; getCtx: () => Promise<OrgContext | null> };

/** Browsers always send Origin on POST; anything else than our own origin is refused (CSRF, on top of SameSite=Lax). */
function sameOrigin(req: Request, appOrigin: string) {
  return req.headers.get("origin") === appOrigin;
}

export async function handleUpload(req: Request, brandId: string, deps: HttpDeps): Promise<Response> {
  if (!sameOrigin(req, deps.appOrigin)) return json({ error: "BAD_ORIGIN" }, 403);
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const slot = new URL(req.url).searchParams.get("slot") as Slot | null;
  if (slot !== "logo" && slot !== "font" && slot !== "source") return json({ error: "BAD_SLOT" }, 400);
  // Refuse oversized bodies before buffering them; a missing length (chunked upload) is refused too.
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json({ error: "LENGTH_REQUIRED" }, 411);
  if (length > MAX_BYTES[slot] + MULTIPART_OVERHEAD) return json({ error: "TOO_LARGE" }, 413);

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json({ error: "BAD_FORM" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "BAD_FORM" }, 400);
  try {
    const r = await uploadBrandFile(deps.db, deps.storage, ctx, brandId, slot, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return json(r, 201);
  } catch (e) {
    if (e instanceof FileError) return json({ error: e.code, detail: e.detail }, STATUS[e.code]);
    throw e;
  }
}

/** Redirects a member of the file's org to a fresh presigned URL (5 min). Others get 404, anonymous 401. */
export async function handleDownload(table: string, id: string, deps: Omit<HttpDeps, "appOrigin">): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  if (table !== "source" && table !== "asset") return json({ error: "NOT_FOUND" }, 404);
  try {
    const url = await brandFileUrl(deps.db, deps.storage, ctx, table, id);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof FileError) return json({ error: e.code }, STATUS[e.code]);
    throw e;
  }
}
