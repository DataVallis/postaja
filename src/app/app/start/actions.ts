"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { SignupError, startTrial } from "@/server/signup/service";

/** /app/start (TASK-037): the person confirms; the trial organization is created and they land on the dashboard. */
export async function startTrialAction(f: FormData) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  let error: string | null = null;
  try {
    await startTrial(getDb(), { userId: u.id, email: u.email }, String(f.get("orgName") ?? ""));
  } catch (e) {
    if (!(e instanceof SignupError)) console.error("start trial failed", e instanceof Error ? e.message.slice(0, 200) : "error");
    error = e instanceof SignupError ? e.code : "FAILED";
  }
  if (error === "HAS_ORG") redirect("/app");
  if (error) redirect(`/app/start?error=${error}`);
  revalidatePath("/app", "layout");
  redirect("/app");
}
