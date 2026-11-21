import { NextRequest, NextResponse } from 'next/server';
import {
  SUPPLIERS,
  listSuppliers,
  supplierStates,
  duffelMode,
  searchFlightOffers,
  validateFlightBooking,
  createFlightOrder,
  getFlightOffer,
  fetchCachedFares,
  carRentalState,
  planPdfPrice,
  type PassengerInput,
} from '@/lib/booking';
import {
  isStripeConfigured,
  stripeMode,
  isStripePublishableConfigured,
  createPaymentIntent,
  retrievePaymentIntent,
  verifyPaymentIntentForTotal,
  flightPriceBreakdown,
  toCents,
} from '@/lib/stripe';
import {
  newOrder,
  saveOrder,
  findOrderByPaymentIntent,
  updateOrder,
  orderStoreKind,
} from '@/lib/orders';

/**
 * Checkout — one checkout for the whole trip (flights + stays +
 * cars + activities), built Nov 11, 2026 by the booking agent.
 *
 * Stripe merchant checkout landed Nov 20, 2026 (TEST MODE ONLY):
 * the traveler pays ON fujintrip.com via Stripe PaymentIntents +
 * Elements — never on a supplier page. FujinTrip collects payment
 * and settles with the provider after booking (merchant rule, Nov 16).
 *
 * Flow (per the flight-booking checkout reference):
 *   1. quote    — refresh the exact offer, show fare + service fee = total
 *   2. validate — check traveler details with Duffel, no payment
 *   3. pay      — create a Stripe PaymentIntent for the exact total
 *                 (fare + tiered service fee + bags/seats at cost);
 *                 the traveler confirms it on this page via Elements
 *   4. book     — only after a SUCCEEDED intent for the exact total;
 *                 creates the Duffel TEST order, records the order
 *
 * TEST MODE ONLY: STRIPE_SECRET_KEY is a placeholder in DigitalOcean
 * and there are no live keys. pay/book return stripe_not_configured
 * until a real sk_test_… key is set; a placeholder never counts as
 * configured. Duffel test fares are test-only, never real prices, and
 * test orders are labeled TEST everywhere. Nothing real is booked or
 * charged.
 */

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isIata(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z]{3}$/.test(v);
}

function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parsePassengers(raw: unknown): PassengerInput[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 9) return null;
  const out: PassengerInput[] = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    if (
      typeof p?.given_name !== 'string' || !p.given_name.trim() ||
      typeof p?.family_name !== 'string' || !p.family_name.trim() ||
      !isDate(p?.born_on) ||
      (p?.gender !== 'm' && p?.gender !== 'f')
    ) {
      return null;
    }
    out.push({
      given_name: p.given_name.trim(),
      family_name: p.family_name.trim(),
      born_on: p.born_on as string,
      gender: p.gender as 'm' | 'f',
      email: typeof p.email === 'string' ? p.email : undefined,
      phone_number: typeof p.phone_number === 'string' ? p.phone_number : undefined,
    });
  }
  return out;
}

