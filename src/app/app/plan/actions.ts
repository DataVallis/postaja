"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addDays, todayIn } from "@/lib/dates";
import { orgContextForAction } from "@/server/auth/require";
import { BulkError, cancelBulk, startBulk } from "@/server/bulk/service";
import { getDb } from "@/server/db/client";
import { bossQueue, getBoss } from "@/server/jobs/boss";

/** Starts a bulk run (TASK-014): a day (all brands or one) or a brand's next N days. Lands on the progress tab. */
export async function startBulkAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const kind = String(f.get("kind") ?? "");
  const brandId = String(f.get("brandId") ?? "") || null;
  const back = String(f.get("back") ?? "/app/plan");
  let runId: string;
  try {
    const scope =
      kind === "brand"
        ? (() => {
            const days = String(f.get("days") ?? "7");
            const from = todayIn();
            return { kind: "brand" as const, brandId: brandId ?? "", from, to: days === "all" ? null : addDays(from, Math.min(Math.max(Number(days) || 7, 1), 366) - 1) };
          })()
        : { kind: "day" as const, date: String(f.get("date") ?? ""), brandId };
    runId = await startBulk(getDb(), bossQueue(await getBoss()), ctx, scope);
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
