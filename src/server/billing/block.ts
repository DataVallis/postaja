// When new AI work stops for an organization billed through Stripe (TASK-036, ADR-073). Pure, so `reserve` can use it
// inside its transaction. No billing row = an organization managed by hand in /admin: never stopped here.
import type { orgBilling } from "../db/schema";
import { GRACE_DAYS } from "./catalog";

const DAY = 86_400_000;

export function billingBlock(b: Pick<typeof orgBilling.$inferSelect, "status" | "pastDueSince" | "pilotEndsAt"> | null | undefined, now = new Date()): "PAST_DUE" | "ENDED" | null {
  if (!b) return null;
  if (b.status === "active" || b.status === "trialing") return null;
  if (b.status === "past_due") return b.pastDueSince && now.getTime() - b.pastDueSince.getTime() > GRACE_DAYS * DAY ? "PAST_DUE" : null;
  if (b.pilotEndsAt && b.pilotEndsAt > now) return null; // a running pilot
  if (b.status === "canceled" || b.status === "unpaid" || b.status === "paused") return "ENDED";
  return b.pilotEndsAt ? "ENDED" : null; // an ended pilot without a plan; a customer who only bought credits is fine
}
