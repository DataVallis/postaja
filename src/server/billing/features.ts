// Features per plan (TASK-053, ADR-083): Solo makes posts, images and carousels; Studio adds ad sets, animations and
// competitor research; Agencija (or the persona add-on) adds the persona. Checked on the server where the work starts;
// the pages show an upgrade offer instead of the tool. Organizations managed by hand (comped, partner, older plans)
// keep everything.
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orgBilling, orgSettings } from "../db/schema";
import type { OrgContext } from "../tenancy/context";
import { planFeatures, type Feature } from "./catalog";

export class PlanFeatureError extends Error {
  readonly code = "PLAN_FEATURE";
  constructor(public readonly feature: Feature) {
    super("PLAN_FEATURE");
  }
}

export async function orgFeatures(db: Db, orgId: string): Promise<Set<Feature>> {
  const [r] = await db.select({ plan: orgSettings.plan, addons: orgBilling.addons }).from(orgSettings)
    .leftJoin(orgBilling, eq(orgBilling.orgId, orgSettings.orgId)).where(eq(orgSettings.orgId, orgId));
  return planFeatures(r?.plan ?? "trial", r?.addons ?? {});
}

export async function hasFeature(db: Db, orgId: string, feature: Feature): Promise<boolean> {
  return (await orgFeatures(db, orgId)).has(feature);
}

/** Throws PlanFeatureError when the organization's plan does not include `feature`. */
export async function requireFeature(db: Db, ctx: Pick<OrgContext, "orgId">, feature: Feature): Promise<void> {
  if (!(await hasFeature(db, ctx.orgId, feature))) throw new PlanFeatureError(feature);
}
