"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { POST_STATUSES } from "@/server/db/schema";
import { getStorage } from "@/server/files/storage";
import { createAnthropicClient } from "@/server/llm/anthropic";
import { reschedulePost } from "@/server/posts/calendar";
import { editPost, generateForPost, generatePost, getPost, PostError, setPostStatus } from "@/server/posts/generate";
import { ImageJobError, requestImages, setImageText } from "@/server/images/service";
import { bossQueue, getBoss } from "@/server/jobs/boss";

export type PostActionState = { error?: string; ok?: string } | undefined;

const code = (e: unknown) => (e instanceof PostError ? e.code : e instanceof z.ZodError ? "INVALID" : "FAILED");

/** Generates in the request (ADR-036); the browser waits ~5–20 s and lands on the post. */
export async function generatePostAction(_p: PostActionState, f: FormData): Promise<PostActionState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "FORBIDDEN" };
  let id: string;
  try {
    id = await generatePost(getDb(), { llm: createAnthropicClient(), storage: getStorage() }, ctx, {
      brandId: String(f.get("brandId") ?? ""),
      channelId: String(f.get("channelId") ?? ""),
      brief: String(f.get("brief") ?? ""),
    });
  } catch (e) {
    return { error: code(e) };
  }
  revalidatePath(`/app/brands/${String(f.get("brandId") ?? "")}`);
  redirect(`/app/posts/${id}`);
}

export async function retryPostAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const old = await getPost(getDb(), ctx, String(f.get("postId") ?? "")).catch(() => null);
  if (!old?.channelId) return;
  const deps = { llm: createAnthropicClient(), storage: getStorage() };
  // A failed post without text is retried in place (TASK-014); one that has text gets a fresh draft.
  if (!old.content) {
    await generateForPost(getDb(), deps, ctx, old.id).catch(() => undefined);
    revalidatePath(`/app/posts/${old.id}`);
    redirect(`/app/posts/${old.id}`);
  }
  const id = await generatePost(getDb(), deps, ctx, { brandId: old.brandId, channelId: old.channelId, brief: old.brief });
  redirect(`/app/posts/${id}`);
}

export async function editPostAction(_p: PostActionState, f: FormData): Promise<PostActionState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "FORBIDDEN" };
  const postId = String(f.get("postId") ?? "");
  const parts = f.getAll("part").map(String);
  try {
    const v = await editPost(getDb(), ctx, postId, parts.length ? { parts } : { caption: String(f.get("caption") ?? "") });
    revalidatePath(`/app/posts/${postId}`);
    return { ok: v.length ? "savedWithIssues" : "saved" };
  } catch (e) {
    return { error: code(e) };
  }
}

export async function setPostStatusAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const postId = String(f.get("postId") ?? "");
  const to = z.enum(POST_STATUSES).safeParse(f.get("to"));
  if (!to.success) return;
  await setPostStatus(getDb(), ctx, postId, to.data).catch(() => undefined);
  revalidatePath(`/app/posts/${postId}`);
}

/** New slot from the post page (TASK-013): empty date = off the plan. */
export async function reschedulePostAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  const date = String(f.get("date") ?? "").trim() || null;
  const time = String(f.get("time") ?? "").trim() || null;
  let error: string | null = null;
  try {
    await reschedulePost(getDb(), ctx, id, { date, time: date ? time : null });
  } catch (e) {
    error = code(e);
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?slotError=${error}` : ""}`);
}

/** "Napiši besedilo z AI" on a planned post (TASK-014): written now, from the plan, in place. */
export async function writePlannedPostAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  await generateForPost(getDb(), { llm: createAnthropicClient(), storage: getStorage() }, ctx, id).catch(() => undefined);
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}`);
}

/** "Ustvari slike" / "Nova ozadja" / "Osveži tekst" (TASK-015): queued for the worker; the page refreshes until done. */
export async function requestImagesAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  const mode = f.get("mode") === "text" ? "text" : "new";
  let error: string | null = null;
  try {
    await requestImages(getDb(), bossQueue(await getBoss()), ctx, id, mode);
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "FAILED";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?imageError=${error}` : ""}#images`);
}

/** Text on the images, by hand (one block per slide). */
export async function saveImageTextAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  let error: string | null = null;
  try {
    await setImageText(getDb(), ctx, id, String(f.get("imageText") ?? ""));
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "INVALID";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?imageError=${error}` : ""}#images`);
}
