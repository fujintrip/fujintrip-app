// Ignav live fares — the live comparison column in the Flights panel
// (Nov 15, 2026: the user wants REAL results — the fares on screen
// today are Duffel TEST fares, fictional).
//
// Built from Ignav's own docs, read live Nov 15, 2026:
// https://ignav.com/docs + /api/openapi.json + /docs/faq.
// REST at https://ignav.com/api, auth `X-Api-Key` header.
//   POST /api/fares/one-way       → FareSearchResponseModel
//   POST /api/fares/round-trip    → FareSearchResponseModel
//   POST /api/fares/search        → FareSearchModel (1–2 ordered legs)
//   POST /api/fares/booking-links → BookingOptionsResponseModel |
//        SearchBookingOptionsResponseModel (booking URLs are NOT in
//        the fare search — fetch them only when the traveler asks).
// Fares may be reused up to 30 minutes; observed_at records when
// Ignav retrieved them (UTC, can be null). $2 per 1,000 successful
// requests; the first 1,000 are a one-time free allowance; failed
// requests are never billed; no per-account rate limit. The flexible
// search caps at 2 legs — a 3–4-leg multi-city search runs one
// one-way request per leg instead (same as Duffel's multi-city).
//
// Honesty rules: the key is server-side only (never in the client
// bundle); a missing key, an Ignav error, or an empty result is an
// honest empty state, never an invented fare. Prices are party
// totals (Ignav prices the whole party, like Duffel) and are
// approximate — the FAQ says to phrase them "from $X" and confirm
// at booking, so the panel does. Booking links open the airline's
// or OTA's own site — the traveler books and pays there, never on
// FujinTrip, and no commission is claimed.
import {
  cabinClassFor,
  canonicalAirlineName,
  formatMinutes,
  formatTime12,
  timeBucketFor,
  type DuffelCabinClass,
  type DuffelFareOffer,
  type DuffelFareSegment,
} from './duffel';
import type { RowSort } from './searchPlaces';

const IGNAV_API = 'https://ignav.com/api';
// 15s per attempt (Nov 22, 2026): a cold upstream call occasionally
// exceeds 10s — a cold JFK→LHR round-trip took >10s and failed on
// first load while the very next call took 3.1s — so 10s was marginal
// for a cold call. Normal cold calls measure 2–3.5s.
const FETCH_TIMEOUT_MS = 15000;
// Exactly one retry on a transient throw — see postIgnav.
const POSTIGNAV_MAX_ATTEMPTS = 2;
// Inside Ignav's 30-minute reuse window: a repeat search for the
// same trip within 10 minutes costs nothing and stays fresh.
const CACHE_TTL_MS = 10 * 60 * 1000;
// The panel shows the cheapest few itineraries, like Duffel's 3
// offers per direction — a longer list is noise, not choice.
export const IGNAV_MAX_ITINERARIES = 3;

export type IgnavTripType = 'oneway' | 'roundtrip' | 'multicity';

// One leg offer in an Ignav itinerary, in the shape the FareCard
// renders. `price` is the whole-itinerary party total on every leg
// of a trip-priced itinerary (the UI hides per-card prices there
// and shows the trip total once); for per-leg one-way searches it
// is the leg's own price. `ignavId` is the handoff token for the
// booking-links endpoint — the itinerary's, carried on each leg.
export type IgnavLegOffer = DuffelFareOffer & { ignavId?: string };

export type IgnavItinerary = {
  ignavId: string | null;
  // Party total for the whole itinerary.
  price: number;
  currency: string;
  priceStatus: 'verified' | 'unverified';
  cabin?: string;
  bags?: string;
  legs: IgnavLegOffer[];
};

// Multi-city 3–4 legs only: one entry per leg, each with its own
// fares (Ignav's flexible search caps at 2 legs). Empty otherwise.
// destCity is the leg's destination city name, filled in by the
// route — the client only knows IATA codes.
export type IgnavLegResult = {
  origin: string;
  destination: string;
  destCity?: string;
  date: string;
  live: boolean;
  reason?: string;
  out: IgnavLegOffer[];
};

