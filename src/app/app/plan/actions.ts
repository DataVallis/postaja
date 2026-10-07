"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { BulkError, cancelBulk, startBulk } from "@/server/bulk/service";
import { getDb } from "@/server/db/client";
import { bossQueue, getBoss } from "@/server/jobs/boss";
import { scopeFrom, stepsFrom } from "./scope";

/** Starts a bulk run (TASK-014/015) after the cost preview: a day, a brand's next N days or a whole imported plan; texts, images or both. */
export async function startBulkAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const field = (k: string) => String(f.get(k) ?? "") || undefined;
  const back = String(f.get("back") ?? "/app/plan");
  let runId: string;
  try {
    const scope = scopeFrom({ kind: field("kind"), date: field("date"), brandId: field("brandId"), days: field("days"), importId: field("importId") });
    const steps = stepsFrom(field("steps"));
    runId = await startBulk(getDb(), bossQueue(await getBoss()), ctx, scope, steps);
  } catch (e) {
    const code = e instanceof BulkError ? e.code : "FAILED";
    redirect(`${back}${back.includes("?") ? "&" : "?"}bulkError=${code}`);
  }
  revalidatePath("/app/plan");
  redirect(`/app/plan?tab=runs&run=${runId}`);
}

export async function cancelBulkAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await cancelBulk(getDb(), ctx, String(f.get("runId") ?? "")).catch(() => undefined);
  revalidatePath("/app/plan");
  redirect("/app/plan?tab=runs");
}
