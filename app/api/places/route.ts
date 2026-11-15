import { NextRequest, NextResponse } from 'next/server';
import { searchPlaces } from '../../../lib/places';

/**
 * GET /api/places — live type-ahead suggestions for the search widget's
 * place fields (API phase round 1, Nov 14, 2026).
 *
 * Query: ?q=lon
 * - q: the typed prefix (2–80 chars). Under 2 chars the reply is an
 *   honest empty list with reason 'type-more' — no guessing from one
 *   letter.
 *
 * The response is always 200 with { places, source, reason? }:
 * - places: [{ name, value, kind: 'city' | 'airport' | 'region',
 *   country?, iata? }]. `value` is what the field is filled with on
 *   selection; for an airport it is the city it serves, so the search
 *   still resolves exactly as today. `iata` is present only when the
 *   source provided it — never guessed.
 * - source: 'travelpayouts' | 'nominatim' | 'known' | 'none' — which
 *   link in the chain answered (see lib/places.ts).
 * - reason: 'type-more' | 'no-matches' when the list is empty.
 *
 * Server-side only: no supplier token ever reaches the client, and a
 * failed live source falls through to the next one instead of failing
 * the request.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  const result = await searchPlaces(q);
  return NextResponse.json(result);
}
