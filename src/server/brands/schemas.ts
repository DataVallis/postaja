import { z } from "zod";
import { PLATFORMS, POST_TYPES } from "../db/schema";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex color #rrggbb");
const shortText = (max: number) => z.string().trim().max(max);
const safeRegex = z
  .string()
  .max(200)
  .refine((p) => {
    try {
      new RegExp(p, "u");
      return true;
    } catch {
      return false;
    }
  }, "invalid regex");
const limit = (max: number) => z.number().int().min(0).max(max);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/);

export const LANGUAGES = ["sl", "en", "de", "hr", "it"] as const;

export const brandInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  // Only http(s): a website is rendered as a link, so javascript:/data: URLs would be XSS.
  website: z.url({ protocol: /^https?$/ }).max(200).optional().or(z.literal("").transform(() => undefined)),
  languages: z.array(z.enum(LANGUAGES)).min(1).max(5),
});

export const pillarsSchema = z
  .array(z.object({ name: z.string().trim().min(1).max(60), description: shortText(500), share: z.number().int().min(0).max(100) }))
  .max(12)
  .refine((ps) => ps.reduce((s, p) => s + p.share, 0) <= 100, "pillar shares must add up to 100 or less")
  .refine((ps) => new Set(ps.map((p) => p.name.toLowerCase())).size === ps.length, "pillar names must be unique");

export const brandRulesSchema = z.object({
  bannedWords: z.array(z.string().trim().min(1).max(60)).max(200).default([]),
  ctaPhrases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  regexMust: z.array(safeRegex).max(10).default([]),
  regexMustNot: z.array(safeRegex).max(10).default([]),
  captionMax: limit(100_000).optional(),
  hashtagsMax: limit(100).optional(),
  emojiMax: limit(100).optional(),
  linksAllowed: z.boolean().optional(),
  mustEndWithCta: z.boolean().optional(),
}).refine((r) => !r.mustEndWithCta || r.ctaPhrases.length > 0, "mustEndWithCta needs at least one CTA phrase");

/** Image template (TASK-015, ADR-043). logoId: null = the brand's first logo, "none" = no logo; fontId: null = built-in. */
export const templateSchema = z.object({
  layout: z.enum(["card", "center", "photo"]).default("card"),
  label: z.enum(["category", "none"]).default("category"),
  accentLine: z.enum(["last", "first", "none"]).default("last"),
  uppercase: z.boolean().default(false),
  overlay: z.number().min(0).max(1).default(0.65),
  footerText: shortText(60).default(""),
  logoId: z.string().min(1).max(100).nullable().default(null),
  fontId: z.string().min(1).max(100).nullable().default(null),
  typeface: z.enum(["sans", "mono"]).default("sans"),
  background: z.enum(["ai", "plain"]).default("ai"),
});

export const visualSchema = z.object({
  colors: z.object({ primary: hex.optional(), secondary: hex.optional(), background: hex.optional(), text: hex.optional(), accent: hex.optional() }).default({}),
  imageStyle: shortText(1000).default(""),
  negativePrompt: shortText(1000).default(""),
  template: templateSchema.optional(),
});

export const profileInput = z.object({
  cgp: z.string().max(50_000),
  rules: brandRulesSchema,
  pillars: pillarsSchema,
  visual: visualSchema,
  note: shortText(200).optional(),
});

export const channelInput = z.object({
  platform: z.enum(PLATFORMS),
  handle: z.string().trim().min(1).max(80),
  language: z.enum(LANGUAGES),
  goal: z.object({
    postsPerDay: z.number().int().min(0).max(10),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).refine((d) => new Set(d).size === d.length, "duplicate weekday"),
  }),
  rules: z.object({ captionMax: limit(100_000).optional(), hashtagsMax: limit(100).optional(), linksAllowed: z.boolean().optional() }).default({}),
  allowedTypes: z.array(z.enum(POST_TYPES)).min(1),
  defaultPresetKey: z.string().max(80).optional(),
});
