"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperadmin } from "@/server/admin/guard";
import { getDb } from "@/server/db/client";
import type { Platform } from "@/server/db/schema";
import { updateFormatPreset, updatePlatformRule } from "@/server/rules/admin";

export type PlatformActionState = { error?: "invalid" | "failed"; ok?: "saved" | "unchanged" } | undefined;

/** "" → null; anything else → Number (validation rejects NaN and fractions). */
const int = (form: FormData, k: string) => {
  const v = String(form.get(k) ?? "").trim();
  return v === "" ? null : Number(v);
};
const str = (form: FormData, k: string) => String(form.get(k) ?? "");
const bool = (form: FormData, k: string) => form.get(k) === "on";

function done(changes: Record<string, unknown>): PlatformActionState {
  revalidatePath("/admin/platform");
  revalidatePath("/admin");
  return { ok: Object.keys(changes).length ? "saved" : "unchanged" };
}
const fail = (e: unknown): PlatformActionState => ({ error: e instanceof z.ZodError ? "invalid" : "failed" });

export async function updateRuleAction(_prev: PlatformActionState, form: FormData): Promise<PlatformActionState> {
  const actor = await requireSuperadmin();
  try {
    const changes = await updatePlatformRule(getDb(), actor, str(form, "platform") as Platform, {
      counting: str(form, "counting") as "graphemes",
      captionMax: int(form, "captionMax"),
      visibleChars: int(form, "visibleChars"),
      hashtagsMax: int(form, "hashtagsMax"),
      mentionsMax: int(form, "mentionsMax"),
      linksClickable: bool(form, "linksClickable"),
      threadPartMax: int(form, "threadPartMax"),
      threadPartsMax: int(form, "threadPartsMax"),
      slidesMin: int(form, "slidesMin"),
      slidesMax: int(form, "slidesMax"),
      source: str(form, "source"),
      confidence: str(form, "confidence") as "high",
      notes: str(form, "notes"),
      verifiedAt: str(form, "verifiedAt"),
    });
    return done(changes);
  } catch (e) {
    return fail(e);
  }
}

export async function updatePresetAction(_prev: PlatformActionState, form: FormData): Promise<PlatformActionState> {
  const actor = await requireSuperadmin();
  try {
    const changes = await updateFormatPreset(getDb(), actor, str(form, "key"), {
      width: int(form, "width") as number,
      height: int(form, "height") as number,
      maxBytes: int(form, "maxBytes"),
      minDurationS: int(form, "minDurationS"),
      maxDurationS: int(form, "maxDurationS"),
      safeZone: {
        top: int(form, "safeTop") ?? 0,
        right: int(form, "safeRight") ?? 0,
        bottom: int(form, "safeBottom") ?? 0,
        left: int(form, "safeLeft") ?? 0,
      },
      enabled: bool(form, "enabled"),
      source: str(form, "source"),
      confidence: str(form, "confidence") as "high",
      notes: str(form, "notes"),
      verifiedAt: str(form, "verifiedAt"),
    });
    return done(changes);
  } catch (e) {
    return fail(e);
  }
}
