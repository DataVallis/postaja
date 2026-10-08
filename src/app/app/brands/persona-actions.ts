"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orgContextForAction } from "@/server/auth/require";
import { DNA_FIELDS } from "@/server/db/schema";
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/files/storage";
import { imageFailureCode } from "@/server/images/service";
import { bossQueue, getBoss } from "@/server/jobs/boss";
import { createAnthropicClient } from "@/server/llm/anthropic";
import { createPersona, createPersonaManual, deletePassportImage, deletePersona, PersonaError, requestPassport, setPersonaInPosts, setPrimaryImage, updatePersona } from "@/server/personas/service";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (brandId: string, error?: string) => `/app/brands/${brandId}?tab=persona${error ? `&personaError=${error}` : ""}`;
const code = (e: unknown) => (e instanceof PersonaError ? e.code : imageFailureCode(e)?.split(":")[0] ?? "FAILED");
const dnaOf = (f: FormData) => Object.fromEntries(DNA_FIELDS.map((k) => [k, str(f, `dna.${k}`)]));

async function ctxOrLogin() {
  const ctx = await orgContextForAction();
  if (!ctx) redirect("/login");
  return ctx;
}

/** "Ustvari z AI": Claude fills the DNA from the owner's rough description; "Ustvari ročno": the owner's own fields. */
export async function createPersonaAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  let error: string | undefined;
  try {
    if (str(f, "mode") === "manual") await createPersonaManual(getDb(), ctx, brandId, { name: str(f, "name"), handle: str(f, "handle"), dna: dnaOf(f) });
    else await createPersona(getDb(), { llm: createAnthropicClient() }, ctx, brandId, { name: str(f, "name"), text: String(f.get("text") ?? "") });
  } catch (e) {
    error = code(e);
    if (error === "FAILED") console.error("createPersona failed", e);
  }
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}

export async function updatePersonaAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  let error: string | undefined;
  try {
    await updatePersona(getDb(), ctx, str(f, "personaId"), { name: str(f, "name"), handle: str(f, "handle"), dna: dnaOf(f) });
  } catch (e) {
    error = code(e);
  }
  revalidatePath(`/app/brands/${brandId}`);
  redirect(`${back(brandId, error)}${error ? "" : "&saved=1"}`);
}

export async function deletePersonaAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  let error: string | undefined;
  try {
    await deletePersona(getDb(), getStorage(), ctx, str(f, "personaId"));
  } catch (e) {
    error = code(e);
  }
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}

/** "Ustvari passport sliko" / "Dopolni potne slike": queued; the tab refreshes until the pictures are there. */
export async function requestPassportAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  let error: string | undefined;
  try {
    await requestPassport(getDb(), bossQueue(await getBoss()), ctx, str(f, "personaId"));
  } catch (e) {
    error = code(e);
  }
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}

export async function setPrimaryImageAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  await setPrimaryImage(getDb(), ctx, str(f, "imageId")).catch(() => undefined);
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId));
}

export async function deletePassportImageAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  await deletePassportImage(getDb(), getStorage(), ctx, str(f, "imageId")).catch(() => undefined);
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId));
}

/** "Persona na slikah objav" on/off (TASK-027). */
export async function setPersonaInPostsAction(f: FormData) {
  const ctx = await ctxOrLogin();
  const brandId = str(f, "brandId");
  let error: string | undefined;
  try {
    await setPersonaInPosts(getDb(), ctx, str(f, "personaId"), str(f, "on") === "1");
  } catch (e) {
    error = code(e);
  }
  revalidatePath(`/app/brands/${brandId}`);
  redirect(back(brandId, error));
}
