"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { addCompetitor, CompetitorError, keepCompetitor, removeCompetitor, requestFind } from "@/server/competitors/service";
import { getDb } from "@/server/db/client";
import type { CompetitorPlatform } from "@/server/db/schema";
import { bossQueue, getBoss } from "@/server/jobs/boss";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (brandId: string, error?: string) => `/app/brands/${brandId}?tab=competitors${error ? `&competitorError=${error}` : ""}`;
const code = (e: unknown) => (e instanceof CompetitorError ? e.code : "FAILED");

/** "Najdi konkurente" (TASK-049): queued; the page refreshes until the run is done. */
export async function findCompetitorsAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const brandId = str(f, "brandId");
  let error: string | undefined;
  await requestFind(getDb(), bossQueue(await getBoss()), ctx, brandId, str(f, "hint")).catch((e) => { error = code(e); });
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}

export async function addCompetitorAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const brandId = str(f, "brandId");
  const platform = str(f, "platform") as CompetitorPlatform | "";
  const profile = str(f, "profile").trim();
  let error: string | undefined;
  await addCompetitor(getDb(), ctx, brandId, {
    name: str(f, "name"), website: str(f, "website"), reason: str(f, "reason"),
    handles: platform && profile ? [{ platform, url: profile }] : [],
  }).catch((e) => { error = code(e); });
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}

export async function keepCompetitorAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await keepCompetitor(getDb(), ctx, str(f, "id")).catch(() => undefined);
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
  redirect(back(str(f, "brandId")));
}

export async function removeCompetitorAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await removeCompetitor(getDb(), ctx, str(f, "id")).catch(() => undefined);
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
  redirect(back(str(f, "brandId")));
}
