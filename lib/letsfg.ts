// LetsFG live fares — the second live comparison column in the
// Flights panel (Nov 16, 2026: the user connected a Revolut payment
// method and topped up $5 in the LetsFG dashboard — the Developer API
// key was already in DigitalOcean, so live searches now work; before
// that every search 402'd).
//
// Built from LetsFG's own OpenAPI spec, read live Nov 16, 2026:
// https://letsfg.co/developers/api/openapi.json ("LetsFG Public
// Developer API 1.0.0, OAS 3.1") + the Swagger docs at
// https://letsfg.co/developers/api/docs, and verified against real
// SANDBOX responses (POST /sandbox/flights/search, no key needed) —
// the offer shape below is what the sandbox actually returns, not a
// guess: offers carry outbound/inbound legs with segments, a
// per-passenger `price`, and a `booking_url` to letsfg.co. Sandbox
// prices are FAKE test data — they are never shown to a traveler and
// never compared with live prices. One sandbox quirk: a one-way
// search still returned offers WITH an inbound leg, so the one-way
// path is verified against the spec + defensive mapping and the real
// one-way shape is confirmed after Deploy.
//   POST /flights/search/async → { search_id, poll_url, poll_interval_seconds }
//   GET  /flights/results/{search_id} → { status: pending|complete|error, offers[], ... }
// The sync search takes 60–90s, so the route never calls it — async
// start + server-side polling only (max ~90s), one request per
// traveler search. There is NO multi-city endpoint: one-way and
// round-trip only; a multi-city search never calls LetsFG.
// Pricing: 200 free searches after every flight booking, then
// $0.01/search from prepaid balance (min top-up $5); a search counts
// only when it returns offers. Completed results are cached 5
// minutes and in-flight searches are de-duped, so one traveler
// search is one LetsFG search.
//
// Honesty rules: the key is server-side only; a missing key, a 402,
// an error, or an empty result is an honest empty state, never an
// invented fare. Prices are party totals (`price_total` when the API
// gives it, else per-passenger `price` × seats). Booking happens on
// letsfg.co via the offer's `booking_url` and the traveler's own
// Revolut method — FujinTrip never takes payment for a LetsFG fare
// and never presents one as bookable on FujinTrip.
import {
  cabinClassFor,
  formatMinutes,
  formatTime12,
  timeBucketFor,
  type DuffelCabinClass,
  type DuffelFareOffer,
  type DuffelFareSegment,
} from './duffel';
import type { RowSort } from './searchPlaces';

const LETSFG_API = 'https://letsfg.co/developers/api/v1';
const FETCH_TIMEOUT_MS = 15000;
// Inside LetsFG's 10-minute result expiry: a repeat search for the
// same trip within 5 minutes costs nothing and stays fresh.
const CACHE_TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
// ~90s of polling — the sync search takes 60–90s, so a search still
// pending after this is abandoned honestly (reason 'timeout'), never
// left hanging or guessed.
const MAX_POLLS = 18;
// The panel shows the cheapest few itineraries, like Ignav's 3 —
// a longer list is noise, not choice.
export const LETSFG_MAX_ITINERARIES = 3;

export type LetsfgTripType = 'oneway' | 'roundtrip';

// One leg offer in a LetsFG itinerary, in the shape the FareCard
// renders. `price` is the whole-itinerary party total on every leg
// (the UI hides per-card prices there and shows the trip total
// once). `letsfgId` is the offer id — the handoff for the booking
// URL, carried on each leg.
export type LetsfgLegOffer = DuffelFareOffer & { letsfgId?: string };

export type LetsfgItinerary = {
  letsfgId: string | null;
  // Party total for the whole itinerary.
  price: number;
  currency: string;
  // The offer's own booking link to letsfg.co — absent when LetsFG
  // gives none, never guessed.
  bookingUrl?: string;
  legs: LetsfgLegOffer[];
};

export type LetsfgSearchResult = {
  live: boolean;
  configured: boolean;
  source: 'letsfg';
  observedAt: string | null;
  tripType: LetsfgTripType;
  itineraries: LetsfgItinerary[];
  reason?: string;
};

