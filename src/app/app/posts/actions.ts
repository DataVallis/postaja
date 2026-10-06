"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { POST_STATUSES } from "@/server/db/schema";
import { getStorage } from "@/server/files/storage";
import { createAnthropicClient } from "@/server/llm/anthropic";
import { editPost, generatePost, getPost, PostError, setPostStatus } from "@/server/posts/generate";

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
  const id = await generatePost(getDb(), { llm: createAnthropicClient(), storage: getStorage() }, ctx, { brandId: old.brandId, channelId: old.channelId, brief: old.brief });
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
