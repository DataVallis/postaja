// What Postaja asks Claude for an animation (TASK-023): a motion spec for one image of a post, from its template's
// elements and words. Prompt and tool only; the spec is checked (motionSpecSchema + specIssues) before rendering.
import { z } from "zod";
import type { DesignSpec, Template } from "../design/spec";
import type { StructuredRequest } from "../llm/types";
import { BG_MOTIONS, ENTER_EFFECTS, LOOPS, MAX_S, MIN_S, motionSpecSchema } from "./motion";

export type MotionInputs = {
  spec: DesignSpec;
  template: Template;
  slots: Record<string, string>;
  /** The owner's wish (optional): pace, what to stress, length. */
  instruction: string;
  platform: string | null;
};

/** The template's elements as Claude sees them: what each is, where it sits and what it says. */
export function describeElements(t: Template, slots: Record<string, string>) {
  return t.elements.map((e, index) => {
    const box = { x: e.x, y: e.y, w: e.w, h: e.h };
    if (e.type === "text") return { index, kind: "text", slot: e.slot, text: (e.slot === "static" ? e.text ?? "" : slots[e.slot] ?? "").slice(0, 300), ...box };
    if (e.type === "image") return { index, kind: e.source === "logo" ? "logo" : "illustration_box", ...box };
    return { index, kind: "shape", ...box, note: e.w > e.h * 8 ? "a horizontal rule/bar" : e.h > e.w * 8 ? "a vertical rule/bar" : "a block/card" };
  });
}

export function motionRequest(i: MotionInputs, invalid?: { draft: unknown; errors: string }): Omit<StructuredRequest, "model"> {
  const schema = z.toJSONSchema(motionSpecSchema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    system: [{
      text: `You are the motion designer of Postaja. You animate ONE finished social image of a brand: its elements (texts, shapes, logo,
an illustration) already sit in their final places; you decide how and when each one appears and how the picture moves,
so the result is a short, calm, premium motion graphic that keeps the brand's thread: ${i.spec.summary}
Rules:
- Length ${MIN_S}–${MAX_S} s (default 6). The finished image must be fully visible and still for at least the last 1.5 s.
- Order the reveal like a reader: background and frame first, then label, the headline (the hero — "words" or "rise"),
  supporting text, then logo/footer/CTA. Overlapping, staggered entrances (0.15–0.4 s apart) feel natural.
- Entrance effects: ${ENTER_EFFECTS.join(", ")}. "words" reveals a text word by word (headlines, short lines only);
  "grow_x"/"grow_y" draw rules and bars; "pop" for chips, numbers, CTA buttons; "none" = visible from the start.
- Elements you do not list are visible from the start (good for the background card or frame).
- Loops after entering (${LOOPS.join(", ")}): at most one or two subtle ones (e.g. "pulse" a CTA, "float" a logo). Mostly "none".
- Illustration background motion (only if the template has a full-bleed illustration): ${BG_MOTIONS.join(", ")} with a small
  amount (0.04–0.12). For a plain or gradient background use "none".
- Never change words, colours, positions or sizes — only timing and motion. Respect the owner's wish if given.`,
      cache: true,
    }],
    user: [
      `<image platform="${i.platform ?? "?"}" template="${i.template.id}" background="${i.template.background.type}">`,
      `<elements>\n${JSON.stringify(describeElements(i.template, i.slots))}\n</elements>`,
      "</image>",
      i.instruction.trim() ? `<owner_wish>\n${i.instruction.trim()}\n</owner_wish>` : "",
      invalid ? `Your previous spec did not validate. Fix:\n${invalid.errors}\n<previous>${JSON.stringify(invalid.draft).slice(0, 6000)}</previous>` : "",
      "Write the motion spec now.",
    ].filter(Boolean).join("\n"),
    tool: { name: "submit_motion", description: "Submit the motion spec for the image.", inputSchema: schema },
    maxTokens: 2500,
    timeoutMs: 2 * 60_000,
  };
}
