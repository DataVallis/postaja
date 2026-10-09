"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/server/admin/guard";
import { setInvoiceNumber } from "@/server/billing/service";
import { ensureStripeCatalog, getStripe } from "@/server/billing/stripe";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

/** "Pripravi cenik v Stripe" (TASK-036): creates the products and prices that are missing (by lookup key). */
export async function ensureCatalogAction() {
  const actor = await requireSuperadmin();
  const stripe = getStripe();
  if (!stripe) redirect("/admin/billing?error=NOT_CONFIGURED");
  let q: string;
  try {
    const r = await ensureStripeCatalog(stripe);
    await getDb().insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: actor.userId, orgId: null, action: "billing.catalog", target: null, meta: { created: r.created } });
    q = `created=${r.created.length}`;
  } catch (e) {
    console.error("[stripe] catalog failed", e instanceof Error ? e.message.slice(0, 200) : "error");
    q = "error=STRIPE";
  }
  revalidatePath("/admin/billing");
  redirect(`/admin/billing?${q}`);
}

/** The number of the invoice the owner issued for a payment (ADR-075); empty clears it. */
export async function setInvoiceNumberAction(f: FormData) {
  const actor = await requireSuperadmin();
  let q = "invoice=saved";
  try {
    await setInvoiceNumber(getDb(), actor, String(f.get("id") ?? ""), String(f.get("number") ?? ""));
  } catch {
    q = "error=STRIPE";
  }
  revalidatePath("/admin/billing");
  redirect(`/admin/billing?${q}${f.get("all") === "1" ? "&all=1" : ""}#payments-h`);
}