// The route's search response: the client result plus the trip it
// was searched for.
export type LetsfgFaresResponse = LetsfgSearchResult & {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  cabin: DuffelCabinClass;
};

export type LetsfgSearchInput = {
  tripType: LetsfgTripType;
  // IATA codes — the route resolves city names first, so the client
  // never guesses a code.
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  travelers: number;
  cabin?: DuffelCabinClass;
};

export function letsfgConfigured(): boolean {
  return Boolean(process.env.LETSFG_API_KEY);
}

// --- Raw LetsFG shapes (OpenAPI 3.1 + real sandbox responses, Nov
// 16 2026). Every field is treated as untrusted — the parsers below
// validate before anything reaches a fare card. The spec documents
// only price / seats / price_total on an offer; everything else is
// additionalProperties — the sandbox shows the real fields: id,
// currency, price_formatted, outbound/inbound legs, airlines,
// owner_airline, bags_price, availability_seats, conditions,
// booking_url, checkout_url, fetched_at, price_normalized. ---------

type LetsfgSegmentRaw = {
  airline?: unknown;
  airline_name?: unknown;
  flight_no?: unknown;
  origin?: unknown;
  destination?: unknown;
  departure?: unknown;
  arrival?: unknown;
  duration_seconds?: unknown;
  cabin_class?: unknown;
  aircraft?: unknown;
};

type LetsfgLegRaw = {
  segments?: unknown;
  total_duration_seconds?: unknown;
  stopovers?: unknown;
};

type LetsfgOfferRaw = {
  id?: unknown;
  price?: unknown;
  price_total?: unknown;
  currency?: unknown;
  outbound?: unknown;
  inbound?: unknown;
  booking_url?: unknown;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// "2027-01-15T13:45:00" → minutes since midnight, airport-local as
// reported. Undefined when the time is missing or malformed —
// never guessed. (Duffel's copy is private to lib/duffel.ts.)
function minutesFromTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return undefined;
  return h * 60 + Number(m[2]);
}

// One LetsFG segment → the FareCard's segment shape. Everything
// comes from the segment object; a field LetsFG does not provide is
// absent, never guessed. from/to are IATA codes ('' when LetsFG
// gives none — the card then shows times without airport codes
// rather than a code it made up).
function mapLetsfgSegment(s: LetsfgSegmentRaw): DuffelFareSegment {
  const code = asStr(s.airline);
  // LetsFG's flight_no already carries the carrier prefix ("IB9225",
  // verified in the real sandbox responses) — prefix the code only
  // when it is not already there, never double it.
  const flightNoRaw = asStr(s.flight_no);
  const flightNumber = flightNoRaw
    ? code && !flightNoRaw.toUpperCase().startsWith(code.toUpperCase())
      ? `${code}${flightNoRaw}`
      : flightNoRaw
    : undefined;
  const departTime = formatTime12(asStr(s.departure));
  const arriveTime = formatTime12(asStr(s.arrival));
  const durationSeconds = asNum(s.duration_seconds);
  const durationMinutes =
    durationSeconds !== undefined ? Math.round(durationSeconds / 60) : undefined;
  return {
    ...(code ? { carrierCode: code } : {}),
    carrierName: asStr(s.airline_name) ?? code ?? 'See details',
    ...(flightNumber ? { flightNumber } : {}),
    from: asStr(s.origin) ?? '',
    to: asStr(s.destination) ?? '',
    ...(departTime ? { departTime } : {}),
    ...(arriveTime ? { arriveTime } : {}),
    ...(durationMinutes !== undefined
      ? { duration: formatMinutes(durationMinutes), durationMinutes }
      : {}),
    ...(asStr(s.aircraft) ? { aircraft: asStr(s.aircraft) } : {}),
    ...(asStr(s.departure) ? { departIso: asStr(s.departure) } : {}),
    ...(asStr(s.arrival) ? { arriveIso: asStr(s.arrival) } : {}),
  };
}

