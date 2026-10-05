import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { effectiveRules } from "@/lib/rules";
import { requireOrgPage } from "@/server/auth/require";
import { BrandError, getBrandDetail, listProfileVersions } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { getPlatformRuleSet, listPlatformRules, listPresets } from "@/server/rules/repo";
import { archiveBrandAction, removeChannelAction } from "../actions";
import { ChannelForm, ProfileForm } from "../forms";

export const dynamic = "force-dynamic";

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const db = getDb();
  const detail = await getBrandDetail(db, org, id).catch((e) => {
    if (e instanceof BrandError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { brand, profile, channels } = detail;
  const [versions, presets, platformRows] = await Promise.all([listProfileVersions(db, org, id), listPresets(db), listPlatformRules(db)]);
  const clickable = new Map(platformRows.map((r) => [r.platform, r.linksClickable]));
  const t = await getTranslations("Brands");
  const f = await getFormatter();
  const isOwner = org.role === "owner";
  const rules = profile?.rules ?? { bannedWords: [], ctaPhrases: [], regexMust: [], regexMustNot: [] };
  const effective = await Promise.all(
    channels.map(async (c) => {
      const platform = await getPlatformRuleSet(db, c.platform);
      return { id: c.id, rules: effectiveRules(platform, c.rules, rules) };
    }),
  );
  return (
    <main className="grid gap-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{brand.name}</h1>
          <p className="text-sm text-muted">
            /{brand.slug}
            {brand.website ? <> · <a href={brand.website} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4">{brand.website.replace(/^https?:\/\//, "")}</a></> : null}
            {" · "}{t("currentVersion", { v: profile?.version ?? 0 })}
          </p>
        </div>
        {isOwner ? (
          <form action={archiveBrandAction}>
            <input type="hidden" name="brandId" value={brand.id} />
            <button type="submit" className="rounded-lg border border-muted px-3 py-1.5 text-sm">{t("archive")}</button>
          </form>
        ) : null}
      </div>

      <section aria-labelledby="profile-h">
        <h2 id="profile-h" className="mb-4 text-lg font-semibold">{t("profile")}</h2>
        <ProfileForm
          brandId={brand.id}
          readOnly={!isOwner}
          cgp={profile?.cgp ?? ""}
          pillarsText={(profile?.pillars ?? []).map((p) => `${p.name} | ${p.share}${p.description ? ` | ${p.description}` : ""}`).join("\n")}
          rules={rules}
          visual={profile?.visual ?? { colors: {}, imageStyle: "", negativePrompt: "" }}
        />
      </section>

      <section aria-labelledby="channels-h">
        <h2 id="channels-h" className="mb-4 text-lg font-semibold">{t("channels")}</h2>
        {channels.length === 0 ? <p className="mb-4 text-muted">{t("noChannels")}</p> : null}
        <ul className="mb-6 grid gap-3" data-testid="channels">
          {channels.map((c) => {
            const r = effective.find((e) => e.id === c.id)!.rules;
            return (
              <li key={c.id} className="rounded-xl border border-muted/30 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{c.platform} · {c.handle}</strong>
                  {isOwner ? (
                    <form action={removeChannelAction}>
                      <input type="hidden" name="brandId" value={brand.id} />
                      <input type="hidden" name="channelId" value={c.id} />
                      <button type="submit" className="text-sm underline underline-offset-4">{t("remove")}</button>
                    </form>
                  ) : null}
                </div>
                <p className="text-muted">
                  {t(`lang.${c.language as "sl"}`)} · {t("perDay", { n: c.goal.postsPerDay })} · {c.goal.weekdays.map((d) => t(`days.${d as 1}`)).join(" ")} · {c.allowedTypes.map((ty) => t(`types.${ty}`)).join(", ")}
                  {c.defaultPresetKey ? ` · ${c.defaultPresetKey}` : ""}
                </p>
                <p data-testid={`effective-${c.platform}`}>
                  {t("effective")}: {t("chars", { n: r.captionMax ?? "∞" })} · {t("hashtags", { n: r.hashtagsMax ?? "∞" })} · {r.linksAllowed === false ? t("noLinks") : clickable.get(c.platform) === false ? t("linksNotClickable") : t("linksOk")}
                </p>
              </li>
            );
          })}
        </ul>
        {isOwner ? <ChannelForm brandId={brand.id} presets={presets.filter((p) => p.enabled).map((p) => ({ key: p.key, platform: p.platform, width: p.width, height: p.height, media: p.media }))} /> : null}
      </section>

      <section aria-labelledby="versions-h">
        <h2 id="versions-h" className="mb-4 text-lg font-semibold">{t("versions")}</h2>
        <ul className="grid gap-1 text-sm" data-testid="versions">
          {versions.map((v) => (
            <li key={v.id}>v{v.version} · {f.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" })}{v.note ? ` · ${v.note === "created" ? t("createdNote") : v.note}` : ""}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
