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
import { editPost, generateForPost, generatePost, getPost, PostError, setPostStatus, setPublishedUrl } from "@/server/posts/generate";
import { deleteImageVersion, ImageJobError, requestImages, restoreImageVersion, setPostPartnerLogo, setSlideTexts } from "@/server/images/service";
import { deletePostVideo } from "@/server/video/media";
import { requestPersonaVideo } from "@/server/video/persona";
import { requestAnimation } from "@/server/video/service";
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
  let error: string | null = null;
  await setPostStatus(getDb(), ctx, postId, to.data, { url: String(f.get("url") ?? "") }).catch((e) => { error = e instanceof PostError ? e.code : "FAILED"; });
  revalidatePath(`/app/posts/${postId}`);
  if (error) redirect(`/app/posts/${postId}?statusError=${error}`);
}

/** The link of a published post, added or corrected later (TASK-029). */
export async function setPublishedUrlAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const postId = String(f.get("postId") ?? "");
  let error: string | null = null;
  await setPublishedUrl(getDb(), ctx, postId, String(f.get("url") ?? "")).catch((e) => { error = e instanceof PostError ? e.code : "FAILED"; });
  revalidatePath(`/app/posts/${postId}`);
  redirect(`/app/posts/${postId}${error ? `?statusError=${error}` : ""}`);
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
/** TASK-031: the "S persono" checkbox, when the form shows it (`personaChoice` marks that it was shown). */
const personaChoice = (f: FormData): { withPersona?: boolean } => (f.get("personaChoice") ? { withPersona: f.get("withPersona") === "1" } : {});

export async function requestImagesAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  const mode = f.get("mode") === "text" ? "text" : "new";
  let error: string | null = null;
  try {
    await requestImages(getDb(), bossQueue(await getBoss()), ctx, id, mode, undefined, personaChoice(f));
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "FAILED";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?imageError=${error}` : ""}#images`);
}

/** "Popravi slike": the owner's correction in words; Claude changes only that, unchanged illustrations are reused. */
export async function reviseImagesAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  let error: string | null = null;
  try {
    await requestImages(getDb(), bossQueue(await getBoss()), ctx, id, "revise", String(f.get("instruction") ?? ""), personaChoice(f));
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "FAILED";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?imageError=${error}` : ""}#images`);
}

/** The words on the images, edited per image and slot, then re-rendered on the same illustrations (no image cost). */
export async function saveSlidesAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  const slides: Record<string, string>[] = [];
  for (const [k, v] of f.entries()) {
    const m = k.match(/^s(\d{1,2})\.([a-z]+)$/);
    if (!m) continue;
    (slides[Number(m[1])] ??= {})[m[2]] = String(v);
  }
  let error: string | null = null;
  try {
    await setSlideTexts(getDb(), ctx, id, Array.from(slides, (s) => s ?? {}));
    await requestImages(getDb(), bossQueue(await getBoss()), ctx, id, "text");
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "INVALID";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?imageError=${error}` : ""}#images`);
}

/** "Logotip partnerja" (TASK-035): saved on the post; existing images are redrawn with it for free. */
export async function setPartnerLogoAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  let error: string | null = null;
  try {
    await setPostPartnerLogo(getDb(), bossQueue(await getBoss()), ctx, id, String(f.get("partnerLogoId") ?? "") || null);
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "FAILED";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?imageError=${error}` : ""}#images`);
}

/** "Animiraj" (TASK-022): the chosen image's illustration moves as described; queued for the worker. */
export async function requestAnimationAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  let error: string | null = null;
  try {
    await requestAnimation(getDb(), bossQueue(await getBoss()), ctx, id, { position: Number(f.get("position") ?? 0), motion: String(f.get("motion") ?? "") });
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "FAILED";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?videoError=${error}` : ""}#animation`);
}

/** "Ustvari video s persono" (TASK-025): queued; the post page refreshes until the video is there. */
export async function requestPersonaVideoAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const id = String(f.get("postId") ?? "");
  let error: string | null = null;
  try {
    await requestPersonaVideo(getDb(), bossQueue(await getBoss()), ctx, id, { durationS: Number(f.get("durationS") ?? 5) as 5, wish: String(f.get("wish") ?? "") });
  } catch (e) {
    error = e instanceof ImageJobError ? e.code : "FAILED";
  }
  revalidatePath(`/app/posts/${id}`);
  redirect(`/app/posts/${id}${error ? `?personaVideoError=${error}` : ""}#persona-video`);
}

/** "Izbriši video" (TASK-032): any member removes one video of the post. */
export async function deletePostVideoAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const postId = String(f.get("postId") ?? "");
  await deletePostVideo(getDb(), getStorage(), ctx, String(f.get("videoId") ?? "")).catch(() => undefined);
  revalidatePath(`/app/posts/${postId}`);
  redirect(`/app/posts/${postId}#${String(f.get("anchor") ?? "animation") === "persona-video" ? "persona-video" : "animation"}`);
}

/** "Vrni to verzijo" (TASK-033): an earlier version of the images becomes current again; nothing is deleted. */
export async function restoreImageVersionAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const postId = String(f.get("postId") ?? "");
  let error: string | null = null;
  await restoreImageVersion(getDb(), ctx, postId, String(f.get("runId") ?? "")).catch((e) => { error = e instanceof ImageJobError ? e.code : "FAILED"; });
  revalidatePath(`/app/posts/${postId}`);
  redirect(`/app/posts/${postId}${error ? `?imageError=${error}` : ""}#images`);
}

/** "Izbriši verzijo" (TASK-033): an earlier version is deleted for good, on purpose. */
export async function deleteImageVersionAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const postId = String(f.get("postId") ?? "");
  await deleteImageVersion(getDb(), getStorage(), ctx, postId, String(f.get("runId") ?? "")).catch(() => undefined);
  revalidatePath(`/app/posts/${postId}`);
  redirect(`/app/posts/${postId}#images`);
}
