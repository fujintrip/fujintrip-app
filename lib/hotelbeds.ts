// Hotelbeds sandbox stays (Nov 16, 2026) — the Stays tab's first
// live hotel source, in TEST mode: the user signed up for a free
// Hotelbeds developer account (info@fujintrip.com) and the
// evaluation key (HOTELBEDS_API_KEY + HOTELBEDS_API_SECRET) lives
// in DigitalOcean as SECRET RUN_TIME.
//
// Built from Hotelbeds' own docs, read live Nov 16, 2026:
// https://developer.hotelbeds.com/documentation/ (Getting Started,
// BookingAPI + ContentAPI OpenAPI specs, and the "Use of images"
// page). Auth: `Api-key` header + `X-Signature`, a SHA-256 hash in
// hex of apiKey + secret + current Unix seconds. Test host:
// https://api.test.hotelbeds.com. Evaluation quota: 50 requests/day
// (403 when exceeded) — the server caches aggressively (6h) and
// never calls the API per render.
//
// BookingAPI: POST /hotel-api/1.0/hotels — availability by
// geolocation (the Stays tab has city names; CITY_INFO carries
// lat/lng, so no Hotelbeds destination code is ever guessed).
//   { stay: {checkIn, checkOut}, occupancies: [{rooms, adults,
//     children: 0}], geolocation: {latitude, longitude, radius,
//     unit: 'km'}, filter: {maxRatesPerRoom: 1}, language: 'ENG',
//     sourceMarket: 'US' }
//   → { hotels: { total, hotel: [{ code, name, categoryCode,
//     categoryName, destinationName, zoneName, latitude, longitude,
//     minRate, currency, room: [{ name, rate: [{ net, rateKey,
//     rateType, boardCode, boardName }] }] }] } }
// ContentAPI: GET /hotel-content-api/1.0/hotels/{codes}/details
// (comma-separated codes — ONE call for every hotel on screen)
//   → { hotels: [{ code, name, images: [{ path, order,
//     imageTypeCode }] }] } — paths are partial; the full URL is
//   https://photos.hotelbeds.com/giata/ + path (320px standard;
//   /bigger/ is 800px). Hotelbeds warns that live ContentAPI calls
//   can get credentials blocked, so details are fetched once per
//   search and cached per hotel for 24h — never per render.
//
// Honesty rules: the sandbox is TEST data — Hotelbeds' own docs
// say bookings on api.test.hotelbeds.com are never real
// reservations and no card is ever charged. Every result is labeled
// sandbox/test, never a bookable room, never a live price. A
// missing key, an error, or an empty result is an honest empty
// state, never an invented hotel. Keys are server-side only (never
// in the client bundle). This module stays client-safe (no node:
// imports — the signature uses Web Crypto) so the Stays tab can
// import its label helpers, the same as lib/ignav.ts.
const HOTELBEDS_API = 'https://api.test.hotelbeds.com';
const FETCH_TIMEOUT_MS = 15000;
// The evaluation key allows 50 requests/day: a repeat search for
// the same stay within 6h costs nothing and stays fresh (same TTL
// as the Travelpayouts competitor-fares cache).
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Hotel content is static — one details fetch per hotel per day.
const CONTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// The panel shows the cheapest few hotels, like the flight panel's
// 3 offers per direction — a longer list is noise, not choice.
export const HOTELBEDS_MAX_HOTELS = 6;
// Geolocation search radius around the city centre (the docs'
// own example uses 20 km for Palma).
const GEO_RADIUS_KM = 20;

export type HotelbedsHotel = {
  code: number;
  name: string;
  categoryCode?: string;
  categoryName?: string;
  destinationName?: string;
  zoneName?: string;
  latitude?: number;
  longitude?: number;
  // Cheapest rate's net price for the whole stay, all rooms. Net is
  // what Hotelbeds charges the agency (B2B net rates) — the figure
  // is shown as the test total, never marked up, never a retail
  // price we invented.
  price: number;
  currency: string;
  nights: number;
  perNight: number;
  perTraveler: number;
  roomName?: string;
  boardCode?: string;
  boardName?: string;
  rateType?: 'BOOKABLE' | 'RECHECK';
  imageUrl?: string;
  // The ContentAPI gallery for this hotel (up to 6 photos, lowest
  // order first); imageUrl is images[0]. A hotel with no usable
  // photo has neither.
  images?: string[];
};

