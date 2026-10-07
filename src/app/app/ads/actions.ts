"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AdError, createAdSet, saveAdCopy, writeAdCopy } from "@/server/ads/service";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
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
