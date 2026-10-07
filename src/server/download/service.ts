// One-click download (TASK-016): a post, or every post of a day (all brands or one), as a ZIP ready to publish —
// per post a folder with the text exactly as it is posted (hashtags included), the first comment, and the images in
// order; a day also gets pregled.csv (an overview that opens in Excel). Members only, bounded by ctx.orgId.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { isIsoDate } from "@/lib/dates";
import { slugify } from "@/lib/slug";
import type { Db } from "../db/client";
import { brands, channels, postMedia, posts } from "../db/schema";
import sharp from "sharp";
import { pdfFromJpegs } from "../files/pdf-writer";
import type { Storage } from "../files/storage";
import type { ZipSource } from "../files/zip-writer";
import type { OrgContext } from "../tenancy/context";

export const DAY_MAX_POSTS = 200;

export class DownloadError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID" | "TOO_MANY" | "EMPTY") {
    super(code);
  }
}

const enc = new TextEncoder();
const text = (s: string) => async () => enc.encode(s);

const columns = {
  id: posts.id, brief: posts.brief, status: posts.status, format: posts.format, content: posts.content, plan: posts.plan,
  scheduledOn: posts.scheduledOn, scheduledTime: posts.scheduledTime, brandName: brands.name, brandSlug: brands.slug,
  platform: channels.platform, handle: channels.handle,
};
type Row = { id: string; brief: string; status: string; format: string; content: { caption: string; parts?: string[] } | null; plan: { topic?: string; firstComment?: string; link?: string } | null; scheduledOn: string | null; scheduledTime: string | null; brandName: string; brandSlug: string; platform: string | null; handle: string | null };

const base = (db: Db, ctx: OrgContext) =>
  db.select(columns).from(posts)
    .innerJoin(brands, and(eq(brands.id, posts.brandId), eq(brands.orgId, ctx.orgId)))
    .leftJoin(channels, and(eq(channels.id, posts.channelId), eq(channels.orgId, ctx.orgId)));

/** "aibuilders-si/instagram-08-30-metoda" — unique within the archive. */
function folders(rows: Row[], prefixBrand: boolean): string[] {
  const used = new Set<string>();
  return rows.map((p) => {
    const when = p.scheduledTime ? p.scheduledTime.replace(":", "-") : "brez-ure";
    const what = slugify(p.plan?.topic || p.brief).slice(0, 40).replace(/-+$/, "") || "objava";
    let name = `${p.platform ?? "brez-kanala"}-${when}-${what}`;
    if (prefixBrand) name = `${p.brandSlug}/${name}`;
    let unique = name;
    for (let n = 2; used.has(unique); n++) unique = `${name}-${n}`;
    used.add(unique);
    return unique;
  });
}

/** The text as it is posted: the caption with its hashtags; a thread's parts separated by a line. */
export function postText(p: Pick<Row, "content">): string | null {
  if (!p.content) return null;
  return p.content.parts?.length ? p.content.parts.join("\n\n---\n\n") : p.content.caption;
}

/** LinkedIn posts carousels as a document: a post there with two or more images also gets them as one PDF (TASK-018). */
export const wantsPdf = (platform: string | null, images: number) => platform === "linkedin" && images >= 2;

/** The images (PNG/JPEG keys, in order) as a PDF, one page each, white behind any transparency. */
async function carouselPdf(storage: Storage, keys: string[], title: string): Promise<Uint8Array> {
  const pages = [];
  for (const k of keys) {
    const img = sharp(await storage.get(k)).flatten({ background: "#ffffff" }).toColourspace("srgb");
    const { data, info } = await img.jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
    pages.push({ jpeg: new Uint8Array(data), width: info.width, height: info.height });
  }
  return pdfFromJpegs(pages, title);
}

