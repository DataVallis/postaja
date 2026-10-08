import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ExternalLink, Lightbulb } from "lucide-react";
import { Badge, buttonClass, Card, DataTable, inputClass, selectClass, STATUS_TONE, td, textareaClass } from "@/components/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { todayIn } from "@/lib/dates";
import { suggestIdeasAction } from "../../ideas/actions";
import type { listPosts } from "@/server/posts/generate";
import { NewPostForm } from "../../posts/editor";

type Post = Awaited<ReturnType<typeof listPosts>>[number];

/** Creating content is the point of the brand page: the request form first, recent posts below (TASK-007). */
export async function PostsSection({ brandId, archived, channels, posts, channelsHref, plannedTodo = 0, ideaError, ideaHint, reviews }: { brandId: string; archived: boolean; channels: { id: string; label: string }[]; posts: Post[]; channelsHref: string; plannedTodo?: number; ideaError?: string; ideaHint?: string; reviews?: Map<string, { decision: "approved" | "changes" }> }) {
  const t = await getTranslations("Posts");
  const ti = await getTranslations("Ideas");
  const tb = await getTranslations("Bulk");
  const f = await getFormatter();
  const label = new Map(channels.map((c) => [c.id, c.label]));
  return (
    <section aria-labelledby="posts-h" className="grid gap-6">
      {plannedTodo ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-signal/40 p-4" data-testid="brand-bulk">
          <div>
            <p className="font-semibold">{tb("brandTitle", { n: plannedTodo })}</p>
            <p className="text-sm text-muted">{tb("brandHint")}</p>
          </div>
          <form action="/app/bulk/new" method="get" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="kind" value="brand" />
            <input type="hidden" name="brandId" value={brandId} />
            <input type="hidden" name="back" value={`/app/brands/${brandId}`} />
            <label htmlFor="bulk-days" className="sr-only">{tb("range")}</label>
            <select id="bulk-days" name="days" defaultValue="7" className={selectClass}>
              <option value="7">{tb("next7")}</option>
              <option value="30">{tb("next30")}</option>
              <option value="all">{tb("allPlanned")}</option>
            </select>
            <button type="submit" name="steps" value="text" className={buttonClass("primary")}>{tb("brandButton")}</button>
            <button type="submit" name="steps" value="text,image" className={buttonClass("secondary")}>{tb("bothButton")}</button>
          </form>
        </Card>
      ) : null}
      {!archived && channels.length ? (
        <Card className="grid gap-4 p-5" id="ideas" data-testid="ideas-form">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><Lightbulb aria-hidden className="size-4" />{ti("title")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{ti("intro")}</p>
          </div>
          {ideaError ? <p role="alert" className="text-sm text-danger">{ti.has(`errors.${ideaError}`) ? ti(`errors.${ideaError}`) : ti("errors.FAILED")}</p> : null}
          <form action={suggestIdeasAction} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="brandId" value={brandId} />
            <div className="grid gap-1">
              <label htmlFor="idea-channel" className="text-sm font-medium">{ti("channel")}</label>
              <select id="idea-channel" name="channelId" className={selectClass}>{channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </div>
            <div className="grid gap-1">
              <label htmlFor="idea-count" className="text-sm font-medium">{ti("count")}</label>
              <input id="idea-count" name="count" type="number" min={1} max={30} defaultValue={10} className={inputClass} />
            </div>
            <div className="grid gap-1">
              <label htmlFor="idea-from" className="text-sm font-medium">{ti("from")}</label>
              <input id="idea-from" name="from" type="date" defaultValue={todayIn()} className={inputClass} />
            </div>
            <div className="grid gap-1 sm:col-span-4">
              <label htmlFor="idea-hint" className="text-sm font-medium">{ti("hint")}</label>
              <textarea id="idea-hint" name="hint" rows={2} maxLength={1000} defaultValue={ideaHint?.slice(0, 1000)} placeholder={ti("hintPlaceholder")} className={textareaClass} />
            </div>
            <div className="sm:col-span-4"><SubmitButton pending={ti("working")}>{ti("submit")}</SubmitButton></div>
          </form>
        </Card>
      ) : null}
      <Card className="grid gap-4 p-5">
        <div>
          <h2 id="posts-h" className="text-base font-semibold">{t("newTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
        </div>
        {archived ? null : channels.length ? <NewPostForm brandId={brandId} channels={channels} /> : (
          <p className="text-sm text-muted">{t("noChannelsPrefix")} <Link href={channelsHref} className="underline underline-offset-4">{t("noChannelsLink")}</Link></p>
        )}
      </Card>
      {posts.length ? (
        <DataTable testId="posts" head={[t("post"), t("channel"), t("statusCol"), t("createdCol")]}>
          {posts.map((p) => (
            <tr key={p.id}>
              <td className={`${td} min-w-56 max-w-xl`}><Link href={`/app/posts/${p.id}`} className="line-clamp-2 hover:underline">{p.content?.caption ?? p.brief}</Link></td>
              <td className={`${td} whitespace-nowrap text-muted`}>{p.channelId ? label.get(p.channelId) : "—"}</td>
              <td className={`${td} whitespace-nowrap`}><Badge tone={STATUS_TONE[p.status]} dot>{t(`status.${p.status}`)}</Badge>{reviews?.get(p.id) ? <span className="ml-2 text-xs" data-testid="client-badge">{reviews.get(p.id)!.decision === "approved" ? t("clientApprovedShort") : t("clientChangesShort")}</span> : null}{p.publishedUrl ? (
                <a href={p.publishedUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs text-muted underline-offset-4 hover:text-fg hover:underline" data-testid="published-link">
                  <ExternalLink aria-hidden className="size-3.5" />{t("openPublished")}
                </a>
              ) : null}</td>
              <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </section>
  );
}
