// One cost-capped Claude call (ADR-036): reserve the worst case, call, settle the real cost (or release on error).
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { brands, modelRegistry } from "../db/schema";
import { costMicroUsd, worstCaseMicroUsd } from "./cost";
import { release, reserve, settle } from "./spend";
import { LlmError, type LlmClient, type StructuredRequest, type Usage } from "./types";

/** A picture costs at most ~1,600 input tokens (Anthropic: width × height / 750, images ≤ 1.15 MP). */
const IMAGE_TOKENS = 1600;

export async function defaultTextModel(db: Db) {
  const [model] = await db.select().from(modelRegistry).where(and(eq(modelRegistry.kind, "text"), eq(modelRegistry.isDefault, true), eq(modelRegistry.enabled, true)));
  if (!model) throw new LlmError("NOT_CONFIGURED", "no text model");
  return model;
}

/** The brand's chosen Claude model when it is still an enabled text model, else the platform default. */
export async function textModelFor(db: Db, brandId: string | null) {
  if (brandId) {
    const [m] = await db.select({ model: modelRegistry }).from(brands)
      .innerJoin(modelRegistry, and(eq(modelRegistry.id, brands.textModelId), eq(modelRegistry.kind, "text"), eq(modelRegistry.enabled, true)))
      .where(eq(brands.id, brandId));
    if (m) return m.model;
  }
  return defaultTextModel(db);
}

/** Throws SpendCapError before any call when the cap would be passed; LlmError from the provider. */
export async function cappedCall(
  db: Db, llm: LlmClient,
  who: { orgId: string; brandId: string | null; postId: string | null; now?: Date },
  req: Omit<StructuredRequest, "model">,
): Promise<{ input: unknown; usage: Usage; model: string }> {
  const model = await textModelFor(db, who.brandId);
  const chars = req.system.reduce((n, b) => n + b.text.length, 0) + req.user.length + JSON.stringify(req.tool).length + (req.images?.length ?? 0) * IMAGE_TOKENS * 3;
  const ledgerId = await reserve(db, { ...who, provider: model.provider, model: model.modelKey, estimate: worstCaseMicroUsd(chars, req.maxTokens, model) });
  try {
    const out = await llm.structured({ ...req, model: model.modelKey });
    await settle(db, ledgerId, out.usage, costMicroUsd(out.usage, model));
    return { ...out, model: model.modelKey };
  } catch (e) {
    await release(db, ledgerId);
    throw e;
  }
}