async function entriesFor(db: Db, storage: Storage, ctx: OrgContext, rows: Row[], dirs: string[]): Promise<ZipSource[]> {
  const media = rows.length
    ? await db.select({ postId: postMedia.postId, position: postMedia.position, key: postMedia.storageKey, type: postMedia.contentType }).from(postMedia)
        .where(and(eq(postMedia.orgId, ctx.orgId), eq(postMedia.kind, "slide"), inArray(postMedia.postId, rows.map((r) => r.id))))
        .orderBy(asc(postMedia.postId), asc(postMedia.position))
    : [];
  const out: ZipSource[] = [];
  rows.forEach((p, i) => {
    const dir = dirs[i];
    const body = postText(p);
    if (body) out.push({ name: `${dir}/besedilo.txt`, bytes: text(`${body}\n`) });
    if (p.plan?.firstComment) out.push({ name: `${dir}/prvi-komentar.txt`, bytes: text(`${p.plan.firstComment}\n`) });
    const own = media.filter((x) => x.postId === p.id);
    for (const m of own) {
      out.push({ name: `${dir}/${m.position + 1}.${m.type === "image/png" ? "png" : "jpg"}`, bytes: () => storage.get(m.key) });
    }
    if (wantsPdf(p.platform, own.length)) out.push({ name: `${dir}/karusel.pdf`, bytes: () => carouselPdf(storage, own.map((m) => m.key), p.plan?.topic || p.brandName) });
  });
  return out;
}

/** One post: its folder content at the top of the archive. */
export async function postArchive(db: Db, storage: Storage, ctx: OrgContext, postId: string) {
  const [p] = (await base(db, ctx).where(and(eq(posts.orgId, ctx.orgId), eq(posts.id, postId)))) as Row[];
  if (!p) throw new DownloadError("NOT_FOUND");
  const [dir] = folders([p], false);
  const entries = (await entriesFor(db, storage, ctx, [p], [dir])).map((e) => ({ ...e, name: e.name.slice(dir.length + 1) }));
  if (!entries.length) throw new DownloadError("EMPTY");
  return { filename: `${p.brandSlug}-${p.scheduledOn ?? p.id.slice(0, 8)}-${dir}.zip`, entries };
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

/** Every post of `date` (not skipped), all brands or one, in time order; with pregled.csv. */
export async function dayArchive(db: Db, storage: Storage, ctx: OrgContext, date: string, brandId?: string | null) {
  if (!isIsoDate(date)) throw new DownloadError("INVALID");
  const where = [eq(posts.orgId, ctx.orgId), eq(posts.scheduledOn, date), sql`${posts.status} <> 'skipped'`];
  if (brandId) where.push(eq(posts.brandId, brandId));
  const rows = (await base(db, ctx).where(and(...where))
    .orderBy(asc(brands.name), sql`${posts.scheduledTime} asc nulls last`, asc(channels.platform), asc(posts.createdAt))
    .limit(DAY_MAX_POSTS + 1)) as Row[];
  if (rows.length > DAY_MAX_POSTS) throw new DownloadError("TOO_MANY");
  if (!rows.length) throw new DownloadError("EMPTY");
  const dirs = folders(rows, true);
  const entries = await entriesFor(db, storage, ctx, rows, dirs);
  const csv = [
    ["Dan", "Ura", "Brand", "Kanal", "Profil", "Format", "Stanje", "Mapa", "Besedilo"].map(csvCell).join(";"),
    ...rows.map((p, i) => [date, p.scheduledTime ?? "", p.brandName, p.platform ?? "", p.handle ?? "", p.format, p.status, dirs[i], (postText(p) ?? "").slice(0, 200)].map(csvCell).join(";")),
  ].join("\r\n");
  // BOM so Excel opens the UTF-8 file with č š ž intact; ";" is the separator Slovenian Excel expects.
  entries.unshift({ name: "pregled.csv", bytes: text(`﻿${csv}\r\n`) });
  const slug = brandId ? rows[0].brandSlug : null;
  return { filename: `postaja-${date}${slug ? `-${slug}` : ""}.zip`, entries };
}

/** One post's images as a PDF (LinkedIn document carousel); any post with at least one image. */
export async function postPdf(db: Db, storage: Storage, ctx: OrgContext, postId: string) {
  const [p] = (await base(db, ctx).where(and(eq(posts.orgId, ctx.orgId), eq(posts.id, postId)))) as Row[];
  if (!p) throw new DownloadError("NOT_FOUND");
  const media = await db.select({ key: postMedia.storageKey }).from(postMedia)
    .where(and(eq(postMedia.orgId, ctx.orgId), eq(postMedia.postId, p.id), eq(postMedia.kind, "slide"))).orderBy(asc(postMedia.position));
  if (!media.length) throw new DownloadError("EMPTY");
  const [dir] = folders([p], false);
  return { filename: `${p.brandSlug}-${p.scheduledOn ?? p.id.slice(0, 8)}-${dir}.pdf`, bytes: await carouselPdf(storage, media.map((m) => m.key), p.plan?.topic || p.brandName) };
}
