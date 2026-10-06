// HTTP entry for plan uploads (TASK-012). Same checks as brand uploads: same origin, signed in, size from the header
// before the body is read. Kept free of Next.js imports so integration tests can call it with real Requests.
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { LlmClient } from "../llm/types";
import type { OrgContext } from "../tenancy/context";
import { IMPORT_MAX_BYTES, ImportError, startImport } from "./service";

const MULTIPART_OVERHEAD = 64 * 1024;
const STATUS: Record<ImportError["code"], number> = {
  NOT_FOUND: 404, EMPTY: 400, TOO_LARGE: 413, UNSUPPORTED_TYPE: 415, INVALID_FILE: 422, NO_POSTS: 422, BAD_STATE: 409,
  INVALID: 400, AI_FAILED: 502, SPEND_CAP: 402, NO_MODEL: 503, PLATFORM_MISMATCH: 422,
};
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export type ImportHttpDeps = { db: Db; storage: Storage; llm: LlmClient; appOrigin: string; getCtx: () => Promise<OrgContext | null> };

export async function handleImportUpload(req: Request, deps: ImportHttpDeps): Promise<Response> {
  if (req.headers.get("origin") !== deps.appOrigin) return json({ error: "BAD_ORIGIN" }, 403);
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json({ error: "LENGTH_REQUIRED" }, 411);
  if (length > IMPORT_MAX_BYTES + MULTIPART_OVERHEAD) return json({ error: "TOO_LARGE" }, 413);
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json({ error: "BAD_FORM" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "BAD_FORM" }, 400);
  try {
    const id = await startImport(deps.db, { llm: deps.llm, storage: deps.storage }, ctx, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return json({ id }, 201);
  } catch (e) {
    if (e instanceof ImportError) return json({ error: e.code, detail: e.detail }, STATUS[e.code]);
    throw e;
  }
}