// Short deterministic hash for the Stripe idempotency key — the same
// logical payment (same offer + same travelers) reuses one intent
// instead of creating a second charge on a double-click.
function hashPassengers(passengers: PassengerInput[]): string {
  const s = JSON.stringify(passengers.map((p) => [p.given_name, p.family_name, p.born_on, p.email ?? '']));
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export async function GET() {
  const mode = duffelMode();
  const states = supplierStates();
  const byState = (s: string) => states.filter((x) => x.state === s).length;
  const stripe = stripeMode();
  return NextResponse.json({
    ok: true,
    live: false,
    label:
      mode === 'live'
        ? 'Checkout is live-ready for quotes. Live booking still needs Stripe + DUFFEL_LIVE_BOOKING_ENABLED=true.'
        : mode === 'test'
          ? 'Checkout — Duffel TEST mode + Stripe TEST mode. Quotes, test payments and test orders only; nothing real is booked or charged.'
          : 'Checkout — Duffel is not configured. Set DUFFEL_API_KEY to enable flight quotes.',
    duffelMode: mode,
    stripeConfigured: isStripeConfigured(),
    stripeMode: stripe,
    stripePublishableConfigured: isStripePublishableConfigured(),
    ordersStore: await orderStoreKind(),
    serviceFee: {
      tiers: [
        { fareUnder: 250, fee: 19 },
        { fareUnder: 800, fee: 35 },
        { fareUnder: Infinity, fee: 49 },
      ],
      note: 'Flat fee per flight order, shown separately at checkout — never hidden in the fare. Bags/seats pass through at cost.',
    },
    planPdf: planPdfPrice(false),
    planPdfRule: 'Plan PDF is FREE when the trip is booked with FujinTrip, $1 when it is not. The $1 case charges via Stripe test mode (PaymentIntent on this page) when a test key is configured; without a key it returns stripe_not_configured and nothing is charged.',
    suppliers: {
      total: SUPPLIERS.length,
      live: byState('live'),
      test: byState('test'),
      notConfigured: byState('not_configured'),
      notApplied: byState('not_applied'),
      unavailable: byState('unavailable'),
      states,
    },
    cars: carRentalState(),
    nextSteps: [
      'Confirm Duffel Stays access in the Duffel dashboard.',
      'Duffel live activation (company details → Managed Content → certification → live token).',
      'Stripe test key → STRIPE_SECRET_KEY + NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (test keys) in DigitalOcean, then Deploy — test payments use card 4242 4242 4242 4242.',
      'Expedia Rapid application (12–20 weeks — start first).',
      'Travelpayouts free token → TRAVELPAYOUTS_TOKEN for cached comparison fares.',
    ],
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;

  // -- quote: refresh the exact offer, show fare + fee = total ------------
  if (action === 'quote') {
    const { category } = body;
    if (category !== 'flights') {
      const suppliers = listSuppliers(category as never).map((s) => ({
        id: s.id, name: s.name, state: s.state, mode: s.mode, access: s.access, leadTime: s.leadTime,
      }));
      return NextResponse.json({
        ok: true,
        live: false,
        category,
        label: suppliers.length
          ? `No live ${String(category)} quote yet — ${suppliers.length} supplier(s) tracked, none bookable on-site today. See suppliers for the state of each.`
          : `No checkout adapter for category "${String(category)}" yet.`,
        suppliers,
      });
    }
    if (!isIata(body.origin) || !isIata(body.destination) || !isDate(body.date)) {
      return bad('quote needs origin + destination (3-letter IATA codes) and date (YYYY-MM-DD).');
    }
    const travelers = Math.min(9, Math.max(1, Number(body.travelers) || 1));
    const out = await searchFlightOffers({
      origin: body.origin as string,
      destination: body.destination as string,
      date: body.date as string,
      travelers,
    });
    let back = null;
    if (isDate(body.returnDate)) {
      back = await searchFlightOffers({
        origin: body.destination as string,
        destination: body.origin as string,
        date: body.returnDate as string,
        travelers,
      });
    }
    // Cached comparison fares (Travelpayouts) — labeled cached, never live.
    let comparison = { configured: false, ok: false, fares: [], label: '', checkedAt: '' } as Awaited<ReturnType<typeof fetchCachedFares>>;
    if (typeof body.date === 'string') {
      comparison = await fetchCachedFares({
        origin: body.origin as string,
        destination: body.destination as string,
        month: (body.date as string).slice(0, 7),
      });
    }
    return NextResponse.json({
      ok: true,
      live: out.mode === 'live',
      mode: out.mode,
      outbound: out,
      return: back,
      comparison,
      label: out.label,
    });
  }

  // -- validate: check traveler details with Duffel, no payment -----------
  if (action === 'validate') {
    const offerId = body.offerId;
    if (typeof offerId !== 'string' || !offerId.startsWith('off_')) {
      return bad('validate needs offerId (off_…) from a quote.');
    }
    const passengers = parsePassengers(body.passengers);
    if (!passengers) {
      return bad('validate needs passengers: one per traveler, each with given_name, family_name, born_on (YYYY-MM-DD) and gender (m/f). Email/phone optional — the first traveler’s contact covers everyone.');
    }
    const services = Array.isArray(body.services)
      ? (body.services as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined;
    const result = await validateFlightBooking({ offerId, passengers, services });
    return NextResponse.json({ ok: true, live: false, ...result });
  }

  // -- pay: create the Stripe PaymentIntent for the exact total -----------
  // The traveler confirms it on fujintrip.com via Elements; the
  // Duffel order is only created by `book` after the intent reads
  // `succeeded`. The intent is created, NOT charged, by this step.
  if (action === 'pay') {
    const offerId = body.offerId;
    if (typeof offerId !== 'string' || !offerId.startsWith('off_')) {
      return bad('pay needs offerId (off_…) from a quote, after validate.');
    }
    const returnOfferId =
      typeof body.returnOfferId === 'string' && body.returnOfferId.startsWith('off_')
        ? body.returnOfferId
        : undefined;
    const passengers = parsePassengers(body.passengers);
    if (!passengers) {
      return bad('pay needs passengers (same shape as validate).');
    }
    if (!isStripeConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: 'stripe_not_configured',
          message:
            'Stripe is not connected — set STRIPE_SECRET_KEY (a real sk_test_… test key) in DigitalOcean and Deploy. Nothing was charged.',
        },
        { status: 503 }
      );
    }
    // Refresh the offer(s) so the total we charge is the current one.
    const out = await getFlightOffer(offerId);
    if (!out.found || !out.offer) return bad(out.label, 422);
    let fare = out.offer.fare;
    const currency = out.offer.currency;
    if (returnOfferId) {
      const back = await getFlightOffer(returnOfferId);
      if (!back.found || !back.offer) return bad(back.label, 422);
      fare += back.offer.fare;
    }
    const extras = Array.isArray(body.extras)
      ? (body.extras as Array<Record<string, unknown>>).map((e) => ({
          label: typeof e.label === 'string' ? e.label : '',
          amount: typeof e.amount === 'number' ? e.amount : 0,
        }))
      : [];
    const breakdown = flightPriceBreakdown(fare, currency, extras);
    const mode = stripeMode();
    const origin = typeof body.origin === 'string' ? body.origin : '';
    const destination = typeof body.destination === 'string' ? body.destination : '';
    const intent = await createPaymentIntent({
      amountCents: toCents(breakdown.total),
      currency: breakdown.currency,
      description: `FujinTrip flight${origin && destination ? ` — ${origin} → ${destination}` : ''} (test mode)`,
      metadata: {
        kind: 'flight',
        offerId,
        ...(returnOfferId ? { returnOfferId } : {}),
        fare: String(breakdown.fare),
        serviceFee: String(breakdown.serviceFee),
        travelers: String(passengers.length),
      },
      idempotencyKey: `fujin-flight-${offerId}-${returnOfferId ?? 'oneway'}-${passengers.length}-${hashPassengers(passengers)}`,
    });
    if (!intent.ok) {
      return NextResponse.json(
        { ok: false, error: intent.error, message: intent.message },
        { status: intent.error === 'stripe_not_configured' ? 503 : 502 }
      );
    }
    const first = passengers[0];
    const order = newOrder({
      kind: 'flight',
      items: [
        { label: 'Airfare', amount: breakdown.fare, currency: breakdown.currency },
        { label: 'FujinTrip service fee', amount: breakdown.serviceFee, currency: breakdown.currency },
        ...breakdown.extras.map((e) => ({ label: e.label, amount: e.amount, currency: breakdown.currency })),
      ],
      fare: breakdown.fare,
      serviceFee: breakdown.serviceFee,
      extrasTotal: breakdown.extrasTotal,
      total: breakdown.total,
      currency: breakdown.currency,
      paymentIntentId: intent.paymentIntentId,
      mode: mode === 'live' ? 'live' : 'test',
      supplier: 'duffel',
      offerId,
      ...(returnOfferId ? { returnOfferId } : {}),
      travelerEmail: first.email,
      travelerName: `${first.given_name} ${first.family_name}`,
    });
    try {
      await saveOrder(order);
    } catch {
      // The intent exists but the order record could not be saved —
      // say so plainly instead of pretending checkout is ready. The
      // traveler has NOT been charged yet (the intent is created,
      // not confirmed).
      return NextResponse.json(
        {
          ok: false,
          error: 'order_not_saved',
          message: 'The payment was prepared but the order could not be saved — try again. Nothing was charged.',
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      live: false,
      testMode: mode === 'test',
      mode,
      orderId: order.id,
      paymentIntentId: intent.paymentIntentId,
      clientSecret: intent.clientSecret,
      breakdown,
      label:
        mode === 'test'
          ? 'TEST MODE — confirm the payment on this page with a Stripe test card (4242 4242 4242 4242). No real card is charged and no real ticket is booked.'
          : 'Confirm the payment on this page to complete the booking.',
    });
  }

  // -- book: only after a SUCCEEDED PaymentIntent for the exact total -----
  if (action === 'book') {
    const offerId = body.offerId;
    if (typeof offerId !== 'string' || !offerId.startsWith('off_')) {
      return bad('book needs offerId (off_…) from a quote, after validate.');
    }
    const passengers = parsePassengers(body.passengers);
    if (!passengers) {
      return bad('book needs passengers (same shape as validate).');
    }
    if (body.confirm !== true) {
      return bad('book needs confirm:true — the traveler must approve the exact total and terms first.', 422);
    }
    const paymentIntentId = body.paymentIntentId;
    if (typeof paymentIntentId !== 'string' || !paymentIntentId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'payment_required',
          message:
            'Pay first (action=pay) to create a Stripe PaymentIntent and confirm it on this page — a booking is only created after a confirmed payment.',
        },
        { status: 402 }
      );
    }
    const order = await findOrderByPaymentIntent(paymentIntentId);
    if (!order || order.offerId !== offerId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'payment_not_found',
          message: 'No checkout order matches that payment — pay first (action=pay), then book with the same payment reference.',
        },
        { status: 404 }
      );
    }
    if (order.status === 'booked') {
      return NextResponse.json({
        ok: true,
        live: false,
        testBooking: true,
        orderId: order.id,
        duffelOrderIds: order.duffelOrderIds,
        bookingReference: order.bookingReference,
        label: 'This payment already booked — the order below is the one that was created. It was not booked twice.',
      });
    }
    if (order.status !== 'awaiting_payment' && order.status !== 'paid') {
      return NextResponse.json(
        { ok: false, error: 'order_not_payable', message: `This order is ${order.status} and cannot be booked.` },
        { status: 422 }
      );
    }
    const retrieved = await retrievePaymentIntent(paymentIntentId);
    if (!retrieved.ok) {
      const status = retrieved.error === 'stripe_not_configured' ? 503 : retrieved.error === 'not_found' ? 404 : 502;
      return NextResponse.json({ ok: false, error: retrieved.error, message: retrieved.message }, { status });
    }
    const check = verifyPaymentIntentForTotal(retrieved.intent, toCents(order.total), order.currency);
    if (!check.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'payment_not_confirmed',
          reason: check.reason,
          paymentStatus: check.status,
          message: 'The payment has not been confirmed for the exact total — confirm it on the payment step first. Nothing was booked.',
        },
        { status: 402 }
      );
    }
    await updateOrder(order.id, { status: 'paid' });
    // Create the Duffel order(s) — one per offer (out + return).
    // Duffel is paid the FARE only; our service fee was collected
    // through Stripe, never through Duffel.
    const results = [];
    for (const id of [offerId, ...(order.returnOfferId ? [order.returnOfferId] : [])]) {
      results.push(await createFlightOrder({ offerId: id, passengers, confirm: true }));
    }
    const failed = results.find((r) => !r.booked);
    if (failed) {
      await updateOrder(order.id, { status: 'booking_failed' });
      return NextResponse.json(
        {
          ok: false,
          live: false,
          testBooking: true,
          orderId: order.id,
          error: 'booking_failed',
          message: `The test payment was confirmed but the Duffel test order failed: ${failed.label} The payment is a test payment (no real money moved) — the FujinTrip team follows up; do not retry the payment.`,
          label: failed.label,
        },
        { status: 502 }
      );
    }
    const duffelOrderIds = results.map((r) => r.orderId).filter((x): x is string => Boolean(x));
    const bookingReference = results[0]?.bookingReference;
    await updateOrder(order.id, {
      status: 'booked',
      duffelOrderIds,
      ...(bookingReference ? { bookingReference } : {}),
    });
    return NextResponse.json({
      ok: true,
      live: false,
      testBooking: true,
      orderId: order.id,
      paymentIntentId,
      duffelOrderIds,
      bookingReference,
      fare: order.fare,
      serviceFee: order.serviceFee,
      total: order.total,
      totalCurrency: order.currency,
      label: 'TEST booking created in Duffel test mode — no real ticket, no real charge. The test payment was confirmed on fujintrip.com; the fare went to Duffel and the service fee to FujinTrip. Do not present this as a real booking.',
      note: 'Test booking only. A real booking needs Duffel live mode + live Stripe keys.',
    });
  }

  return bad('Unknown action. Use quote, validate, pay, or book (GET for checkout status).');
}