// One LetsFG leg → one FareCard offer. Null when the leg carries no
// segments — a leg with no flights cannot render a card. The price
// is the whole-itinerary party total (see LetsfgLegOffer); the
// caller decides whether the card shows it (one-way) or the group
// header shows the trip total instead (round-trip).
function mapLetsfgLeg(
  raw: unknown,
  tripPrice: number,
  currency: string,
  letsfgId: string | null
): LetsfgLegOffer | null {
  if (!isObj(raw)) return null;
  const rawSegs = (Array.isArray(raw.segments) ? raw.segments : []).filter(isObj);
  const segments = rawSegs.map((s) => mapLetsfgSegment(s as LetsfgSegmentRaw));
  if (!segments.length) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const totalSeconds = asNum((raw as LetsfgLegRaw).total_duration_seconds);
  const durationMinutes = totalSeconds !== undefined ? Math.round(totalSeconds / 60) : undefined;
  // The departure minute-of-day comes from the airport-local time
  // (what the traveler sees) — the UTC timestamp would shift it by
  // the airport's offset. Sorting by it is still correct: every
  // offer on one leg departs from the same airport.
  const departMinutes = minutesFromTime(asStr((rawSegs[0] as LetsfgSegmentRaw).departure));
  return {
    airline: asStr((rawSegs[0] as LetsfgSegmentRaw).airline_name) ?? asStr((rawSegs[0] as LetsfgSegmentRaw).airline) ?? first.carrierName,
    price: tripPrice,
    currency,
    stops: Math.max(0, segments.length - 1),
    duration: durationMinutes !== undefined ? formatMinutes(durationMinutes) : '',
    ...(first.departTime ? { departTime: first.departTime } : {}),
    ...(last.arriveTime ? { arriveTime: last.arriveTime } : {}),
    ...(departMinutes !== undefined ? { departMinutes } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(first.carrierCode ? { carrierCode: first.carrierCode } : {}),
    segments,
    ...(letsfgId ? { letsfgId } : {}),
  };
}

// An offer → one itinerary: outbound plus an inbound when one is
// present. The party total is `price_total` when LetsFG gives it
// (the spec: exactly what booking holds); otherwise the
// per-passenger `price` × seats (adults + children — a lap infant
// takes no seat). An offer with no usable price or no legs is
// dropped, never rendered as a guessed fare. The sandbox never
// returns `price_total`, so the × seats path is the one the tests
// pin — the live check after Deploy confirms `price_total` when
// LetsFG sends it.
export function letsfgItineraryFromOffer(raw: unknown, seats: number): LetsfgItinerary | null {
  if (!isObj(raw)) return null;
  const priceTotal = asNum(raw.price_total);
  const priceEach = asNum(raw.price);
  const partySeats = Math.max(1, Math.floor(seats) || 1);
  let price: number | undefined;
  if (priceTotal !== undefined && priceTotal > 0) price = Math.round(priceTotal);
  else if (priceEach !== undefined && priceEach > 0) price = Math.round(priceEach * partySeats);
  if (price === undefined) return null;
  const currency = asStr(raw.currency) ?? 'USD';
  const letsfgId = asStr(raw.id) ?? null;
  const bookingUrl = asStr(raw.booking_url);
  const legs: LetsfgLegOffer[] = [];
  for (const legRaw of [raw.outbound, raw.inbound]) {
    if (legRaw === null || legRaw === undefined) continue;
    const leg = mapLetsfgLeg(legRaw, price, currency, letsfgId);
    if (leg) legs.push(leg);
  }
  if (!legs.length) return null;
  return {
    letsfgId,
    price,
    currency,
    ...(bookingUrl && /^https:\/\//i.test(bookingUrl) ? { bookingUrl } : {}),
    legs,
  };
}

// The async-start response, validated: { search_id, poll_url?,
// poll_interval_seconds? } or null when the shape is wrong. A
// poll_url off LetsFG's own host is never followed — the results
// URL is built from the search_id instead.
export function parseLetsfgStartResponse(value: unknown): {
  searchId: string;
  pollUrl?: string;
  pollIntervalSeconds?: number;
} | null {
  if (!isObj(value)) return null;
  const searchId = asStr(value.search_id);
  if (!searchId) return null;
  const pollUrl = asStr(value.poll_url);
  const pollInterval = asNum(value.poll_interval_seconds);
  return {
    searchId,
    ...(pollUrl && /^https:\/\/letsfg\.co\//i.test(pollUrl) ? { pollUrl } : {}),
    ...(pollInterval !== undefined && pollInterval >= 1 && pollInterval <= 30
      ? { pollIntervalSeconds: Math.round(pollInterval) }
      : {}),
  };
}

// The poll response, validated: status pending | complete | error,
// the offers when complete, an error string when failed. A malformed
// 200 is an error, never a guessed fare list.
export function parseLetsfgPollResponse(value: unknown): {
  status: 'pending' | 'complete' | 'error';
  offers: unknown[];
  currency?: string;
  error?: string;
} | null {
  if (!isObj(value)) return null;
  const status = value.status;
  if (status !== 'pending' && status !== 'complete' && status !== 'error') return null;
  return {
    status,
    offers: Array.isArray(value.offers) ? value.offers : [],
    ...(asStr(value.currency) ? { currency: asStr(value.currency) } : {}),
    ...(asStr(value.error) ? { error: asStr(value.error) } : {}),
  };
}

// LetsFG's cabin vocabulary: M economy, W premium economy, C
// business, F first. Anything unrecognized falls back to economy —
// never a crash, never a guessed cabin.
export function letsfgCabinClass(cabin: DuffelCabinClass): 'M' | 'W' | 'C' | 'F' {
  switch (cabin) {
    case 'premium_economy':
      return 'W';
    case 'business':
      return 'C';
    case 'first':
      return 'F';
    default:
      return 'M';
  }
}

// --- Freshness, sorting, filtering ---------------------------------

export function letsfgFreshnessLabel(observedAt: string | null): string {
  if (!observedAt) return 'Live fares from LetsFG';
  const d = new Date(observedAt);
  if (Number.isNaN(d.getTime())) return 'Live fares from LetsFG';
  // The zone is named (Nov 16, 2026): the tag renders in the
  // viewer's browser, so a bare "4:40 PM" reads as UTC in one
  // browser and local time in another — "4:40 PM UTC" is never
  // mistaken for the traveler's own clock.
  return `Live · checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
  )}`;
}

// The short source tag on each individual LetsFG fare: source +
// freshness, discreet — the big column header is gone, but every
// fare still says where it came from and when it was checked. No
// timestamp on file means no time is claimed.
export function letsfgSourceTag(observedAt: string | null): string {
  if (!observedAt) return 'LetsFG · live fare';
  const d = new Date(observedAt);
  if (Number.isNaN(d.getTime())) return 'LetsFG · live fare';
  return `LetsFG · live, checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
  )}`;
}

// The trip's stop count — the OUTBOUND leg's stops (Nov 16, 2026):
// the same outbound-first rule as Ignav, so a 1-stop-out /
// nonstop-back trip lands in the 1-stop bucket, never in none.
export function letsfgItineraryStops(it: LetsfgItinerary): number {
  return it.legs[0]?.stops ?? 0;
}

// A trip's total duration — the sum of its legs, mirroring
// sortLetsfgItineraries. A leg with no duration makes the trip sort
// last on duration, never guessed.
export function letsfgItineraryDuration(it: LetsfgItinerary): number {
  return it.legs.reduce((sum, l) => sum + (l.durationMinutes ?? Infinity), 0);
}

// The itineraries, re-ordered by the same sort the sidebar offers:
// cheapest = trip price ascending; shortest = total trip duration;
// earliest = outbound departure. A missing value sorts last, price
// breaking the tie — nothing is dropped for lacking a time.
export function sortLetsfgItineraries(list: LetsfgItinerary[], sort: RowSort): LetsfgItinerary[] {
  if (sort === 'duration') {
    return [...list].sort((a, b) => letsfgItineraryDuration(a) - letsfgItineraryDuration(b) || a.price - b.price);
  }
  if (sort === 'departure') {
    return [...list].sort(
      (a, b) => (a.legs[0]?.departMinutes ?? Infinity) - (b.legs[0]?.departMinutes ?? Infinity) || a.price - b.price
    );
  }
  return [...list].sort((a, b) => a.price - b.price);
}

// Does this itinerary survive the panel's stops/airline/time
// filters? The stops filter reads the outbound only (see
// letsfgItineraryStops); the airline filter still needs every leg to
// match — a IB-out / AZ-back trip is genuinely two airlines. The
// time filter reads the OUTBOUND departure only: the traveler picks
// when the trip leaves, and the return leaves when it leaves.
export function letsfgItineraryMatches(
  it: LetsfgItinerary,
  stopsFilter: number[],
  airlinesFilter: string[],
  timesFilter: string[] = []
): boolean {
  if (stopsFilter.length && !stopsFilter.includes(letsfgItineraryStops(it))) return false;
  if (airlinesFilter.length && !it.legs.every((l) => airlinesFilter.includes(l.airline))) return false;
  if (timesFilter.length) {
    const bucket = timeBucketFor(it.legs[0]?.departMinutes);
    if (!bucket || !timesFilter.includes(bucket)) return false;
  }
  return true;
}

// The cheapest itinerary's trip price, or 0 when there is none.
export function cheapestLetsfgItinerary(itineraries: LetsfgItinerary[]): number {
  if (!itineraries.length) return 0;
  return Math.min(...itineraries.map((it) => it.price));
}

// The honest empty message for a failed LetsFG lookup — the reason
// the column shows instead of fares, never a guessed fare.
export function letsfgEmptyMessage(reason?: string): string {
  switch (reason) {
    case 'no_key':
      return 'Live fares from LetsFG are not connected yet — add the LetsFG API key and real fares will appear here.';
    case 'unsupported_trip_type':
      return 'LetsFG does not search multi-city trips, so no LetsFG fares were checked.';
    case 'no_airport_code':
      return 'LetsFG has no airport code for this route, so no live fares were checked.';
    case 'no_offers':
      return 'LetsFG found no live fares for these dates.';
    case 'unauthorized':
      return 'LetsFG rejected the API key — check LETSFG_API_KEY in DigitalOcean.';
    case 'payment_required':
      return 'LetsFG needs a connected payment method or balance — check the LetsFG dashboard.';
    case 'rate_limited':
      return 'LetsFG is busy right now — try the search again shortly.';
    case 'timeout':
      return 'LetsFG is still searching — try the search again shortly.';
    case 'search_failed':
      return 'The LetsFG search failed — try the search again shortly.';
    case 'search_expired':
      return 'The LetsFG search expired — try the search again shortly.';
    case 'upstream_unavailable':
      return "LetsFG's fare source did not answer — try again shortly.";
    case 'missing_slots':
      return 'LetsFG needs a departure city, a destination and trip dates — nothing was looked up.';
    default:
      return "LetsFG couldn't be reached right now.";
  }
}

// --- Live calls -----------------------------------------------------

const searchCache = new Map<string, { ts: number; result: LetsfgSearchResult }>();
const inflight = new Map<string, Promise<LetsfgSearchResult>>();

// Test-only: the module cache survives across tests in one process,
// so a test that stubs fetch clears it between cases. Production
// code never calls this.
export function clearLetsfgCache(): void {
  searchCache.clear();
  inflight.clear();
}

function errorReason(status: number): string {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'payment_required';
  if (status === 429) return 'rate_limited';
  if (status === 424) return 'upstream_unavailable';
  return 'error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLetsfg(
  url: string,
  opts: { method?: string; body?: Record<string, unknown> }
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const apiKey = process.env.LETSFG_API_KEY ?? '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'X-API-Key': apiKey,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

export type LetsfgSearchOptions = {
  // Test hooks only — production uses the defaults (5s polls, 18
  // polls ≈ 90s). A test that polls the real defaults would wait
  // a minute and a half to prove a timeout.
  pollIntervalMs?: number;
  maxPolls?: number;
};

async function runLetsfgSearch(
  input: LetsfgSearchInput,
  cabin: DuffelCabinClass,
  base: LetsfgSearchResult,
  opts: LetsfgSearchOptions
): Promise<LetsfgSearchResult> {
  const seats = Math.min(9, Math.max(1, input.travelers));
  const body: Record<string, unknown> = {
    origin: input.origin,
    destination: input.destination,
    date_from: input.departDate,
    date_to: input.departDate,
    adults: seats,
    currency: 'USD',
    limit: 10,
    sort: 'price',
    cabin_class: letsfgCabinClass(cabin),
  };
  if (input.tripType === 'roundtrip' && input.returnDate) {
    body.return_from = input.returnDate;
    body.return_to = input.returnDate;
  }
  try {
    const start = await fetchLetsfg(`${LETSFG_API}/flights/search/async`, { method: 'POST', body });
    if (!start.ok) return { ...base, reason: errorReason(start.status) };
    const started = parseLetsfgStartResponse(start.json);
    if (!started) return { ...base, reason: 'bad_response' };
    const pollUrl =
      started.pollUrl ?? `${LETSFG_API}/flights/results/${encodeURIComponent(started.searchId)}`;
    const interval =
      started.pollIntervalSeconds !== undefined
        ? started.pollIntervalSeconds * 1000
        : opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    const maxPolls = opts.maxPolls ?? MAX_POLLS;
    for (let i = 0; i < maxPolls; i += 1) {
      await sleep(interval);
      let poll: { ok: boolean; status: number; json: unknown };
      try {
        poll = await fetchLetsfg(pollUrl, {});
      } catch {
        return { ...base, reason: 'error' };
      }
      if (!poll.ok) {
        if (poll.status === 404) return { ...base, reason: 'search_expired' };
        return { ...base, reason: errorReason(poll.status) };
      }
      const parsed = parseLetsfgPollResponse(poll.json);
      if (!parsed) return { ...base, reason: 'bad_response' };
      if (parsed.status === 'error') return { ...base, reason: 'search_failed' };
      if (parsed.status === 'complete') {
        const itineraries = parsed.offers
          .map((o) => letsfgItineraryFromOffer(o, seats))
          .filter((it): it is LetsfgItinerary => !!it);
        return {
          ...base,
          live: itineraries.length > 0,
          observedAt: new Date().toISOString(),
          itineraries,
          ...(itineraries.length ? {} : { reason: 'no_offers' }),
        };
      }
      // pending → poll again.
    }
    return { ...base, reason: 'timeout' };
  } catch {
    return { ...base, reason: 'error' };
  }
}

export async function searchLetsfgFares(
  input: LetsfgSearchInput,
  opts: LetsfgSearchOptions = {}
): Promise<LetsfgSearchResult> {
  const cabin = cabinClassFor(input.cabin ?? 'economy');
  const base: LetsfgSearchResult = {
    live: false,
    configured: letsfgConfigured(),
    source: 'letsfg',
    observedAt: null,
    tripType: input.tripType,
    itineraries: [],
  };
  if (!base.configured) return { ...base, reason: 'no_key' };
  const key = `search|${input.tripType}|${input.origin}|${input.destination}|${input.departDate}|${
    input.returnDate ?? ''
  }|${input.travelers}|${cabin}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  // One traveler search is one LetsFG search: a second caller while
  // the first is still polling awaits the same promise instead of
  // starting a second billable search.
  const running = inflight.get(key);
  if (running) return running;
  const promise = runLetsfgSearch(input, cabin, base, opts);
  inflight.set(key, promise);
  try {
    const result = await promise;
    // Only a completed poll is cached — an error or timeout never
    // poisons the cache, and a failed request is never retried in a
    // loop.
    if (result.live || result.reason === 'no_offers') {
      searchCache.set(key, { ts: Date.now(), result });
    }
    return result;
  } finally {
    inflight.delete(key);
  }
}
