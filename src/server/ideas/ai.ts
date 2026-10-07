// What Postaja asks Claude for post ideas (TASK-019, spec §6.2). Prompt and tool only.
import { z } from "zod";
import { languageName } from "@/lib/language";
import type { StructuredRequest } from "../llm/types";

export const IDEA_FORMATS = ["text", "image", "carousel", "thread"] as const;
export type IdeaFormat = (typeof IDEA_FORMATS)[number];

export type IdeaInputs = {
  brandName: string;
  language: string;
  platform: string;
  formats: IdeaFormat[];
  cgp: string;
  pillars: { name: string; description: string; share: number; recent: number }[];
  /** Recent posts of the brand, newest first: what not to repeat. */
  recent: { date: string | null; topic: string }[];
  count: number;
  hint: string;
  /** Ideas already rejected as repeats in this run (asked again for replacements). */
  avoid: string[];
};

const CGP_MAX = 20_000;

export function ideasSchema(pillars: string[], formats: IdeaFormat[], count: number) {
  return z.object({
    ideas: z.array(z.object({
      title: z.string().trim().min(3).max(160),
      angle: z.string().trim().min(3).max(600),
      pillar: (pillars.length ? z.enum(pillars as [string, ...string[]]) : z.string()).nullable(),
      format: z.enum(formats as [IdeaFormat, ...IdeaFormat[]]),
    })).min(1).max(count),
  });
}

export function ideasRequest(i: IdeaInputs): Omit<StructuredRequest, "model"> {
  const schema = z.toJSONSchema(ideasSchema(i.pillars.map((p) => p.name), i.formats, i.count), { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    system: [{
      text: `You are the content strategist of Postaja. You propose post ideas for ONE brand and one channel, from the brand's own
instructions (CGP). Each idea is a distinct topic with a concrete angle — not a generic theme — that this brand can say with
authority. Never repeat or rephrase a topic the brand has already posted or planned (listed in <recent_posts>), and never
two ideas on the same topic. Balance the content pillars towards their target share (fewer recent posts → more ideas).
Write titles and angles in the post language. Do not invent facts, prices, dates or offers that the CGP does not state.`,
      cache: true,
    }],
    user: [
      `<brand name="${i.brandName}" platform="${i.platform}" language="${languageName(i.language)}" formats="${i.formats.join(",")}">`,
      i.cgp.trim() ? `<cgp>\n${i.cgp.slice(0, CGP_MAX)}\n</cgp>` : "<cgp>(none yet)</cgp>",
      i.pillars.length ? `<pillars>\n${i.pillars.map((p) => `- ${p.name} (target ${p.share}%, recent posts ${p.recent}): ${p.description}`).join("\n")}\n</pillars>` : "",
      `<recent_posts>\n${i.recent.length ? i.recent.map((r) => `- ${r.date ?? "unscheduled"}: ${r.topic}`).join("\n") : "(none)"}\n</recent_posts>`,
      "</brand>",
      i.hint.trim() ? `<owner_wish>\n${i.hint.trim()}\n</owner_wish>` : "",
      i.avoid.length ? `These ideas repeat earlier posts and were rejected — propose different topics:\n${i.avoid.map((a) => `- ${a}`).join("\n")}` : "",
      `Propose exactly ${i.count} idea${i.count === 1 ? "" : "s"}. "angle" says what the post argues or shows in one or two sentences; "format" is one of the channel's formats.`,
    ].filter(Boolean).join("\n"),
    tool: { name: "suggest_post_ideas", description: "Submit the post ideas.", inputSchema: schema },
    maxTokens: Math.min(8000, 600 + i.count * 250),
    timeoutMs: 3 * 60_000,
  };
}
