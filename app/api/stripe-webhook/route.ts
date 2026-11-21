import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/stripe';
import { findOrderByPaymentIntent, updateOrder } from '@/lib/orders';

/**
 * Stripe webhook — keeps order records in sync with Stripe.
 *
 * The Stripe signature is verified against STRIPE_WEBHOOK_SECRET on
 * every call. When the secret is not set, unsigned payloads are
 * rejected (400) and logged — never trusted. Handled events:
 *   payment_intent.succeeded    → order awaiting_payment → paid
 *   payment_intent.payment_failed → order awaiting_payment → payment_failed
 * Anything else is acknowledged (200) and ignored.
 *
 * Stripe sends the raw body; this route reads req.text() (never
 * req.json()) so constructEvent sees the exact signed bytes.
 * Configure the endpoint in the Stripe dashboard (test mode) with the
 * webhook secret as STRIPE_WEBHOOK_SECRET in DigitalOcean.
 */

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  const verified = await verifyWebhookSignature(rawBody, signature);
  if (!verified.ok) {
    console.error('[stripe-webhook] rejected:', verified.error, '-', verified.message);
    return NextResponse.json({ ok: false, error: verified.error, message: verified.message }, { status: 400 });
  }
  const event = verified.event;
  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as { id?: string };
    if (typeof intent.id === 'string') {
      const order = await findOrderByPaymentIntent(intent.id);
      if (order && order.status === 'awaiting_payment') {
        await updateOrder(order.id, {
          status: event.type === 'payment_intent.succeeded' ? 'paid' : 'payment_failed',
        });
      }
    }
  }
  return NextResponse.json({ received: true });
}
