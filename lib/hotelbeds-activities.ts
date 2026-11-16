// Hotelbeds sandbox activities (Nov 16, 2026) — the Attractions
// tab's live activity source, in TEST mode. Wired in the same
// build as the Hotel product; the toggle in lib/hotelbeds.ts is
// OFF until the user switches it on (Hotel first, this one ready
// to switch on).
//
// Built from Hotelbeds' own docs, read live Nov 16, 2026:
// https://developer.hotelbeds.com/documentation/activities/
// (Activities Booking API availability page + the Activities
// OpenAPI spec). Auth: the same Api-key + X-Signature as hotels,
// with the ACTIVITIES key/secret. Test host:
// https://api.test.hotelbeds.com. Evaluation quota: 50
// requests/day on the activities key — 6h server cache, never
// per render.
//
// POST /activity-api/3.0/activities/availability
//   { filters: [{searchFilterItems: [{type: 'GPS', value:
//     'lat, lng'}]}], from, to, paxes: [{age}], language: 'en',
//     pagination: {itemsPerPage: 10, page: 1}, order: 'PRICE' }
//   → { activities: [{ activityCode, country: {code, name,
//     destinations: [{node, name}]}, modalities: [{code, name,
//     duration, amountsFrom: [{paxType, ageFrom, ageTo, amount,
//     boxOfficeAmount}], ...}], currencyName, amountsFrom:
//     [{paxType, amount, ...}], content: {name, description,
//     summary, currency, code, media: {images:
//     [{visualizationOrder, mimeType, urls: [{sizeType,
//     resource}]}]}}] }
//
// Honesty rules: the same as hotels — sandbox TEST data, every
// result labeled sandbox/test, never a bookable activity, never a
// live price. A switched-off toggle, a missing key, an error, or
// an empty result is an honest empty state, never an invented
// tour. This module stays client-safe (no node: imports) so the
// Attractions tab can import its label helpers, the same as
// lib/ignav.ts.
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
export const HOTELBEDS_MAX_ACTIVITIES = 6;

export type HotelbedsActivity = {
  code: string;
  name: string;
  destinationName?: string;
  countryName?: string;
  modalityCode?: string;
  modalityName?: string;
  durationDays?: number;
  // Cheapest from-price per person (the activity-level amountsFrom
  // is already the lowest across modalities, per pax type).
  price: number;
  currency: string;
  perTraveler: number;
  total: number;
  imageUrl?: string;
  summary?: string;
};

export type HotelbedsActivitiesReason =
  | 'disabled'
  | 'no_key'
  | 'no_coordinates'
  | 'no_dates'
  | 'no_activities'
  | 'unauthorized'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'bad_response'
  | 'error';

export type HotelbedsActivitiesResult = {
  live: boolean;
  enabled: boolean;
  configured: boolean;
  active: boolean;
  source: 'hotelbeds-activities';
  sandbox: true;
  checkedAt: string | null;
  destination: string;
  from: string;
  to: string;
  travelers: number;
  activities: HotelbedsActivity[];
  reason?: HotelbedsActivitiesReason;
};

export type HotelbedsActivitiesInput = {
  latitude: number;
  longitude: number;
  destination: string;
  from: string;
  to: string;
  travelers: number;
};

// The sandbox tag on every activity card and on the section
// header: source + test-data warning, always visible — it is the
// honesty label, not a source tag, so it never hides behind a
// filter.
export function hotelbedsActivitiesSandboxTag(checkedAt: string | null): string {
  const when = checkedAt ? ` · checked ${checkedAt}` : '';
  return `Hotelbeds · Sandbox — test data, not a bookable activity${when}`;
}