export type IgnavSearchResult = {
  live: boolean;
  configured: boolean;
  source: 'ignav';
  observedAt: string | null;
  tripType: IgnavTripType;
  itineraries: IgnavItinerary[];
  legs: IgnavLegResult[];
  reason?: string;
};

// The route's search response: the client result plus the trip it
// was searched for.
export type IgnavFaresResponse = IgnavSearchResult & {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  cabin: DuffelCabinClass;
};

export type IgnavBookingLink = {
  providerName: string;
  providerType: 'airline' | 'third_party' | null;
  specificity: 'exact_flight' | 'search_results' | null;
  fareName?: string;
  price?: number;
  currency?: string;
  url: string;
};

export type IgnavBookingLinksResult = {
  available: boolean;
  configured: boolean;
  links: IgnavBookingLink[];
  reason?: string;
};

export function ignavConfigured(): boolean {
  return Boolean(process.env.IGNAV_API_KEY);
}

// --- Raw Ignav shapes (OpenAPI, Nov 15 2026). Every field is
// treated as untrusted — the parsers below validate before anything
// reaches a fare card. ----------------------------------------------

type IgnavSegmentRaw = {
  marketing_carrier_code?: unknown;
  flight_number?: unknown;
  operating_carrier_name?: unknown;
  departure_airport?: unknown;
  departure_time_local?: unknown;
  departure_time_utc?: unknown;
  arrival_airport?: unknown;
  arrival_time_local?: unknown;
  arrival_time_utc?: unknown;
  duration_minutes?: unknown;
  aircraft?: unknown;
};

type IgnavLegRaw = {
  carrier?: unknown;
  duration_minutes?: unknown;
  segments?: unknown;
};

type IgnavPriceRaw = {
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
};

type IgnavBagsRaw = {
  carry_on?: unknown;
  checked?: unknown;
};

type IgnavItineraryRaw = {
  price?: unknown;
  outbound?: unknown;
  inbound?: unknown;
  legs?: unknown;
  cabin_class?: unknown;
  bags?: unknown;
  ignav_id?: unknown;
};

