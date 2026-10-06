import { Archive } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, Card, DataTable, PageHeader, Tabs, td } from "@/components/ui";
import { notFound } from "next/navigation";
import { effectiveRules } from "@/lib/rules";
import { requireOrgPage } from "@/server/auth/require";
import { listBrandFiles } from "@/server/brands/files";
import { BrandError, getBrandDetail, listProfileVersions } from "@/server/brands/service";
import { getDb } from "@/server/db/client";
import { getPlatformRuleSet, listPlatformRules, listPresets } from "@/server/rules/repo";
import { archiveBrandAction, removeChannelAction } from "../actions";
import { ChannelForm, ProfileForm } from "../forms";
import { FilesSection } from "./files-section";
import { PostsSection } from "./posts-section";
import { listPosts } from "@/server/posts/generate";
import { pendingDraft } from "@/server/mcp/service";
import { bulkCandidates } from "@/server/bulk/service";
import { todayIn } from "@/lib/dates";

export const dynamic = "force-dynamic";

const TABS = ["posts", "files", "profile", "channels", "versions"] as const;
type Tab = (typeof TABS)[number];

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const raw = (await searchParams).tab;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "posts";
  const db = getDb();
  const detail = await getBrandDetail(db, org, id).catch((e) => {
    if (e instanceof BrandError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { brand, profile, channels } = detail;
  const [versions, presets, platformRows, files, recentPosts, draft] = await Promise.all([listProfileVersions(db, org, id), listPresets(db), listPlatformRules(db), listBrandFiles(db, org, id), listPosts(db, org, id, 10), pendingDraft(db, org, id)]);
  const plannedTodo = (await bulkCandidates(db, org, { kind: "brand", brandId: id, from: todayIn(), to: null })).length;
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
  const base = `/app/brands/${brand.id}`;
  const href = (k: Tab) => (k === "posts" ? base : `${base}?tab=${k}`);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/brands" className="hover:text-fg hover:underline">{t("title")}</Link>}
        title={brand.name}
        description={
          <>
            /{brand.slug}
            {brand.website ? <> · <a href={brand.website} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4">{brand.website.replace(/^https?:\/\//, "")}</a></> : null}
            {" · "}{t("currentVersion", { v: profile?.version ?? 0 })}
          </>
        }
        actions={isOwner ? (
          <form action={archiveBrandAction}>
            <input type="hidden" name="brandId" value={brand.id} />
            <button type="submit" className={buttonClass("secondary", "sm")}><Archive aria-hidden className="size-4" />{t("archive")}</button>
          </form>
        ) : null}
      />

      {draft && isOwner && tab !== "profile" ? (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 border-signal/50 p-4 text-sm" data-testid="draft-notice">
          <span><strong>{t("cgpDraft.title")}</strong> · {t("cgpDraft.waiting")}</span>
          <Link href={href("profile")} className={buttonClass("primary", "sm")}>{t("cgpDraft.open")}</Link>
        </Card>
      ) : null}

      <Tabs
        label={t("tabsLabel")}
        defaultKey="posts"
        tabs={[
          { key: "posts", label: t("tabs.posts"), href: href("posts"), count: recentPosts.length },
          { key: "files", label: t("tabs.files"), href: href("files"), count: files.sources.length + files.logos.length + files.fonts.length },
          { key: "profile", label: t("tabs.profile"), href: href("profile") },
          { key: "channels", label: t("tabs.channels"), href: href("channels"), count: channels.length },
          { key: "versions", label: t("tabs.versions"), href: href("versions"), count: versions.length },
        ]}
      />

      {tab === "posts" ? (
        <PostsSection brandId={brand.id} archived={brand.archivedAt !== null} posts={recentPosts} channels={channels.map((c) => ({ id: c.id, label: `${c.platform} · ${c.handle}` }))} channelsHref={href("channels")} plannedTodo={brand.archivedAt ? 0 : plannedTodo} />
      ) : null}

      {tab === "files" ? <FilesSection brandId={brand.id} files={files} isOwner={isOwner} archived={brand.archivedAt !== null} languages={brand.languages} /> : null}

      {tab === "profile" ? (
        <section aria-labelledby="profile-h">
          <h2 id="profile-h" className="sr-only">{t("profile")}</h2>
          <ProfileForm
            brandId={brand.id}
            readOnly={!isOwner}
            cgpSources={files.sources.filter((s) => s.kind === "pdf" || s.kind === "docx" || s.kind === "text").map((s) => ({ id: s.id, filename: s.filename }))}
            cgp={profile?.cgp ?? ""}
            cgpDraft={draft ? { id: draft.id, text: draft.text, note: draft.note, when: f.dateTime(draft.createdAt, { dateStyle: "medium", timeStyle: "short" }) } : null}
            pillarsText={(profile?.pillars ?? []).map((p) => `${p.name} | ${p.share}${p.description ? ` | ${p.description}` : ""}`).join("\n")}
            rules={rules}
            visual={profile?.visual ?? { colors: {}, imageStyle: "", negativePrompt: "" }}
          />
        </section>
      ) : null}

      {tab === "channels" ? (
        <section aria-labelledby="channels-h" className="grid gap-6">
          <h2 id="channels-h" className="sr-only">{t("channels")}</h2>
          {channels.length === 0 ? <p className="text-muted">{t("noChannels")}</p> : null}
          <ul className="grid gap-3" data-testid="channels">
            {channels.map((c) => {
              const r = effective.find((e) => e.id === c.id)!.rules;
              return (
                <li key={c.id}>
                  <Card className="grid gap-1 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{c.platform} · {c.handle}</strong>
                      {isOwner ? (
                        <form action={removeChannelAction}>
                          <input type="hidden" name="brandId" value={brand.id} />
                          <input type="hidden" name="channelId" value={c.id} />
                          <button type="submit" className={buttonClass("ghost", "sm")}>{t("remove")}</button>
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
                  </Card>
                </li>
              );
            })}
          </ul>
          {isOwner ? <Card className="p-5"><ChannelForm brandId={brand.id} languages={brand.languages} presets={presets.filter((p) => p.enabled).map((p) => ({ key: p.key, platform: p.platform, width: p.width, height: p.height, media: p.media }))} /></Card> : null}
        </section>
      ) : null}

      {tab === "versions" ? (
        <section aria-labelledby="versions-h">
          <h2 id="versions-h" className="sr-only">{t("versions")}</h2>
          <DataTable testId="versions" head={[t("versionCol"), t("savedAt"), t("noteCol")]}>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className={`${td} font-medium`}>v{v.version}</td>
                <td className={`${td} text-muted`}>{f.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className={td}>{v.note ? (v.note === "created" ? t("createdNote") : v.note) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}
    </>
  );
}