export type HotelbedsReason =
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

export type HotelbedsSearchResult = {
  live: boolean;
  configured: boolean;
  enabled: boolean;
  active: boolean;
  source: 'hotelbeds';
  sandbox: true;
  checkedAt: string | null;
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  nights: number;
  hotels: HotelbedsHotel[];
  reason?: HotelbedsReason;
};

export type HotelbedsSearchInput = {
  latitude: number;
  longitude: number;
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
};

// --- Products ------------------------------------------------------
// Per-product on/off, in ONE place (Nov 16, 2026 — user: wire all
// four Hotelbeds products now, activate what we need in code).
// Hotel is on first; Activities, Transfers and Bundle are wired
// and ready to switch on by flipping one boolean each. A product
// that is off renders nothing and never calls its API, whatever
// its keys. Each product has its OWN evaluation key (50 req/day
// each) — the env var names are the ones the user is adding to
// DigitalOcean.
export type HotelbedsProduct = 'hotel' | 'activities' | 'transfers' | 'bundle';

export const HOTELBEDS_PRODUCTS: Record<HotelbedsProduct, boolean> = {
  hotel: true,
  activities: true,
  transfers: true,
  // Bundle activated Nov 17, 2026 (user: add API for packages and
  // trip offers) — the Bundle key is live in DigitalOcean.
  bundle: true,
};

export const HOTELBEDS_PRODUCT_KEYS: Record<HotelbedsProduct, { key: string; secret: string }> = {
  hotel: { key: 'HOTELBEDS_API_KEY', secret: 'HOTELBEDS_API_SECRET' },
  activities: { key: 'HOTELBEDS_ACTIVITIES_API_KEY', secret: 'HOTELBEDS_ACTIVITIES_API_SECRET' },
  transfers: { key: 'HOTELBEDS_TRANSFERS_API_KEY', secret: 'HOTELBEDS_TRANSFERS_API_SECRET' },
  bundle: { key: 'HOTELBEDS_BUNDLE_API_KEY', secret: 'HOTELBEDS_BUNDLE_API_SECRET' },
};

// The code toggle alone — client-safe (no env access), so a tab can
// decide whether to fetch at all without touching keys.
export function hotelbedsProductEnabled(product: HotelbedsProduct): boolean {
  return HOTELBEDS_PRODUCTS[product] === true;
}

export function hotelbedsProductCredentials(product: HotelbedsProduct): { apiKey: string; secret: string } | null {
  const vars = HOTELBEDS_PRODUCT_KEYS[product];
  const apiKey = process.env[vars.key] ?? '';
  const secret = process.env[vars.secret] ?? '';
  if (!apiKey || !secret) return null;
  return { apiKey, secret };
}

export function hotelbedsProductConfigured(product: HotelbedsProduct): boolean {
  return hotelbedsProductCredentials(product) !== null;
}

// Live for a product = switched on in code AND keys present. The
// route checks this before any API call; the tab checks the toggle
// before any fetch.
export function hotelbedsProductActive(product: HotelbedsProduct): boolean {
  return hotelbedsProductEnabled(product) && hotelbedsProductConfigured(product);
}

export function hotelbedsConfigured(): boolean {
  return hotelbedsProductConfigured('hotel');
}

// --- Auth -----------------------------------------------------------
// X-Signature = SHA-256 hex of apiKey + secret + Unix seconds
// (Hotelbeds Getting Started, verbatim). Web Crypto, not node:crypto
// — this module is imported by the client for its label helpers.
export async function hotelbedsSignature(
  apiKey: string,
  secret: string,
  timestampSeconds: number
): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${apiKey}${secret}${Math.floor(timestampSeconds)}`)
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hotelbedsAuthHeaders(
  apiKey: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<Record<string, string>> {
  return {
    Accept: 'application/json',
    'Api-key': apiKey,
    'X-Signature': await hotelbedsSignature(apiKey, secret, nowSeconds),
  };
}

// --- Images ----------------------------------------------------------
// ContentAPI returns partial paths ("00/000112/000112a_hb_ro_025.jpg");
// Hotelbeds' "Use of images" page says to prepend
// https://photos.hotelbeds.com/giata/ for the 320px standard size.
// A path that is already a full URL passes through unchanged.
export function hotelbedsImageUrl(path: string | undefined): string | undefined {
  if (!path || !path.trim()) return undefined;
  const p = path.trim();
  if (/^https?:\/\//i.test(p)) return p;
  return `https://photos.hotelbeds.com/giata/${p.replace(/^\/+/, '')}`;
}

