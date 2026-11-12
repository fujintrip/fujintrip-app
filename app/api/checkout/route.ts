import { NextRequest, NextResponse } from 'next/server';
import {
  SUPPLIERS,
  listSuppliers,
  supplierStates,
  duffelMode,
  searchFlightOffers,
  validateFlightBooking,
  createFlightOrder,
  fetchCachedFares,
  carRentalState,
  planPdfPrice,
  type PassengerInput,
} from '@/lib/booking';

/**
 * Checkout skeleton — one checkout for the whole trip (flights + stays +
 * cars + activities), built Nov 11, 2026 by the booking agent.
 *
 * What it does today: Duffel flight quotes (test key), validation and
 * TEST order creation, Travelpayouts cached comparison fares, and an
 * honest status report for every supplier. It NEVER charges a card and
 * NEVER creates a live booking: live mode refuses until a live Duffel
 * key and Stripe are configured, and says exactly which step is missing.
 *
 * Flow (per the flight-booking checkout reference):
 *   1. quote    — refresh the exact offer, show fare + service fee = total
 *   2. validate — check traveler details with Duffel, no payment
 *   3. book     — only after validate + the traveler approves the exact
 *                 total and terms (confirm:true); test mode only for now
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

export async function GET() {
  const mode = duffelMode();
  const states = supplierStates();
  const byState = (s: string) => states.filter((x) => x.state === s).length;
  return NextResponse.json({
    ok: true,
    live: false,
    label:
      mode === 'live'
        ? 'Checkout is live-ready for quotes. Live booking still needs Stripe + DUFFEL_LIVE_BOOKING_ENABLED=true.'
        : mode === 'test'
          ? 'Checkout skeleton — Duffel TEST mode. Quotes and test orders only; nothing real is booked or charged.'
          : 'Checkout skeleton — Duffel is not configured. Set DUFFEL_API_KEY to enable flight quotes.',
    duffelMode: mode,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    serviceFee: {
      tiers: [
        { fareUnder: 250, fee: 19 },
        { fareUnder: 800, fee: 35 },
        { fareUnder: Infinity, fee: 49 },
      ],
      note: 'Flat fee per flight order, shown separately at checkout — never hidden in the fare. Bags/seats pass through at cost.',
    },
    planPdf: planPdfPrice(false),
    planPdfRule: 'Plan PDF is FREE when the trip is booked with FujinTrip, $1 when it is not. Stripe is not connected yet, so the $1 case returns stripe_not_configured and nothing is charged.',
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
      'Stripe account → STRIPE_SECRET_KEY in DigitalOcean.',
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

  // -- book: only after validate + explicit confirm; test mode only -------
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
    const result = await createFlightOrder({ offerId, passengers, confirm: true });
    return NextResponse.json({
      ok: result.booked,
      live: false,
      ...result,
      note: result.booked
        ? 'Test booking only. A real booking needs Duffel live mode + Stripe; see missingSteps when live.'
        : undefined,
    });
  }

  return bad('Unknown action. Use quote, validate, or book (GET for checkout status).');
}
