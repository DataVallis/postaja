"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { acceptIdeas, discardIdeas, IdeaError, suggestIdeas } from "@/server/ideas/service";
import { createAnthropicClient } from "@/server/llm/anthropic";

const code = (e: unknown) => (e instanceof IdeaError ? e.code : "FAILED");

/** "Predlagaj ideje" on the brand page: one Claude call (plus replacements for repeats), then the review page. */
export async function suggestIdeasAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const brandId = String(f.get("brandId") ?? "");
  let id: string;
  try {
    id = await suggestIdeas(getDb(), { llm: createAnthropicClient() }, ctx, {
      brandId, channelId: String(f.get("channelId") ?? ""), count: Number(f.get("count") ?? 10),
      from: String(f.get("from") ?? "") || undefined, hint: String(f.get("hint") ?? ""),
    });
  } catch (e) {
    if (!(e instanceof IdeaError)) console.error("suggestIdeas failed", e);
    else if (e.detail) console.warn("suggestIdeas", e.code, e.detail);
    redirect(`/app/brands/${brandId}?tab=posts&ideaError=${code(e)}#ideas`);
  }
  redirect(`/app/ideas/${id}`);
}

/** The ticked ideas (with their days) become planned posts. */
export async function acceptIdeasAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("runId") ?? "");
  const picks = f.getAll("pick").map((v) => Number(v)).filter((n) => Number.isInteger(n))
    .map((index) => ({ index, date: String(f.get(`date-${index}`) ?? "") || null }));
  let brandId = "";
  try {
    if (!picks.length) throw new IdeaError("INVALID");
    await acceptIdeas(getDb(), ctx, id, picks);
    brandId = String(f.get("brandId") ?? "");
  } catch (e) {
    redirect(`/app/ideas/${id}?error=${code(e)}`);
  }
  revalidatePath("/app/plan");
  redirect(`/app/plan?brand=${brandId}`);
}

export async function discardIdeasAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const id = String(f.get("runId") ?? "");
  await discardIdeas(getDb(), ctx, id).catch(() => undefined);
  redirect(`/app/brands/${String(f.get("brandId") ?? "")}?tab=posts`);
}
