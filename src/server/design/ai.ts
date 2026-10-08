// What Postaja asks Claude for images (TASK-017, ADR-044): a brand's visual system (from scratch or revised), and per
// post which template each image uses, the words on it and what the illustration shows. Prompts and tools only.
import { z } from "zod";
import { languageName } from "@/lib/language";
import type { ImageBlock, StructuredRequest } from "../llm/types";
import { designJsonSchema, nullableSlotTexts, templateSlots, needsIllustration, type DesignSpec } from "./spec";

const DSL = `How a design is described (Postaja renders it exactly; every letter is drawn by Postaja, never by an image model):
- Canvas positions and sizes are percent: x/y/w/h of the canvas (0–100). The same template is rendered at 4:5 (1080×1350),
  1:1 (1080×1080) and 16:9 (1600×900), so keep layouts robust: generous safe margins (≥ 6%), nothing important at the edges.
- Font sizes (maxSize/minSize) are percent of the canvas WIDTH: big headlines 7–11, sub-heads 3.5–5, body 2.6–4, labels 1.8–2.6.
  Text is fitted into its box between minSize and maxSize, so make text boxes big enough for the longest expected text.
- Text elements show a slot filled per post (headline, subhead, label, body, cta, number, footer) or fixed text (slot "static").
  In slot text, words written *like this* are drawn in the element's "emphasis" colour — use that for the brand's highlight style.
- "fill" gives text a chip/button background; shapes make rules, bars, frames, cards, dots; "image" places the logo or the post's
  generated illustration in a box. A template background is a colour, a gradient, or a full-bleed illustration with an overlay
  (use an overlay strong enough that text stays readable; fade "bottom" darkens towards the text).
- Colours are palette keys (background, surface, text, muted, accent, accent2) or #hex. Keep contrast WCAG-readable.
- Characters: any Latin text with č š ž ć đ, punctuation, arrows and simple symbols (✓ ✗ → ★ ● ■ ▲); no emoji.
- Fonts: built-in families sans (Inter), grotesk (Space Grotesk), serif (Playfair Display), mono (JetBrains Mono), or "brand"
  (the brand's own font, only if one is uploaded). Weight 400 or 700.`;

const SYSTEM_DESIGN = `You are the art director of Postaja, a tool that makes social posts for many brands of many clients.
You create ONE brand's visual system: a small set of templates that every future image of this brand is made from, so the
feed is instantly recognisable and consistent, yet each post can differ. It must belong to THIS brand only — derive it
from the brand's identity (CGP), the owner's description, its colours, logo and especially its past posts if shown.
Do not fall back to generic social-media looks; if past posts exist, keep their composition, typography feel, colour use and
signature details (labels, rules, footers, numbering, framing) and make them systematic.

${DSL}

Make 3–6 templates that cover what this brand posts: a cover/single image with a strong headline, an inner carousel slide
(points or steps), and whatever else the brand needs (quote, statistic/number, announcement, call to action). Give each
an id (kebab-case), a short Slovenian-or-brand-language name, "use" (when to pick it), and sample content in the brand's
language showing the intended length. Describe the illustration style precisely (medium, lighting, colours, mood,
composition, what to avoid) — it is given to the image model with every illustration, together with the brand's examples.
The summary states the common thread in two or three sentences.`;

export type DesignInputs = {
  brand: { name: string; website: string | null; languages: string[] };
  cgp: string;
  colors: Record<string, string | undefined>;
  imageStyle: string;
  negativePrompt: string;
  brief: string;
  hasLogo: boolean;
  brandFont: string | null;
  examples: ImageBlock[];
  logo: ImageBlock | null;
};

const CGP_MAX = 20_000;

function brandBlock(i: DesignInputs): string {
  const colors = Object.entries(i.colors).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    `<brand name="${i.brand.name}"${i.brand.website ? ` website="${i.brand.website}"` : ""} languages="${i.brand.languages.join(",")}">`,
    i.cgp.trim() ? `<cgp>\n${i.cgp.slice(0, CGP_MAX)}\n</cgp>` : "<cgp>(none yet)</cgp>",
    colors ? `<brand_colours>${colors}</brand_colours>` : "",
    i.imageStyle.trim() ? `<image_style_notes>${i.imageStyle}</image_style_notes>` : "",
    i.negativePrompt.trim() ? `<avoid>${i.negativePrompt}</avoid>` : "",
    `<assets logo="${i.hasLogo ? "yes" : "no"}" brand_font="${i.brandFont ?? "none"}" past_post_images="${i.examples.length}"/>`,
    "</brand>",
  ].filter(Boolean).join("\n");
}

