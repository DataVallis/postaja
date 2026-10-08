"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { addCompetitor, CompetitorError, keepCompetitor, removeCompetitor, requestFind } from "@/server/competitors/service";
import { decideLearning, deleteScreenshot, requestAnalyze, sendLearningsToCgp } from "@/server/competitors/analysis";
import { todayIn } from "@/lib/dates";
import { getStorage } from "@/server/files/storage";
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

// ---- Analysis (TASK-050) ----

export async function analyzeCompetitorsAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const brandId = str(f, "brandId");
  let error: string | undefined;
  await requestAnalyze(getDb(), bossQueue(await getBoss()), ctx, brandId).catch((e) => { error = code(e); });
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}

export async function deleteScreenshotAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await deleteScreenshot(getDb(), getStorage(), ctx, str(f, "itemId")).catch(() => undefined);
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
  redirect(back(str(f, "brandId")));
}

export async function decideLearningAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const d = str(f, "decision");
  await decideLearning(getDb(), ctx, str(f, "reportId"), str(f, "learningId"), d === "yes" || d === "no" ? d : null).catch(() => undefined);
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
  redirect(`/app/brands/${str(f, "brandId")}?tab=competitors&report=${str(f, "reportId")}#report`);
}

/** Owner: accepted learnings → pending CGP draft, reviewed on the profile tab. */
export async function sendLearningsAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const brandId = str(f, "brandId");
  let error: string | undefined;
  await sendLearningsToCgp(getDb(), ctx, str(f, "reportId"), todayIn()).catch((e) => { error = code(e); });
  revalidatePath(`/app/brands/${brandId}`);
  redirect(error ? back(brandId, error) : `/app/brands/${brandId}?tab=profile`);
}
