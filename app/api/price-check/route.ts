import { NextRequest, NextResponse } from 'next/server';
import { appendObservation, fetchLiveFares, priceCheck, trendLine, type TrendObservation } from '../../../lib/duffel';
import { comparisonFor, ROUTE_STOPS, routeKeyForDestination } from '../../../lib/planner';
import { suggestedStart } from '../../../lib/tripCard';

/**
 * POST /api/price-check — the whole-trip price check (competitor
 * learning, Nov 11 #4: Mindtrip / Kayak).
 *
 * Body: { origin, destination, travelers, month, durationDays, history?, depart?, return? }.
 * Asks Duffel for the live fares for the exact trip (same dates the
 * trip card uses), compares the cheapest out+back total with the
 * plan's Best-value flight leg, and returns the honest "book now or
 * wait" read — a snapshot against the plan's own flight budget, never
 * a forecast. When Duffel has no fare (no key, no airport code, no
 * offers), live is false and the response still carries the plan's
 * flight budget, so the UI can say what it knows instead of faking it.
 *
 * depart / return (optional, Nov 14 2026): the searched dates as
 * YYYY-MM-DD. When valid they are the Duffel slices — the checked
 * dates are the traveler's dates, never the planner's suggested start
 * standing in for them. When absent or invalid, the old behavior
 * stands: suggestedStart(month) + durationDays (the chat's callers
 * send month/durationDays only).
 *
 * history (optional, round 2 #3): the watch's own past observations
 * [{ at, total }] — the fresh check is appended (deduped) before the
 * trend is read, so the returned trend always ends with today's fare.
 * The trend is a humble read of the traveler's own checks ("Since you
 * started watching…", confidence low/medium), never a forecast and
 * never "95% accurate".
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
  // The searched dates, when the caller gives them — strictly
  // validated (YYYY-MM-DD that round-trips), never trusted blindly.
  // A return only counts when a departure anchors it and it is not
  // before the departure.
  const validIso = (v: unknown): v is string => {
    if (typeof v !== 'string') return false;
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v.trim();
  };
  const departRaw = typeof raw.depart === 'string' ? raw.depart.trim() : '';
  const returnRaw = typeof raw.return === 'string' ? raw.return.trim() : '';

  const plannerFlight = destination ? comparisonFor(destination, travelers).best.flight : 0;
  // The watch's own past checks, validated and capped — arbitrary
  // history is never trusted blindly.
  const history: TrendObservation[] = Array.isArray(raw.history)
    ? (raw.history as unknown[])
        .filter(
          (h): h is TrendObservation =>
            !!h && typeof h === 'object' && typeof (h as TrendObservation).at === 'string' && typeof (h as TrendObservation).total === 'number' && (h as TrendObservation).total > 0
        )
        .slice(0, 50)
    : [];

  const routeKey = destination ? routeKeyForDestination(destination) : '';
  const fareDestCity = routeKey ? ROUTE_STOPS[routeKey][0].city : destination;
  const departDate = validIso(departRaw)
    ? new Date(`${departRaw}T00:00:00Z`)
    : month
      ? suggestedStart(month)
      : null;
  const returnDate =
    validIso(returnRaw) && departDate && returnRaw >= departRaw
      ? new Date(`${returnRaw}T00:00:00Z`)
      : departDate && durationDays >= 2
        ? new Date(departDate.getTime() + (durationDays - 1) * 86400000)
        : null;

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
      trend: trendLine(history),
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
  // The trend reads the watch's own past checks plus today's fresh
  // fare (deduped — the same total on the same day adds nothing), so
  // it always ends with the fare this response just fetched.
  const trend = trendLine(
    check.live && liveFares && liveFares.out.length && liveFares.back.length
      ? appendObservation(history, check.liveTotal)
      : history
  );

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
    trend,
  });
}
