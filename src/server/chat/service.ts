// Conversation next to the post (TASK-061, ADR-099). The owner writes what they want in words; Claude decides whether
// the post's text, its images or both change (or only answers), then the existing machinery does the work: the text
// goes through the same writing loop as a new post (CGP, rules, one automatic fix), the images through the same
// correction job as "Popravi slike" (only what is asked changes). Every message is kept as the post's history.
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { postMessages, posts, type ChatMeta } from "../db/schema";
import type { Storage } from "../files/storage";
import { ImageJobError, requestImages } from "../images/service";
import { cappedCall } from "../llm/call";
import { SpendCapError } from "../llm/spend";
import type { LlmClient } from "../llm/types";
import { PostError, postText, revisePostText } from "../posts/generate";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export const CHAT_MAX = 2000;

export class ChatError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "BAD_STATE" | "INVALID" | "BUSY" | "SPEND_CAP" | "FAILED") {
    super(code);
  }
}

export type ChatDeps = { llm: LlmClient; storage: Storage; queue: { send(name: string, data: object, key: string): Promise<void> }; now?: Date };
export type ChatMessage = { id: string; role: "user" | "assistant"; body: string; meta: ChatMeta; createdAt: Date };

/** The post's conversation, oldest first. */
export async function listMessages(db: Db, ctx: OrgContext, postId: string): Promise<ChatMessage[]> {
  const rows = await db.select().from(postMessages)
    .where(and(eq(postMessages.orgId, ctx.orgId), eq(postMessages.postId, postId)))
    .orderBy(asc(postMessages.createdAt), desc(postMessages.role)); // same instant: the owner first
  return rows.map((r) => ({ id: r.id, role: r.role, body: r.body, meta: r.meta, createdAt: r.createdAt }));
}

async function say(db: Db, ctx: OrgContext, postId: string, role: "user" | "assistant", body: string, meta: ChatMeta = {}, at?: Date) {
  await forOrg(db, ctx).insert(postMessages, { id: crypto.randomUUID(), postId, role, body, meta, createdBy: role === "user" ? ctx.userId : null, ...(at ? { createdAt: at } : {}) });
}

/** What Claude decides for one message (validated; empty instructions mean "no change there"). */
export const route = z.object({
  text: z.string().trim().max(CHAT_MAX).default(""),
  images: z.string().trim().max(CHAT_MAX).default(""),
  reply: z.string().trim().min(1).max(1000),
});

const ROUTE_TOOL = {
  name: "route_message",
  description: "Decide what the owner's message changes in the post and answer them briefly.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["text", "images", "reply"],
    properties: {
      text: { type: "string", description: "The change to the post's text, as an instruction for the writer, in the owner's words where possible. Empty when the text stays as it is." },
      images: { type: "string", description: "The change to the post's images (words on them, pictures, layout, colours, number of slides), as an instruction for the designer. Empty when the images stay as they are." },
      reply: { type: "string", description: "One or two short sentences to the owner, in the language they wrote in: what will change, or the answer to their question. No promises about results you cannot see." },
    },
  },
};

/**
 * One turn: the owner's message is stored, Claude routes it, the text is rewritten in place (seconds) and/or the images
 * are queued for correction (they appear on the page when done), and Postaja's answer is stored. Any member may write.
 */
export async function chatTurn(db: Db, deps: ChatDeps, ctx: OrgContext, postId: string, raw: string): Promise<ChatMeta> {
  const message = z.string().trim().min(1).max(CHAT_MAX).safeParse(raw);
  if (!message.success) throw new ChatError("INVALID");
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ChatError("NOT_FOUND");
  if (!p.content || !["ready", "needs_review", "approved"].includes(p.status)) throw new ChatError(p.status === "generating" ? "BUSY" : "BAD_STATE");
  if (p.mediaStatus === "queued" || p.mediaStatus === "rendering") throw new ChatError("BUSY");
  await say(db, ctx, postId, "user", message.data);

  const slides = p.visual?.slides.map((s, i) => `Image ${i + 1}: ${Object.entries(s.slots).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" | ")}`).join("\n");
  const history = (await listMessages(db, ctx, postId)).slice(-9, -1).map((m) => `${m.role === "user" ? "Owner" : "Postaja"}: ${m.body}`).join("\n");
  let decided: z.infer<typeof route>;
  try {
    const out = await cappedCall(db, deps.llm, { orgId: ctx.orgId, brandId: p.brandId, postId, now: deps.now, action: "assist" }, {
      system: [{ text: "You are Postaja's assistant for one social media post. The owner writes to you about the post. Decide what changes: the text, the images, both, or nothing (a question or a remark). Instructions go to a writer and a designer who see the post; keep them short and faithful to what the owner asked. Never invent changes the owner did not ask for." }],
      user: [
        `Original request: ${p.brief}`,
        `The post's text now:\n<post>\n${postText(p.content)}\n</post>`,
        slides ? `The post's images now (the words on them):\n${slides}` : "The post has no images yet. An instruction for images creates them.",
        history ? `Earlier in this conversation:\n${history}` : "",
        `The owner's message:\n${message.data}`,
      ].filter(Boolean).join("\n\n"),
      tool: ROUTE_TOOL,
      maxTokens: 600,
    });
    decided = route.parse(out.input);
  } catch (e) {
    const code = e instanceof SpendCapError ? "SPEND_CAP" : "FAILED";
    await say(db, ctx, postId, "assistant", "", { error: code });
    throw new ChatError(code);
  }

  const meta: ChatMeta = {};
  if (decided.text) {
    try {
      await revisePostText(db, deps, ctx, postId, decided.text);
      meta.text = true;
    } catch (e) {
      meta.error = e instanceof PostError && e.code === "SPEND_CAP" ? "SPEND_CAP" : "TEXT_FAILED";
    }
  }
  if (decided.images && !meta.error) {
    try {
      // With images: the correction job changes only what is asked. Without: new images, the instruction as the brief's addition.
      if (p.visual) await requestImages(db, deps.queue, ctx, postId, "revise", decided.images);
      else await requestImages(db, deps.queue, ctx, postId, "new");
      meta.images = true;
    } catch (e) {
      meta.error = e instanceof ImageJobError ? `IMAGES_${e.code}` : "IMAGES_FAILED";
    }
  }
  await say(db, ctx, postId, "assistant", decided.reply, meta);
  return meta;
}

/**
 * The start of a new post's conversation (TASK-061): the request as the owner's first message and Postaja's answer.
 * When the brand has a design, the images are made in the same step.
 */
export async function startConversation(db: Db, deps: Pick<ChatDeps, "queue">, ctx: OrgContext, postId: string, opts: { images: boolean }): Promise<ChatMeta> {
  const [p] = (await forOrg(db, ctx).select(posts, eq(posts.id, postId))) as (typeof posts.$inferSelect)[];
  if (!p) throw new ChatError("NOT_FOUND");
  const t0 = new Date();
  await say(db, ctx, postId, "user", p.brief, {}, t0);
  const meta: ChatMeta = p.content ? { created: true } : { error: p.error ?? "TEXT_FAILED" };
  if (p.content && opts.images) {
    try {
      await requestImages(db, deps.queue, ctx, postId, "new");
      meta.images = true;
    } catch (e) {
      // No design yet, or images already on their way: the text stands; the page shows how to get images.
      if (!(e instanceof ImageJobError)) throw e;
      meta.error = `IMAGES_${e.code}`;
    }
  }
  await say(db, ctx, postId, "assistant", "", meta, new Date(t0.getTime() + 1));
  return meta;
}
