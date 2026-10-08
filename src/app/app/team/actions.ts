"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { createMailerFromEnv } from "@/server/email/mailer";
import { cancelInvitation, inviteToTeam, removeMember, setMemberRole, TeamError } from "@/server/orgs/team";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (q = "") => `/app/team${q}`;

async function run(fn: () => Promise<unknown>, ok: string) {
  let q = `?ok=${ok}`;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof TeamError)) console.error("team action failed", e);
    q = `?error=${e instanceof TeamError ? e.code : "FAILED"}`;
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
