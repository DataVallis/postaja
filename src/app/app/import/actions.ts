"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { PLAN_FIELDS, PLAN_PLATFORMS, type ColumnMapping, type PlanField, type PlanPlatform } from "@/server/plans/mapping";
import { confirmImport, discardImport, ImportError, importView, reopenImport, updateImport } from "@/server/plans/service";

const back = (id: string, error?: string) => redirect(`/app/import/${id}${error ? `?error=${error}` : ""}`);
const code = (e: unknown) => (e instanceof ImportError ? e.code : "FAILED");

/** Channels per platform/account and the schedule; with intent=confirm the posts are created right after. */
export async function saveImportAction(f: FormData) {
  const ctx = await orgContextForAction();
  const id = String(f.get("importId") ?? "");
  if (!ctx) redirect("/login");
  const channelMap: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith("ch:") && typeof v === "string" && v) channelMap[decodeURIComponent(k.slice(3))] = v;
  const start = String(f.get("startDate") ?? "").trim();
  const interval = String(f.get("intervalDays") ?? "").trim();
  let result: Awaited<ReturnType<typeof confirmImport>> | null = null;
  try {
    await updateImport(getDb(), ctx, id, {
      channelMap,
      ...(f.has("startDate") ? { startDate: start || null } : {}),
      ...(f.has("intervalDays") ? { intervalDays: interval ? Number(interval) : null } : {}),
    });
    if (f.get("intent") === "confirm") result = await confirmImport(getDb(), ctx, id);
  } catch (e) {
    back(id, code(e));
  }
  revalidatePath(`/app/import/${id}`);
  if (result) redirect(`/app/posts?import=${id}`);
  back(id);
}

/** The owner corrects what a column means; items are re-read from the stored table. */
export async function saveMappingAction(f: FormData) {
  const ctx = await orgContextForAction();
  const id = String(f.get("importId") ?? "");
  if (!ctx) redirect("/login");
  try {
    const v = await importView(getDb(), ctx, id);
    const mappings: ColumnMapping[] = ((v.import.mappings ?? []) as ColumnMapping[]).map((m, s) => {
      const platform = String(f.get(`platform:${s}`) ?? "");
      return {
        ...m,
        columns: m.columns.map((c, i) => {
          const val = String(f.get(`col:${s}:${i}`) ?? c);
          return (PLAN_FIELDS as readonly string[]).includes(val) ? (val as PlanField) : c;
        }),
        defaultPlatform: (PLAN_PLATFORMS as readonly string[]).includes(platform) ? (platform as PlanPlatform) : null,
      };
    });
    await updateImport(getDb(), ctx, id, { mappings });
  } catch (e) {
    back(id, code(e));
  }
  revalidatePath(`/app/import/${id}`);
  back(id);
}

export async function discardImportAction(f: FormData) {
  const ctx = await orgContextForAction();
  const id = String(f.get("importId") ?? "");
  if (!ctx) redirect("/login");
  try {
    await discardImport(getDb(), ctx, id);
  } catch (e) {
    back(id, code(e));
  }
  redirect("/app/import");
}

/** Opens an imported plan again to import the rows that had no channel then (duplicates are skipped). */
export async function reopenImportAction(f: FormData) {
  const ctx = await orgContextForAction();
  const id = String(f.get("importId") ?? "");
  if (!ctx) redirect("/login");
  try {
    await reopenImport(getDb(), ctx, id);
  } catch (e) {
    back(id, code(e));
  }
  revalidatePath(`/app/import/${id}`);
  back(id);
}
