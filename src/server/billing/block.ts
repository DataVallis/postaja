// When new AI work stops for an organization billed through Stripe (TASK-036, ADR-073) or on a self-serve trial
// (TASK-037). Pure, so `reserve` can use it inside its transaction. No billing row = an organization managed by hand in /admin: never stopped here.
import type { orgBilling } from "../db/schema";
import { GRACE_DAYS } from "./catalog";

const DAY = 86_400_000;

export function billingBlock(b: Pick<typeof orgBilling.$inferSelect, "status" | "pastDueSince" | "pilotEndsAt"> & { trialEndsAt?: Date | null } | null | undefined, now = new Date()): "PAST_DUE" | "ENDED" | null {
  if (!b) return null;
  if (b.status === "active" || b.status === "trialing") return null;
  if (b.status === "past_due") return b.pastDueSince && now.getTime() - b.pastDueSince.getTime() > GRACE_DAYS * DAY ? "PAST_DUE" : null;
  if (b.pilotEndsAt && b.pilotEndsAt > now) return null; // a running pilot
  if (b.trialEndsAt && b.trialEndsAt > now) return null; // a running trial (TASK-037)
  if (b.status === "canceled" || b.status === "unpaid" || b.status === "paused") return "ENDED";
  // An ended pilot or trial without a plan; a customer who only bought credits is fine.
  return b.pilotEndsAt || b.trialEndsAt ? "ENDED" : null;
}