function images(i: DesignInputs, extra: ImageBlock[] = []): ImageBlock[] {
  return [
    ...(i.logo ? [{ ...i.logo, caption: "The brand logo:" }] : []),
    ...i.examples.map((e, n) => ({ ...e, caption: `Past post of this brand ${n + 1}/${i.examples.length}:` })),
    ...extra,
  ];
}

const tool = { name: "submit_brand_design", description: "Submit the brand's visual system.", inputSchema: designJsonSchema() };

/** A design from scratch. */
export function createDesignRequest(i: DesignInputs, invalid?: { draft: unknown; errors: string }): Omit<StructuredRequest, "model"> {
  return {
    system: [{ text: SYSTEM_DESIGN, cache: true }],
    images: images(i),
    user: [
      brandBlock(i),
      `<owner_description>\n${i.brief.trim() || "(no description — infer from the CGP, colours and past posts)"}\n</owner_description>`,
      invalid ? `Your previous answer did not validate. Fix exactly these problems and submit again:\n${invalid.errors}\n<previous>${JSON.stringify(invalid.draft).slice(0, 20_000)}</previous>` : "",
      "Create the brand's visual system now.",
    ].filter(Boolean).join("\n\n"),
    tool,
    maxTokens: 12_000,
    // A full design is several thousand output tokens: minutes, not seconds (the SDK default of 90 s cut it off).
    timeoutMs: 8 * 60_000,
  };
}

/** A revision: the current design, what it looks like now (rendered previews), and the owner's words. */
export function reviseDesignRequest(i: DesignInputs, current: DesignSpec, instruction: string, previews: ImageBlock[], invalid?: { draft: unknown; errors: string }): Omit<StructuredRequest, "model"> {
  return {
    system: [{ text: SYSTEM_DESIGN, cache: true }],
    images: images(i, previews),
    user: [
      brandBlock(i),
      `<current_design>\n${JSON.stringify(current)}\n</current_design>`,
      "The last images above are the current templates rendered with their sample content.",
      `<owner_request>\n${instruction.trim()}\n</owner_request>`,
      invalid ? `Your previous answer did not validate. Fix exactly these problems:\n${invalid.errors}\n<previous>${JSON.stringify(invalid.draft).slice(0, 20_000)}</previous>` : "",
      "Apply the owner's request to the design. Change only what the request asks for (and what it implies for consistency across templates); keep everything else exactly as it is, including template ids. Submit the full revised design.",
    ].filter(Boolean).join("\n\n"),
    tool,
    maxTokens: 12_000,
    // A full design is several thousand output tokens: minutes, not seconds (the SDK default of 90 s cut it off).
    timeoutMs: 8 * 60_000,
  };
}

/** Zod issues as short lines for a retry prompt. */
export const issues = (e: z.ZodError) => e.issues.slice(0, 20).map((x) => `- ${x.path.join(".")}: ${x.message}`).join("\n");

// ---- per post ----

export type PostVisualInputs = {
  brandName: string;
  language: string;
  platform: string | null;
  format: string;
  brief: string;
  plan: Record<string, unknown>;
  caption: string | null;
  /** TASK-027: the brand's persona appears in the illustrations. */
  persona?: { name: string } | null;
};

export const MAX_SLIDES = 20;

/** Claude's choice for one post: template, words and illustration per image. */
export function postVisualSchema(spec: DesignSpec) {
  const ids = spec.templates.map((t) => t.id) as [string, ...string[]];
  return z.object({
    slides: z.array(z.object({
      templateId: z.enum(ids),
      slots: nullableSlotTexts(600),
      illustration: z.string().max(1500).nullable(),
    })).min(1).max(MAX_SLIDES),
  });
}

