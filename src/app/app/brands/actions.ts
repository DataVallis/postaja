"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgContextForAction } from "@/server/auth/require";
import { getDb } from "@/server/db/client";
import { PLATFORMS, POST_TYPES } from "@/server/db/schema";
import { addChannel, BrandError, createBrand, removeChannel, saveProfile, setBrandArchived } from "@/server/brands/service";
import { LANGUAGES } from "@/server/brands/schemas";
import { deleteBrandFile } from "@/server/brands/files";
import { getStorage } from "@/server/files/storage";
import { discardDraft } from "@/server/mcp/service";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const optInt = (f: FormData, k: string) => (str(f, k) === "" ? undefined : Number(str(f, k)));
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const list = (s: string) => s.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);

function errorCode(e: unknown): string {
  if (e instanceof BrandError) return e.code.toLowerCase();
  if (e instanceof z.ZodError) return "invalid";
  return "failed";
}

export async function createBrandAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "forbidden" };
  let id: string;
  try {
    id = (
      await createBrand(getDb(), ctx, {
        name: str(f, "name"),
        slug: str(f, "slug"),
        website: str(f, "website"),
        languages: f.getAll("languages").map(String) as (typeof LANGUAGES)[number][],
      })
    ).id;
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath("/app/brands");
  redirect(`/app/brands/${id}`);
}

/** Pillar lines: "Name | share | description". */
function parsePillars(text: string) {
  return lines(text).map((l) => {
    const [name, share, ...desc] = l.split("|").map((x) => x.trim());
    return { name: name ?? "", share: Number(share ?? "0"), description: desc.join(" | ") };
  });
}

export async function saveProfileAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "forbidden" };
  const brandId = str(f, "brandId");
  const links = str(f, "linksAllowed");
  try {
    const color = (k: string) => (str(f, k) ? str(f, k) : undefined);
    const r = await saveProfile(getDb(), ctx, brandId, {
      cgp: String(f.get("cgp") ?? ""),
      pillars: parsePillars(str(f, "pillars")),
      rules: {
        bannedWords: list(str(f, "bannedWords")),
        ctaPhrases: lines(str(f, "ctaPhrases")),
        regexMust: [],
        regexMustNot: [],
        captionMax: optInt(f, "captionMax"),
        hashtagsMax: optInt(f, "hashtagsMax"),
        emojiMax: optInt(f, "emojiMax"),
        linksAllowed: links === "" ? undefined : links === "yes",
        mustEndWithCta: f.get("mustEndWithCta") === "on",
      },
      visual: {
        colors: { primary: color("colorPrimary"), secondary: color("colorSecondary"), background: color("colorBackground"), text: color("colorText"), accent: color("colorAccent") },
        imageStyle: str(f, "imageStyle"),
        negativePrompt: str(f, "negativePrompt"),
      },
      note: str(f, "note") || undefined,
    });
    revalidatePath(`/app/brands/${brandId}`);
    return { ok: `v${r.version}` };
  } catch (e) {
    return { error: errorCode(e) };
  }
}

export async function addChannelAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "forbidden" };
  const brandId = str(f, "brandId");
  const links = str(f, "chLinksAllowed");
  try {
    await addChannel(getDb(), ctx, brandId, {
      platform: str(f, "platform") as (typeof PLATFORMS)[number],
      handle: str(f, "handle"),
      language: str(f, "language") as (typeof LANGUAGES)[number],
      goal: { postsPerDay: Number(str(f, "postsPerDay") || "0"), weekdays: f.getAll("weekdays").map(Number) },
      rules: { captionMax: optInt(f, "chCaptionMax"), hashtagsMax: optInt(f, "chHashtagsMax"), linksAllowed: links === "" ? undefined : links === "yes" },
      allowedTypes: f.getAll("allowedTypes").map(String) as (typeof POST_TYPES)[number][],
      defaultPresetKey: str(f, "defaultPresetKey") || undefined,
    });
    revalidatePath(`/app/brands/${brandId}`);
    return { ok: "channelAdded" };
  } catch (e) {
    return { error: errorCode(e) };
  }
}

export async function removeChannelAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  try {
    await removeChannel(getDb(), ctx, str(f, "channelId"));
  } catch {
    /* not found / forbidden: nothing to remove */
  }
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
}

export async function archiveBrandAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  await setBrandArchived(getDb(), ctx, str(f, "brandId"), true).catch(() => undefined);
  revalidatePath("/app/brands");
  redirect("/app/brands");
}

/** Owner only (checked in the service); the row goes first, then the S3 object (ADR-033). */
export async function deleteBrandFileAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  const table = str(f, "table") === "asset" ? "asset" : "source";
  await deleteBrandFile(getDb(), getStorage(), ctx, table, str(f, "fileId")).catch(() => undefined);
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
}

/** Owner only (checked in the service): drops the CGP Claude proposed through MCP (ADR-038). */
export async function discardCgpDraftAction(f: FormData): Promise<void> {
  const ctx = await orgContextForAction();
  if (!ctx) return;
  await discardDraft(getDb(), ctx, str(f, "draftId")).catch(() => undefined);
  revalidatePath(`/app/brands/${str(f, "brandId")}`);
}
