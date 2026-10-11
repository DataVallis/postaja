"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/server/admin/guard";
import { CreditError, grantCredits, resolveCreditRequest, setCreditPrices } from "@/server/credits/service";
import { getDb } from "@/server/db/client";
import { CREDIT_ACTIONS } from "@/server/db/schema";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const code = (e: unknown) => (e instanceof CreditError ? e.code : "FAILED");
const back = (q: string) => { revalidatePath("/admin/credits"); revalidatePath("/admin"); redirect(`/admin/credits?${q}`); };

/** Credit prices (TASK-038): one number per action; only changes are saved and audited. */
export async function savePricesAction(f: FormData) {
  const actor = await requireSuperadmin();
  let q = "ok=prices";
  try {
    await setCreditPrices(getDb(), actor, Object.fromEntries(CREDIT_ACTIONS.map((a) => [a, Number(str(f, a) || "NaN")])));
  } catch (e) {
    q = `error=${code(e)}`;
  }
  back(q);
}

/** A pack for an organization (gift or correction): credits, months valid, note. */
export async function grantAction(f: FormData) {
  const actor = await requireSuperadmin();
  let q = "ok=granted";
  try {
    await grantCredits(getDb(), actor, str(f, "orgId"), { credits: Number(str(f, "credits")), months: Number(str(f, "months") || "12"), note: str(f, "note") });
  } catch (e) {
    q = `error=${code(e)}`;
  }
  back(q);
}

/** An owner's "Kupi kredite": grant once paid, or decline. */
export async function resolveRequestAction(f: FormData) {
  const actor = await requireSuperadmin();
  const decision = str(f, "decision") === "grant" ? "grant" : "decline";
  let q = `ok=${decision === "grant" ? "granted" : "declined"}`;
  try {
    await resolveCreditRequest(getDb(), actor, str(f, "id"), decision);
  } catch (e) {
    q = `error=${code(e)}`;
  }
  back(q);
}