/** A correction of a post's images in the owner's words (owner, 2026-10-07): the current plan and how it looks now. */
export type VisualRevision = { current: { templateId: string; slots: Record<string, string>; illustration: string | null }[]; instruction: string; previews: ImageBlock[] };

export function postVisualRequest(spec: DesignSpec, p: PostVisualInputs, invalid?: { draft: unknown; errors: string }, revise?: VisualRevision): Omit<StructuredRequest, "model"> {
  const templates = spec.templates.map((t) => ({
    id: t.id, name: t.name, use: t.use, slots: templateSlots(t), illustration: needsIllustration(t), sample: t.sample,
  }));
  const schema = z.toJSONSchema(postVisualSchema(spec), { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    system: [{
      text: `You are the art director of Postaja. For one post you choose, from the brand's own templates, the template of each image,
the words on it and what its illustration shows. Keep the brand's common thread: ${spec.summary}
Rules:
- Every word on the images is in the post's language (the language attribute of <post>), whatever language the plan, brief
  or caption is written in.
- On-image words come from the plan: if the plan has text for the image (overlay text) or slide texts, use them verbatim when
  they are in the post's language, otherwise translate them faithfully (same meaning, names, numbers). You may split them over
  the template's slots and mark the key words with *…* for emphasis. Without such text, write a short hook from the topic —
  a headline is at most ~8 words — that complements the caption: the image is seen right above the caption, so never
  repeat the caption's sentences, steps or lists on the image; one idea that makes people read on. Never invent facts,
  prices or dates.
- Image prompt: when the plan has "imagePrompt", the owner has decided the picture. The first image uses a template that
  shows an illustration (illustration=true), and its illustration is the plan's imagePrompt word for word.
- Fill only the slots the template has; keep each about as long as the template's sample.
- Carousel: one image per slide of the plan (a cover first if the plan has no cover slide); otherwise one image. At most ${MAX_SLIDES}.
- Illustration: only for templates that show one (illustration=true), else null. Describe the subject and composition concretely
  (what is in the picture, where, leaving room where the text goes); the brand's illustration style is added automatically.
  Never ask for text, letters, logos or watermarks in the picture. In a carousel, use illustrations where they help, not everywhere.`,
      cache: true,
    }],
    user: [
      `<templates>\n${JSON.stringify(templates)}\n</templates>`,
      `<post brand="${p.brandName}" language="${languageName(p.language)}" platform="${p.platform ?? "?"}" format="${p.format}">`,
      `<brief>${p.brief}</brief>`,
      `<plan>${JSON.stringify(p.plan)}</plan>`,
      p.caption ? `<caption>${p.caption.slice(0, 3000)}</caption>` : "",
      "</post>",
      p.persona ? `<persona name="${p.persona.name.replace(/"/g, "'")}">Every illustration shows this brand's persona, a real-looking person made from reference photos. Describe the scene as a photo: what she or he does, where, the framing and where the text has room — never the face, hair or body (they come from the photos).</persona>` : "",
      revise ? `<current_images>\n${JSON.stringify(revise.current)}\n</current_images>\nThe images above are these current images, in order.` : "",
      revise ? `<owner_request>\n${revise.instruction.trim()}\n</owner_request>` : "",
      revise
        ? `Apply the owner's request to the current images and submit all images again. Change only what the request asks for (and what it implies); keep every other image, template, word and illustration description exactly as it is — identical text — so unchanged illustrations are reused at no cost. If the request is about the picture itself (subject, colours, mood, composition), rewrite that image's illustration description; if it is about words, change the slots; if it is about layout, pick another of the brand's templates. Adding or removing images only when asked.`
        : "",
      invalid ? `Your previous answer did not validate. Fix:\n${invalid.errors}\n<previous>${JSON.stringify(invalid.draft).slice(0, 8000)}</previous>` : "",
    ].filter(Boolean).join("\n"),
    ...(revise?.previews.length ? { images: revise.previews } : {}),
    tool: { name: "plan_post_images", description: "Choose template, words and illustration for each image of the post.", inputSchema: schema },
    maxTokens: 4000,
    timeoutMs: 3 * 60_000,
  };
}
