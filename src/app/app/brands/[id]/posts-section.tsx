import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { listPosts } from "@/server/posts/generate";
import { NewPostForm } from "../../posts/editor";

type Post = Awaited<ReturnType<typeof listPosts>>[number];

/** Creating content is the point of the brand page: the request form first, recent posts below (TASK-007). */
export async function PostsSection({ brandId, archived, channels, posts }: { brandId: string; archived: boolean; channels: { id: string; label: string }[]; posts: Post[] }) {
  const t = await getTranslations("Posts");
  const f = await getFormatter();
  const label = new Map(channels.map((c) => [c.id, c.label]));
  return (
    <section aria-labelledby="posts-h" className="grid gap-4">
      <div>
        <h2 id="posts-h" className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </div>
      {archived ? null : <NewPostForm brandId={brandId} channels={channels} />}
      {posts.length ? (
        <ul className="grid gap-2" data-testid="posts">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/app/posts/${p.id}`} className="grid gap-1 rounded-xl border border-muted/20 p-3 hover:border-muted/60 focus-visible:outline-2 focus-visible:outline-fg">
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 font-medium text-fg dark:bg-paper/10">{t(`status.${p.status}`)}</span>
                  <span>{p.channelId ? label.get(p.channelId) : ""}</span>
                  <span>{f.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                <span className="line-clamp-2 text-sm">{p.content?.caption ?? p.brief}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
