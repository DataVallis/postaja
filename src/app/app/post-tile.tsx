import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A post as it will look (TASK-056): its first image when it has one, otherwise a dashed tile with its text — images
 * are made on request, so a planned post shows what is ready and that its picture is still to be made.
 */
export function PostTile(props: {
  href: string;
  image: string | null;
  title: string;
  kicker?: ReactNode;
  noImage: string;
  selected?: boolean;
  aspect?: "4/5" | "1/1";
}) {
  const ring = props.selected ? "ring-2 ring-signal ring-offset-2 ring-offset-bg" : "";
  const aspect = props.aspect === "1/1" ? "aspect-square" : "aspect-[4/5]";
  return props.image ? (
    <Link href={props.href} aria-current={props.selected ? "true" : undefined} className={`group relative block ${aspect} overflow-hidden rounded-xl bg-raised ${ring}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private image behind a short-lived redirect */}
      <img src={`/api/post-media/${props.image}`} alt={props.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
      {props.kicker ? <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">{props.kicker}</span> : null}
    </Link>
  ) : (
    <Link href={props.href} aria-current={props.selected ? "true" : undefined}
      className={`relative flex ${aspect} flex-col justify-end gap-2 overflow-hidden rounded-xl border border-dashed border-line bg-surface p-3 transition hover:border-muted ${ring}`}>
      {props.kicker ? <span className="absolute left-2 top-2 rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-muted">{props.kicker}</span> : null}
      <span className="line-clamp-4 text-sm font-semibold leading-snug">{props.title}</span>
      <span className="text-xs font-medium text-accent-text">{props.noImage}</span>
    </Link>
  );
}
