import { NextRequest, NextResponse } from 'next/server';
import { resolveAirportCode } from '../../../lib/airportCodes';
import { cabinClassFor } from '../../../lib/duffel';
import {
  fetchIgnavBookingLinks,
  ignavConfigured,
  searchIgnavFares,
  type IgnavFaresResponse,
  type IgnavLegResult,
  type IgnavSearchInput,
  type IgnavTripType,
} from '../../../lib/ignav';
import { ROUTE_STOPS, routeKeyForDestination } from '../../../lib/planner';

/**
 * POST /api/ignav-fares — the Ignav live comparison column.
 *
 * Search body (same trip shape the Flights search already builds):
 * { tripType?, origin, destination, depart?, return?, legs?, travelers?, cabin? }
 * - tripType 'roundtrip' (default) / 'oneway' / 'multicity'.
 * - origin/destination/legs carry CITY NAMES — plus the picker's
 *   IATA code when one was captured (originIata / destinationIata,
 *   per leg too). A passed code is preferred; otherwise the name
 *   resolves through the server-side resolver (hand map, then the
 *   generated city dataset) — codes are never guessed.
 * - depart/return are YYYY-MM-DD; return must be >= depart.
 * - Multi-city legs: [{ origin, destination, date }] (2–4).
 * Returns { live, configured, source:'ignav', observedAt, tripType,
 * itineraries, legs, ... } — itineraries carry whole-trip prices for
 * one-way, round-trip and 2-leg multi-city; legs carry per-leg fares
 * for 3–4-leg multi-city (Ignav's flexible search caps at 2 legs).
 * The response is always 200: a missing key, an Ignav error, or an
 * empty result is an honest live:false + reason, never an invented
 * fare. IGNAV_API_KEY never leaves the server.
 *
 * Booking-links body: { action:'booking-links', ignavId, origin?,
 * destination?, departureDate?, returnDate?, outboundCarrierCode?,
 * outboundFlightNumber?, inboundCarrierCode?, inboundFlightNumber?,
 * adults?, children? } — returns { available, configured, links }.
 * Links are fetched only when the traveler asks (each lookup is a
 * billable Ignav request), and open the airline's or OTA's own site.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;

  // --- Booking links (on demand, one billable request per click). ---
  if (raw.action === 'booking-links') {
    const ignavId = typeof raw.ignavId === 'string' ? raw.ignavId.trim() : '';
    const str = (k: string) => (typeof raw[k] === 'string' && (raw[k] as string).trim() ? (raw[k] as string).trim() : undefined);
    const num = (k: string) =>
      typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : undefined;
    const result = await fetchIgnavBookingLinks({
      ignavId,
      origin: str('origin'),
      destination: str('destination'),
      departureDate: str('departureDate'),
      returnDate: str('returnDate'),
      outboundCarrierCode: str('outboundCarrierCode'),
      outboundFlightNumber: str('outboundFlightNumber'),
      inboundCarrierCode: str('inboundCarrierCode'),
      inboundFlightNumber: str('inboundFlightNumber'),
      adults: num('adults'),
      children: num('children'),
    }).catch(() => null);
    return NextResponse.json(
      result ?? { available: false, configured: ignavConfigured(), links: [], reason: 'error' }
    );
  }

  // --- Search. ---
  const origin = typeof raw.origin === 'string' ? raw.origin.trim() : '';
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const travelers =
    typeof raw.travelers === 'number' && raw.travelers >= 1 && raw.travelers <= 9 ? raw.travelers : 2;
  const cabin = cabinClassFor(raw.cabin);
  const tripType: IgnavTripType =
    raw.tripType === 'oneway' || raw.tripType === 'multicity' ? raw.tripType : 'roundtrip';

  const validIso = (v: unknown): v is string => {
    if (typeof v !== 'string') return false;
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v.trim();
  };
  const departRaw = typeof raw.depart === 'string' ? raw.depart.trim() : '';
  const returnRaw = typeof raw.return === 'string' ? raw.return.trim() : '';

  const empty = (reason: string, extra: Partial<IgnavFaresResponse> = {}): IgnavFaresResponse => ({
    live: false,
    configured: ignavConfigured(),
    source: 'ignav',
    observedAt: null,
    tripType,
    origin,
    destination,
    departDate: departRaw,
    returnDate: returnRaw,
    travelers,
    cabin,
    itineraries: [],
    legs: [],
    reason,
    ...extra,
  });

  // --- Multi-city: validate the legs, resolve codes, then either the
  // flexible search (2 legs, both resolvable) or one one-way request
  // per resolvable leg (3–4 legs, or a leg with no code — the failed
  // leg renders honestly instead of blocking the others). ---
  if (tripType === 'multicity') {
    const cleanLegs = Array.isArray(raw.legs)
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
    if (cleanLegs.length < 2) {
      return NextResponse.json(
        empty('missing_slots', {
          origin: cleanLegs[0]?.origin ?? '',
          destination: cleanLegs[0]?.destination ?? '',
          departDate: cleanLegs[0]?.date ?? '',
          returnDate: cleanLegs.length ? cleanLegs[cleanLegs.length - 1].date : '',
        })
      );
    }
    const resolved = cleanLegs.map((l) => ({
      ...l,
      fromIata: resolveAirportCode(l.origin, l.originIata),
      toIata: resolveAirportCode(l.destination, l.destinationIata),
    }));
    const first = cleanLegs[0];
    const last = cleanLegs[cleanLegs.length - 1];
    if (resolved.length === 2 && resolved.every((l) => l.fromIata && l.toIata)) {
      const res = await searchIgnavFares({
        tripType: 'multicity',
        origin: resolved[0].fromIata!,
        destination: resolved[0].toIata!,
        departDate: resolved[0].date,
        legs: resolved.map((l) => ({ origin: l.fromIata!, destination: l.toIata!, date: l.date })),
        travelers,
        cabin,
      }).catch(() => null);
      return NextResponse.json({
        ...(res ?? empty('error')),
        origin: first.origin,
        destination: first.destination,
        departDate: first.date,
        returnDate: last.date,
        travelers,
        cabin,
      });
    }
    // Per-leg path: only the resolvable legs are searched; the rest
    // render as failed legs, in their original positions.
    const searchable = resolved.filter((l) => l.fromIata && l.toIata);
    const res = await searchIgnavFares({
      tripType: 'multicity',
      origin: searchable[0]?.fromIata ?? '',
      destination: searchable[0]?.toIata ?? '',
      departDate: searchable[0]?.date ?? first.date,
      legs: searchable.map((l) => ({ origin: l.fromIata!, destination: l.toIata!, date: l.date })),
      travelers,
      cabin,
    }).catch(() => null);
    let cursor = 0;
    const legs: IgnavLegResult[] = resolved.map((l) => {
      const lk = routeKeyForDestination(l.destination);
      const destCity = lk ? ROUTE_STOPS[lk][0].city : l.destination;
      if (!l.fromIata || !l.toIata) {
        return { origin: l.origin, destination: l.destination, destCity, date: l.date, live: false, reason: 'no_airport_code', out: [] };
      }
      const got = res?.legs[cursor++];
      return {
        origin: l.origin,
        destination: l.destination,
        destCity,
        date: l.date,
        live: got?.live ?? false,
        ...(got?.reason ? { reason: got.reason } : {}),
        out: got?.out ?? [],
      };
    });
    const allLive = legs.length > 0 && legs.every((l) => l.live && l.out.length > 0);
    return NextResponse.json({
      live: allLive,
      configured: ignavConfigured(),
      source: 'ignav',
      observedAt: res?.observedAt ?? null,
      tripType,
      origin: first.origin,
      destination: first.destination,
      departDate: first.date,
      returnDate: last.date,
      travelers,
      cabin,
      itineraries: [],
      legs,
      reason: allLive ? undefined : res?.reason ?? 'no_offers',
    });
  }

  // --- One-way / round-trip. ---
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
  const input: IgnavSearchInput = {
    tripType,
    origin: fromIata,
    destination: toIata,
    departDate: departRaw,
    ...(tripType === 'roundtrip' ? { returnDate: returnRaw } : {}),
    travelers,
    cabin,
  };
  const res = await searchIgnavFares(input).catch(() => null);
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
