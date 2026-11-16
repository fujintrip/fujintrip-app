import { NextRequest, NextResponse } from 'next/server';
import { CITY_INFO } from '../../../lib/tripCard';
import {
  hotelbedsProductActive,
  hotelbedsProductConfigured,
  hotelbedsProductEnabled,
} from '../../../lib/hotelbeds';
import {
  hotelbedsBundleStatus,
  searchHotelbedsBundle,
  type HotelbedsBundleResult,
} from '../../../lib/hotelbeds-bundle';

/**
 * /api/hotelbeds-bundle — the Hotelbeds Bundle product (Nov 16,
 * 2026). Wired, toggle OFF in lib/hotelbeds.ts until the user
 * switches it on. NO planner rebuild: the planner already builds
 * packages from its own legs and never reads this route.
 *
 * GET — status only: { enabled, configured, active,
 * source:'hotelbeds-bundle', sandbox:true, note }.
 *
 * POST — packaging availability search: { destination, checkIn,
 * checkOut, guests?, rooms? } (same shape as /api/hotelbeds-stays).
 * Runs the Hotel BookingAPI availability search with packaging:
 * true + hotelPackage: 'YES' under the BUNDLE key/secret, and
 * returns the packaged hotels parsed by the same mapper as the
 * Hotel product.
 * The response is always 200: a switched-off toggle, a missing
 * key, an error, or an empty result is an honest live:false +
 * reason, never an invented package. HOTELBEDS_BUNDLE_API_KEY /
 * HOTELBEDS_BUNDLE_API_SECRET never leave the server. SANDBOX:
 * every price is test data from the evaluation account.
 */
export async function GET() {
  return NextResponse.json(hotelbedsBundleStatus());
}

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

  const empty = (reason: HotelbedsBundleResult['reason']): HotelbedsBundleResult => ({
    live: false,
    enabled: hotelbedsProductEnabled('bundle'),
    configured: hotelbedsProductConfigured('bundle'),
    active: hotelbedsProductActive('bundle'),
    source: 'hotelbeds-bundle',
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
    note: '',
  });

  if (!destination || !validIso(checkIn) || !validIso(checkOut) || nights < 1) {
    return NextResponse.json(empty('no_dates'));
  }
  const info = CITY_INFO[destination];
  if (!info) {
    return NextResponse.json(empty('no_coordinates'));
  }
  const res = await searchHotelbedsBundle({
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
