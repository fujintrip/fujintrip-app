import { NextRequest, NextResponse } from 'next/server';
import { CITY_TZ, fetchTonight } from '../../../lib/food';

/**
 * POST /api/food — "Tonight, near you, open now" (competitor learning
 * round 2 #4).
 *
 * Body: { city }.
 * Returns the 3 places open tonight in that city — name, price band,
 * open-now status, walk time from the city center, named dish, one
 * Wikivoyage review quote — all from Wikivoyage's Eat listings and
 * OpenStreetMap, never invented. A place whose hours cannot be parsed
 * is "hours not verified", never guessed open. When no place can be
 * confirmed, places is empty and the client says so honestly.
 *
 * The city must be a trip-card city; anything else returns an empty
 * list rather than fetching a page the app cannot vouch for.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const city = typeof raw.city === 'string' ? raw.city.trim() : '';
  if (!city || city.length > 60 || !CITY_TZ[city]) {
    return NextResponse.json({ city, tz: null, places: [], checkedAt: new Date().toISOString(), reason: 'unknown_city' });
  }
  const tonight = await fetchTonight(city).catch(() => ({
    city,
    tz: CITY_TZ[city],
    places: [],
    checkedAt: new Date().toISOString(),
  }));
  return NextResponse.json({ ...tonight, reason: tonight.places.length ? undefined : 'no_open_places' });
}
