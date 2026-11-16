// Hotelbeds sandbox transfers (Nov 16, 2026) — the Taxis tab's
// airport-transfer source, in TEST mode. Wired in the same build
// as the Hotel product; the toggle in lib/hotelbeds.ts is OFF
// until the user switches it on (Hotel first, this one ready to
// switch on).
//
// Built from Hotelbeds' own docs, read live Nov 16, 2026:
// https://developer.hotelbeds.com/documentation/transfers/
// (Availability Simple page + the Transfers OpenAPI spec). Auth:
// the same Api-key + X-Signature as hotels, with the TRANSFERS
// key/secret. Test host: https://api.test.hotelbeds.com.
// Evaluation quota: 50 requests/day on the transfers key — 6h
// server cache, never per render.
//
// GET /transfer-api/1.0/availability/{language}/from/{fromType}/
//   {fromCode}/to/{toType}/{toCode}/{outbound}[/{inbound}]/
//   {adults}/{children}/{infants}
//   Types: IATA (airport, recommended), ATLAS (hotel codes), GPS
//   ("lat,lon", min 3 decimals), PORT, STATION. Outbound:
//   "YYYY-MM-DDTHH:mm:ss" in the destination's local time. A 204
//   means no availability.
//   → { search, services: [{ id, direction (DEPARTURE|RETURN),
//     transferType (PRIVATE|SHARED), vehicle: {code, name},
//     category: {code, name}, pickupInformation: {date, time,
//     from, to, pickup}, minPaxCapacity, maxPaxCapacity, content:
//     {vehicle, category, images: [{url, type}], transferRemarks:
//     {description}}, price: {currencyId, netAmount, totalAmount},
//     rateKey, cancellationPolicies }] }
//
// The Taxis tab gives city names, not terminal codes: each side
// resolves to an IATA airport code when the city has one, else to
// its GPS coordinates — at least one side must be an airport, or
// the search is not an airport transfer at all. One-way only: the
// Taxis tab models one trip (pickup time), not a return leg, so no
// inbound is ever sent.
import {
  hotelbedsAuthHeaders,
  hotelbedsErrorReason,
  hotelbedsFetch,
  hotelbedsProductActive,
  hotelbedsProductConfigured,
  hotelbedsProductCredentials,
  hotelbedsProductEnabled,
} from './hotelbeds';

const HOTELBEDS_API = 'https://api.test.hotelbeds.com';
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const HOTELBEDS_MAX_TRANSFERS = 6;

export type HotelbedsTransferPointType = 'IATA' | 'ATLAS' | 'GPS' | 'PORT' | 'STATION';

export type HotelbedsTransfer = {
  id: number;
  direction: 'DEPARTURE' | 'RETURN';
  transferType: 'PRIVATE' | 'SHARED';
  vehicleCode?: string;
  vehicleName?: string;
  categoryCode?: string;
  categoryName?: string;
  pickupDate?: string;
  pickupTime?: string;
  fromDescription?: string;
  toDescription?: string;
  minPaxCapacity?: number;
  maxPaxCapacity?: number;
  remarks?: string;
  // totalAmount for the whole party (the service price, not
  // per-seat — a private transfer costs the same for 1 or 4).
  price: number;
  currency: string;
  perTraveler: number;
  imageUrl?: string;
};

export type HotelbedsTransfersReason =
  | 'disabled'
  | 'no_key'
  | 'no_location'
  | 'no_airport'
  | 'no_dates'
  | 'no_transfers'
  | 'unauthorized'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'bad_response'
  | 'error';

export type HotelbedsTransfersResult = {
  live: boolean;
  enabled: boolean;
  configured: boolean;
  active: boolean;
  source: 'hotelbeds-transfers';
  sandbox: true;
  checkedAt: string | null;
  fromLabel: string;
  toLabel: string;
  outbound: string;
  adults: number;
  transfers: HotelbedsTransfer[];
  reason?: HotelbedsTransfersReason;
};

export type HotelbedsTransfersInput = {
  fromType: HotelbedsTransferPointType;
  fromCode: string;
  toType: HotelbedsTransferPointType;
  toCode: string;
  fromLabel: string;
  toLabel: string;
  outbound: string;
  adults: number;
};

// The sandbox tag on every transfer card and on the section
// header: source + test-data warning, always visible — it is the
// honesty label, not a source tag, so it never hides behind a
// filter.
export function hotelbedsTransfersSandboxTag(checkedAt: string | null): string {
  const when = checkedAt ? ` · checked ${checkedAt}` : '';
  return `Hotelbeds · Sandbox — test data, not a bookable transfer${when}`;
}