export function hotelbedsActivitiesEmptyMessage(reason?: HotelbedsActivitiesReason): string {
  switch (reason) {
    case 'disabled':
      return 'Hotelbeds Activities is wired but switched off in code — flip it on and test activities will appear here.';
    case 'no_key':
      return 'Hotelbeds Activities is not connected yet — add HOTELBEDS_ACTIVITIES_API_KEY and HOTELBEDS_ACTIVITIES_API_SECRET in DigitalOcean and test activities will appear here.';
    case 'no_coordinates':
      return 'Hotelbeds has no location on file for this destination, so no test activities were checked.';
    case 'no_dates':
      return 'Hotelbeds needs trip dates — add dates to see test activities.';
    case 'no_activities':
      return 'Hotelbeds found no test activities for these dates.';
    case 'unauthorized':
      return 'Hotelbeds rejected the Activities API key — check HOTELBEDS_ACTIVITIES_API_KEY and HOTELBEDS_ACTIVITIES_API_SECRET in DigitalOcean.';
    case 'quota_exceeded':
      return 'Hotelbeds Activities allows 50 requests a day and today’s quota is used up — test activities return tomorrow.';
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

// --- Raw shapes (Activities docs, Nov 16 2026). Every field is
// treated as untrusted — the parsers below validate before
// anything reaches an activity card. ------------------------------

type HotelbedsAmountsFromRaw = {
  paxType?: unknown;
  ageFrom?: unknown;
  ageTo?: unknown;
  amount?: unknown;
  boxOfficeAmount?: unknown;
};

type HotelbedsModalityRaw = {
  code?: unknown;
  name?: unknown;
  duration?: unknown;
  amountsFrom?: unknown;
};

type HotelbedsActivityRaw = {
  activityCode?: unknown;
  country?: unknown;
  modalities?: unknown;
  currencyName?: unknown;
  amountsFrom?: unknown;
  content?: unknown;
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

// The cheapest per-person from-price: the ADULT amount when one is
// listed, else the lowest amount across pax types. Null when no
// usable amount exists — an activity with no price cannot render a
// price card.
function cheapestAmountFrom(list: unknown): number | null {
  const amounts = (Array.isArray(list) ? list : []).filter(isObj) as HotelbedsAmountsFromRaw[];
  let adult: number | null = null;
  let lowest: number | null = null;
  for (const a of amounts) {
    const amount = asNum(a.amount);
    if (amount === undefined || amount <= 0) continue;
    if (lowest === null || amount < lowest) lowest = amount;
    if (a.paxType === 'ADULT' && (adult === null || amount < adult)) adult = amount;
  }
  return adult ?? lowest;
}

// The cheapest modality (by its lowest amountsFrom amount) — the
// one whose name and duration the card shows alongside the price.
function cheapestModality(raw: unknown): { code?: string; name?: string; durationDays?: number; amount: number } | null {
  const modalities = (Array.isArray(raw) ? raw : []).filter(isObj) as HotelbedsModalityRaw[];
  let best: { code?: string; name?: string; durationDays?: number; amount: number } | null = null;
  for (const m of modalities) {
    const amount = cheapestAmountFrom(m.amountsFrom);
    if (amount === null) continue;
    if (best && amount >= best.amount) continue;
    best = {
      amount,
      ...(asStr(m.code) ? { code: asStr(m.code) } : {}),
      ...(asStr(m.name) ? { name: asStr(m.name) } : {}),
      ...(asNum(m.duration) !== undefined ? { durationDays: asNum(m.duration) } : {}),
    };
  }
  return best;
}

// Activity content images carry full URLs in several sizes; take
// the lowest-order image, preferring LARGE, then MEDIUM, then any
// size. A URL that is not http(s) is dropped, never rendered.
function bestImageUrl(content: Record<string, unknown>): string | undefined {
  if (!isObj(content.media) || !Array.isArray(content.media.images)) return undefined;
  const images = (content.media.images as unknown[]).filter(isObj);
  const withOrder = images
    .map((img) => {
      const urls = Array.isArray((img as Record<string, unknown>).urls)
        ? ((img as Record<string, unknown>).urls as unknown[]).filter(isObj)
        : [];
      const bySize = (size: string) =>
        urls.find((u) => (u as Record<string, unknown>).sizeType === size && /^https?:\/\//i.test(String((u as Record<string, unknown>).resource ?? '')));
      const pick = bySize('LARGE') ?? bySize('MEDIUM') ?? bySize('XLARGE') ?? bySize('SMALL') ?? bySize('RAW') ?? urls.find((u) => /^https?:\/\//i.test(String((u as Record<string, unknown>).resource ?? '')));
      if (!pick) return null;
      return {
        url: String((pick as Record<string, unknown>).resource),
        order: asNum((img as Record<string, unknown>).visualizationOrder) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((x): x is { url: string; order: number } => !!x)
    .sort((a, b) => a.order - b.order);
  return withOrder[0]?.url;
}

// Content descriptions arrive as HTML — strip tags for the card's
// one-line summary, capped so a long factsheet never floods the
// card. No HTML is ever injected into the page.
function plainSummary(content: Record<string, unknown>): string | undefined {
  const raw = asStr(content.summary) ?? asStr(content.description);
  if (!raw) return undefined;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;
}

// One availability activity → the card shape. Null when the
// activity has no code, no name, or no usable price.
export function mapAvailabilityActivity(raw: unknown, travelers: number): HotelbedsActivity | null {
  if (!isObj(raw)) return null;
  const code = asStr(raw.activityCode);
  const content = isObj(raw.content) ? raw.content : null;
  const name = content ? asStr(content.name) : undefined;
  if (!code || !name) return null;
  const amount = cheapestAmountFrom(raw.amountsFrom) ?? cheapestModality(raw.modalities)?.amount ?? null;
  if (amount === null) return null;
  const modality = cheapestModality(raw.modalities);
  const currency = (content ? asStr(content.currency) : undefined) ?? 'USD';
  const country = isObj(raw.country) ? raw.country : null;
  const dests = country && Array.isArray(country.destinations) ? (country.destinations as unknown[]).filter(isObj) : [];
  return {
    code,
    name,
    ...(dests[0] && asStr((dests[0] as Record<string, unknown>).name)
      ? { destinationName: asStr((dests[0] as Record<string, unknown>).name) }
      : {}),
    ...(country && asStr(country.name) ? { countryName: asStr(country.name) } : {}),
    ...(modality?.code ? { modalityCode: modality.code } : {}),
    ...(modality?.name ? { modalityName: modality.name } : {}),
    ...(modality?.durationDays !== undefined ? { durationDays: modality.durationDays } : {}),
    price: Math.round(amount),
    currency,
    perTraveler: Math.round(amount),
    // Total from the ROUNDED per-person price, so the card's
    // arithmetic adds up (per-person x travelers = total).
    total: Math.round(amount) * Math.max(1, travelers),
    ...(content ? { ...(bestImageUrl(content) ? { imageUrl: bestImageUrl(content) } : {}), ...(plainSummary(content) ? { summary: plainSummary(content) } : {}) } : {}),
  };
}

// The availability response shape, validated: the raw activity
// list or null when the shape is wrong — a malformed 200 is an
// error, never a guessed tour list.
export function parseActivitiesResponse(value: unknown): unknown[] | null {
  if (!isObj(value) || !Array.isArray(value.activities)) return null;
  return value.activities as unknown[];
}

// Availability activities mapped + sorted cheapest first, capped
// at the panel's count.
export function mapAvailabilityActivities(value: unknown, travelers: number): HotelbedsActivity[] | null {
  const parsed = parseActivitiesResponse(value);
  if (!parsed) return null;
  const activities = parsed
    .map((raw) => mapAvailabilityActivity(raw, travelers))
    .filter((a): a is HotelbedsActivity => !!a)
    .sort((a, b) => a.price - b.price);
  return activities.slice(0, HOTELBEDS_MAX_ACTIVITIES);
}

// --- Live calls ------------------------------------------------------

const searchCache = new Map<string, { ts: number; result: HotelbedsActivitiesResult }>();
let quotaBlockedUntil = 0;

// Test-only: the module cache survives across tests in one process,
// so a test that stubs fetch clears it between cases. Production
// code never calls this.
export function clearHotelbedsActivitiesCache(): void {
  searchCache.clear();
  quotaBlockedUntil = 0;
}

export async function searchHotelbedsActivities(input: HotelbedsActivitiesInput): Promise<HotelbedsActivitiesResult> {
  const base: HotelbedsActivitiesResult = {
    live: false,
    enabled: hotelbedsProductEnabled('activities'),
    configured: hotelbedsProductConfigured('activities'),
    active: hotelbedsProductActive('activities'),
    source: 'hotelbeds-activities',
    sandbox: true,
    checkedAt: null,
    destination: input.destination,
    from: input.from,
    to: input.to,
    travelers: input.travelers,
    activities: [],
  };
  // Switched off in code: no API call, whatever the keys — the
  // toggle is the switch.
  if (!base.enabled) return { ...base, reason: 'disabled' };
  if (!base.configured) return { ...base, reason: 'no_key' };
  const creds = hotelbedsProductCredentials('activities');
  if (!creds) return { ...base, reason: 'no_key' };
  const key = `activities|${input.latitude}|${input.longitude}|${input.from}|${input.to}|${input.travelers}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  if (Date.now() < quotaBlockedUntil) return { ...base, reason: 'quota_exceeded' };

  // The form collects a party size, not ages — every pax is an
  // adult (30), disclosed here, not hidden in the request.
  const paxes = Array.from({ length: Math.max(1, input.travelers) }, () => ({ age: 30 }));
  const body = {
    filters: [{ searchFilterItems: [{ type: 'GPS', value: `${input.latitude}, ${input.longitude}` }] }],
    from: input.from,
    to: input.to,
    paxes,
    language: 'en',
    pagination: { itemsPerPage: 10, page: 1 },
    order: 'PRICE',
  };
  const r = await hotelbedsFetch(
    `${HOTELBEDS_API}/activity-api/3.0/activities/availability`,
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
  const activities = mapAvailabilityActivities(r.json, input.travelers);
  if (!activities) return { ...base, reason: 'bad_response' };
  if (!activities.length) return { ...base, reason: 'no_activities' };
  const result: HotelbedsActivitiesResult = {
    ...base,
    live: true,
    checkedAt: new Date().toISOString().slice(0, 10),
    activities,
  };
  // Only a real HTTP 200 answer is cached — an error never poisons
  // the cache, and a failed request is never retried in a loop.
  searchCache.set(key, { ts: Date.now(), result });
  return result;
}
