"use server";
import { revalidatePath } from "next/cache";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { createApprovalLink, ReviewError, revokeApprovalLink } from "@/server/reviews/service";

export type LinkState = { url?: string; error?: string };

const appOrigin = () => new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;

/** "Ustvari povezavo" (TASK-041): the link is returned once, to be copied; only its hash is stored. */
export async function createApprovalLinkAction(_prev: LinkState, f: FormData): Promise<LinkState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "FAILED" };
  const brandId = String(f.get("brandId") ?? "");
  try {
    const { token } = await createApprovalLink(getDb(), ctx, brandId, { label: String(f.get("label") ?? ""), from: String(f.get("from") ?? ""), to: String(f.get("to") ?? "") });
    revalidatePath(`/app/brands/${brandId}`);
    return { url: `${appOrigin()}/r/${token}` };
  } catch (e) {
    return { error: e instanceof ReviewError ? e.code : "FAILED" };
  }
}

export async function revokeApprovalLinkAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  await revokeApprovalLink(getDb(), ctx, String(f.get("id") ?? "")).catch(() => undefined);
  revalidatePath(`/app/brands/${String(f.get("brandId") ?? "")}`);
}
