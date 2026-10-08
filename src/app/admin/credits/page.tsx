import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, Card, inputClass, selectClass } from "@/components/ui";
import { requireSuperadmin } from "@/server/admin/guard";
import { listOrganizations } from "@/server/admin/queries";
import { listCreditPrices, pendingCreditRequests } from "@/server/credits/service";
import { getDb } from "@/server/db/client";
import { CREDIT_PACKS } from "@/server/db/schema";
import { grantAction, resolveRequestAction, savePricesAction } from "./actions";

export const dynamic = "force-dynamic";

/** Credits (TASK-038, ADR-071): prices per action, open purchase requests, packs for an organization. */
export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actor = await requireSuperadmin();
  const sp = await searchParams;
  const t = await getTranslations("Admin.credits");
  const f = await getFormatter();
  const db = getDb();
  const [prices, pending, orgs] = await Promise.all([listCreditPrices(db), pendingCreditRequests(db, actor), listOrganizations(db)]);
  return (
    <div className="grid max-w-4xl gap-8">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("intro")}</p>
      </div>
      {sp.ok ? <p role="status" className="text-sm text-signal">{t(`ok.${sp.ok}` as "ok.prices")}</p> : null}
      {sp.error ? <p role="alert" className="text-sm text-danger">{t.has(`errors.${sp.error}`) ? t(`errors.${sp.error}`) : t("errors.FAILED")}</p> : null}

      <section aria-labelledby="requests-h" className="grid gap-3">
        <h2 id="requests-h" className="text-lg font-semibold">{t("requests")}</h2>
        {pending.length === 0 ? <p className="text-sm text-muted">{t("noRequests")}</p> : (
          <div className="grid gap-2" data-testid="credit-requests">
            {pending.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-semibold">{r.orgName} · {t("pack", { credits: CREDIT_PACKS[r.pack].credits.toLocaleString("sl-SI"), price: CREDIT_PACKS[r.pack].priceEur })}</p>
                  <p className="text-xs text-muted">{r.email ?? ""} · {f.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</p>
                </div>
                <form action={resolveRequestAction} className="flex gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" name="decision" value="grant" className={buttonClass("primary", "sm")}>{t("grantPaid")}</button>
                  <button type="submit" name="decision" value="decline" className={buttonClass("ghost", "sm")}>{t("decline")}</button>
                </form>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="prices-h" className="grid gap-3">
        <h2 id="prices-h" className="text-lg font-semibold">{t("prices")}</h2>
        <form action={savePricesAction} className="grid gap-3" data-testid="credit-prices">
          <div className="grid gap-3 sm:grid-cols-2">
            {prices.map((p) => (
              <label key={p.action} className="grid grid-cols-[1fr_6rem] items-center gap-3 text-sm">
                <span>{t(`actions.${p.action}`)}</span>
                <input name={p.action} type="number" min={0} max={10000} step={1} required defaultValue={p.credits} className={inputClass} />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">{t("pricesHint")}</p>
          <div><button type="submit" className={buttonClass("primary")}>{t("savePrices")}</button></div>
        </form>
      </section>

      <section aria-labelledby="grant-h" className="grid gap-3">
        <h2 id="grant-h" className="text-lg font-semibold">{t("grant")}</h2>
        <form action={grantAction} className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_2fr_auto] md:items-end" data-testid="credit-grant">
          <label className="grid gap-1 text-sm"><span>{t("org")}</span>
            <select name="orgId" required className={selectClass}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm"><span>{t("credits")}</span><input name="credits" type="number" min={1} required className={inputClass} /></label>
          <label className="grid gap-1 text-sm"><span>{t("months")}</span><input name="months" type="number" min={1} max={36} defaultValue={12} className={inputClass} /></label>
          <label className="grid gap-1 text-sm"><span>{t("note")}</span><input name="note" maxLength={200} className={inputClass} /></label>
          <button type="submit" className={buttonClass("secondary")}>{t("grantButton")}</button>
        </form>
      </section>
    </div>
  );
}
