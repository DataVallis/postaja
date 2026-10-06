import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, Card, DataTable, STATUS_TONE, td } from "@/components/ui";
import type { listPosts } from "@/server/posts/generate";
import { NewPostForm } from "../../posts/editor";

type Post = Awaited<ReturnType<typeof listPosts>>[number];

/** Creating content is the point of the brand page: the request form first, recent posts below (TASK-007). */
export async function PostsSection({ brandId, archived, channels, posts, channelsHref }: { brandId: string; archived: boolean; channels: { id: string; label: string }[]; posts: Post[]; channelsHref: string }) {
  const t = await getTranslations("Posts");
  const f = await getFormatter();
  const label = new Map(channels.map((c) => [c.id, c.label]));
  return (
    <section aria-labelledby="posts-h" className="grid gap-6">
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
              <td className={td}><Badge tone={STATUS_TONE[p.status]} dot>{t(`status.${p.status}`)}</Badge></td>
              <td className={`${td} whitespace-nowrap text-muted`}>{f.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" })}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </section>
  );
}
