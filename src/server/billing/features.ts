// Features per plan (TASK-053, ADR-083; launch scope ADR-094): Solo makes posts, images, carousels and animations; the
// persona is an add-on; ad sets and competitor research are hidden unless a super admin switched them on for the
// organization. Checked on the server where the work starts; the pages show an upgrade offer only for what can be
// bought. Organizations managed by hand (comped, partner, older plans) keep everything.
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
  const [r] = await db.select({ plan: orgSettings.plan, addons: orgBilling.addons, extra: orgSettings.extraFeatures }).from(orgSettings)
    .leftJoin(orgBilling, eq(orgBilling.orgId, orgSettings.orgId)).where(eq(orgSettings.orgId, orgId));
  return planFeatures(r?.plan ?? "trial", r?.addons ?? {}, r?.extra ?? []);
}

export async function hasFeature(db: Db, orgId: string, feature: Feature): Promise<boolean> {
  return (await orgFeatures(db, orgId)).has(feature);
}

/** Throws PlanFeatureError when the organization's plan does not include `feature`. */
export async function requireFeature(db: Db, ctx: Pick<OrgContext, "orgId">, feature: Feature): Promise<void> {
  if (!(await hasFeature(db, ctx.orgId, feature))) throw new PlanFeatureError(feature);
}
