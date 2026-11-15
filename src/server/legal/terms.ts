// Terms of use (TASK-060, ADR-095): the text lives in docs/legal/terms.<locale>.md and is shown at /terms; an
// organization's owner accepts a version — at signup, or before the first purchase — confirming that they buy for
// their business (the terms are for business users only, clause 1.3). Stored on org_settings and audited.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "@/lib/legal/terms";
import type { Db } from "../db/client";
import { auditLog, orgSettings } from "../db/schema";
import { parseMarkdown, plain, type Block } from "../guide/markdown";
import type { OrgContext } from "../tenancy/context";

export class TermsError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_CONFIRMED") {
    super(code);
  }
}

// Not traced by the bundler; next.config ships docs/legal with the /terms page.
const fileFor = (locale: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), "docs", "legal", `terms.${locale === "en" ? "en" : "sl"}.md`);

/** The terms in `locale` (Slovenian is binding; English is a translation): title and the parsed text. */
export async function termsText(locale: string): Promise<{ title: string; blocks: Block[] }> {
  const blocks = parseMarkdown(await readFile(/*turbopackIgnore: true*/ fileFor(locale), "utf8"));
  const h1 = blocks.find((b) => b.t === "h" && b.level === 1);
  return { title: h1 && h1.t === "h" ? plain(h1.v) : "Pogoji uporabe", blocks: blocks.filter((b) => b !== h1) };
}

/** Whether the organization accepted the current version of the terms. */
export async function termsAccepted(db: Db, orgId: string): Promise<boolean> {
  const [r] = await db.select({ v: orgSettings.termsVersion }).from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return r?.v === TERMS_VERSION;
}

/**
 * Owner: accept the current terms for the organization. `confirmed` is the ticked box "I buy for my business and
 * accept the terms"; without it nothing is stored.
 */
export async function acceptTerms(db: Db, ctx: Pick<OrgContext, "orgId" | "userId" | "role">, confirmed: boolean, now = new Date()): Promise<void> {
  if (ctx.role !== "owner") throw new TermsError("FORBIDDEN");
  if (!confirmed) throw new TermsError("NOT_CONFIRMED");
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ v: orgSettings.termsVersion }).from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId)).for("update");
    if (!before || before.v === TERMS_VERSION) return; // already accepted: nothing to write
    await tx.update(orgSettings).set({ termsVersion: TERMS_VERSION, termsAcceptedAt: now, termsAcceptedBy: ctx.userId, updatedAt: now }).where(eq(orgSettings.orgId, ctx.orgId));
    await tx.insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: ctx.userId, orgId: ctx.orgId, action: "org.terms.accept", target: TERMS_VERSION, meta: { version: TERMS_VERSION, business: true } });
  });
}