// --- Star class + facets ------------------------------------------------
// Hotelbeds category codes carry the star class: "3EST" is 3 stars,
// "5EST" is 5. Anything else (APART, HOSTEL, VILLA…) has no star
// class — the facet never invents one. categoryName ("4 stars") is
// the fallback when the code is not a star code.
export function hotelbedsStars(hotel: { categoryCode?: string; categoryName?: string }): number | null {
  const code = (hotel.categoryCode ?? '').trim().toUpperCase();
  const codeMatch = code.match(/^([1-5])EST$/);
  if (codeMatch) return Number(codeMatch[1]);
  const nameMatch = (hotel.categoryName ?? '').match(/([1-5])\s*stars?/i);
  if (nameMatch) return Number(nameMatch[1]);
  return null;
}

export type HotelbedsFacetOption = { value: string; label: string; count: number };

// Facet options from the hotels actually returned — counts from the
// full result set, never invented, sorted most-common first (stars
// highest first). A facet with no matching hotel in the set does not
// appear.
export function hotelbedsStarOptions(hotels: HotelbedsHotel[]): HotelbedsFacetOption[] {
  const counts = new Map<number, number>();
  for (const h of hotels) {
    const s = hotelbedsStars(h);
    if (s !== null) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([stars, count]) => ({ value: String(stars), label: `${stars} star${stars === 1 ? '' : 's'}`, count }));
}