type IgnavBookingLinkRaw = {
  provider_name?: unknown;
  provider_type?: unknown;
  specificity?: unknown;
  fare_name?: unknown;
  price?: unknown;
  url?: unknown;
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

// "2027-01-15T08:30:00" → minutes since midnight, airport-local as
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

function bagsLabel(bags: unknown): string | undefined {
  if (!isObj(bags)) return undefined;
  const checked = asNum(bags.checked) ?? 0;
  const carryOn = asNum(bags.carry_on) ?? 0;
  if (checked > 0) return `${checked} checked bag${checked > 1 ? 's' : ''} included`;
  if (carryOn > 0) return 'carry-on only (no checked bag included)';
  return undefined;
}

// One Ignav segment → the FareCard's segment shape. Everything
// comes from the segment object; a field Ignav does not provide is
// absent, never guessed. from/to are IATA codes ('' when Ignav
// gives none — the card then shows times without airport codes
// rather than a code it made up).
function mapIgnavSegment(s: IgnavSegmentRaw): DuffelFareSegment {
  const code = asStr(s.marketing_carrier_code);
  const flightNumber =
    code && asStr(s.flight_number) ? `${code}${asStr(s.flight_number)}` : undefined;
  const departTime = formatTime12(asStr(s.departure_time_local));
  const arriveTime = formatTime12(asStr(s.arrival_time_local));
  const durationMinutes = asNum(s.duration_minutes);
  return {
    ...(code ? { carrierCode: code } : {}),
    carrierName: asStr(s.operating_carrier_name) ?? 'See details',
    ...(flightNumber ? { flightNumber } : {}),
    from: asStr(s.departure_airport) ?? '',
    to: asStr(s.arrival_airport) ?? '',
    ...(departTime ? { departTime } : {}),
    ...(arriveTime ? { arriveTime } : {}),
    ...(typeof durationMinutes === 'number' ? { duration: formatMinutes(durationMinutes) } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(asStr(s.aircraft) ? { aircraft: asStr(s.aircraft) } : {}),
    ...(asStr(s.departure_time_utc) ?? asStr(s.departure_time_local)
      ? { departIso: asStr(s.departure_time_utc) ?? asStr(s.departure_time_local) }
      : {}),
    ...(asStr(s.arrival_time_utc) ?? asStr(s.arrival_time_local)
      ? { arriveIso: asStr(s.arrival_time_utc) ?? asStr(s.arrival_time_local) }
      : {}),
  };
}

// One Ignav leg → one FareCard offer. Null when the leg carries no
// segments — a leg with no flights cannot render a card. The price
// is the whole-itinerary party total (see IgnavLegOffer); the
// caller decides whether the card shows it (one-way) or the group
// header shows the trip total instead (round-trip, multi-city).
function mapIgnavLeg(
  raw: unknown,
  tripPrice: number,
  currency: string,
  ignavId: string | null,
  bags?: string
): IgnavLegOffer | null {
  if (!isObj(raw)) return null;
  const rawSegs = (Array.isArray(raw.segments) ? raw.segments : []).filter(isObj);
  const segments = rawSegs.map((s) => mapIgnavSegment(s as IgnavSegmentRaw));
  if (!segments.length) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const durationMinutes = asNum(raw.duration_minutes);
  // The departure minute-of-day comes from the airport-local time
  // (what the traveler sees) — the UTC timestamp would shift it by
  // the airport's offset. Sorting by it is still correct: every
  // offer on one leg departs from the same airport.
  const departMinutes = minutesFromTime(asStr((rawSegs[0] as IgnavSegmentRaw).departure_time_local));
  return {
    airline: asStr(raw.carrier) ?? first.carrierName,
    price: tripPrice,
    currency,
    stops: Math.max(0, segments.length - 1),
    duration: typeof durationMinutes === 'number' ? formatMinutes(durationMinutes) : '',
    ...(bags ? { bags } : {}),
    ...(first.departTime ? { departTime: first.departTime } : {}),
    ...(last.arriveTime ? { arriveTime: last.arriveTime } : {}),
    ...(departMinutes !== undefined ? { departMinutes } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(first.carrierCode ? { carrierCode: first.carrierCode } : {}),
    segments,
    ...(ignavId ? { ignavId } : {}),
  };
}

function priceOf(raw: unknown): { amount: number; currency: string; status: 'verified' | 'unverified' } | null {
  if (!isObj(raw)) return null;
  const amount = asNum(raw.amount);
  if (amount === undefined || amount <= 0) return null;
  return {
    amount: Math.round(amount),
    currency: asStr(raw.currency) ?? 'USD',
    status: raw.status === 'unverified' ? 'unverified' : 'verified',
  };
}

// An itinerary from a one-way / round-trip response: outbound plus
// an inbound when one is present.
function itineraryFromResponseModel(raw: unknown): IgnavItinerary | null {
  if (!isObj(raw)) return null;
  const price = priceOf(raw.price);
  if (!price) return null;
  const bags = bagsLabel(raw.bags);
  const ignavId = asStr(raw.ignav_id) ?? null;
  const legs: IgnavLegOffer[] = [];
  for (const legRaw of [raw.outbound, raw.inbound]) {
    if (legRaw === null || legRaw === undefined) continue;
    const leg = mapIgnavLeg(legRaw, price.amount, price.currency, ignavId, bags);
    if (leg) legs.push(leg);
  }
  if (!legs.length) return null;
  return {
    ignavId,
    price: price.amount,
    currency: price.currency,
    priceStatus: price.status,
    ...(asStr(raw.cabin_class) ? { cabin: asStr(raw.cabin_class) } : {}),
    ...(bags ? { bags } : {}),
    legs,
  };
}

// An itinerary from a flexible-search response: the legs array, in
// order.
function itineraryFromSearchModel(raw: unknown): IgnavItinerary | null {
  if (!isObj(raw)) return null;
  const price = priceOf(raw.price);
  if (!price) return null;
  const bags = bagsLabel(raw.bags);
  const ignavId = asStr(raw.ignav_id) ?? null;
  if (!Array.isArray(raw.legs)) return null;
  const legs: IgnavLegOffer[] = [];
  for (const legRaw of raw.legs) {
    const leg = mapIgnavLeg(legRaw, price.amount, price.currency, ignavId, bags);
    if (leg) legs.push(leg);
  }
  if (!legs.length) return null;
  return {
    ignavId,
    price: price.amount,
    currency: price.currency,
    priceStatus: price.status,
    ...(asStr(raw.cabin_class) ? { cabin: asStr(raw.cabin_class) } : {}),
    ...(bags ? { bags } : {}),
    legs,
  };
}

// The one-way / round-trip response shape, validated: {itineraries,
// observed_at} or null when the shape is wrong — a malformed 200
// is an error, never a guessed fare list.
export function parseIgnavFareSearchResponse(value: unknown): {
  itineraries: IgnavItinerary[];
  observedAt: string | null;
} | null {
  if (!isObj(value) || !Array.isArray(value.itineraries)) return null;
  const itineraries = (value.itineraries as unknown[])
    .map((it) => itineraryFromResponseModel(it))
    .filter((it): it is IgnavItinerary => !!it);
  return {
    itineraries,
    observedAt: asStr(value.observed_at) ?? null,
  };
}

// The flexible-search response shape, validated.
export function parseIgnavSearchResponse(value: unknown): {
  itineraries: IgnavItinerary[];
  observedAt: string | null;
} | null {
  if (!isObj(value) || !Array.isArray(value.itineraries)) return null;
  const itineraries = (value.itineraries as unknown[])
    .map((it) => itineraryFromSearchModel(it))
    .filter((it): it is IgnavItinerary => !!it);
  return {
    itineraries,
    observedAt: asStr(value.observed_at) ?? null,
  };
}

// The booking-links response: both response shapes carry
// booking_options; every option's links are flattened into one
// list. A link without a provider name or a usable URL is dropped,
// never rendered as a dead link.
export function parseIgnavBookingLinksResponse(value: unknown): IgnavBookingLink[] {
  if (!isObj(value) || !Array.isArray(value.booking_options)) return [];
  const links: IgnavBookingLink[] = [];
  for (const opt of value.booking_options as unknown[]) {
    if (!isObj(opt) || !Array.isArray(opt.links)) continue;
    for (const raw of opt.links as unknown[]) {
      if (!isObj(raw)) continue;
      const providerName = asStr(raw.provider_name);
      const url = asStr(raw.url);
      if (!providerName || !url || !/^https?:\/\//i.test(url)) continue;
      const price = isObj(raw.price) ? priceOf(raw.price) : null;
      links.push({
        providerName,
        providerType: raw.provider_type === 'airline' || raw.provider_type === 'third_party' ? raw.provider_type : null,
        specificity: raw.specificity === 'exact_flight' || raw.specificity === 'search_results' ? raw.specificity : null,
        ...(asStr(raw.fare_name) ? { fareName: asStr(raw.fare_name) } : {}),
        ...(price ? { price: price.amount, currency: price.currency } : {}),
        url,
      });
    }
  }
  return links;
}

// --- Freshness, sorting, filtering ---------------------------------

export function ignavFreshnessLabel(observedAt: string | null): string {
  if (!observedAt) return 'Live fares from Ignav';
  const d = new Date(observedAt);
  if (Number.isNaN(d.getTime())) return 'Live fares from Ignav';
  // The zone is named (Nov 16, 2026): the tag renders in the
  // viewer's browser, so a bare "4:40 PM" reads as UTC in one
  // browser and local time in another — "4:40 PM UTC" is never
  // mistaken for the traveler's own clock.
  return `Live · checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
  )}`;
}

// The short source tag on each individual Ignav fare (Nov 15,
// 2026): source + freshness, discreet — the big column header is
// gone, but every fare still says where it came from and when it
// was checked. No timestamp on file means no time is claimed.
export function ignavSourceTag(observedAt: string | null): string {
  if (!observedAt) return 'Ignav · live fare';
  const d = new Date(observedAt);
  if (Number.isNaN(d.getTime())) return 'Ignav · live fare';
  // The zone is named — see ignavFreshnessLabel: a bare clock time
  // is UTC in one browser and local time in another.
  return `Ignav · live, checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
  )}`;
}

// The itineraries, re-ordered by the same sort the sidebar offers:
// cheapest = trip price ascending; shortest = total trip duration;
// earliest = outbound departure. A missing value sorts last, price
// breaking the tie — nothing is dropped for lacking a time.
export function sortIgnavItineraries(list: IgnavItinerary[], sort: RowSort): IgnavItinerary[] {
  const totalDuration = (it: IgnavItinerary) =>
    it.legs.reduce((sum, l) => sum + (l.durationMinutes ?? Infinity), 0);
  if (sort === 'duration') {
    return [...list].sort((a, b) => totalDuration(a) - totalDuration(b) || a.price - b.price);
  }
  if (sort === 'departure') {
    return [...list].sort(
      (a, b) => (a.legs[0]?.departMinutes ?? Infinity) - (b.legs[0]?.departMinutes ?? Infinity) || a.price - b.price
    );
  }
  return [...list].sort((a, b) => a.price - b.price);
}

// The trip's stop count — the OUTBOUND leg's stops (Nov 16, 2026).
// A round trip is "1-stop" when the way out stops once, whatever the
// return does: the same outbound-first rule the time filter and the
// departure sort already use. The old rule — every leg must agree on
// one stop count — left a 1-stop-out / nonstop-back trip in NO stops
// bucket at all: uncountable and unfilterable, so the panel read
// "1 stop (0)" next to three 1-stop-via-Madrid trips.
export function ignavItineraryStops(it: IgnavItinerary): number {
  return it.legs[0]?.stops ?? 0;
}

// Does this itinerary survive the panel's stops/airline/time
// filters? The stops filter reads the outbound only (see
// ignavItineraryStops); the airline filter still needs every leg to
// match — a BA-out / AA-back trip is genuinely two airlines. The
// time filter reads the OUTBOUND departure only: the traveler picks
// when the trip leaves, and the return leaves when it leaves.
export function ignavItineraryMatches(
  it: IgnavItinerary,
  stopsFilter: number[],
  airlinesFilter: string[],
  timesFilter: string[] = []
): boolean {
  if (stopsFilter.length && !stopsFilter.includes(ignavItineraryStops(it))) return false;
  // The airline filter compares canonical names (rendered-check
  // fix, Nov 21 2026): a filter for "ITA Airways" matches a leg
  // Ignav calls "ITA".
  if (airlinesFilter.length && !it.legs.every((l) => airlinesFilter.includes(canonicalAirlineName(l.airline)))) return false;
  if (timesFilter.length) {
    const bucket = timeBucketFor(it.legs[0]?.departMinutes);
    if (!bucket || !timesFilter.includes(bucket)) return false;
  }
  return true;
}

// Every leg offer in a search result — the filter options (airlines,
// stops, counts) come from these, the same as Duffel's offers.
export function ignavAllLegOffers(result: IgnavSearchResult | null): IgnavLegOffer[] {
  if (!result) return [];
  return [...result.itineraries.flatMap((it) => it.legs), ...result.legs.flatMap((l) => l.out)];
}

// The cheapest itinerary's trip price, or 0 when there is none.
export function cheapestIgnavItinerary(itineraries: IgnavItinerary[]): number {
  if (!itineraries.length) return 0;
  return Math.min(...itineraries.map((it) => it.price));
}

// The honest empty message for a failed Ignav lookup — the reason
// the column shows instead of fares, never a guessed fare.
export function ignavEmptyMessage(reason?: string): string {
  switch (reason) {
    case 'no_key':
      return 'Live fares from Ignav are not connected yet — add the Ignav API key and real fares will appear here.';
    case 'no_airport_code':
      return 'Ignav has no airport code for this route, so no live fares were checked.';
    case 'no_offers':
      return 'Ignav found no live fares for these dates.';
    case 'unauthorized':
      return 'Ignav rejected the API key — check IGNAV_API_KEY in DigitalOcean.';
    case 'payment_required':
      return "Ignav's free allowance is used up — the next 1,000 searches cost $2.";
    case 'rate_limited':
      return 'Ignav is busy right now — try the search again shortly.';
    case 'upstream_unavailable':
      return "Ignav's fare source did not answer — try again shortly.";
    case 'missing_slots':
      return 'Ignav needs a departure city, a destination and trip dates — nothing was looked up.';
    default:
      return "Ignav couldn't be reached right now.";
  }
}

// The booking-links request for an itinerary: the ignav_id is the
// handoff token; the itinerary fields are the fallback the API
// accepts when an id is missing. Origin/destination come from the
// first and last segment airports; dates from the first segment's
// departure. For a 2-leg flexible itinerary the second leg rides
// as the "inbound" fields — the closest the request shape allows.
export function ignavBookingContext(it: IgnavItinerary): {
  ignavId: string | null;
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  outboundCarrierCode?: string;
  outboundFlightNumber?: string;
  inboundCarrierCode?: string;
  inboundFlightNumber?: string;
} {
  const firstLeg = it.legs[0];
  const lastLeg = it.legs[it.legs.length - 1];
  const firstSeg = firstLeg?.segments?.[0];
  const lastSeg = lastLeg?.segments?.[lastLeg.segments.length - 1];
  const secondLegFirstSeg = it.legs[1]?.segments?.[0];
  return {
    ignavId: it.ignavId,
    ...(firstSeg?.from ? { origin: firstSeg.from } : {}),
    ...(lastSeg?.to ? { destination: lastSeg.to } : {}),
    ...(firstSeg?.departIso ? { departureDate: firstSeg.departIso.slice(0, 10) } : {}),
    ...(it.legs.length > 1 && secondLegFirstSeg?.departIso
      ? { returnDate: secondLegFirstSeg.departIso.slice(0, 10) }
      : {}),
    ...(firstSeg?.carrierCode ? { outboundCarrierCode: firstSeg.carrierCode } : {}),
    ...(firstSeg?.flightNumber ? { outboundFlightNumber: firstSeg.flightNumber } : {}),
    ...(secondLegFirstSeg?.carrierCode ? { inboundCarrierCode: secondLegFirstSeg.carrierCode } : {}),
    ...(secondLegFirstSeg?.flightNumber ? { inboundFlightNumber: secondLegFirstSeg.flightNumber } : {}),
  };
}

// The booking-links request for a single leg offer (a 3–4-leg
// multi-city leg, where each leg is its own one-way search): the
// offer's own ignav_id plus its first/last segment airports.
export function ignavBookingContextForOffer(offer: IgnavLegOffer): {
  ignavId: string | null;
  origin?: string;
  destination?: string;
  departureDate?: string;
  outboundCarrierCode?: string;
  outboundFlightNumber?: string;
} {
  const segs = offer.segments ?? [];
  const first = segs[0];
  const last = segs.length ? segs[segs.length - 1] : undefined;
  return {
    ignavId: offer.ignavId ?? null,
    ...(first?.from ? { origin: first.from } : {}),
    ...(last?.to ? { destination: last.to } : {}),
    ...(first?.departIso ? { departureDate: first.departIso.slice(0, 10) } : {}),
    ...(first?.carrierCode ? { outboundCarrierCode: first.carrierCode } : {}),
    ...(first?.flightNumber ? { outboundFlightNumber: first.flightNumber } : {}),
  };
}

// --- Live calls -----------------------------------------------------

const searchCache = new Map<string, { ts: number; result: IgnavSearchResult }>();
const linksCache = new Map<string, { ts: number; result: IgnavBookingLinksResult }>();

// Test-only: the module cache survives across tests in one process,
// so a test that stubs fetch clears it between cases. Production
// code never calls this.
export function clearIgnavCache(): void {
  searchCache.clear();
  linksCache.clear();
}

function errorReason(status: number, code?: string): string {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'payment_required';
  if (status === 429) return 'rate_limited';
  if (status === 424) return 'upstream_unavailable';
  void code;
  return 'error';
}

async function postIgnav(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const apiKey = process.env.IGNAV_API_KEY ?? '';
  // One bounded retry on a transient throw only (a network error or
  // the abort above): a cold upstream call occasionally exceeds the
  // timeout (observed Nov 22, 2026 — a cold JFK→LHR round-trip took
  // >10s and failed, the very next call 3.1s), and the retry lands
  // once Ignav has warmed up. An HTTP error status is NEVER retried
  // — a 401/402/429/424 has a reason to show, and retrying a 429
  // is wrong. Exactly one retry, never a loop; a still-failing
  // second attempt throws and the caller reports the honest error.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < POSTIGNAV_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${IGNAV_API}${path}`, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as unknown;
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function errorCodeOf(json: unknown): string | undefined {
  if (isObj(json) && isObj(json.error)) return asStr(json.error.code);
  return undefined;
}

export type IgnavSearchInput = {
  tripType: IgnavTripType;
  // IATA codes — the route resolves city names first, so the client
  // never guesses a code.
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  // Multi-city legs (IATA), in order. 2 legs use the flexible
  // search endpoint; 3–4 legs run one one-way request per leg.
  legs?: { origin: string; destination: string; date: string }[];
  travelers: number;
  cabin?: DuffelCabinClass;
};

export async function searchIgnavFares(input: IgnavSearchInput): Promise<IgnavSearchResult> {
  const cabin = cabinClassFor(input.cabin ?? 'economy');
  const base: IgnavSearchResult = {
    live: false,
    configured: ignavConfigured(),
    source: 'ignav',
    observedAt: null,
    tripType: input.tripType,
    itineraries: [],
    legs: [],
  };
  if (!base.configured) return { ...base, reason: 'no_key' };
  const legsKey = (input.legs ?? []).map((l) => `${l.origin}>${l.destination}@${l.date}`).join(',');
  const key = `search|${input.tripType}|${input.origin}|${input.destination}|${input.departDate}|${input.returnDate ?? ''}|${legsKey}|${input.travelers}|${cabin}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;

  const common = { adults: input.travelers, cabin_class: cabin, market: 'US' };
  let result: IgnavSearchResult | null = null;

  try {
    if (input.tripType === 'oneway') {
      const r = await postIgnav('/fares/one-way', {
        origin: input.origin,
        destination: input.destination,
        departure_date: input.departDate,
        ...common,
      });
      if (!r.ok) return { ...base, reason: errorReason(r.status, errorCodeOf(r.json)) };
      const parsed = parseIgnavFareSearchResponse(r.json);
      if (!parsed) return { ...base, reason: 'bad_response' };
      result = { ...base, live: parsed.itineraries.length > 0, observedAt: parsed.observedAt, itineraries: parsed.itineraries };
    } else if (input.tripType === 'roundtrip') {
      const r = await postIgnav('/fares/round-trip', {
        origin: input.origin,
        destination: input.destination,
        departure_date: input.departDate,
        return_date: input.returnDate,
        ...common,
      });
      if (!r.ok) return { ...base, reason: errorReason(r.status, errorCodeOf(r.json)) };
      const parsed = parseIgnavFareSearchResponse(r.json);
      if (!parsed) return { ...base, reason: 'bad_response' };
      result = { ...base, live: parsed.itineraries.length > 0, observedAt: parsed.observedAt, itineraries: parsed.itineraries };
    } else {
      const legs = input.legs ?? [];
      if (legs.length === 2) {
        const r = await postIgnav('/fares/search', {
          legs: legs.map((l) => ({ origin: l.origin, destination: l.destination, departure_date: l.date })),
          ...common,
        });
        if (!r.ok) return { ...base, reason: errorReason(r.status, errorCodeOf(r.json)) };
        const parsed = parseIgnavSearchResponse(r.json);
        if (!parsed) return { ...base, reason: 'bad_response' };
        result = { ...base, live: parsed.itineraries.length > 0, observedAt: parsed.observedAt, itineraries: parsed.itineraries };
      } else {
        // 3–4 legs (or a trip with an unresolvable leg): one
        // one-way request per leg, in parallel — Ignav's flexible
        // search caps at 2 legs.
        const perLeg = await Promise.all(
          legs.map(async (leg) => {
            try {
              const r = await postIgnav('/fares/one-way', {
                origin: leg.origin,
                destination: leg.destination,
                departure_date: leg.date,
                ...common,
              });
              if (!r.ok) return { origin: leg.origin, destination: leg.destination, date: leg.date, live: false, reason: errorReason(r.status, errorCodeOf(r.json)), out: [] as IgnavLegOffer[] };
              const parsed = parseIgnavFareSearchResponse(r.json);
              if (!parsed) return { origin: leg.origin, destination: leg.destination, date: leg.date, live: false, reason: 'bad_response', out: [] as IgnavLegOffer[] };
              return {
                origin: leg.origin,
                destination: leg.destination,
                date: leg.date,
                live: parsed.itineraries.length > 0,
                out: parsed.itineraries.flatMap((it) => it.legs),
              };
            } catch {
              return { origin: leg.origin, destination: leg.destination, date: leg.date, live: false, reason: 'error', out: [] as IgnavLegOffer[] };
            }
          })
        );
        const allLive = perLeg.length > 0 && perLeg.every((l) => l.live && l.out.length > 0);
        result = { ...base, live: allLive, legs: perLeg, observedAt: null };
      }
    }
  } catch {
    return { ...base, reason: 'error' };
  }

  if (!result) return { ...base, reason: 'error' };
  if (!result.live && !result.itineraries.length && !result.legs.length) {
    result = { ...result, reason: 'no_offers' };
  }
  // Only a real HTTP 200 answer is cached — an error never poisons
  // the cache. A transient throw gets exactly one retry inside
  // postIgnav (never a loop); an HTTP error status is never retried.
  searchCache.set(key, { ts: Date.now(), result });
  return result;
}

export async function fetchIgnavBookingLinks(opts: {
  ignavId: string;
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  outboundCarrierCode?: string;
  outboundFlightNumber?: string;
  inboundCarrierCode?: string;
  inboundFlightNumber?: string;
  adults?: number;
  children?: number;
}): Promise<IgnavBookingLinksResult> {
  const none = (reason: string): IgnavBookingLinksResult => ({
    available: false,
    configured: ignavConfigured(),
    links: [],
    reason,
  });
  if (!ignavConfigured()) return none('no_key');
  if (!opts.ignavId) return none('missing_id');
  const hit = linksCache.get(opts.ignavId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  const body: Record<string, unknown> = { ignav_id: opts.ignavId, market: 'US' };
  for (const [k, v] of Object.entries({
    origin: opts.origin,
    destination: opts.destination,
    departure_date: opts.departureDate,
    return_date: opts.returnDate,
    outbound_carrier_code: opts.outboundCarrierCode,
    outbound_flight_number: opts.outboundFlightNumber,
    inbound_carrier_code: opts.inboundCarrierCode,
    inbound_flight_number: opts.inboundFlightNumber,
    adults: opts.adults,
    children: opts.children,
  })) {
    if (v !== undefined && v !== null && v !== '') body[k] = v;
  }
  try {
    const r = await postIgnav('/fares/booking-links', body);
    if (!r.ok) return none(errorReason(r.status, errorCodeOf(r.json)));
    const links = parseIgnavBookingLinksResponse(r.json);
    const result: IgnavBookingLinksResult = {
      available: links.length > 0,
      configured: true,
      links,
      ...(links.length ? {} : { reason: 'no_links' }),
    };
    linksCache.set(opts.ignavId, { ts: Date.now(), result });
    return result;
  } catch {
    return none('error');
  }
}
