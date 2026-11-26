import { NextRequest, NextResponse } from 'next/server';
import { resolveAirportCode } from '../../../lib/airportCodes';
import { ROUTE_STOPS, routeKeyForDestination } from '../../../lib/planner';
import { fetchCompetitorFares } from '../../../lib/travelpayouts';

/**
 * GET /api/competitor-fares — the "Other sites" comparison column,
 * filled with CACHED Travelpayouts fares (user chose "Travelpayouts now
 * — cached, labelled", Nov 12, 2026).
 *
 * Query: ?origin=New York&destination=Central Europe
 *   &depart=2027-01-04&return=2027-01-17&travelers=2
 * - origin: the traveler's departure city (chat). destination: a route
 *   display name ("Central Europe") or a city ("Kyoto").
 * - originIata / destIata (optional): the picker's IATA codes when
 *   captured — preferred over name resolution, never guessed. The
 *   fare is looked up for the route's first city, so a passed
 *   destination code only applies when the destination already is
 *   that city.
 * - depart/return: the trip card's start/end dates (YYYY-MM-DD).
 * - Server-side only: TRAVELPAYOUTS_TOKEN never leaves the server.
 *
 * The response is always 200 with { available, configured, ... }:
 * available=true carries the cheapest cached round-trip fare per
 * traveler, the trip total, and a label with its check date
 * ("Cached / indicative — checked <date>"). available=false carries an
 * honest label instead — no token, no airport code, no cached fare for
 * those dates, or a lookup failure — and never an invented price.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const origin = (q.get('origin') || '').trim();
  const destination = (q.get('destination') || '').trim();
  const depart = (q.get('depart') || '').trim();
  const ret = (q.get('return') || '').trim();
  const travelers = Math.min(9, Math.max(1, Number.parseInt(q.get('travelers') || '2', 10) || 2));
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

  if (!origin || !destination || !dateOk(depart) || !dateOk(ret)) {
    return NextResponse.json({
      available: false,
      configured: Boolean(process.env.TRAVELPAYOUTS_TOKEN),
      origin,
      destination,
      originIata: null,
      destIata: null,
      departDate: depart,
      returnDate: ret,
      travelers,
      farePerTraveler: null,
      total: null,
      currency: 'USD',
      checkedAt: new Date().toISOString().slice(0, 10),
      label: 'Competitor fares need a departure city, a destination and trip dates — nothing was looked up.',
      reason: 'no-cached-fare',
    });
  }

  // The fare is looked up for the route's first city; a passed
  // destination code only applies when the destination already is
  // that city (a route name like "Central Europe" carries no code).
  const destKey = destination ? routeKeyForDestination(destination) : '';
  const fareDestCity = destKey ? ROUTE_STOPS[destKey][0].city : destination;
  const result = await fetchCompetitorFares({
    origin,
    destination,
    departDate: depart,
    returnDate: ret,
    travelers,
    originIata: resolveAirportCode(origin, q.get('originIata')) ?? undefined,
    destIata: resolveAirportCode(fareDestCity, destination === fareDestCity ? q.get('destIata') : undefined) ?? undefined,
  });
  return NextResponse.json(result);
}