export function hotelbedsTransfersEmptyMessage(reason?: HotelbedsTransfersReason): string {
  switch (reason) {
    case 'disabled':
      return 'Hotelbeds Transfers is wired but switched off in code — flip it on and test transfers will appear here.';
    case 'no_key':
      return 'Hotelbeds Transfers is not connected yet — add HOTELBEDS_TRANSFERS_API_KEY and HOTELBEDS_TRANSFERS_API_SECRET in DigitalOcean and test transfers will appear here.';
    case 'no_location':
      return 'Hotelbeds has no airport or location on file for one end of this trip, so no test transfers were checked.';
    case 'no_airport':
      return 'Hotelbeds transfers run to and from airports — put an airport city on one end of the trip to see test transfers.';
    case 'no_dates':
      return 'Hotelbeds needs a pickup date — add one to see test transfers.';
    case 'no_transfers':
      return 'Hotelbeds found no test transfers for this route and time.';
    case 'unauthorized':
      return 'Hotelbeds rejected the Transfers API key — check HOTELBEDS_TRANSFERS_API_KEY and HOTELBEDS_TRANSFERS_API_SECRET in DigitalOcean.';
    case 'quota_exceeded':
      return 'Hotelbeds Transfers allows 50 requests a day and today’s quota is used up — test transfers return tomorrow.';
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

// --- Raw shapes (Transfers docs, Nov 16 2026). Every field is
// treated as untrusted — the parsers below validate before
// anything reaches a transfer card. ------------------------------

type HotelbedsTransferRaw = {
  id?: unknown;
  direction?: unknown;
  transferType?: unknown;
  vehicle?: unknown;
  category?: unknown;
  pickupInformation?: unknown;
  minPaxCapacity?: unknown;
  maxPaxCapacity?: unknown;
  content?: unknown;
  price?: unknown;
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

// Transfer content images carry a path that is only rendered when
// it is already a full URL — a partial path is never guessed into
// a host we have not verified for transfers.
function bestTransferImageUrl(content: Record<string, unknown>): string | undefined {
  if (!isObj(content) || !Array.isArray(content.images)) return undefined;
  const images = (content.images as unknown[]).filter(isObj);
  const urls = images
    .map((img) => asStr((img as Record<string, unknown>).url))
    .filter((u): u is string => !!u && /^https?:\/\//i.test(u));
  if (!urls.length) return undefined;
  const prefer = (type: string) => {
    const hit = images.find(
      (img) =>
        (img as Record<string, unknown>).type === type &&
        /^https?:\/\//i.test(String((img as Record<string, unknown>).url ?? ''))
    );
    return hit ? String((hit as Record<string, unknown>).url) : undefined;
  };
  return prefer('LARGE') ?? prefer('MEDIUM') ?? prefer('EXTRALARGE') ?? urls[0];
}

// One availability service → the card shape. Null when the service
// has no id, no known transfer type, or no usable price — a
// service that cannot be described honestly is never shown.
export function mapAvailabilityTransfer(raw: unknown, adults: number): HotelbedsTransfer | null {
  if (!isObj(raw)) return null;
  const id = asNum(raw.id);
  if (id === undefined) return null;
  if (raw.transferType !== 'PRIVATE' && raw.transferType !== 'SHARED') return null;
  const priceObj = isObj(raw.price) ? raw.price : null;
  const price = priceObj ? asNum(priceObj.totalAmount) : undefined;
  if (price === undefined || price <= 0) return null;
  const vehicle = isObj(raw.vehicle) ? raw.vehicle : null;
  const category = isObj(raw.category) ? raw.category : null;
  const pickup = isObj(raw.pickupInformation) ? raw.pickupInformation : null;
  const content = isObj(raw.content) ? raw.content : null;
  const remarks =
    content && isObj(content.transferRemarks) ? asStr(content.transferRemarks.description) : undefined;
  return {
    id,
    direction: raw.direction === 'RETURN' ? 'RETURN' : 'DEPARTURE',
    transferType: raw.transferType,
    ...(vehicle && asStr(vehicle.code) ? { vehicleCode: asStr(vehicle.code) } : {}),
    ...(vehicle && asStr(vehicle.name) ? { vehicleName: asStr(vehicle.name) } : {}),
    ...(category && asStr(category.code) ? { categoryCode: asStr(category.code) } : {}),
    ...(category && asStr(category.name) ? { categoryName: asStr(category.name) } : {}),
    ...(pickup && asStr(pickup.date) ? { pickupDate: asStr(pickup.date) } : {}),
    ...(pickup && asStr(pickup.time) ? { pickupTime: asStr(pickup.time) } : {}),
    ...(pickup && isObj(pickup.from) && asStr(pickup.from.description)
      ? { fromDescription: asStr(pickup.from.description) }
      : {}),
    ...(pickup && isObj(pickup.to) && asStr(pickup.to.description)
      ? { toDescription: asStr(pickup.to.description) }
      : {}),
    ...(asNum(raw.minPaxCapacity) !== undefined ? { minPaxCapacity: asNum(raw.minPaxCapacity) } : {}),
    ...(asNum(raw.maxPaxCapacity) !== undefined ? { maxPaxCapacity: asNum(raw.maxPaxCapacity) } : {}),
    ...(remarks ? { remarks } : {}),
    price: Math.round(price),
    currency: (priceObj && asStr(priceObj.currencyId)) ?? 'USD',
    perTraveler: Math.max(1, Math.round(price / Math.max(1, adults))),
    ...(content && bestTransferImageUrl(content) ? { imageUrl: bestTransferImageUrl(content) } : {}),
  };
}

// The availability response shape, validated: the raw service list
// or null when the shape is wrong — a malformed 200 is an error,
// never a guessed transfer list.
export function parseTransfersResponse(value: unknown): unknown[] | null {
  if (!isObj(value) || !Array.isArray(value.services)) return null;
  return value.services as unknown[];
}

// Availability services mapped + sorted cheapest first, capped at
// the panel's count.
export function mapAvailabilityTransfers(value: unknown, adults: number): HotelbedsTransfer[] | null {
  const parsed = parseTransfersResponse(value);
  if (!parsed) return null;
  const transfers = parsed
    .map((raw) => mapAvailabilityTransfer(raw, adults))
    .filter((t): t is HotelbedsTransfer => !!t)
    .sort((a, b) => a.price - b.price);
  return transfers.slice(0, HOTELBEDS_MAX_TRANSFERS);
}

// The Availability Simple path, built from the docs' own shape —
// exported so tests can pin the URL without a live call.
export function transferAvailabilityPath(input: HotelbedsTransfersInput): string {
  return `/transfer-api/1.0/availability/en/from/${input.fromType}/${input.fromCode}/to/${input.toType}/${input.toCode}/${input.outbound}/${input.adults}/0/0`;
}

// --- Live calls ------------------------------------------------------

const searchCache = new Map<string, { ts: number; result: HotelbedsTransfersResult }>();
let quotaBlockedUntil = 0;

// Test-only: the module cache survives across tests in one process,
// so a test that stubs fetch clears it between cases. Production
// code never calls this.
export function clearHotelbedsTransfersCache(): void {
  searchCache.clear();
  quotaBlockedUntil = 0;
}

export async function searchHotelbedsTransfers(input: HotelbedsTransfersInput): Promise<HotelbedsTransfersResult> {
  const base: HotelbedsTransfersResult = {
    live: false,
    enabled: hotelbedsProductEnabled('transfers'),
    configured: hotelbedsProductConfigured('transfers'),
    active: hotelbedsProductActive('transfers'),
    source: 'hotelbeds-transfers',
    sandbox: true,
    checkedAt: null,
    fromLabel: input.fromLabel,
    toLabel: input.toLabel,
    outbound: input.outbound,
    adults: input.adults,
    transfers: [],
  };
  // Switched off in code: no API call, whatever the keys — the
  // toggle is the switch.
  if (!base.enabled) return { ...base, reason: 'disabled' };
  if (!base.configured) return { ...base, reason: 'no_key' };
  const creds = hotelbedsProductCredentials('transfers');
  if (!creds) return { ...base, reason: 'no_key' };
  const key = `transfers|${input.fromType}|${input.fromCode}|${input.toType}|${input.toCode}|${input.outbound}|${input.adults}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  if (Date.now() < quotaBlockedUntil) return { ...base, reason: 'quota_exceeded' };

  const r = await hotelbedsFetch(
    `${HOTELBEDS_API}${transferAvailabilityPath(input)}`,
    { headers: await hotelbedsAuthHeaders(creds.apiKey, creds.secret) },
    FETCH_TIMEOUT_MS
  );
  if (!r) return { ...base, reason: 'error' };
  // 204 is Hotelbeds' own "no availability" — an honest empty,
  // not an error.
  if (r.status === 204) return { ...base, reason: 'no_transfers' };
  if (!r.ok) {
    if (r.status === 403) quotaBlockedUntil = Date.now() + CACHE_TTL_MS;
    return { ...base, reason: hotelbedsErrorReason(r.status) };
  }
  const transfers = mapAvailabilityTransfers(r.json, input.adults);
  if (!transfers) return { ...base, reason: 'bad_response' };
  if (!transfers.length) return { ...base, reason: 'no_transfers' };
  const result: HotelbedsTransfersResult = {
    ...base,
    live: true,
    checkedAt: new Date().toISOString().slice(0, 10),
    transfers,
  };
  // Only a real HTTP 200 answer with services is cached — an error
  // never poisons the cache, and a failed request is never retried
  // in a loop.
  searchCache.set(key, { ts: Date.now(), result });
  return result;
}
