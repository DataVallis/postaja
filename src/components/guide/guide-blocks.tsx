import Link from "next/link";
import type { Block, Inline } from "@/server/guide/markdown";

function Inlines({ v }: { v: Inline[] }) {
  return (
    <>
      {v.map((n, i) => {
        if (n.t === "text") return n.v;
        if (n.t === "code") return <code key={i} className="rounded bg-raised px-1 py-0.5 text-[0.9em]">{n.v}</code>;
        if (n.t === "strong") return <strong key={i} className="font-semibold text-fg"><Inlines v={n.v} /></strong>;
        return n.href.startsWith("/")
          ? <Link key={i} href={n.href} className="underline underline-offset-4 hover:text-signal"><Inlines v={n.v} /></Link>
          : <a key={i} href={n.href} rel="noopener noreferrer" target="_blank" className="underline underline-offset-4 hover:text-signal"><Inlines v={n.v} /></a>;
      })}
    </>
  );
}

/** A guide chapter as React (the parsed tree; never raw HTML). */
export function GuideBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="grid max-w-3xl gap-4 text-[0.95rem] leading-7 text-fg/90">
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const cls = b.level === 2 ? "mt-6 scroll-mt-24 text-lg font-semibold text-fg" : "mt-2 scroll-mt-24 font-semibold text-fg";
          return b.level === 2 ? <h2 key={i} id={b.id} className={cls}><Inlines v={b.v} /></h2> : <h3 key={i} id={b.id} className={cls}><Inlines v={b.v} /></h3>;
        }
        if (b.t === "p") return <p key={i}><Inlines v={b.v} /></p>;
        if (b.t === "quote") return <p key={i} className="rounded-lg border-l-4 border-signal bg-raised/50 px-4 py-2"><Inlines v={b.v} /></p>;
        const items = b.items.map((it, j) => <li key={j} className="pl-1"><Inlines v={it} /></li>);
        return b.t === "ul" ? <ul key={i} className="grid list-disc gap-1.5 pl-6">{items}</ul> : <ol key={i} className="grid list-decimal gap-1.5 pl-6">{items}</ol>;
      })}
    </div>
  );
}
