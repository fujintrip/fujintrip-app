import { NextRequest, NextResponse } from 'next/server';
import { resolveAirportCode } from '../../../lib/airportCodes';
import { cabinClassFor } from '../../../lib/duffel';
import {
  letsfgConfigured,
  searchLetsfgFares,
  type LetsfgFaresResponse,
  type LetsfgSearchInput,
  type LetsfgTripType,
} from '../../../lib/letsfg';

/**
 * POST /api/letsfg-fares — the LetsFG live comparison column.
 *
 * Search body (same trip shape the Flights search already builds):
 * { tripType?, origin, destination, depart?, return?, travelers?, cabin? }
 * - tripType 'roundtrip' (default) / 'oneway'. LetsFG has NO
 *   multi-city endpoint — a multi-city search returns live:false +
 *   reason 'unsupported_trip_type' and never calls LetsFG.
 * - origin/destination carry CITY NAMES — plus the picker's IATA
 *   code when one was captured (originIata / destinationIata). A
 *   passed code is preferred; otherwise the name resolves through
 *   the server-side resolver (hand map, then the generated city
 *   dataset) — codes are never guessed.
 * - depart/return are YYYY-MM-DD; return must be >= depart.
 * Returns { live, configured, source:'letsfg', observedAt, tripType,
 * itineraries, ... } — itineraries carry whole-trip party-total
 * prices for one-way and round-trip. The response is always 200: a
 * missing key, a 402, an error, or an empty result is an honest
 * live:false + reason, never an invented fare. LETSFG_API_KEY never
 * leaves the server. The route starts an async LetsFG search and
 * polls server-side (max ~90s) — the client makes one request per
 * search, never per poll.
 *
 * Booking: every itinerary carries its own booking_url to letsfg.co
 * — the traveler books and pays there with their own Revolut method.
 * FujinTrip never takes payment for a LetsFG fare.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;

  const origin = typeof raw.origin === 'string' ? raw.origin.trim() : '';
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const travelers =
    typeof raw.travelers === 'number' && raw.travelers >= 1 && raw.travelers <= 9 ? raw.travelers : 2;
  const cabin = cabinClassFor(raw.cabin);
  const departRaw = typeof raw.depart === 'string' ? raw.depart.trim() : '';
  const returnRaw = typeof raw.return === 'string' ? raw.return.trim() : '';

  // LetsFG has no multi-city endpoint — the honest empty state, and
  // no LetsFG call at all.
  if (raw.tripType === 'multicity') {
    return NextResponse.json({
      live: false,
      configured: letsfgConfigured(),
      source: 'letsfg',
      observedAt: null,
      tripType: 'multicity',
      origin,
      destination,
      departDate: departRaw,
      returnDate: returnRaw,
      travelers,
      cabin,
      itineraries: [],
      reason: 'unsupported_trip_type',
    });
  }
  const tripType: LetsfgTripType = raw.tripType === 'oneway' ? 'oneway' : 'roundtrip';

  const validIso = (v: unknown): v is string => {
    if (typeof v !== 'string') return false;
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v.trim();
  };

  const empty = (reason: string): LetsfgFaresResponse => ({
    live: false,
    configured: letsfgConfigured(),
    source: 'letsfg',
    observedAt: null,
    tripType,
    origin,
    destination,
    departDate: departRaw,
    returnDate: returnRaw,
    travelers,
    cabin,
    itineraries: [],
    reason,
  });

  const departOk = validIso(departRaw);
  const returnOk = tripType === 'oneway' ? true : validIso(returnRaw) && returnRaw >= departRaw;
  if (!origin || !destination || !departOk || !returnOk) {
    return NextResponse.json(empty('missing_slots'));
  }
  const fromIata = resolveAirportCode(origin, typeof raw.originIata === 'string' ? raw.originIata : undefined);
  const toIata = resolveAirportCode(destination, typeof raw.destinationIata === 'string' ? raw.destinationIata : undefined);
  if (!fromIata || !toIata) {
    return NextResponse.json(empty('no_airport_code'));
  }
  const input: LetsfgSearchInput = {
    tripType,
    origin: fromIata,
    destination: toIata,
    departDate: departRaw,
    ...(tripType === 'roundtrip' ? { returnDate: returnRaw } : {}),
    travelers,
    cabin,
  };
  const res = await searchLetsfgFares(input).catch(() => null);
  return NextResponse.json({
    ...(res ?? empty('error')),
    origin,
    destination,
    departDate: departRaw,
    returnDate: tripType === 'roundtrip' ? returnRaw : '',
    travelers,
    cabin,
  });
}
