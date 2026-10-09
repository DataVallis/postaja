// Billing with Stripe (TASK-036, ADR-073): one row per organization that has a Stripe customer — the subscription's
// state as the webhooks last reported it — and every processed webhook event once (idempotency).
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./org";

export const SUBSCRIPTION_STATUSES = ["none", "active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const orgBilling = pgTable(
  "org_billing",
  {
    orgId: text("org_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").$type<SubscriptionStatus>().notNull().default("none"),
    /** solo / studio / agency from the subscription's price; pilot while a pilot runs. */
    plan: text("plan"),
    interval: text("interval").$type<"month" | "year">(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** When payments started failing; new AI work stops after the grace period. */
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    /** The 99 € agency pilot: until when it runs; one pilot per organization. */
    pilotEndsAt: timestamp("pilot_ends_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_billing_customer_uq").on(t.stripeCustomerId),
    check("org_billing_status_ck", sql`${t.status} in ('none','active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')`),
  ],
);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  orgId: text("org_id"),
  /** What Postaja did with it ("plan:studio", "pack:500", "ignored", …). */
  outcome: text("outcome").notNull().default(""),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every payment Stripe collected, with what the owner needs to issue the invoice in his own invoicing program (owner,
 * 2026-10-09: invoices are not issued by Stripe). Amounts in euro cents; the owner records the invoice number here.
 */
export const billingPayments = pgTable(
  "billing_payments",
  {
    /** Stripe invoice id (subscriptions) or Checkout session id (one-off payments). */
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organization.id, { onDelete: "set null" }),
    kind: text("kind").$type<"plan" | "pilot" | "pack">().notNull(),
    description: text("description").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    currency: text("currency").notNull(),
    netCents: integer("net_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    buyerName: text("buyer_name").notNull().default(""),
    buyerEmail: text("buyer_email").notNull().default(""),
    buyerAddress: text("buyer_address").notNull().default(""),
    buyerCountry: text("buyer_country").notNull().default(""),
    buyerVatId: text("buyer_vat_id").notNull().default(""),
    /** No VAT charged to an EU business outside Slovenia with a VAT id: the invoice must say "reverse charge". */
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    stripeCustomerId: text("stripe_customer_id"),
    invoiceNumber: text("invoice_number"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("billing_payments_paid_idx").on(t.paidAt), check("billing_payments_kind_ck", sql`${t.kind} in ('plan','pilot','pack')`)],
);
