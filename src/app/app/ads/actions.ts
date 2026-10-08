"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteCreativeVersion, requestAdImages, restoreCreativeVersion, setAdPartnerLogo, setAdSlides } from "@/server/ads/creatives";
import { AdError, createAdSet, deleteCopyVersion, restoreCopyVersion, saveAdCopy, writeAdCopy } from "@/server/ads/service";
import { bossQueue, getBoss } from "@/server/jobs/boss";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { createAnthropicClient } from "@/server/llm/anthropic";

const code = (e: unknown) => (e instanceof AdError ? e.code : "FAILED");

/** "Ustvari oglas" on the brand's Oglasi tab: the ad set and its copy (one Claude call, plus a fix round). */
export async function createAdSetAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const brandId = String(f.get("brandId") ?? "");
  let id: string;
  try {
    id = await createAdSet(getDb(), { llm: createAnthropicClient() }, ctx, {
      brandId,
      name: String(f.get("name") ?? ""),
      objective: String(f.get("objective") ?? "traffic") as "traffic",
      networks: f.getAll("networks").map(String) as "meta"[],
      placements: f.getAll("placements").map(String),
      offer: String(f.get("offer") ?? ""),
      landingUrl: String(f.get("landingUrl") ?? "") || undefined,
      brief: String(f.get("brief") ?? ""),
      language: String(f.get("language") ?? "") || undefined,
    });
  } catch (e) {
    if (!(e instanceof AdError)) console.error("createAdSet failed", e);
    redirect(`/app/brands/${brandId}?tab=ads&adError=${code(e)}`);
  }
  redirect(`/app/ads/${id}`);
}

/** "Napiši znova": new copy for the same concept. */
export async function rewriteAdCopyAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  try {
    await writeAdCopy(getDb(), { llm: createAnthropicClient() }, ctx, id);
  } catch (e) {
    redirect(`/app/ads/${id}?error=${code(e)}`);
  }
  revalidatePath(`/app/ads/${id}`);
  redirect(`/app/ads/${id}`);
}

/** Edited copy: fields named `v<variant>.<network>.<field>`; multi-text fields one text per line. */
export async function saveAdCopyAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  const copy: Record<string, Record<string, string | string[]>>[] = [];
  for (const [k, v] of f.entries()) {
    const m = k.match(/^v(\d)\.([a-z_]+)\.([a-z_]+)$/);
    if (!m || typeof v !== "string") continue;
    const [, vi, net, field] = m;
    const variant = (copy[Number(vi)] ??= {});
    (variant[net] ??= {})[field] = f.get(`multi.${field}`) ? v.split(/\r?\n/) : v;
  }
  try {
    await saveAdCopy(getDb(), ctx, id, Array.from(copy, (c) => c ?? {}));
  } catch (e) {
    redirect(`/app/ads/${id}?error=${code(e)}`);
  }
  revalidatePath(`/app/ads/${id}`);
  redirect(`/app/ads/${id}?saved=1`);
}

/** "Ustvari slike" / "Nove slike": the creatives for every placement, in the background. */
export async function requestAdImagesAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  let error: string | null = null;
  try {
    await requestAdImages(getDb(), bossQueue(await getBoss()), ctx, id, f.get("mode") === "text" ? "text" : "new");
  } catch (e) {
    error = e instanceof AdError ? (e.detail ?? e.code) : "FAILED";
  }
  revalidatePath(`/app/ads/${id}`);
  redirect(`/app/ads/${id}${error ? `?imageError=${error}` : ""}#creatives`);
}

/** Corrected words on the creatives (per variant and slot), redrawn on the same illustrations for free. */
/** "Logotip partnerja" (TASK-035): saved on the ad set; existing creatives are redrawn with it for free. */
export async function setAdPartnerLogoAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  let error: string | null = null;
  try {
    await setAdPartnerLogo(getDb(), bossQueue(await getBoss()), ctx, id, String(f.get("partnerLogoId") ?? "") || null);
  } catch (e) {
    error = e instanceof AdError ? (e.detail ?? e.code) : "FAILED";
  }
  revalidatePath(`/app/ads/${id}`);
  redirect(`/app/ads/${id}${error ? `?imageError=${error}` : ""}#creatives`);
}

export async function saveAdSlidesAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  const slides: Record<string, string>[] = [];
  for (const [k, v] of f.entries()) {
    const m = k.match(/^s(\d)\.([a-z]+)$/);
    if (m) (slides[Number(m[1])] ??= {})[m[2]] = String(v);
  }
  let error: string | null = null;
  try {
    await setAdSlides(getDb(), ctx, id, Array.from(slides, (s) => s ?? {}));
    await requestAdImages(getDb(), bossQueue(await getBoss()), ctx, id, "text");
  } catch (e) {
    error = e instanceof AdError ? (e.detail ?? e.code) : "INVALID";
  }
  revalidatePath(`/app/ads/${id}`);
  redirect(`/app/ads/${id}${error ? `?imageError=${error}` : ""}#creatives`);
}

const back = (id: string, hash: string, error?: string) => `/app/ads/${id}${error ? `?error=${error}` : ""}#${hash}`;

/** TASK-034: earlier ad copy / creatives — restore (the current one becomes a version) or delete on purpose. */
export async function restoreCopyVersionAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  let error: string | undefined;
  await restoreCopyVersion(getDb(), ctx, id, String(f.get("versionId") ?? "")).catch((e) => { error = code(e); });
  revalidatePath(`/app/ads/${id}`);
  redirect(back(id, "ad-copy", error));
}

export async function deleteCopyVersionAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  await deleteCopyVersion(getDb(), ctx, id, String(f.get("versionId") ?? "")).catch(() => undefined);
  revalidatePath(`/app/ads/${id}`);
  redirect(back(id, "ad-copy"));
}

export async function restoreCreativeVersionAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  let error: string | undefined;
  await restoreCreativeVersion(getDb(), ctx, id, String(f.get("versionId") ?? "")).catch((e) => { error = code(e); });
  revalidatePath(`/app/ads/${id}`);
  redirect(back(id, "creatives", error));
}

export async function deleteCreativeVersionAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("adSetId") ?? "");
  await deleteCreativeVersion(getDb(), getStorage(), ctx, id, String(f.get("versionId") ?? "")).catch(() => undefined);
  revalidatePath(`/app/ads/${id}`);
  redirect(back(id, "creatives"));
}
