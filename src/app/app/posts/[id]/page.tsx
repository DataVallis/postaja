import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, buttonClass, Card, PageHeader, STATUS_TONE } from "@/components/ui";
import { microToUsd } from "@/lib/money/usd";
import { requireOrgPage } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import type { PostStatus } from "@/server/db/schema";
import { getPost, postCost, PostError, rulesFor } from "@/server/posts/generate";
import { retryPostAction, setPostStatusAction } from "../actions";
import { PostEditor } from "../editor";

export const dynamic = "force-dynamic";

const NEXT: Partial<Record<PostStatus, PostStatus[]>> = {
  ready: ["approved", "skipped"],
  needs_review: ["approved", "skipped"],
  approved: ["published", "skipped", "ready"],
  published: ["approved"],
  skipped: ["ready"],
  failed: ["skipped"],
};

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { org } = await requireOrgPage();
  const { id } = await params;
  const db = getDb();
  const post = await getPost(db, org, id).catch((e) => {
    if (e instanceof PostError) notFound();
    throw e;
  });
  const t = await getTranslations("Posts");
  const f = await getFormatter();
  const ctx = post.channelId ? await rulesFor(db, org, post.brandId, post.channelId).catch(() => null) : null;
  const cost = await postCost(db, org, post.id);
  const editable = post.status === "ready" || post.status === "needs_review" || post.status === "approved";
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href={`/app/brands/${post.brandId}`} className="hover:text-fg hover:underline">← {ctx?.brand.name ?? t("brand")}</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{ctx ? `${ctx.channel.platform} · ${ctx.channel.handle}` : t("post")}<span data-testid="status" className="text-base font-normal"><Badge tone={STATUS_TONE[post.status]} dot>{t(`status.${post.status}`)}</Badge></span></span>}
        description={<>{t("briefWas")}: {post.brief}</>}
      />
      {post.status === "failed" ? (
        <div role="alert" className="grid justify-items-start gap-3 rounded-xl border border-signal p-4">
          <p>{t(`errors.${post.error ?? "FAILED"}`)}</p>
          <form action={retryPostAction}>
            <input type="hidden" name="postId" value={post.id} />
            <button type="submit" className={buttonClass("primary")}>{t("retry")}</button>
          </form>
        </div>
      ) : null}

      {post.ruleFailures.length ? (
        <div className="grid gap-2 rounded-xl border border-signal/60 bg-signal/10 p-4 text-sm" data-testid="failures">
          <p className="font-semibold">{t("failuresTitle")}</p>
          <ul className="grid gap-1">
            {post.ruleFailures.map((v, i) => (
              <li key={i}>{t(`violations.${v.code}`, { actual: String(v.actual), limit: String(v.limit), part: v.part ?? 0 })}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {post.content && ctx ? (
        <Card className="p-5"><PostEditor postId={post.id} caption={post.content.caption} parts={post.content.parts} rules={ctx.rules} readOnly={!editable} /></Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(NEXT[post.status] ?? []).map((to) => (
          <form key={to} action={setPostStatusAction}>
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="to" value={to} />
            <button type="submit" className={buttonClass(to === "approved" ? "primary" : "secondary", "sm")}>{t(`to.${to}`)}</button>
          </form>
        ))}
      </div>

      <p className="text-xs text-muted">
        {f.dateTime(post.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {post.model} · {t("cost", { usd: microToUsd(cost, 4) })}
        {post.fixAttempts ? ` · ${t("fixed")}` : ""}
      </p>
    </div>
  );
}
