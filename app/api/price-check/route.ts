import { NextRequest, NextResponse } from 'next/server';
import { resolveAirportCode } from '../../../lib/airportCodes';
import { appendObservation, cabinClassFor, duffelMode, fetchLiveFares, fetchOneWayFares, priceCheck, trendLine, type TrendObservation } from '../../../lib/duffel';
import { comparisonFor, ROUTE_STOPS, routeKeyForDestination } from '../../../lib/planner';
import { suggestedStart } from '../../../lib/tripCard';

/**
 * POST /api/price-check — the whole-trip price check (competitor
 * learning, Nov 11 #4: Mindtrip / Kayak).
 *
 * Body: { origin, destination, travelers, month, durationDays, history?, depart?, return?, cabin?, tripType?, legs? }.
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
 * tripType (optional, Nov 15 2026): 'roundtrip' (default), 'oneway'
 * or 'multicity'. One-way asks Duffel for the outbound slice only —
 * no return is fetched and none is invented; the response carries
 * returnDate '' and back []. Multi-city sends legs: [{ origin,
 * destination, date }] and runs one one-way Offer Request per leg in
 * parallel (Duffel has no multi-slice shortcut — each leg is its own
 * honest request); the response carries legs: [{ origin, destination,
 * destCity, date, live, reason?, out }] and liveTotal is the sum of
 * the cheapest fare per leg, 0 unless every leg has a fare. The
 * book-now read (verdict/line) is a round-trip comparison only — for
 * one-way and multi-city the verdict is 'fares' when fares exist
 * ("fares found, no round-trip budget to compare against") and the
 * line stays empty, never a comparison against a budget that does
 * not apply.
 *
 * history (optional, round 2 #3): the watch's own past observations
 * [{ at, total }] — the fresh check is appended (deduped) before the
 * trend is read, so the returned trend always ends with today's fare.
 * The trend is a humble read of the traveler's own checks ("Since you
 * started watching…", confidence low/medium), never a forecast and
 * never "95% accurate". The trend is round-trip only — one-way and
 * multi-city return the history's own trend, unappended.
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
  // The cabin the traveler picked (UI label or Duffel class) — the
  // Offer Request is asked for this cabin, never silently economy.
  // Junk falls back to economy.
  const cabin = cabinClassFor(raw.cabin);
  // The picker's IATA codes when the caller captured them (SearchWidget
  // / SearchResults) — preferred over name resolution, never guessed.
  const originIataRaw = typeof raw.originIata === 'string' ? raw.originIata : undefined;
  const destinationIataRaw = typeof raw.destinationIata === 'string' ? raw.destinationIata : undefined;
  // The trip type (Nov 15, 2026): junk falls back to round-trip, so
  // every caller that never heard of trip types — the chat included —
  // keeps the round-trip behavior it already had.
  const tripType =
    raw.tripType === 'oneway' || raw.tripType === 'multicity' ? (raw.tripType as 'oneway' | 'multicity') : 'roundtrip';
  // The multi-city legs, validated one by one — a leg with an empty
  // end or a bad date is dropped, never guessed; fewer than 2 clean
  // legs is not a multi-city search.
  const legsIn = Array.isArray(raw.legs)
    ? (raw.legs as unknown[])
        .map((l) => {
          if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
          const o = l as Record<string, unknown>;
          const oFrom = typeof o.origin === 'string' ? o.origin.trim() : '';
          const oTo = typeof o.destination === 'string' ? o.destination.trim() : '';
          const oDate = typeof o.date === 'string' ? o.date.trim() : '';
          const oFromIata = typeof o.originIata === 'string' ? o.originIata : undefined;
          const oToIata = typeof o.destinationIata === 'string' ? o.destinationIata : undefined;
          return oFrom && oTo && validIso(oDate)
            ? {
                origin: oFrom,
                destination: oTo,
                date: oDate,
                ...(oFromIata ? { originIata: oFromIata } : {}),
                ...(oToIata ? { destinationIata: oToIata } : {}),
              }
            : null;
        })
        .filter(
          (l): l is { origin: string; destination: string; date: string; originIata?: string; destinationIata?: string } => !!l
        )
        .slice(0, 4)
    : [];

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

  // --- Multi-city: one one-way request per leg, in parallel. ---
  if (tripType === 'multicity') {
    const first = legsIn[0];
    const firstFlight = first ? comparisonFor(first.destination, travelers).best.flight : 0;
    if (legsIn.length < 2 || !first) {
      return NextResponse.json({
        live: false,
        reason: 'missing_slots',
        tripType: 'multicity',
        origin: first?.origin ?? '',
        destination: first?.destination ?? '',
        destCity: '',
        departDate: first?.date ?? '',
        returnDate: legsIn.length ? legsIn[legsIn.length - 1].date : '',
        travelers,
        cabin,
        mode: duffelMode(),
        out: [],
        back: [],
        legs: [],
        liveTotal: 0,
        plannerFlight: firstFlight,
        diff: 0,
        verdict: 'no_fare',
        line: '',
        trend: trendLine(history),
      });
    }
    const legResults = await Promise.all(
      legsIn.map(async (leg) => {
        const lk = routeKeyForDestination(leg.destination);
        const destCity = lk ? ROUTE_STOPS[lk][0].city : leg.destination;
        const fares = await fetchOneWayFares({
          origin: leg.origin,
          destCity,
          departDate: leg.date,
          travelers,
          cabinClass: cabin,
          // The fare is searched for the route's first city, so a
          // passed code only applies when the leg named that city
          // itself — otherwise the first city resolves by name.
          originIata: resolveAirportCode(leg.origin, leg.originIata) ?? undefined,
          destIata: resolveAirportCode(destCity, leg.destination === destCity ? leg.destinationIata : undefined) ?? undefined,
        }).catch(() => null);
        return {
          origin: leg.origin,
          destination: leg.destination,
          destCity,
          date: leg.date,
          live: fares?.live ?? false,
          reason: fares?.reason,
          out: fares?.out ?? [],
        };
      })
    );
    const allLive = legResults.every((l) => l.live && l.out.length > 0);
    const liveTotal = allLive
      ? legResults.reduce((sum, l) => sum + Math.min(...l.out.map((o) => o.price)), 0)
      : 0;
    return NextResponse.json({
      live: allLive,
      reason: allLive ? undefined : 'no_fare',
      tripType: 'multicity',
      origin: first.origin,
      destination: first.destination,
      destCity: legResults[0].destCity,
      departDate: first.date,
      returnDate: legsIn[legsIn.length - 1].date,
      travelers,
      cabin,
      mode: duffelMode(),
      out: legResults[0].out,
      back: [],
      legs: legResults,
      liveTotal,
      plannerFlight: firstFlight,
      diff: 0,
      verdict: allLive ? 'fares' : 'no_fare',
      line: '',
      trend: trendLine(history),
    });
  }

  // --- One-way: the outbound slice only. ---
  if (tripType === 'oneway') {
    const departDate = validIso(departRaw)
      ? new Date(`${departRaw}T00:00:00Z`)
      : month
        ? suggestedStart(month)
        : null;
    if (!origin || !fareDestCity || !departDate) {
      return NextResponse.json({
        live: false,
        reason: 'missing_slots',
        tripType: 'oneway',
        origin,
        destination,
        destCity: fareDestCity,
        departDate: departDate ? departDate.toISOString().slice(0, 10) : '',
        returnDate: '',
        travelers,
        cabin,
        mode: duffelMode(),
        out: [],
        back: [],
        legs: [],
        liveTotal: 0,
        plannerFlight,
        diff: 0,
        verdict: 'no_fare',
        line: '',
        trend: trendLine(history),
      });
    }
    const liveFares = await fetchOneWayFares({
      origin,
      destCity: fareDestCity,
      departDate: departDate.toISOString().slice(0, 10),
      travelers,
      cabinClass: cabin,
      originIata: resolveAirportCode(origin, originIataRaw) ?? undefined,
      destIata: resolveAirportCode(fareDestCity, destination === fareDestCity ? destinationIataRaw : undefined) ?? undefined,
    }).catch(() => null);
    const liveTotal = liveFares?.live && liveFares.out.length ? Math.min(...liveFares.out.map((o) => o.price)) : 0;
    return NextResponse.json({
      live: liveFares?.live ?? false,
      reason: liveFares?.reason ?? (liveFares?.live ? undefined : 'no_fare'),
      tripType: 'oneway',
      origin: liveFares?.origin ?? origin,
      destination,
      destCity: liveFares?.destCity ?? fareDestCity,
      departDate: liveFares?.departDate ?? departDate.toISOString().slice(0, 10),
      returnDate: '',
      travelers,
      cabin,
      mode: duffelMode(),
      out: liveFares?.out ?? [],
      back: [],
      legs: [],
      liveTotal,
      plannerFlight,
      diff: 0,
      verdict: liveFares?.live ? 'fares' : 'no_fare',
      line: '',
      trend: trendLine(history),
    });
  }

  // --- Round-trip: the original path, unchanged in behavior. ---
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
      tripType: 'roundtrip',
      origin,
      destination,
      destCity: fareDestCity,
      departDate: departDate ? departDate.toISOString().slice(0, 10) : '',
      returnDate: returnDate ? returnDate.toISOString().slice(0, 10) : '',
      travelers,
      cabin,
      mode: duffelMode(),
      out: [],
      back: [],
      legs: [],
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
    cabinClass: cabin,
    originIata: resolveAirportCode(origin, originIataRaw) ?? undefined,
    destIata: resolveAirportCode(fareDestCity, destination === fareDestCity ? destinationIataRaw : undefined) ?? undefined,
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
    tripType: 'roundtrip',
    origin: liveFares?.origin ?? origin,
    destination,
    destCity: liveFares?.destCity ?? fareDestCity,
    departDate: liveFares?.departDate ?? departDate.toISOString().slice(0, 10),
    returnDate: liveFares?.returnDate ?? returnDate.toISOString().slice(0, 10),
    travelers,
    cabin,
    mode: duffelMode(),
    out: liveFares?.out ?? [],
    back: liveFares?.back ?? [],
    legs: [],
    liveTotal: check.liveTotal,
    plannerFlight: check.plannerFlight,
    diff: check.diff,
    verdict: check.verdict,
    line: check.line,
    trend,
  });
}
