// Hotelbeds Bundle (Nov 16, 2026) — the fourth Hotelbeds product
// key, wired and ON (activated Nov 17, 2026; the Bundle key is live
// in DigitalOcean). No planner rebuild: our planner already builds
// packages from its own legs, and Bundle must not change that — the
// package price's hotel leg can come from a Bundle fare (see
// collectLivePackageFares in lib/packages.ts), but the legs, tiers
// and totals stay the planner's.
//
// What "Bundle" is, from Hotelbeds' own material: there is no
// separate Bundle API product in Hotelbeds' public API specs (the
// official OpenAPI repo lists Hotel, Activities and Transfers
// Booking/Content/Cache APIs only). Bundling is a feature of the
// Hotel BookingAPI: an availability search with packaging: true
// and hotelPackage: 'YES' returns packaged hotel rates (hotel +
// transfer + activity under one confirmation, per Hotelbeds' 2024
// bundling note). The Bundle key is the credential for that
// packaging flow. So this client runs the documented packaging
// availability search against the Hotel BookingAPI host, with the
// BUNDLE key/secret — and nothing else.
//
// The toggle in lib/hotelbeds.ts is ON: the route runs the packaging
// search and returns packaging availability (hotels with packaged
// rates, parsed by the same mapper as the Hotel product). SANDBOX:
// every price is test data from the evaluation account.
import {
  hotelbedsAuthHeaders,
  hotelbedsErrorReason,
  hotelbedsFetch,
  hotelbedsProductActive,
  hotelbedsProductConfigured,
  hotelbedsProductCredentials,
  hotelbedsProductEnabled,
  mapAvailabilityHotels,
  type HotelbedsHotel,
} from './hotelbeds';

const HOTELBEDS_API = 'https://api.test.hotelbeds.com';
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GEO_RADIUS_KM = 20;

export type HotelbedsBundleReason =
  | 'disabled'
  | 'no_key'
  | 'no_coordinates'
  | 'no_dates'
  | 'no_hotels'
  | 'unauthorized'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'bad_response'
  | 'error';

export type HotelbedsBundleResult = {
  live: boolean;
  enabled: boolean;
  configured: boolean;
  active: boolean;
  source: 'hotelbeds-bundle';
  sandbox: true;
  checkedAt: string | null;
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  nights: number;
  hotels: HotelbedsHotel[];
  reason?: HotelbedsBundleReason;
  note: string;
};

export type HotelbedsBundleInput = {
  latitude: number;
  longitude: number;
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
};

export const HOTELBEDS_BUNDLE_NOTE =
  'Bundle is on: the packaging search runs under the Bundle key (Hotel BookingAPI with packaging + hotelPackage), and package prices read its fares — sandbox test data, labeled as such. The planner still builds packages from its own legs.';

export function hotelbedsBundleNote(): string {
  return HOTELBEDS_BUNDLE_NOTE;
}

// Same shape as the other three products' empty messages, so a
// future UI (or the route's error text) can name the real cause
// instead of inventing one.
export function hotelbedsBundleEmptyMessage(reason?: HotelbedsBundleReason): string {
  switch (reason) {
    case 'disabled':
      return 'Hotelbeds bundle is switched off in the code — flip the bundle toggle in lib/hotelbeds.ts to turn the packaging search on.';
    case 'no_key':
      return 'Hotelbeds bundle is not connected yet — add HOTELBEDS_BUNDLE_API_KEY and HOTELBEDS_BUNDLE_API_SECRET in DigitalOcean.';
    case 'no_coordinates':
      return 'Hotelbeds has no location on file for this destination, so no test hotels were checked.';
    case 'no_dates':
      return 'Hotelbeds needs check-in and check-out dates — add dates to see test hotels.';
    case 'no_hotels':
      return 'Hotelbeds found no test hotels for these dates.';
    case 'unauthorized':
      return 'Hotelbeds rejected the API key — check HOTELBEDS_BUNDLE_API_KEY and HOTELBEDS_BUNDLE_API_SECRET in DigitalOcean.';
    case 'quota_exceeded':
      return 'Hotelbeds sandbox allows 50 requests a day and today’s quota is used up — test hotels return tomorrow.';
    case 'rate_limited':
      return 'Hotelbeds is busy right now — try the search again shortly.';
    case 'upstream_unavailable':
      return 'Hotelbeds did not answer — try again shortly.';
    case 'bad_response':
      return 'Hotelbeds answered in a shape we could not read — nothing was shown rather than guessed.';
    default:
      return 'Hotelbeds could not be reached right now.';
  }
}

