// TASK-037: the first successful download is the last of the first steps; remembered once per organization.
import { orgContextForAction } from "../auth/require";
import { getDb } from "../db/client";
import { markDownload } from "./service";

export async function withDownloadMark(res: Response): Promise<Response> {
  if (res.ok) {
    const ctx = await orgContextForAction();
    if (ctx) await markDownload(getDb(), ctx.orgId).catch(() => undefined);
  }
  return res;
}
