// HTTP layer for brand files (TASK-005b part 2, ADR-033). Kept free of Next.js imports so integration tests can
// call it with real Requests: same-origin check, size check before reading the body, FileError → status.
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { brandFileUrl, CGP_IMPORT_MAX_BYTES, CgpImportError, cgpTextFromDocument, FileError, MAX_BYTES, MAX_ZIP_BYTES, uploadAuto, type Slot } from "./files";

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
  // No slot (or "auto") = sort each file (and each entry of a ZIP) automatically; a slot forces e.g. "this is the logo".
  const raw = new URL(req.url).searchParams.get("slot") ?? "auto";
  if (raw !== "auto" && raw !== "logo" && raw !== "font" && raw !== "source") return json({ error: "BAD_SLOT" }, 400);
  const slot = raw === "auto" ? undefined : (raw as Slot);
  const max = slot ? MAX_BYTES[slot] : Math.max(MAX_ZIP_BYTES, MAX_BYTES.source);
  // Refuse oversized bodies before buffering them; a missing length (chunked upload) is refused too.
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json({ error: "LENGTH_REQUIRED" }, 411);
  if (length > max + MULTIPART_OVERHEAD) return json({ error: "TOO_LARGE" }, 413);

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json({ error: "BAD_FORM" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "BAD_FORM" }, 400);
  try {
    const results = await uploadAuto(deps.db, deps.storage, ctx, brandId, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, slot);
    // Always one result per file. Status: 201 all stored; a single failed file keeps its specific status (415, 422, …);
    // a ZIP with mixed outcomes is 200 and the results say which entries failed.
    if (results.every((r) => r.ok)) return json({ results }, 201);
    const first = results[0];
    if (results.length === 1 && !first.ok) return json({ results }, STATUS[first.error as FileError["code"]] ?? 422);
    return json({ results }, 200);
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

const CGP_STATUS: Record<CgpImportError["code"], number> = {
  FORBIDDEN: 403, NOT_FOUND: 404, ARCHIVED: 409, TOO_LARGE: 413, UNSUPPORTED_TYPE: 415, INVALID_FILE: 422, NO_TEXT: 422, TOO_LONG: 422,
};

/** POST multipart with `file` (a document) or `sourceId` (an uploaded source) → `{ text, filename, kind }` (ADR-037). */
export async function handleCgpImport(req: Request, brandId: string, deps: HttpDeps): Promise<Response> {
  if (!sameOrigin(req, deps.appOrigin)) return json({ error: "BAD_ORIGIN" }, 403);
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json({ error: "LENGTH_REQUIRED" }, 411);
  if (length > CGP_IMPORT_MAX_BYTES + MULTIPART_OVERHEAD) return json({ error: "TOO_LARGE" }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "BAD_FORM" }, 400);
  }
  const file = form.get("file");
  const sourceId = form.get("sourceId");
  try {
    const from = file instanceof File
      ? { file: { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } }
      : typeof sourceId === "string" && sourceId ? { sourceId } : null;
    if (!from) return json({ error: "BAD_FORM" }, 400);
    return json(await cgpTextFromDocument(deps.db, deps.storage, ctx, brandId, from), 200);
  } catch (e) {
    if (e instanceof CgpImportError) return json({ error: e.code, detail: e.detail }, CGP_STATUS[e.code]);
    throw e;
  }
}
