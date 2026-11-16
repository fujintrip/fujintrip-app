import { NextRequest, NextResponse } from 'next/server';
import { CITY_INFO } from '../../../lib/tripCard';
import {
  hotelbedsProductActive,
  hotelbedsProductConfigured,
  hotelbedsProductEnabled,
} from '../../../lib/hotelbeds';
import {
  searchHotelbedsActivities,
  type HotelbedsActivitiesResult,
} from '../../../lib/hotelbeds-activities';

/**
 * POST /api/hotelbeds-activities — the Attractions tab's Hotelbeds
 * sandbox column (Nov 16, 2026). Wired, toggle OFF in
 * lib/hotelbeds.ts until the user switches it on.
 *
 * Search body: { destination, from, to?, travelers? }
 * - destination: a CITY NAME (resolved via CITY_INFO lat/lng for
 *   the GPS filter — Hotelbeds destination codes are never
 *   guessed).
 * - from/to: YYYY-MM-DD; to defaults to from (single-day search).
 * - travelers: 1–9 (default 2); every pax is an adult (ages are
 *   not collected).
 * Returns the HotelbedsActivitiesResult: { live, enabled,
 * configured, active, source:'hotelbeds-activities', sandbox:true,
 * checkedAt, destination, from, to, travelers, activities,
 * reason? }. Activities carry name, destination, modality, the
 * cheapest per-person from-price + party total, and a photo URL
 * from the availability content when one was found.
 * The response is always 200: a switched-off toggle, a missing
 * key, an error, or an empty result is an honest live:false +
 * reason, never an invented tour. HOTELBEDS_ACTIVITIES_API_KEY /
 * HOTELBEDS_ACTIVITIES_API_SECRET never leave the server.
 * SANDBOX: every price is test data from the evaluation account —
 * the panel labels it as such; nothing here is a bookable
 * activity.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;

  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const from = typeof raw.from === 'string' ? raw.from.trim() : '';
  const toRaw = typeof raw.to === 'string' ? raw.to.trim() : '';
  const travelers =
    typeof raw.travelers === 'number' && Number.isFinite(raw.travelers)
      ? Math.min(9, Math.max(1, Math.floor(raw.travelers)))
      : 2;

  const validIso = (v: string): boolean => {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const to = validIso(toRaw) && toRaw >= from ? toRaw : from;

  const empty = (reason: HotelbedsActivitiesResult['reason']): HotelbedsActivitiesResult => ({
    live: false,
    enabled: hotelbedsProductEnabled('activities'),
    configured: hotelbedsProductConfigured('activities'),
    active: hotelbedsProductActive('activities'),
    source: 'hotelbeds-activities',
    sandbox: true,
    checkedAt: null,
    destination,
    from,
    to,
    travelers,
    activities: [],
    reason,
  });

  if (!destination || !validIso(from)) {
    return NextResponse.json(empty(!destination ? 'no_coordinates' : 'no_dates'));
  }
  const info = CITY_INFO[destination];
  if (!info) {
    return NextResponse.json(empty('no_coordinates'));
  }
  const res = await searchHotelbedsActivities({
    latitude: info.lat,
    longitude: info.lng,
    destination,
    from,
    to,
    travelers,
  }).catch(() => null);
  return NextResponse.json(res ?? empty('error'));
}
