import { NextRequest, NextResponse } from 'next/server';
import { fetchLiveFares, priceCheck } from '../../../lib/duffel';
import { comparisonFor, ROUTE_STOPS, routeKeyForDestination } from '../../../lib/planner';
import { suggestedStart } from '../../../lib/tripCard';

/**
 * POST /api/price-check — the whole-trip price check (competitor
 * learning, Nov 11 #4: Mindtrip / Kayak).
 *
 * Body: { origin, destination, travelers, month, durationDays }.
 * Asks Duffel for the live fares for the exact trip (same dates the
 * trip card uses), compares the cheapest out+back total with the
 * plan's Best-value flight leg, and returns the honest "book now or
 * wait" read — a snapshot against the plan's own flight budget, never
 * a forecast. When Duffel has no fare (no key, no airport code, no
 * offers), live is false and the response still carries the plan's
 * flight budget, so the UI can say what it knows instead of faking it.
 *
 * The Duffel key never leaves the server; the response carries airline
 * names and prices only.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const origin = typeof raw.origin === 'string' ? raw.origin.trim() : '';
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const travelers = typeof raw.travelers === 'number' && raw.travelers >= 1 && raw.travelers <= 9 ? raw.travelers : 2;
  const month = typeof raw.month === 'number' && raw.month >= 1 && raw.month <= 12 ? raw.month : 0;
  const durationDays = typeof raw.durationDays === 'number' && raw.durationDays >= 2 ? raw.durationDays : 0;

  const plannerFlight = destination ? comparisonFor(destination, travelers).best.flight : 0;

  const routeKey = destination ? routeKeyForDestination(destination) : '';
  const fareDestCity = routeKey ? ROUTE_STOPS[routeKey][0].city : destination;
  const departDate = month ? suggestedStart(month) : null;
  const returnDate =
    departDate && durationDays >= 2 ? new Date(departDate.getTime() + (durationDays - 1) * 86400000) : null;

  if (!origin || !fareDestCity || !departDate || !returnDate) {
    return NextResponse.json({
      live: false,
      reason: 'missing_slots',
      origin,
      destination,
      destCity: fareDestCity,
      departDate: departDate ? departDate.toISOString().slice(0, 10) : '',
      returnDate: returnDate ? returnDate.toISOString().slice(0, 10) : '',
      travelers,
      out: [],
      back: [],
      liveTotal: 0,
      plannerFlight,
      diff: 0,
      verdict: 'no_fare',
      line: '',
    });
  }

  const liveFares = await fetchLiveFares({
    origin,
    destCity: fareDestCity,
    departDate: departDate.toISOString().slice(0, 10),
    returnDate: returnDate.toISOString().slice(0, 10),
    travelers,
  }).catch(() => null);
  const check = liveFares ? priceCheck(liveFares, plannerFlight) : { live: false, liveTotal: 0, plannerFlight, diff: 0, verdict: 'no_fare' as const, line: '' };

  return NextResponse.json({
    live: check.live,
    reason: liveFares?.reason ?? (check.live ? undefined : 'no_fare'),
    origin: liveFares?.origin ?? origin,
    destination,
    destCity: liveFares?.destCity ?? fareDestCity,
    departDate: liveFares?.departDate ?? departDate.toISOString().slice(0, 10),
    returnDate: liveFares?.returnDate ?? returnDate.toISOString().slice(0, 10),
    travelers,
    out: liveFares?.out ?? [],
    back: liveFares?.back ?? [],
    liveTotal: check.liveTotal,
    plannerFlight: check.plannerFlight,
    diff: check.diff,
    verdict: check.verdict,
    line: check.line,
  });
}
