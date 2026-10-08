"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { usdToMicro } from "@/lib/money/usd";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { PLANS } from "@/server/db/schema";
import { createMailerFromEnv } from "@/server/email/mailer";
import { createOrganization, inviteMember, updateOrgSettings } from "@/server/orgs/service";

export type ActionState = { error?: string; ok?: string } | undefined;

const deps = () => ({
  mailer: createMailerFromEnv(),
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "",
});

function errorCode(e: unknown): string {
  if (e instanceof z.ZodError) return "invalid";
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("duplicate key") || msg.includes("unique")) return "duplicate";
  if (msg === "INVALID_AMOUNT" || msg === "AMOUNT_TOO_LARGE") return "amount";
  return "failed";
}

export async function createOrgAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireSuperadmin();
  let orgId: string;
  try {
    const cap = String(form.get("spendCapUsd") ?? "").trim();
    const r = await createOrganization(getDb(), deps(), actor, {
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      plan: String(form.get("plan") ?? "") as (typeof PLANS)[number],
      ownerEmail: String(form.get("ownerEmail") ?? ""),
      ...(cap ? { spendCapMicroUsd: usdToMicro(cap) } : {}),
    });
    orgId = r.orgId;
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath("/admin");
  redirect(`/admin/orgs/${orgId}`);
}

export async function updateSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireSuperadmin();
  const orgId = String(form.get("orgId") ?? "");
  try {
    await updateOrgSettings(getDb(), actor, orgId, {
      plan: z.enum(PLANS).parse(form.get("plan")),
      status: z.enum(["active", "suspended"]).parse(form.get("status")),
      spendCapMicroUsd: usdToMicro(String(form.get("spendCapUsd") ?? "")),
      // Empty = unlimited (TASK-028).
      limits: Object.fromEntries(([["brands", "limitBrands"], ["members", "limitMembers"], ["generationsPerMonth", "limitGenerations"], ["creditsPerMonth", "limitCredits"]] as const)
        .map(([k, f]) => [k, String(form.get(f) ?? "").trim()])
        .filter(([, v]) => v !== "")
        .map(([k, v]) => [k, z.coerce.number().int().parse(v)])),
    });
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath(`/admin/orgs/${orgId}`);
  revalidatePath("/admin");
  return { ok: "saved" };
}

export async function inviteMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireSuperadmin();
  const orgId = String(form.get("orgId") ?? "");
  try {
    const r = await inviteMember(getDb(), deps(), actor, orgId, {
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "") as "owner" | "editor",
    });
    revalidatePath(`/admin/orgs/${orgId}`);
    return { ok: r.status };
  } catch (e) {
    return { error: errorCode(e) };
  }
}
