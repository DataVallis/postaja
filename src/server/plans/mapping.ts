// Column mapping → plan items (TASK-012, ADR-041). The AI (or the header heuristic, or the owner) only decides which
// column means what; every value is then read by this code, verbatim. Pure functions, unit tested on the owner's plans.
import { z } from "zod";
import type { PlanTable } from "./table";

export const PLAN_FIELDS = [
  "ignore", "row_number", "date", "time", "day_offset", "day_number", "platform", "account", "format", "image_type",
  "slide_count", "topic", "category", "audience", "text", "hashtags", "cta", "cta_hashtags", "link", "first_comment",
  "image_prompt", "overlay_text", "slides", "status", "published_on", "notes", "char_count",
] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];

export const PLAN_PLATFORMS = ["instagram", "facebook", "linkedin", "x", "tiktok", "youtube"] as const;
export type PlanPlatform = (typeof PLAN_PLATFORMS)[number];
export const PLAN_FORMATS = ["text", "image", "carousel", "thread", "video"] as const;
export type PlanFormat = (typeof PLAN_FORMATS)[number];

export const mappingSchema = z.object({
  columns: z.array(z.enum(PLAN_FIELDS)).max(200),
  /** File-level defaults, e.g. a sheet that is all X posts has no platform column. */
  defaultPlatform: z.enum(PLAN_PLATFORMS).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
});
export type ColumnMapping = z.infer<typeof mappingSchema>;

export type PlanItem = {
  ref: string;
  date: string | null;
  time: string | null;
  dayOffset: number | null;
  platform: PlanPlatform | null;
  account: string | null;
  format: PlanFormat;
  slideCount: number | null;
  topic: string | null;
  category: string | null;
  audience: string | null;
  text: string | null;
  parts: string[] | null;
  hashtags: string[];
  cta: string | null;
  link: string | null;
  firstComment: string | null;
  imagePrompt: string | null;
  overlayText: string | null;
  slides: string[];
  status: "planned" | "published" | "skip";
  publishedOn: string | null;
  notes: string | null;
  warnings: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Excel serial (1900 system), ISO, d.m.yyyy / d. m. yyyy / d/m/yyyy (European order). Anything else → null. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n < 20000 || n > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})\.?(?:\s.*)?$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

/** "08:30", "8.30", "8h", "8:30 CET" or an Excel day fraction (0.354…) → "HH:MM". */
export function parseTime(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^0?\.\d+$/.test(s)) {
    const mins = Math.round(Number(s) * 1440);
    return mins >= 0 && mins < 1440 ? `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` : null;
  }
  const m = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*h?\b/i);
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null;
}

/** "+12", "12", "-3", "dan 12" → 12; "12.0" from Excel numbers too. */
export function parseOffset(v: string): number | null {
  const m = v.trim().match(/^(?:dan|day)?\s*([+-]?\d+)(?:\.0+)?$/i);
  return m ? Number(m[1]) : null;
}

export function normalizePlatform(v: string): PlanPlatform | null {
  const s = v.toLowerCase();
  if (/linked\s*in/.test(s)) return "linkedin";
  if (/insta|\big\b/.test(s)) return "instagram";
  if (/twitter|^\s*x\s*$|\bx\b/.test(s)) return "x";
  if (/facebook|\bfb\b/.test(s)) return "facebook";
  if (/tik\s*tok/.test(s)) return "tiktok";
  if (/youtube|\byt\b|shorts/.test(s)) return "youtube";
  return null;
}

