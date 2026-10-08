"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { createMailerFromEnv } from "@/server/email/mailer";
import { CreditError, requestCredits } from "@/server/credits/service";
import { BillingError, checkoutUrl, portalUrl, type CheckoutItem } from "@/server/billing/service";
import { getStripe } from "@/server/billing/stripe";
import { cancelInvitation, inviteToTeam, removeMember, setMemberRole, TeamError } from "@/server/orgs/team";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (q = "") => `/app/team${q}`;

async function run(fn: () => Promise<unknown>, ok: string) {
  let q = `?ok=${ok}`;
  try {
    await fn();
  } catch (e) {
    const known = e instanceof TeamError || e instanceof CreditError;
    if (!known) console.error("team action failed", e);
    q = `?error=${known ? (e as TeamError | CreditError).code : "FAILED"}`;
  }
  revalidatePath("/app/team");
  redirect(back(q));
}

export async function inviteAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const deps = { mailer: createMailerFromEnv(), baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "" };
  await run(() => inviteToTeam(getDb(), deps, ctx, { email: str(f, "email"), role: str(f, "role") as "editor" }), "invited");
}

export async function cancelInvitationAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await run(() => cancelInvitation(getDb(), ctx, str(f, "invitationId")), "canceled");
}

export async function setRoleAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await run(() => setMemberRole(getDb(), ctx, str(f, "memberId"), str(f, "role")), "role");
}

export async function removeMemberAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await run(() => removeMember(getDb(), ctx, str(f, "memberId")), "removed");
}

/** "Kupi kredite" (TASK-038): a request for a pack; the super admin adds it once paid (until checkout, TASK-036). */
export async function requestCreditsAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  await run(() => requestCredits(getDb(), ctx, str(f, "pack")), "creditsRequested");
}

const appUrl = () => new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;

/** Plan, pilot or credit pack (TASK-036): to Stripe Checkout; errors come back to the team page. */
export async function checkoutAction(f: FormData) {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  const kind = str(f, "kind");
  const item: CheckoutItem = kind === "pilot" ? { kind: "pilot" } : kind === "pack" ? { kind: "pack", pack: str(f, "pack") as "small" } : { kind: "plan", plan: str(f, "plan") as "solo", interval: str(f, "interval") === "year" ? "year" : "month" };
  let url: string;
  try {
    url = await checkoutUrl(getDb(), getStripe(), ctx, item, appUrl());
  } catch (e) {
    if (!(e instanceof BillingError)) console.error("checkout failed", e instanceof Error ? e.message.slice(0, 200) : "error");
    redirect(back(`?error=${e instanceof BillingError ? e.code : "FAILED"}#billing-h`));
  }
  redirect(url);
}

/** "Upravljaj naročnino": Stripe's customer portal (card, invoices, plan change, cancel). */
export async function portalAction() {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  let url: string;
  try {
    url = await portalUrl(getDb(), getStripe(), ctx, appUrl());
  } catch (e) {
    redirect(back(`?error=${e instanceof BillingError ? e.code : "FAILED"}#billing-h`));
  }
  redirect(url);
}
