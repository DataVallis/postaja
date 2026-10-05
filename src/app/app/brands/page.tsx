import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireOrgPage } from "@/server/auth/require";
import { listBrands } from "@/server/brands/service";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const { org } = await requireOrgPage();
  const t = await getTranslations("Brands");
  const list = await listBrands(getDb(), org);
  return (
    <main>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {org.role === "owner" ? (
          <Link href="/app/brands/new" className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink">{t("new")}</Link>
        ) : null}
      </div>
      {list.length === 0 ? (
        <p className="text-muted">{org.role === "owner" ? t("emptyOwner") : t("emptyEditor")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="brand-list">
          {list.map((b) => (
            <li key={b.id}>
              <Link href={`/app/brands/${b.id}`} className="block rounded-xl border border-muted/30 p-4 hover:border-signal">
                <span className="block font-semibold">{b.name}</span>
                <span className="text-sm text-muted">/{b.slug}{b.website ? ` · ${b.website.replace(/^https?:\/\//, "")}` : ""} · {b.languages.join(", ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
