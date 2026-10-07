// HTTP for persona passports (TASK-024): upload one picture (owner, same origin, size checked before the body is read)
// and show one picture (302 to a short presigned URL, members of the org). Free of Next.js imports for tests.
import { MULTIPART_OVERHEAD } from "../brands/files-http";
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { MAX_PASSPORT_BYTES, PersonaError, passportImageUrl, uploadPassportImage } from "./service";

type Deps = { db: Db; storage: Storage; getCtx: () => Promise<OrgContext | null> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const STATUS: Record<PersonaError["code"], number> = {
  FORBIDDEN: 403, NOT_FOUND: 404, ARCHIVED: 409, EXISTS: 409, INVALID: 400, INVALID_OUTPUT: 502, BAD_STATE: 409, LIMIT_REACHED: 409,
  DUPLICATE: 409, INVALID_FILE: 422, TOO_LARGE: 413, NOTHING_TO_DO: 409, NO_REF_MODEL: 409,
};

export async function handlePassportUpload(req: Request, personaId: string, deps: Deps & { appOrigin: string }): Promise<Response> {
  if (req.headers.get("origin") !== deps.appOrigin) return json({ error: "BAD_ORIGIN" }, 403);
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json({ error: "LENGTH_REQUIRED" }, 411);
  if (length > MAX_PASSPORT_BYTES + MULTIPART_OVERHEAD) return json({ error: "TOO_LARGE" }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "BAD_FORM" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "BAD_FORM" }, 400);
  try {
    const id = await uploadPassportImage(deps.db, deps.storage, ctx, personaId, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, String(form.get("angle") ?? "other"));
    return json({ id }, 201);
  } catch (e) {
    if (e instanceof PersonaError) return json({ error: e.code }, STATUS[e.code]);
    throw e;
  }
}

export async function handlePassportImage(req: Request, imageId: string, deps: Deps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const url = await passportImageUrl(deps.db, deps.storage, ctx, imageId, new URL(req.url).searchParams.get("download") === "1");
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof PersonaError) return json({ error: e.code }, 404);
    throw e;
  }
}
