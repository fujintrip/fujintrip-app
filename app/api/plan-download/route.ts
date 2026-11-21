import { NextRequest, NextResponse } from 'next/server';
import {
  isStripeConfigured,
  stripeMode,
  createPaymentIntent,
  retrievePaymentIntent,
  verifyPaymentIntentForTotal,
  toCents,
} from '@/lib/stripe';
import {
  newOrder,
  saveOrder,
  findOrderByPaymentIntent,
  updateOrder,
} from '@/lib/orders';

/**
 * Plan PDF download — the $1 rule (firm, Nov 10, 2026).
 * Downloading the full plan PDF costs $1 when the traveler has NOT booked
 * with FujinTrip; it is FREE when they booked with us.
 *
 * POST { destination, travelers, booked } →
 *   { decision: 'free' | 'pay_1' | 'paid', priceCents,
 *     stripe: 'ready' | 'not_configured', stripeMode,
 *     paymentIntentClientSecret?, paymentIntentId?, checkoutUrl: null,
 *     message, destination, travelers }
 * POST { destination, travelers, booked, paymentIntentId } →
 *   verifies the $1 Stripe payment, then { decision: 'paid' }.
 * GET → health: { status, priceCents, stripe, stripeMode, note }.
 *
 * Stripe TEST MODE (Nov 20, 2026): when a real sk_test_… key is
 * configured, the $1 case creates a PaymentIntent for $1 and the
 * traveler confirms it on this page via Elements (test card
 * 4242 4242 4242 4242) — no redirect, no supplier page. Without a
 * real key the $1 case still returns stripe 'not_configured' and
 * nothing is charged. A placeholder key never counts as configured.
 */

const PRICE_CENTS = 100; // $1.00 USD

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const travelers = Math.min(9, Math.max(1, Number(raw.travelers) || 1));
  const booked = raw.booked === true;

  if (!destination) {
    return NextResponse.json(
      {
        decision: 'pay_1',
        priceCents: PRICE_CENTS,
        stripe: 'not_configured',
        stripeMode: stripeMode(),
        checkoutUrl: null,
        message: 'No trip to download yet — build a plan first.',
        destination,
        travelers,
      },
      { status: 400 }
    );
  }

  if (booked) {
    return NextResponse.json({
      decision: 'free',
      priceCents: 0,
      stripe: isStripeConfigured() ? 'ready' : 'not_configured',
      stripeMode: stripeMode(),
      checkoutUrl: null,
      message: 'Your guide is free — you booked with us.',
      destination,
      travelers,
    });
  }

  // -- verify a $1 payment the traveler just confirmed ----------------------
  const paymentIntentId = raw.paymentIntentId;
  if (typeof paymentIntentId === 'string' && paymentIntentId) {
    const retrieved = await retrievePaymentIntent(paymentIntentId);
    if (!retrieved.ok) {
      return NextResponse.json(
        {
          decision: 'pay_1',
          priceCents: PRICE_CENTS,
          stripe: isStripeConfigured() ? 'ready' : 'not_configured',
          stripeMode: stripeMode(),
          checkoutUrl: null,
          error: retrieved.error,
          message: retrieved.message,
          destination,
          travelers,
        },
        { status: retrieved.error === 'stripe_not_configured' ? 503 : 402 }
      );
    }
    const intent = retrieved.intent;
    const check = verifyPaymentIntentForTotal(intent, PRICE_CENTS, 'USD');
    const kindOk = (intent.metadata?.kind as string | undefined) === 'plan_pdf';
    const destOk = (intent.metadata?.destination as string | undefined) === destination;
    if (!check.ok || !kindOk || !destOk) {
      return NextResponse.json(
        {
          decision: 'pay_1',
          priceCents: PRICE_CENTS,
          stripe: 'ready',
          stripeMode: stripeMode(),
          checkoutUrl: null,
          error: 'payment_not_confirmed',
          message: 'That $1 payment has not been confirmed for this plan — pay on this page first. Nothing was downloaded.',
          destination,
          travelers,
        },
        { status: 402 }
      );
    }
    const order = await findOrderByPaymentIntent(paymentIntentId);
    if (order && order.status === 'awaiting_payment') {
      await updateOrder(order.id, { status: 'paid' });
    }
    return NextResponse.json({
      decision: 'paid',
      priceCents: PRICE_CENTS,
      stripe: 'ready',
      stripeMode: stripeMode(),
      checkoutUrl: null,
      paymentIntentId,
      orderId: order?.id ?? null,
      message: '$1 received — your PDF is opening now. Thank you.',
      destination,
      travelers,
    });
  }

  // -- the $1 case: charge via Stripe test mode when configured -------------
  if (!isStripeConfigured()) {
    // No Stripe key yet — the $1 cannot be collected. Say so
    // plainly; never pretend a payment happened.
    return NextResponse.json({
      decision: 'pay_1',
      priceCents: PRICE_CENTS,
      stripe: 'not_configured',
      stripeMode: stripeMode(),
      checkoutUrl: null,
      message:
        '$1 to download the full plan — free if you book with us. The $1 checkout isn’t connected yet: set up Stripe (see README) before anyone can pay.',
      destination,
      travelers,
    });
  }

  const intent = await createPaymentIntent({
    amountCents: PRICE_CENTS,
    currency: 'USD',
    description: `FujinTrip plan PDF — ${destination} (test mode)`,
    metadata: { kind: 'plan_pdf', destination, travelers: String(travelers) },
    idempotencyKey: `fujin-pdf-${destination.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${travelers}`,
  });
  if (!intent.ok) {
    return NextResponse.json(
      {
        decision: 'pay_1',
        priceCents: PRICE_CENTS,
        stripe: 'ready',
        stripeMode: stripeMode(),
        checkoutUrl: null,
        error: intent.error,
        message: intent.message,
        destination,
        travelers,
      },
      { status: intent.error === 'stripe_not_configured' ? 503 : 502 }
    );
  }
  try {
    await saveOrder(
      newOrder({
        kind: 'plan_pdf',
        items: [{ label: `Plan PDF — ${destination}`, amount: 1, currency: 'USD' }],
        fare: 0,
        serviceFee: 0,
        extrasTotal: 0,
        total: 1,
        currency: 'USD',
        paymentIntentId: intent.paymentIntentId,
        mode: stripeMode() === 'live' ? 'live' : 'test',
        supplier: 'fujintrip',
        travelerEmail: undefined,
      })
    );
  } catch {
    return NextResponse.json(
      {
        decision: 'pay_1',
        priceCents: PRICE_CENTS,
        stripe: 'ready',
        stripeMode: stripeMode(),
        checkoutUrl: null,
        error: 'order_not_saved',
        message: 'The $1 payment was prepared but the order could not be saved — try again. Nothing was charged.',
        destination,
        travelers,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({
    decision: 'pay_1',
    priceCents: PRICE_CENTS,
    stripe: 'ready',
    stripeMode: stripeMode(),
    checkoutUrl: null,
    paymentIntentClientSecret: intent.clientSecret,
    paymentIntentId: intent.paymentIntentId,
    message:
      '$1 to download the full plan — free if you book with us. Pay $1 on this page (test mode: use card 4242 4242 4242 4242).',
    destination,
    travelers,
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    priceCents: PRICE_CENTS,
    stripe: isStripeConfigured() ? 'ready' : 'not_configured',
    stripeMode: stripeMode(),
    note: 'POST { destination, travelers, booked } to get the download decision. With a Stripe test key configured the $1 case returns a PaymentIntent to confirm on this page; without a key it returns stripe_not_configured and nothing is charged.',
  });
}
