"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { ReviewError, submitReview } from "@/server/reviews/service";

/** The client's decision on one post (TASK-041); the token in the form is the only key. */
export async function submitReviewAction(f: FormData): Promise<void> {
  const token = String(f.get("token") ?? "");
  const postId = String(f.get("postId") ?? "");
  const decision = f.get("decision") === "changes" ? "changes" : "approved";
  let error: string | undefined;
  await submitReview(getDb(), token, postId, { decision, comment: String(f.get("comment") ?? ""), reviewer: String(f.get("reviewer") ?? "") })
    .catch((e) => { error = e instanceof ReviewError ? e.code : "FAILED"; });
  redirect(`/r/${encodeURIComponent(token)}?${error ? `error=${error}&post=${postId}` : `done=${postId}`}#p-${postId}`);
}