/** "CHERR.IO_X_posts.xlsx", "IG Content Plan", "LinkedIn objave" → the one platform a file is for, or null if none/several. */
export function platformFromName(name: string): PlanPlatform | null {
  const words = name.replace(/\.[a-z0-9]+$/i, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const found = new Set(words.map((w) => normalizePlatform(w)).filter((x): x is PlanPlatform => x !== null));
  return found.size === 1 ? [...found][0] : null;
}

/** Owner's words for formats: "Carousel (6)", "Carousel — 6 slajdov", "Thread (9)", "Text + image", "Single", "Video …". */
export function normalizeFormat(v: string): { format: PlanFormat; slides: number | null } | null {
  const s = v.toLowerCase();
  const n = s.match(/(\d+)/)?.[1];
  if (/carou|karusel|vrtilj/.test(s)) return { format: "carousel", slides: n ? Number(n) : null };
  if (/thread|nit\b|niti/.test(s)) return { format: "thread", slides: n ? Number(n) : null };
  if (/video|reel|short|story|zgodba/.test(s)) return { format: "video", slides: null };
  if (/image|slika|photo|foto|grafika|text\s*\+|card|kartica/.test(s)) return { format: "image", slides: null };
  if (/single|text|besedilo|tweet|post|objava/.test(s)) return { format: "text", slides: null };
  return null;
}

export function normalizeStatus(v: string): "planned" | "published" | "skip" {
  const s = v.toLowerCase();
  if (/objavljen|posted|published|\bdone\b|\blive\b|✓|✅/.test(s)) return "published";
  if (/skip|preskoč|cancel|odpoved|zavrž|\bno\b/.test(s)) return "skip";
  return "planned";
}

export const extractHashtags = (s: string) => [...new Set(s.match(/#[\p{L}\p{N}_]+/gu) ?? [])];

/** "1: …\n2: …", "SLAJD 1: … | SLAJD 2: …", "COVER: … | …" → slide texts in order. */
export function splitSlides(v: string): string[] {
  const s = v.trim();
  if (!s || s === "—" || s === "-") return [];
  const byNumber = s.split(/\n(?=\s*(?:slajd|slide)?\s*\d+\s*[:.)])/i);
  if (byNumber.length > 1) return byNumber.map((x) => x.trim().replace(/^(?:slajd|slide)?\s*\d+\s*[:.)]\s*/i, "")).filter(Boolean);
  const byBar = s.split(/\s+\|\s+/);
  if (byBar.length > 1) return byBar.map((x) => x.trim()).filter(Boolean);
  return [s];
}

/** "Hook\n\n1/ …\n\n2/ …" → parts; the text before "1/" is the first part. Not a numbered thread → null. */
export function splitThread(text: string): string[] | null {
  if (!/(^|\n)\s*1\/\s/.test(text)) return null;
  const parts = text.split(/\n\s*\n(?=\s*\d+\/\s)/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // A closing paragraph after the last numbered part stays with it.
  return parts;
}

const empty = (v: string | undefined) => !v || !v.trim() || /^[—–-]+$/.test(v.trim());

/** Rows → plan items with the given mapping. Unknown values become warnings, never guesses. */
export function mapRows(table: PlanTable, mapping: ColumnMapping): PlanItem[] {
  const cols = (f: PlanField) => mapping.columns.map((c, i) => (c === f ? i : -1)).filter((i) => i >= 0);
  const get = (cells: string[], f: PlanField) => cols(f).map((i) => cells[i] ?? "").filter((v) => !empty(v)).join("\n\n").trim();
  return table.rows.map(({ n, cells }) => {
    const w: string[] = [];
    const rawDate = get(cells, "date");
    const date = rawDate ? parseDate(rawDate) : null;
    if (rawDate && !date) w.push(`DATE:${rawDate}`);
    const rawTime = get(cells, "time");
    const time = rawTime ? parseTime(rawTime) : null;
    if (rawTime && !time) w.push(`TIME:${rawTime}`);
    let dayOffset: number | null = null;
    const off = get(cells, "day_offset");
    const dayNo = get(cells, "day_number");
    if (off) dayOffset = parseOffset(off);
    else if (dayNo) { const d = parseOffset(dayNo); dayOffset = d === null ? null : d - 1; }
    if ((off || dayNo) && dayOffset === null) w.push(`OFFSET:${off || dayNo}`);

    const rawPlatform = get(cells, "platform");
    const platform = rawPlatform ? normalizePlatform(rawPlatform) : mapping.defaultPlatform ?? null;
    if (rawPlatform && !platform) w.push(`PLATFORM:${rawPlatform}`);

    const rawFormat = get(cells, "format");
    const imageType = get(cells, "image_type");
    let fmt = rawFormat ? normalizeFormat(rawFormat) : null;
    if (rawFormat && !fmt) w.push(`FORMAT:${rawFormat}`);
    if (!fmt && imageType) fmt = /video/i.test(imageType) ? { format: "video", slides: null } : { format: "image", slides: null };
    const slideCount = Number(get(cells, "slide_count")) || fmt?.slides || null;

    let text = get(cells, "text") || null;
    const tagSource = [get(cells, "hashtags"), get(cells, "cta_hashtags")].join(" ");
    const hashtags = extractHashtags(tagSource);
    const ctaRaw = [get(cells, "cta"), get(cells, "cta_hashtags").replace(/#[\p{L}\p{N}_]+/gu, "").trim()].filter(Boolean).join(" · ");
    const slides = splitSlides(get(cells, "slides"));
    let format: PlanFormat = fmt?.format ?? (slides.length > 1 ? "carousel" : "text");
    if (format === "text" && get(cells, "image_prompt")) format = "image";
    let parts: string[] | null = null;
    if (text && (format === "thread" || (platform === "x" && splitThread(text)))) {
      parts = splitThread(text);
      if (parts) format = "thread";
    }
    if (!text) w.push("NO_TEXT");
    if (text) text = text.replace(/\r\n?/g, "\n");

    const rawStatus = get(cells, "status");
    const publishedOnRaw = get(cells, "published_on");
    const publishedOn = publishedOnRaw ? parseDate(publishedOnRaw) : null;
    let status = rawStatus ? normalizeStatus(rawStatus) : "planned";
    if (publishedOn && status === "planned") status = "published";

    return {
      ref: `${table.sheet}!${n}`,
      date, time, dayOffset, platform,
      account: get(cells, "account") || null,
      format, slideCount: format === "carousel" || format === "thread" ? slideCount ?? (slides.length || null) : null,
      topic: get(cells, "topic") || null,
      category: get(cells, "category") || null,
      audience: get(cells, "audience") || null,
      text, parts, hashtags,
      cta: ctaRaw || null,
      link: get(cells, "link") || null,
      firstComment: get(cells, "first_comment") || null,
      imagePrompt: get(cells, "image_prompt") || null,
      overlayText: get(cells, "overlay_text") || null,
      slides,
      status, publishedOn,
      notes: get(cells, "notes") || null,
      warnings: w,
    };
  });
}

const H: [RegExp, PlanField][] = [
  [/^(#|št\.?|no\.?|nr\.?)$/i, "row_number"],
  [/posted on|objavljeno dne|objavljeno$|published on|datum objave/i, "published_on"],
  [/od danes|offset|relativ|\+\s*dni/i, "day_offset"],
  [/^(datum|date|day of|dan v)|datum/i, "date"],
  [/^(dan|day)\b/i, "day_number"],
  [/^(ura|time|čas|cas|hour)\b/i, "time"],
  [/platform|omrežje|kanal|network|channel/i, "platform"],
  [/račun|account|profil|handle/i, "account"],
  [/image type|tip slike|vrsta slike/i, "image_type"],
  [/^(format|tip|type|vrsta)\b/i, "format"],
  [/slide|slajd|karusel/i, "slides"],
  [/overlay|tekst na sliki|napis/i, "overlay_text"],
  [/prompt|image|slika|grafika|visual/i, "image_prompt"],
  [/cta.*hashtag|hashtag.*cta/i, "cta_hashtags"],
  [/hashtag|ključnik/i, "hashtags"],
  [/first comment|prvi komentar/i, "first_comment"],
  [/link|cta|poziv/i, "cta"],
  [/^(chars|znaki|dolžina|length)/i, "char_count"],
  [/caption|besedilo|text|copy|vsebina|post text|objava/i, "text"],
  [/tema|topic|naslov|title|hook/i, "topic"],
  [/categor|kategor|steber|pillar/i, "category"],
  [/audien|publika|ciljna/i, "audience"],
  [/status|stanje/i, "status"],
  [/notes|opomb|komentar/i, "notes"],
];

/**
 * Header words → fields, checked against sample values (a "Dan" column of weekday names is not a day number; a
 * "Datum" column of "+12" values is an offset). Used when the AI is unavailable and as the owner's starting point.
 */
export function guessMapping(header: string[], sample: string[][] = []): ColumnMapping {
  const used = new Set<PlanField>();
  const values = (i: number) => sample.map((r) => (r[i] ?? "").trim()).filter(Boolean);
  const columns = header.map((h, i) => {
    const hit = H.find(([re, f]) => re.test(h) && (!used.has(f) || f === "notes"));
    if (!hit) return "ignore" as const;
    let f = hit[1];
    const v = values(i);
    if (f === "day_number" && v.length && !v.every((x) => parseOffset(x) !== null)) return "ignore" as const;
    if (f === "date" && v.length && v.every((x) => /^[+-]\d+$/.test(x))) f = "day_offset";
    if (used.has(f) && f !== "notes") return "ignore" as const;
    used.add(f);
    return f;
  });
  return { columns, defaultPlatform: null, language: null };
}
