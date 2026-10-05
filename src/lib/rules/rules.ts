// Three rule layers — platform, channel, brand — merged so the most strict wins (ADR-022).
import { emojiCount, hashtags, measure, mentions, urls, type Counting } from "./count";

export type RuleSet = {
  counting: Counting;
  captionMax?: number;
  /** Characters shown before "…more"; a warning, not an error. */
  visibleChars?: number;
  hashtagsMax?: number;
  mentionsMax?: number;
  emojiMax?: number;
  /** false = links in the caption are a violation (e.g. "links only in first comment"). */
  linksAllowed?: boolean;
  threadPartMax?: number;
  threadPartsMax?: number;
  slidesMin?: number;
  slidesMax?: number;
  bannedWords?: string[];
  mustEndWithCta?: boolean;
  regexMust?: string[];
  regexMustNot?: string[];
};

export type RuleLayer = Partial<RuleSet>;

const minDefined = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const maxDefined = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

/** Merge layers: numeric limits take the minimum (slidesMin the maximum), booleans the stricter value, lists the union. */
export function effectiveRules(platform: RuleSet, ...layers: (RuleLayer | undefined)[]): RuleSet {
  return layers.reduce<RuleSet>((acc, l) => {
    if (!l) return acc;
    return {
      counting: acc.counting, // counting is a platform fact, never overridden
      captionMax: minDefined(acc.captionMax, l.captionMax),
      visibleChars: minDefined(acc.visibleChars, l.visibleChars),
      hashtagsMax: minDefined(acc.hashtagsMax, l.hashtagsMax),
      mentionsMax: minDefined(acc.mentionsMax, l.mentionsMax),
      emojiMax: minDefined(acc.emojiMax, l.emojiMax),
      linksAllowed: acc.linksAllowed === false || l.linksAllowed === false ? false : (acc.linksAllowed ?? l.linksAllowed),
      threadPartMax: minDefined(acc.threadPartMax, l.threadPartMax),
      threadPartsMax: minDefined(acc.threadPartsMax, l.threadPartsMax),
      slidesMin: maxDefined(acc.slidesMin, l.slidesMin),
      slidesMax: minDefined(acc.slidesMax, l.slidesMax),
      bannedWords: [...new Set([...(acc.bannedWords ?? []), ...(l.bannedWords ?? [])])],
      mustEndWithCta: acc.mustEndWithCta || l.mustEndWithCta || undefined,
      regexMust: [...(acc.regexMust ?? []), ...(l.regexMust ?? [])],
      regexMustNot: [...(acc.regexMustNot ?? []), ...(l.regexMustNot ?? [])],
    };
  }, { ...platform });
}

export type ViolationCode =
  | "caption_too_long"
  | "too_many_hashtags"
  | "too_many_mentions"
  | "too_many_emoji"
  | "links_not_allowed"
  | "banned_word"
  | "regex_must"
  | "regex_must_not"
  | "missing_cta"
  | "thread_part_too_long"
  | "too_many_thread_parts"
  | "too_few_slides"
  | "too_many_slides";

export type Violation = { code: ViolationCode; actual: number | string; limit: number | string; part?: number };
export type Warning = { code: "truncated_preview"; actual: number; limit: number };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Checks one caption / post text against a rule set. */
export function checkText(text: string, rules: RuleSet, ctaPhrases: string[] = []): { violations: Violation[]; warnings: Warning[] } {
  const v: Violation[] = [];
  const w: Warning[] = [];
  const len = measure(text, rules.counting);
  if (rules.captionMax !== undefined && len > rules.captionMax) v.push({ code: "caption_too_long", actual: len, limit: rules.captionMax });
  if (rules.visibleChars !== undefined && len > rules.visibleChars) w.push({ code: "truncated_preview", actual: len, limit: rules.visibleChars });
  const tags = hashtags(text).length;
  if (rules.hashtagsMax !== undefined && tags > rules.hashtagsMax) v.push({ code: "too_many_hashtags", actual: tags, limit: rules.hashtagsMax });
  const ments = mentions(text).length;
  if (rules.mentionsMax !== undefined && ments > rules.mentionsMax) v.push({ code: "too_many_mentions", actual: ments, limit: rules.mentionsMax });
  const emo = emojiCount(text);
  if (rules.emojiMax !== undefined && emo > rules.emojiMax) v.push({ code: "too_many_emoji", actual: emo, limit: rules.emojiMax });
  if (rules.linksAllowed === false && urls(text).length > 0) v.push({ code: "links_not_allowed", actual: urls(text).length, limit: 0 });
  for (const word of rules.bannedWords ?? []) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) v.push({ code: "banned_word", actual: word, limit: "" });
  }
  for (const p of rules.regexMust ?? []) if (!new RegExp(p, "u").test(text)) v.push({ code: "regex_must", actual: "", limit: p });
  for (const p of rules.regexMustNot ?? []) if (new RegExp(p, "u").test(text)) v.push({ code: "regex_must_not", actual: "", limit: p });
  if (rules.mustEndWithCta) {
    const tail = text.trim().split(/\n+/).slice(-2).join(" ").toLowerCase();
    if (!ctaPhrases.some((c) => tail.includes(c.toLowerCase()))) v.push({ code: "missing_cta", actual: "", limit: ctaPhrases.join(" | ") });
  }
  return { violations: v, warnings: w };
}

/** X thread: every part within the per-part limit, number of parts within the maximum. */
export function checkThread(parts: string[], rules: RuleSet): Violation[] {
  const v: Violation[] = [];
  if (rules.threadPartsMax !== undefined && parts.length > rules.threadPartsMax)
    v.push({ code: "too_many_thread_parts", actual: parts.length, limit: rules.threadPartsMax });
  parts.forEach((p, i) => {
    const len = measure(p, rules.counting);
    if (rules.threadPartMax !== undefined && len > rules.threadPartMax) v.push({ code: "thread_part_too_long", actual: len, limit: rules.threadPartMax, part: i + 1 });
  });
  return v;
}

export function checkCarousel(slideCount: number, rules: RuleSet): Violation[] {
  const v: Violation[] = [];
  if (rules.slidesMin !== undefined && slideCount < rules.slidesMin) v.push({ code: "too_few_slides", actual: slideCount, limit: rules.slidesMin });
  if (rules.slidesMax !== undefined && slideCount > rules.slidesMax) v.push({ code: "too_many_slides", actual: slideCount, limit: rules.slidesMax });
  return v;
}
