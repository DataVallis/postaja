"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import { DemoError, demoBrandFor, newDemoLink, revokeDemoLink, startDemo } from "@/server/demos/service";
import { bossQueue, getBoss } from "@/server/jobs/boss";

export type DemoState = { url?: string; error?: string };

const appOrigin = () => new URL(process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").origin;
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

/** "Ustvari demo" (TASK-040): queued; the share link is returned once, to be copied (only its hash is stored). */
export async function startDemoAction(_prev: DemoState, f: FormData): Promise<DemoState> {
  const actor = await requireSuperadmin();
  try {
    const { token } = await startDemo(getDb(), bossQueue(await getBoss()), actor, { url: str(f, "url"), name: str(f, "name"), text: str(f, "text") });
    revalidatePath("/admin/demos");
    return { url: `${appOrigin()}/d/${token}` };
  } catch (e) {
    return { error: e instanceof DemoError ? e.code : "FAILED" };
  }
}

/** "Nova povezava": a new link for 14 more days; the old one stops working. */
export async function newDemoLinkAction(_prev: DemoState, f: FormData): Promise<DemoState> {
  const actor = await requireSuperadmin();
  try {
    const { token } = await newDemoLink(getDb(), actor, str(f, "id"));
    revalidatePath("/admin/demos");
    return { url: `${appOrigin()}/d/${token}` };
  } catch (e) {
    return { error: e instanceof DemoError ? e.code : "FAILED" };
  }
}

export async function revokeDemoLinkAction(f: FormData): Promise<void> {
  const actor = await requireSuperadmin();
  await revokeDemoLink(getDb(), actor, str(f, "id")).catch(() => undefined);
  revalidatePath("/admin/demos");
}

/** "Odpri brand": switches the super admin to the sales organization and opens the demo brand to refine it. */
export async function openDemoBrandAction(f: FormData): Promise<void> {
  const actor = await requireSuperadmin();
  const target = await demoBrandFor(getDb(), actor, str(f, "id")).catch(() => null);
  if (!target) redirect("/admin/demos");
  await getAuth().api.setActiveOrganization({ headers: await headers(), body: { organizationId: target.orgId } });
  redirect(`/app/brands/${target.brandId}`);
}
