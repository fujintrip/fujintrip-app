import { NextRequest, NextResponse } from 'next/server';
import { CITY_IATA } from '../../../lib/duffel';
import { CITY_INFO } from '../../../lib/tripCard';
import {
  hotelbedsProductActive,
  hotelbedsProductConfigured,
  hotelbedsProductEnabled,
} from '../../../lib/hotelbeds';
import {
  searchHotelbedsTransfers,
  type HotelbedsTransferPointType,
  type HotelbedsTransfersResult,
} from '../../../lib/hotelbeds-transfers';

/**
 * POST /api/hotelbeds-transfers — the Taxis tab's Hotelbeds
 * sandbox airport-transfer column (Nov 16, 2026). Wired, toggle
 * OFF in lib/hotelbeds.ts until the user switches it on.
 *
 * Search body: { from, to, depart, pickupTime?, travelers? }
 * - from/to: CITY NAMES. Each side resolves to an IATA airport
 *   code when the city has one, else to its GPS coordinates —
 *   at least one side must be an airport, or the search is not an
 *   airport transfer at all. Hotelbeds ATLAS hotel codes are never
 *   guessed (no hotel is picked for the traveler).
 * - depart: YYYY-MM-DD; pickupTime: "HH:mm" (defaults to 12:00 —
 *   the API needs a datetime, and noon is the disclosed default).
 * - travelers: 1–9 (default 2), all adults.
 * - One-way only: the Taxis tab models one trip, not a return leg.
 * Returns the HotelbedsTransfersResult: { live, enabled,
 * configured, active, source:'hotelbeds-transfers', sandbox:true,
 * checkedAt, fromLabel, toLabel, outbound, adults, transfers,
 * reason? }. Transfers carry direction, type (PRIVATE/SHARED),
 * vehicle + category, pickup date/time, and the total price for
 * the whole party.
 * The response is always 200: a switched-off toggle, a missing
 * key, an error, or an empty result is an honest live:false +
 * reason, never an invented transfer.
 * HOTELBEDS_TRANSFERS_API_KEY / HOTELBEDS_TRANSFERS_API_SECRET
 * never leave the server. SANDBOX: every price is test data from
 * the evaluation account — the panel labels it as such; nothing
 * here is a bookable transfer.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;

  const from = typeof raw.from === 'string' ? raw.from.trim() : '';
  const to = typeof raw.to === 'string' ? raw.to.trim() : '';
  const depart = typeof raw.depart === 'string' ? raw.depart.trim() : '';
  const pickupTimeRaw = typeof raw.pickupTime === 'string' ? raw.pickupTime.trim() : '';
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
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTimeRaw);
  const pickupTime = timeOk ? pickupTimeRaw : '12:00';
  const outbound = validIso(depart) ? `${depart}T${pickupTime}:00` : '';

  const empty = (reason: HotelbedsTransfersResult['reason']): HotelbedsTransfersResult => ({
    live: false,
    enabled: hotelbedsProductEnabled('transfers'),
    configured: hotelbedsProductConfigured('transfers'),
    active: hotelbedsProductActive('transfers'),
    source: 'hotelbeds-transfers',
    sandbox: true,
    checkedAt: null,
    fromLabel: from,
    toLabel: to,
    outbound,
    adults: travelers,
    transfers: [],
    reason,
  });

  if (!from || !to || !validIso(depart)) {
    return NextResponse.json(empty(!validIso(depart) ? 'no_dates' : 'no_location'));
  }
  // Each side: an airport code when the city has one, else GPS.
  const resolve = (
    place: string
  ): { type: HotelbedsTransferPointType; code: string } | null => {
    const iata = CITY_IATA[place];
    if (iata) return { type: 'IATA', code: iata };
    const info = CITY_INFO[place];
    if (info) return { type: 'GPS', code: `${info.lat},${info.lng}` };
    return null;
  };
  const fromPoint = resolve(from);
  const toPoint = resolve(to);
  if (!fromPoint || !toPoint) {
    return NextResponse.json(empty('no_location'));
  }
  if (fromPoint.type !== 'IATA' && toPoint.type !== 'IATA') {
    return NextResponse.json(empty('no_airport'));
  }
  const res = await searchHotelbedsTransfers({
    fromType: fromPoint.type,
    fromCode: fromPoint.code,
    toType: toPoint.type,
    toCode: toPoint.code,
    fromLabel: from,
    toLabel: to,
    outbound,
    adults: travelers,
  }).catch(() => null);
  return NextResponse.json(res ?? empty('error'));
}
