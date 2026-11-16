import { NextRequest, NextResponse } from 'next/server';
import { CITY_INFO } from '../../../lib/tripCard';
import {
  hotelbedsConfigured,
  hotelbedsProductActive,
  hotelbedsProductEnabled,
  searchHotelbedsStays,
  type HotelbedsSearchResult,
} from '../../../lib/hotelbeds';

/**
 * POST /api/hotelbeds-stays — the Stays tab's Hotelbeds sandbox
 * column (Nov 16, 2026).
 *
 * Search body: { destination, checkIn, checkOut, guests?, rooms? }
 * - destination: a CITY NAME (resolved via CITY_INFO lat/lng for
 *   the geolocation search — Hotelbeds destination codes are never
 *   guessed).
 * - checkIn/checkOut: YYYY-MM-DD; checkOut must be after checkIn.
 * - guests: 1–9 (default 2); rooms: 1–4 (default 1).
 * Returns the HotelbedsSearchResult: { live, configured,
 * source:'hotelbeds', sandbox:true, checkedAt, destination,
 * checkIn, checkOut, guests, rooms, nights, hotels, reason? }.
 * Hotels carry name, category, zone, cheapest net price for the
 * whole stay (per night + per traveler), room/board, and a photo
 * URL from ContentAPI when one was found.
 * The response is always 200: a missing key, an error, or an empty
 * result is an honest live:false + reason, never an invented hotel.
 * HOTELBEDS_API_KEY / HOTELBEDS_API_SECRET never leave the server.
 * SANDBOX: every price is test data from the evaluation account —
 * the panel labels it as such; nothing here is a bookable room.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;

  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const checkIn = typeof raw.checkIn === 'string' ? raw.checkIn.trim() : '';
  const checkOut = typeof raw.checkOut === 'string' ? raw.checkOut.trim() : '';
  const guests =
    typeof raw.guests === 'number' && Number.isFinite(raw.guests)
      ? Math.min(9, Math.max(1, Math.floor(raw.guests)))
      : 2;
  const rooms =
    typeof raw.rooms === 'number' && Number.isFinite(raw.rooms)
      ? Math.min(4, Math.max(1, Math.floor(raw.rooms)))
      : 1;

  const validIso = (v: string): boolean => {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const nights =
    validIso(checkIn) && validIso(checkOut) && checkOut > checkIn
      ? Math.round(
          (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86400000
        )
      : 0;

  const empty = (reason: HotelbedsSearchResult['reason']): HotelbedsSearchResult => ({
    live: false,
    configured: hotelbedsConfigured(),
    enabled: hotelbedsProductEnabled('hotel'),
    active: hotelbedsProductActive('hotel'),
    source: 'hotelbeds',
    sandbox: true,
    checkedAt: null,
    destination,
    checkIn,
    checkOut,
    guests,
    rooms,
    nights,
    hotels: [],
    reason,
  });

  if (!destination || !validIso(checkIn) || !validIso(checkOut) || nights < 1) {
    return NextResponse.json(empty('no_dates'));
  }
  const info = CITY_INFO[destination];
  if (!info) {
    return NextResponse.json(empty('no_coordinates'));
  }
  const res = await searchHotelbedsStays({
    latitude: info.lat,
    longitude: info.lng,
    destination,
    checkIn,
    checkOut,
    guests,
    rooms,
  }).catch(() => null);
  return NextResponse.json(res ?? empty('error'));
}
