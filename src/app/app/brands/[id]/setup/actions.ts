"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgContextForAction } from "@/server/auth/require";
import { BrandError, saveProfilePart } from "@/server/brands/service";
import { getDb } from "@/server/db/client";

export type SetupState = { error?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const optInt = (f: FormData, k: string) => (str(f, k) === "" ? undefined : Number(str(f, k)));
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const list = (s: string) => s.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);

/**
 * One wizard step (TASK-055): CGP, topics and rules, or colours and image style. Saves a new profile version with only
 * that part changed, then goes on to the next step.
 */
export async function saveSetupPartAction(_p: SetupState, f: FormData): Promise<SetupState> {
  const ctx = await orgContextForAction();
  if (!ctx) return { error: "forbidden" };
  const brandId = str(f, "brandId");
  const part = str(f, "part");
  const next = str(f, "next");
  try {
    if (part === "cgp") {
      await saveProfilePart(getDb(), ctx, brandId, { cgp: String(f.get("cgp") ?? ""), note: "čarovnik: CGP" });
    } else if (part === "rules") {
      const pillars = [0, 1, 2, 3, 4].map((i) => ({ name: str(f, `pillar${i}`), share: Number(str(f, `share${i}`) || "0"), description: str(f, `pillarDesc${i}`) })).filter((p) => p.name);
      const links = str(f, "linksAllowed");
      await saveProfilePart(getDb(), ctx, brandId, {
        pillars,
        rules: {
          ctaPhrases: lines(str(f, "ctaPhrases")), bannedWords: list(str(f, "bannedWords")),
          hashtagsMax: optInt(f, "hashtagsMax"), emojiMax: optInt(f, "emojiMax"),
          linksAllowed: links === "" ? undefined : links === "yes", mustEndWithCta: f.get("mustEndWithCta") === "on",
        },
        note: "čarovnik: teme in pravila",
      });
    } else if (part === "visual") {
      const color = (k: string) => (str(f, k) ? str(f, k) : undefined);
      await saveProfilePart(getDb(), ctx, brandId, {
        visual: {
          colors: { primary: color("colorPrimary"), secondary: color("colorSecondary"), background: color("colorBackground"), text: color("colorText"), accent: color("colorAccent") },
          imageStyle: str(f, "imageStyle"), negativePrompt: str(f, "negativePrompt"),
        },
        note: "čarovnik: barve in slog",
      });
    } else return { error: "invalid" };
  } catch (e) {
    if (e instanceof BrandError) return { error: e.code.toLowerCase() };
    if (e instanceof z.ZodError) return { error: e.issues.some((i) => i.path.includes("pillars")) ? "pillars" : "invalid" };
    return { error: "failed" };
  }
  revalidatePath(`/app/brands/${brandId}`, "layout");
  redirect(`/app/brands/${brandId}/setup?step=${encodeURIComponent(next)}`);
}
