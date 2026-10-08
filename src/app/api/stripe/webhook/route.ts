import { getDb } from "@/server/db/client";
import { handleStripeEvent } from "@/server/billing/service";
import { getStripe, webhookSecret } from "@/server/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe webhooks (TASK-036, ADR-073). Only events signed with STRIPE_WEBHOOK_SECRET are read; each is processed once.
 * 200 = done (or already done), 400 = not from Stripe, 500 = try again later (Stripe retries).
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = webhookSecret();
  if (!stripe || !secret) return new Response("Not configured", { status: 503 });
  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  try {
    const r = await handleStripeEvent(getDb(), event);
    return Response.json({ received: true, result: r });
  } catch (e) {
    console.error("[stripe] webhook failed", event.type, e instanceof Error ? e.message.slice(0, 200) : "error");
    return new Response("Failed", { status: 500 });
  }
}