export function hotelbedsZoneOptions(hotels: HotelbedsHotel[]): HotelbedsFacetOption[] {
  const counts = new Map<string, number>();
  for (const h of hotels) {
    if (!h.zoneName) continue;
    counts.set(h.zoneName, (counts.get(h.zoneName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([zone, count]) => ({ value: zone, label: zone, count }));
}

export function hotelbedsBoardOptions(hotels: HotelbedsHotel[]): HotelbedsFacetOption[] {
  const counts = new Map<string, number>();
  for (const h of hotels) {
    if (!h.boardName) continue;
    counts.set(h.boardName, (counts.get(h.boardName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([board, count]) => ({ value: board, label: board, count }));
}

export type HotelbedsHotelFilter = {
  star: number | null;
  zone: string | null;
  board: string | null;
  maxPrice: number | null;
};

// The Stays facets, applied together: star class, zone, meal plan
// (board), and the max-price band (per traveler). A hotel with no
// star class, zone, or board only matches that facet when the facet
// is unset — an unknown value never claims to match a filter.
export function filterHotelbedsHotels(hotels: HotelbedsHotel[], f: HotelbedsHotelFilter): HotelbedsHotel[] {
  return hotels.filter((h) => {
    if (f.star !== null && hotelbedsStars(h) !== f.star) return false;
    if (f.zone !== null && h.zoneName !== f.zone) return false;
    if (f.board !== null && h.boardName !== f.board) return false;
    if (f.maxPrice !== null && h.perTraveler > f.maxPrice) return false;
    return true;
  });
}

// --- Labels ----------------------------------------------------------
// The sandbox tag on every hotel card and on the section header:
// source + test-data warning, always visible — it is the honesty
// label, not a source tag, so it never hides behind a filter (a
// filtered view must still say these are test prices).
export function hotelbedsSandboxTag(checkedAt: string | null): string {
  const when = checkedAt ? ` · checked ${checkedAt}` : '';
  return `Hotelbeds · Sandbox — test data, not a bookable room${when}`;
}

export function hotelbedsEmptyMessage(reason?: HotelbedsReason): string {
  switch (reason) {
    case 'disabled':
      return 'Hotelbeds stays are switched off in the code — flip the hotel toggle in lib/hotelbeds.ts to turn test hotels on.';
    case 'no_key':
      return 'Hotelbeds sandbox is not connected yet — add HOTELBEDS_API_KEY and HOTELBEDS_API_SECRET in DigitalOcean and test hotels will appear here.';
    case 'no_coordinates':
      return 'Hotelbeds has no location on file for this destination, so no test hotels were checked.';
    case 'no_dates':
      return 'Hotelbeds needs check-in and check-out dates — add dates to see test hotels.';
    case 'no_hotels':
      return 'Hotelbeds found no test hotels for these dates.';
    case 'unauthorized':
      return 'Hotelbeds rejected the API key — check HOTELBEDS_API_KEY and HOTELBEDS_API_SECRET in DigitalOcean.';
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

// --- Raw shapes (OpenAPI, Nov 16 2026). Every field is treated as
// untrusted — the parsers below validate before anything reaches a
// hotel card. ---------------------------------------------------------

type HotelbedsRateRaw = {
  net?: unknown;
  rateKey?: unknown;
  rateType?: unknown;
  boardCode?: unknown;
  boardName?: unknown;
};

type HotelbedsRoomRaw = {
  name?: unknown;
  // The spec (OpenAPI 3.0, ApiHotel.room / room.rate) names the
  // arrays singular: room.rate. The 1.0 test host's JSON has been
  // seen in the wild with the plural wrapper names (rooms/rates)
  // too, so both spellings are accepted — never guessed, just
  // read either way Hotelbeds writes it.
  rate?: unknown;
  rates?: unknown;
};

type HotelbedsHotelRaw = {
  code?: unknown;
  name?: unknown;
  categoryCode?: unknown;
  categoryName?: unknown;
  destinationName?: unknown;
  zoneName?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  minRate?: unknown;
  currency?: unknown;
  room?: unknown;
  rooms?: unknown;
};

type HotelbedsImageRaw = {
  path?: unknown;
  order?: unknown;
  imageTypeCode?: unknown;
};

type HotelbedsContentHotelRaw = {
  code?: unknown;
  name?: unknown;
  images?: unknown;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// The cheapest rate across a hotel's rooms: the "from" price for
// the whole stay. Null when the hotel carries no usable rate — a
// hotel with no price cannot render a price card.
function cheapestRate(roomRaw: unknown): {
  net: number;
  roomName?: string;
  rateKey?: string;
  rateType?: 'BOOKABLE' | 'RECHECK';
  boardCode?: string;
  boardName?: string;
} | null {
  const rooms = (Array.isArray(roomRaw) ? roomRaw : []).filter(isObj) as HotelbedsRoomRaw[];
  let best: {
    net: number;
    roomName?: string;
    rateKey?: string;
    rateType?: 'BOOKABLE' | 'RECHECK';
    boardCode?: string;
    boardName?: string;
  } | null = null;
  for (const room of rooms) {
    // Spec spelling is rate[]; the 1.0 host may write rates[].
    const rateList = Array.isArray(room.rate)
      ? room.rate
      : Array.isArray(room.rates)
        ? room.rates
        : [];
    const rates = rateList.filter(isObj) as HotelbedsRateRaw[];
    for (const rate of rates) {
      const net = asNum(rate.net);
      if (net === undefined || net <= 0) continue;
      if (best && net >= best.net) continue;
      best = {
        net,
        ...(asStr(room.name) ? { roomName: asStr(room.name) } : {}),
        ...(asStr(rate.rateKey) ? { rateKey: asStr(rate.rateKey) } : {}),
        ...(rate.rateType === 'BOOKABLE' || rate.rateType === 'RECHECK' ? { rateType: rate.rateType } : {}),
        ...(asStr(rate.boardCode) ? { boardCode: asStr(rate.boardCode) } : {}),
        ...(asStr(rate.boardName) ? { boardName: asStr(rate.boardName) } : {}),
      };
    }
  }
  return best;
}

// One availability hotel → the card shape. Null when the hotel has
// no name, no code, or no usable price — a nameless or priceless
// hotel is never shown as a blank or $0 card.
export function mapAvailabilityHotel(
  raw: unknown,
  nights: number,
  guests: number
): HotelbedsHotel | null {
  if (!isObj(raw)) return null;
  const code = asNum(raw.code);
  const name = asStr(raw.name);
  if (code === undefined || !name) return null;
  // Spec spelling is room[]; the 1.0 host may write rooms[].
  const roomList = Array.isArray(raw.room)
    ? raw.room
    : Array.isArray(raw.rooms)
      ? raw.rooms
      : [];
  const rate = cheapestRate(roomList);
  const minRate = asNum(raw.minRate);
  const price = rate?.net ?? minRate;
  if (price === undefined || price <= 0) return null;
  const currency = asStr(raw.currency) ?? 'USD';
  return {
    code,
    name,
    ...(asStr(raw.categoryCode) ? { categoryCode: asStr(raw.categoryCode) } : {}),
    ...(asStr(raw.categoryName) ? { categoryName: asStr(raw.categoryName) } : {}),
    ...(asStr(raw.destinationName) ? { destinationName: asStr(raw.destinationName) } : {}),
    ...(asStr(raw.zoneName) ? { zoneName: asStr(raw.zoneName) } : {}),
    ...(asNum(raw.latitude) !== undefined ? { latitude: asNum(raw.latitude) } : {}),
    ...(asNum(raw.longitude) !== undefined ? { longitude: asNum(raw.longitude) } : {}),
    price: Math.round(price),
    currency,
    nights,
    perNight: Math.max(1, Math.round(price / Math.max(1, nights))),
    perTraveler: Math.max(1, Math.round(price / Math.max(1, guests))),
    ...(rate?.roomName ? { roomName: rate.roomName } : {}),
    ...(rate?.boardCode ? { boardCode: rate.boardCode } : {}),
    ...(rate?.boardName ? { boardName: rate.boardName } : {}),
    ...(rate?.rateType ? { rateType: rate.rateType } : {}),
  };
}

// The availability response shape, validated: the raw hotel list
// or null when the shape is wrong — a malformed 200 is an error,
// never a guessed hotel list.
//
// Two live-host variances (Nov 17, 2026 — the Stays dead end):
// the sandbox omits the hotel array entirely when a search finds
// nothing (total 0, no `hotel` key), which the old strict check
// read as a broken response instead of an honest empty result; and
// the 1.0 test host may write the plural wrapper names
// (hotels/rooms/rates) where the 3.0 spec writes singular. So:
// a missing array is an empty list, a single hotel object is
// wrapped, either spelling is read — but a hotels container that
// is absent, or a `hotel` value that is neither an array nor an
// object, is still a malformed response (null).
export function parseAvailabilityResponse(value: unknown): unknown[] | null {
  if (!isObj(value) || !isObj(value.hotels)) return null;
  const container = value.hotels as Record<string, unknown>;
  const list = container.hotel ?? container.hotels;
  if (list === undefined) return [];
  if (Array.isArray(list)) return list as unknown[];
  if (isObj(list)) return [list];
  return null;
}

// Server-side diagnosis only (Nov 17, 2026): when the availability
// answer is still unreadable after the tolerant parse, log what it
// actually looked like — top-level keys, the hotels container's
// keys, and any error object Hotelbeds sent — to the runtime log
// (DigitalOcean logs), never to the client response. The shape is
// the only thing logged; no request data, no credentials.
export function logBadAvailabilityResponse(value: unknown): void {
  try {
    const top = isObj(value) ? Object.keys(value) : [];
    const hotels = isObj(value) && isObj(value.hotels) ? Object.keys(value.hotels as Record<string, unknown>) : [];
    const err =
      isObj(value) && isObj(value.error)
        ? JSON.stringify(value.error).slice(0, 300)
        : undefined;
    console.error(
      '[hotelbeds] availability shape not recognized',
      JSON.stringify({ top, hotels, error: err ?? null })
    );
  } catch {
    // Logging must never break the search.
  }
}

// Availability hotels mapped + sorted cheapest first, capped at the
// panel's count. The nights/guests math lives here so the route and
// the tests share it.
export function mapAvailabilityHotels(
  value: unknown,
  nights: number,
  guests: number
): HotelbedsHotel[] | null {
  const parsed = parseAvailabilityResponse(value);
  if (!parsed) return null;
  const hotels = parsed
    .map((raw) => mapAvailabilityHotel(raw, nights, guests))
    .filter((h): h is HotelbedsHotel => !!h)
    .sort((a, b) => a.price - b.price);
  return hotels.slice(0, HOTELBEDS_MAX_HOTELS);
}

// The ContentAPI details response: {hotels: [...]} for a multi-code
// call, {hotel: {...}} for a single code. Returns code → image URL
// (the lowest-order image — the order Hotelbeds shows them in).
// A hotel with no usable image maps to no entry; the card renders
// without a photo rather than a broken one.
export function parseContentDetailsResponse(value: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!isObj(value)) return out;
  const list: unknown[] = Array.isArray(value.hotels)
    ? (value.hotels as unknown[])
    : isObj(value.hotel)
      ? [value.hotel]
      : [];
  for (const entry of list) {
    if (!isObj(entry)) continue;
    const code = asNum((entry as HotelbedsContentHotelRaw).code);
    if (code === undefined || out.has(code)) continue;
    const images = (
      Array.isArray((entry as HotelbedsContentHotelRaw).images)
        ? ((entry as HotelbedsContentHotelRaw).images as unknown[])
        : []
    ).filter(isObj) as HotelbedsImageRaw[];
    const sorted = images
      .map((img) => ({ url: hotelbedsImageUrl(asStr(img.path)), order: asNum(img.order) ?? Number.MAX_SAFE_INTEGER }))
      .filter((img): img is { url: string; order: number } => !!img.url)
      .sort((a, b) => a.order - b.order);
    if (sorted.length) out.set(code, sorted[0].url);
  }
  return out;
}

// The ContentAPI details response as a gallery: code → up to 6
// image URLs, lowest order first. Same validation as the
// single-photo parser above; a hotel with no usable image maps to
// no entry, and the card renders its first photo (or none) rather
// than a broken one.
export function parseContentDetailsImages(value: unknown): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (!isObj(value)) return out;
  const list: unknown[] = Array.isArray(value.hotels)
    ? (value.hotels as unknown[])
    : isObj(value.hotel)
      ? [value.hotel]
      : [];
  for (const entry of list) {
    if (!isObj(entry)) continue;
    const code = asNum((entry as HotelbedsContentHotelRaw).code);
    if (code === undefined || out.has(code)) continue;
    const images = (
      Array.isArray((entry as HotelbedsContentHotelRaw).images)
        ? ((entry as HotelbedsContentHotelRaw).images as unknown[])
        : []
    ).filter(isObj) as HotelbedsImageRaw[];
    const urls = images
      .map((img) => ({ url: hotelbedsImageUrl(asStr(img.path)), order: asNum(img.order) ?? Number.MAX_SAFE_INTEGER }))
      .filter((img): img is { url: string; order: number } => !!img.url)
      .sort((a, b) => a.order - b.order)
      .map((img) => img.url)
      .slice(0, 6);
    if (urls.length) out.set(code, urls);
  }
  return out;
}

// --- Live calls ------------------------------------------------------

const searchCache = new Map<string, { ts: number; result: HotelbedsSearchResult }>();
const contentCache = new Map<number, { ts: number; images: string[] }>();
// The evaluation quota is 50 requests/day: after a 403 the client
// stops calling until this timestamp instead of burning the quota
// on retries that cannot succeed.
let quotaBlockedUntil = 0;

// Test-only: the module caches survive across tests in one process,
// so a test that stubs fetch clears them between cases. Production
// code never calls this.
export function clearHotelbedsCache(): void {
  searchCache.clear();
  contentCache.clear();
  quotaBlockedUntil = 0;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const days = Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86400000
  );
  return Number.isFinite(days) && days >= 1 ? days : 1;
}

// The HTTP-status reasons only: what errorReason can actually
// return. The per-product reason unions all include these five,
// so the activities/transfers/bundle clients can use the shared
// helper without a cast.
export type HotelbedsHttpReason =
  | 'unauthorized'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'error';

function errorReason(status: number): HotelbedsHttpReason {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'quota_exceeded';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_unavailable';
  return 'error';
}

// Shared by the four product clients (activities, transfers and
// bundle import these from here): the same auth, the same error
// mapping, the same timeout fetch.
export { errorReason as hotelbedsErrorReason };

export async function hotelbedsFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: unknown } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const r = await hotelbedsFetch(url, init, timeoutMs);
  if (!r) throw new Error('fetch failed');
  return r;
}

// The ContentAPI details for a list of hotel codes — one call for
// the whole list (comma-separated codes). Hotels already in the
// 24h content cache are skipped, so a repeat search for the same
// hotels costs no ContentAPI call at all.
async function fetchHotelImages(codes: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  const missing = codes.filter((c) => {
    const hit = contentCache.get(c);
    if (hit && Date.now() - hit.ts < CONTENT_CACHE_TTL_MS) {
      out.set(c, hit.images);
      return false;
    }
    return true;
  });
  if (!missing.length) return out;
  const creds = hotelbedsProductCredentials('hotel');
  if (!creds) return out;
  try {
    const r = await fetchWithTimeout(
      `${HOTELBEDS_API}/hotel-content-api/1.0/hotels/${missing.join(',')}/details?language=ENG`,
      { headers: await hotelbedsAuthHeaders(creds.apiKey, creds.secret) },
      FETCH_TIMEOUT_MS
    );
    if (!r.ok) return out;
    const parsed = parseContentDetailsImages(r.json);
    for (const [code, images] of parsed) {
      out.set(code, images);
      contentCache.set(code, { ts: Date.now(), images });
    }
  } catch {
    // Photos are an enhancement, never the search: a failed
    // details call leaves the hotels imageless, not errored.
  }
  return out;
}

export async function searchHotelbedsStays(input: HotelbedsSearchInput): Promise<HotelbedsSearchResult> {
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const base: HotelbedsSearchResult = {
    live: false,
    configured: hotelbedsConfigured(),
    enabled: hotelbedsProductEnabled('hotel'),
    active: hotelbedsProductActive('hotel'),
    source: 'hotelbeds',
    sandbox: true,
    checkedAt: null,
    destination: input.destination,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    nights,
    hotels: [],
  };
  // Switched off in code: never call the API, whatever the keys —
  // the same rule as the other three products.
  if (!hotelbedsProductEnabled('hotel')) return { ...base, reason: 'disabled' };
  if (!base.configured) return { ...base, reason: 'no_key' };
  const creds = hotelbedsProductCredentials('hotel');
  if (!creds) return { ...base, reason: 'no_key' };
  const key = `stays|${input.latitude}|${input.longitude}|${input.checkIn}|${input.checkOut}|${input.guests}|${input.rooms}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  if (Date.now() < quotaBlockedUntil) return { ...base, reason: 'quota_exceeded' };

  const apiKey = creds.apiKey;
  const secret = creds.secret;
  // The form collects total guests + rooms, not a per-room split,
  // so guests are spread evenly across rooms (rounded) — disclosed
  // here, not hidden in the request.
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
    language: 'ENG',
    sourceMarket: 'US',
  };
  let availability: { ok: boolean; status: number; json: unknown };
  try {
    availability = await fetchWithTimeout(
      `${HOTELBEDS_API}/hotel-api/1.0/hotels`,
      {
        method: 'POST',
        headers: { ...(await hotelbedsAuthHeaders(apiKey, secret)), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      FETCH_TIMEOUT_MS
    );
  } catch {
    return { ...base, reason: 'error' };
  }
  if (!availability.ok) {
    if (availability.status === 403) quotaBlockedUntil = Date.now() + CACHE_TTL_MS;
    return { ...base, reason: errorReason(availability.status) };
  }
  const hotels = mapAvailabilityHotels(availability.json, nights, input.guests);
  if (!hotels) {
    logBadAvailabilityResponse(availability.json);
    return { ...base, reason: 'bad_response' };
  }
  if (!hotels.length) return { ...base, reason: 'no_hotels' };
  // Photos, one ContentAPI call for the hotels on screen — the
  // gallery per hotel, first photo as the card image.
  const images = await fetchHotelImages(hotels.map((h) => h.code));
  const withImages = hotels.map((h) =>
    images.has(h.code) ? { ...h, imageUrl: images.get(h.code)![0], images: images.get(h.code) } : h
  );
  const result: HotelbedsSearchResult = {
    ...base,
    live: true,
    checkedAt: new Date().toISOString().slice(0, 10),
    hotels: withImages,
  };
  // Only a real HTTP 200 answer is cached — an error never poisons
  // the cache, and a failed request is never retried in a loop.
  searchCache.set(key, { ts: Date.now(), result });
  return result;
}
