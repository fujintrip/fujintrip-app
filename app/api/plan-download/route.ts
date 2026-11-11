import { NextRequest, NextResponse } from 'next/server';

/**
 * Plan PDF download — the $1 rule (firm, Nov 10, 2026).
 * Downloading the full plan PDF costs $1 when the traveler has NOT booked
 * with FujinTrip; it is FREE when they booked with us.
 *
 * POST { destination, travelers, booked } →
 *   { decision: 'free' | 'pay_1', priceCents, stripe: 'not_configured' | 'ready',
 *     checkoutUrl: string | null, message, destination, travelers }
 * GET → health: { status, priceCents, stripe, note }.
 *
 * STRIPE IS NOT CONNECTED YET: there is no Stripe account and no key
 * anywhere, so the $1 case always returns stripe 'not_configured' and
 * checkoutUrl null, and the UI explains that instead of pretending a
 * payment happened. Nothing is charged. The route is structured so wiring
 * real Stripe Checkout later is a small change (see the TODO block below).
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
      stripe: 'not_configured',
      checkoutUrl: null,
      message: 'Your guide is free — you booked with us.',
      destination,
      travelers,
    });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    // No Stripe account/key yet — the $1 cannot be collected. Say so
    // plainly; never pretend a payment happened.
    return NextResponse.json({
      decision: 'pay_1',
      priceCents: PRICE_CENTS,
      stripe: 'not_configured',
      checkoutUrl: null,
      message:
        '$1 to download the full plan — free if you book with us. The $1 checkout isn’t connected yet: set up Stripe (see README) before anyone can pay.',
      destination,
      travelers,
    });
  }

  // TODO: Stripe Checkout — when STRIPE_SECRET_KEY is set (see README for
  // the user steps), create a Checkout Session here and return its URL:
  //
  //   import Stripe from 'stripe'; // add the `stripe` package first
  //   const stripe = new Stripe(stripeKey);
  //   const session = await stripe.checkout.sessions.create({
  //     mode: 'payment',
  //     line_items: [{ price_data: { currency: 'usd', unit_amount: PRICE_CENTS,
  //       product_data: { name: `FujinTrip plan — ${destination}` } }, quantity: 1 }],
  //     success_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fujintrip.com'}/?pdf=paid&destination=${encodeURIComponent(destination)}`,
  //     cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://fujintrip.com'}/`,
  //     metadata: { destination, travelers: String(travelers) },
  //   });
  //   return NextResponse.json({ decision: 'pay_1', priceCents: PRICE_CENTS,
  //     stripe: 'ready', checkoutUrl: session.url,
  //     message: '$1 to download the full plan — free if you book with us.',
  //     destination, travelers });
  //
  // Until this block is wired, the key being set alone changes nothing —
  // the route keeps returning stripe 'not_configured' below.
  return NextResponse.json({
    decision: 'pay_1',
    priceCents: PRICE_CENTS,
    stripe: 'not_configured',
    checkoutUrl: null,
    message:
      '$1 to download the full plan — free if you book with us. The $1 checkout isn’t connected yet: set up Stripe (see README) before anyone can pay.',
    destination,
    travelers,
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    priceCents: PRICE_CENTS,
    stripe: process.env.STRIPE_SECRET_KEY ? 'ready' : 'not_configured',
    note: 'POST { destination, travelers, booked } to get the download decision. Stripe is not connected yet — the $1 case returns stripe_not_configured until a Stripe key is set and Checkout is wired (see README).',
  });
}
