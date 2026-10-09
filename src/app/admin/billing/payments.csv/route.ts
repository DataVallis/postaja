import { requireSuperadmin } from "@/server/admin/guard";
import { paymentsCsv } from "@/server/billing/service";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Payments for invoicing as CSV (ADR-075); ?open=1 = only those without an invoice number. Super admins only. */
export async function GET(req: Request) {
  const actor = await requireSuperadmin();
  const open = new URL(req.url).searchParams.get("open") === "1";
  const csv = await paymentsCsv(getDb(), actor, { open });
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="postaja-placila${open ? "-za-racun" : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