export function hotelbedsBundleStatus(): {
  enabled: boolean;
  configured: boolean;
  active: boolean;
  source: 'hotelbeds-bundle';
  sandbox: true;
  note: string;
} {
  return {
    enabled: hotelbedsProductEnabled('bundle'),
    configured: hotelbedsProductConfigured('bundle'),
    active: hotelbedsProductActive('bundle'),
    source: 'hotelbeds-bundle',
    sandbox: true,
    note: HOTELBEDS_BUNDLE_NOTE,
  };
}

// --- Live calls ------------------------------------------------------

const searchCache = new Map<string, { ts: number; result: HotelbedsBundleResult }>();
let quotaBlockedUntil = 0;

// Test-only: the module cache survives across tests in one process,
// so a test that stubs fetch clears it between cases. Production
// code never calls this.
export function clearHotelbedsBundleCache(): void {
  searchCache.clear();
  quotaBlockedUntil = 0;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const days = Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86400000
  );
  return Number.isFinite(days) && days >= 1 ? days : 1;
}

export async function searchHotelbedsBundle(input: HotelbedsBundleInput): Promise<HotelbedsBundleResult> {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const base: HotelbedsBundleResult = {
    live: false,
    enabled: hotelbedsProductEnabled('bundle'),
    configured: hotelbedsProductConfigured('bundle'),
    active: hotelbedsProductActive('bundle'),
    source: 'hotelbeds-bundle',
    sandbox: true,
    checkedAt: null,
    destination: input.destination,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    nights,
    hotels: [],
    note: HOTELBEDS_BUNDLE_NOTE,
  };
  // Switched off in code: no API call, whatever the keys — the
  // toggle is the switch.
  if (!base.enabled) return { ...base, reason: 'disabled' };
  if (!base.configured) return { ...base, reason: 'no_key' };
  const creds = hotelbedsProductCredentials('bundle');
  if (!creds) return { ...base, reason: 'no_key' };
  const key = `bundle|${input.latitude}|${input.longitude}|${input.checkIn}|${input.checkOut}|${input.guests}|${input.rooms}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  if (Date.now() < quotaBlockedUntil) return { ...base, reason: 'quota_exceeded' };

  // The form collects total guests + rooms, not a per-room split,
  // so guests are spread evenly across rooms (rounded) — the same
  // disclosed rule as the Hotel product.
  const perRoom = Math.max(1, Math.round(input.guests / Math.max(1, input.rooms)));
  const body = {
    stay: { checkIn: input.checkIn, checkOut: input.checkOut },
    occupancies: [{ rooms: input.rooms, adults: perRoom, children: 0 }],
    geolocation: {
      latitude: input.latitude,
      longitude: input.longitude,
      radius: GEO_RADIUS_KM,
      unit: 'km',
    },
    filter: { maxRatesPerRoom: 1 },
    // The bundling flags (Hotel BookingAPI docs): the search
    // returns packaged rates — hotel + transfer + activity under
    // one confirmation — instead of room-only rates.
    packaging: true,
    hotelPackage: 'YES',
    language: 'ENG',
    sourceMarket: 'US',
  };
  const r = await hotelbedsFetch(
    `${HOTELBEDS_API}/hotel-api/1.0/hotels`,
    {
      method: 'POST',
      headers: { ...(await hotelbedsAuthHeaders(creds.apiKey, creds.secret)), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    FETCH_TIMEOUT_MS
  );
  if (!r) return { ...base, reason: 'error' };
  if (!r.ok) {
    if (r.status === 403) quotaBlockedUntil = Date.now() + CACHE_TTL_MS;
    return { ...base, reason: hotelbedsErrorReason(r.status) };
  }
  const hotels = mapAvailabilityHotels(r.json, nights, input.guests);
  if (!hotels) return { ...base, reason: 'bad_response' };
  if (!hotels.length) return { ...base, reason: 'no_hotels' };
  const result: HotelbedsBundleResult = {
    ...base,
    live: true,
    checkedAt: new Date().toISOString().slice(0, 10),
    hotels,
  };
  // Only a real HTTP 200 answer is cached — an error never poisons
  // the cache, and a failed request is never retried in a loop.
  searchCache.set(key, { ts: Date.now(), result });
  return result;
}
