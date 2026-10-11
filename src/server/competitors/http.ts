// HTTP for competitor screenshots (TASK-050): upload (members, same origin, size checked before the body is read) and
// show (302 to a short presigned URL, members of the org). Free of Next.js imports for tests.
import { MULTIPART_OVERHEAD } from "../brands/files-http";
import type { Db } from "../db/client";
import type { Storage } from "../files/storage";
import type { OrgContext } from "../tenancy/context";
import { SCREENSHOT_MAX_BYTES, screenshotUrl, uploadScreenshot } from "./analysis";
import { CompetitorError } from "./service";

type Deps = { db: Db; storage: Storage; getCtx: () => Promise<OrgContext | null> };
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const STATUS: Partial<Record<CompetitorError["code"], number>> = { NOT_FOUND: 404, ARCHIVED: 409, TOO_LARGE: 413, INVALID_FILE: 422, LIMIT_REACHED: 409, FORBIDDEN: 403 };

export async function handleScreenshotUpload(req: Request, competitorId: string, deps: Deps & { appOrigin: string }): Promise<Response> {
  if (req.headers.get("origin") !== deps.appOrigin) return json({ error: "BAD_ORIGIN" }, 403);
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json({ error: "LENGTH_REQUIRED" }, 411);
  if (length > SCREENSHOT_MAX_BYTES + MULTIPART_OVERHEAD) return json({ error: "TOO_LARGE" }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "BAD_FORM" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "BAD_FORM" }, 400);
  try {
    const id = await uploadScreenshot(deps.db, deps.storage, ctx, competitorId, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return json({ id }, 201);
  } catch (e) {
    if (e instanceof CompetitorError) return json({ error: e.code }, STATUS[e.code] ?? 400);
    throw e;
  }
}

export async function handleScreenshot(itemId: string, deps: Deps): Promise<Response> {
  const ctx = await deps.getCtx();
  if (!ctx) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const url = await screenshotUrl(deps.db, deps.storage, ctx, itemId);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof CompetitorError) return json({ error: e.code }, 404);
    throw e;
  }
}
