// Duffel live fares — shared helper for the chat (and later the trip
// card). The chat asks Duffel for the real fares for the traveler's
// origin → first city of the route (and back), on the trip's suggested
// dates, and the model quotes those fares instead of the planner's
// estimates. In test mode Duffel returns test fares (one carrier, the
// fictional 'Duffel Airways', is proof of test mode) — real bookable
// fares need live mode. The key is server-side only and never returns
// to the browser; this helper only returns airline names and prices.
//
// Honesty rules: a city with no IATA code in the map below gets no live
// fare (the planner estimate is used instead) — codes are never guessed.
// A failed or slow Duffel call returns live:false and the chat falls
// back to the planner's price table. Results are cached 10 minutes so
// a long conversation does not re-query Duffel on every turn.
const DUFFEL_API = 'https://api.duffel.com/air/offer_requests';
const FETCH_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type DuffelFareOffer = {
  airline: string;
  price: number;
  currency: string;
  stops: number;
  duration: string;
  // Included baggage from the offer's own segments (Duffel returns the
  // allowance per segment): "1 checked bag included", "carry-on only
  // (no checked bag included)", or undefined when the offer carries no
  // baggage data — never guessed. This is the all-in price honesty the
  // FTC rule (12 May 2025) asks for: a fare that hides a bag fee is not
  // the true total.
  bags?: string;
  // Times as Duffel reports them (airport-local time on the segment):
  // "8:30 AM" departure, "8:45 PM" arrival — or undefined when the
  // offer carries no segment times, never guessed. The minute values
  // are for sorting only, derived from the same segment data.
  departTime?: string;
  arriveTime?: string;
  departMinutes?: number;
  durationMinutes?: number;
  // The operating carrier's IATA code (first segment) — the airline
  // logo comes from this code, never from a guessed URL or a
  // hardcoded per-airline map. Undefined when Duffel gives no code.
  carrierCode?: string;
  // The offer's own segments, in order — the rich fare card renders
  // flight numbers, airports, aircraft and layovers from these, never
  // from invented data. Undefined for offers parsed before segments
  // existed (old callers), never faked.
  segments?: DuffelFareSegment[];
};

// One flight leg inside an offer slice, as the fare card shows it.
// Everything here comes from Duffel's segment object; a field Duffel
// does not provide is absent, never guessed. from/to are IATA codes
// ('' when Duffel gives none — the card then shows times without
// airport codes rather than a code it made up). departIso/arriveIso
// are the raw ISO times, kept only so layovers can be computed from
// absolute timestamps (same-airport times share a timezone, so the
// difference is the real layover).
export type DuffelFareSegment = {
  carrierCode?: string;
  carrierName: string;
  flightNumber?: string;
  from: string;
  to: string;
  departTime?: string;
  arriveTime?: string;
  duration?: string;
  durationMinutes?: number;
  aircraft?: string;
  departIso?: string;
  arriveIso?: string;
};

// Airline logo (rich fare cards, Nov 15 2026): Kiwi's public airline
// logo set, verified live Nov 15 — BA/AA/TP/LH/EK all return HTTP 200
// image/png at 64x64, an unknown code 303s to Kiwi's generic
// placeholder image. The URL is built from the carrier code only —
// no per-airline map, no hardcoded logos.
export function airlineLogoUrl(code: string): string {
  return `https://images.kiwi.com/airlines/64x64/${code.trim().toUpperCase()}.png`;
}

// Initials tile fallback: the first letters of the first two words
// ("British Airways" → "BA", "TAP Air Portugal" → "TA", "American" →
// "A"). Shown when there is no carrier code, the logo fails to load,
// or the carrier is a test carrier with no real logo.
export function airlineInitials(name: string): string {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return (letters || '?').toUpperCase();
}

// Duffel's test mode flies a fictional carrier, "Duffel Airways"
// (its own docs call it proof of test mode) — it has no real logo,
// so the card shows the initials tile, never a logo fetched for a
// code that belongs to some other airline.
export function isTestCarrier(name: string): boolean {
  return /duffel/i.test(name ?? '');
}

// Minutes as a human duration: 65 → "1h 5m", 45 → "45m", 120 → "2h".
// Used for layovers computed from segment times.
export function formatMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) return '';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// The layovers between an offer's segments, in order: the airport the
// traveler waits at (the arriving segment's destination) and the wait
// in minutes, computed from the segments' absolute ISO times —
// minutes is undefined when either time is missing or unparseable,
// never guessed. A nonstop offer has no layovers.
export type Layover = { airport: string; minutes: number | undefined };

export function layoversFor(offer: DuffelFareOffer): Layover[] {
  const segs = offer.segments ?? [];
  const out: Layover[] = [];
  for (let i = 0; i + 1 < segs.length; i++) {
    const arrive = segs[i].arriveIso;
    const depart = segs[i + 1].departIso;
    let minutes: number | undefined;
    if (arrive && depart) {
      const a = Date.parse(arrive);
      const d = Date.parse(depart);
      if (Number.isFinite(a) && Number.isFinite(d) && d >= a) minutes = Math.round((d - a) / 60000);
    }
    out.push({ airport: segs[i].to, minutes });
  }
  return out;
}

// Per-traveler price from the party total Duffel quotes: rounded to
// the nearest dollar, never a fraction. A party of 1 (or a bad count)
// is the total itself.
export function perTravelerPrice(total: number, travelers: number): number {
  if (!Number.isFinite(total) || travelers < 1) return total;
  return Math.round(total / travelers);
};

// Departure-time buckets for the flights filter (Nov 15, 2026):
// the traveler filters live fares by when the flight leaves. The
// buckets are fixed clock ranges, so a fare's bucket comes only from
// its own departMinutes — never guessed. An offer with no departure
// time has no bucket and matches no time filter.
export const TIME_BUCKETS = [
  { id: 'night', label: 'Night · 12–6 AM', min: 0, max: 359 },
  { id: 'morning', label: 'Morning · 6 AM–12 PM', min: 360, max: 719 },
  { id: 'afternoon', label: 'Afternoon · 12–6 PM', min: 720, max: 1079 },
  { id: 'evening', label: 'Evening · 6 PM–12 AM', min: 1080, max: 1439 },
] as const;
export type TimeBucketId = (typeof TIME_BUCKETS)[number]['id'];

export function timeBucketFor(departMinutes: number | undefined): TimeBucketId | null {
  if (departMinutes === undefined || !Number.isFinite(departMinutes)) return null;
  const m = ((Math.floor(departMinutes) % 1440) + 1440) % 1440;
  for (const b of TIME_BUCKETS) if (m >= b.min && m <= b.max) return b.id;
  return null;
}

export type LiveFares = {
  live: boolean;
  origin: string;
  destCity: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  out: DuffelFareOffer[];
  back: DuffelFareOffer[];
  reason?: string;
};

// Validate a live-fares payload before the trip card trusts it (the
// client gets this JSON from /api/fujin, and the card must never show a
// fare for the wrong trip). Only a live payload with well-formed offers
// passes; anything else — null, live:false, a missing direction, a
// non-numeric price — returns null and the card falls back to the
// planner estimate.
export function parseLiveFares(value: unknown): LiveFares | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.live !== true) return null;
  const okOffer = (o: unknown): o is DuffelFareOffer =>
    !!o && typeof o === 'object' && typeof (o as DuffelFareOffer).airline === 'string' && (o as DuffelFareOffer).airline.length > 0 &&
    typeof (o as DuffelFareOffer).price === 'number' && Number.isFinite((o as DuffelFareOffer).price) && (o as DuffelFareOffer).price > 0 &&
    okOptionalOfferFields(o);
  const okOffers = (arr: unknown): arr is DuffelFareOffer[] =>
    Array.isArray(arr) && arr.every(okOffer);
  const okDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (typeof v.origin !== 'string' || !v.origin || typeof v.destCity !== 'string' || !v.destCity) return null;
  if (!okDate(v.departDate) || !okDate(v.returnDate)) return null;
  if (typeof v.travelers !== 'number' || !Number.isFinite(v.travelers) || v.travelers < 1) return null;
  if (!okOffers(v.out) || !okOffers(v.back)) return null;
  return {
    live: true,
    origin: v.origin as string,
    destCity: v.destCity as string,
    departDate: v.departDate as string,
    returnDate: v.returnDate as string,
    travelers: v.travelers as number,
    out: v.out as DuffelFareOffer[],
    back: v.back as DuffelFareOffer[],
    ...(typeof v.reason === 'string' ? { reason: v.reason as string } : {}),
  };
}

// City name → IATA airport code. Only well-known commercial airports;
// a city missing here (or a region name) simply gets no live fare.
export const CITY_IATA: Record<string, string> = {
  'New York': 'JFK',
  NYC: 'JFK',
  'Los Angeles': 'LAX',
  'San Francisco': 'SFO',
  'Mexico City': 'MEX',
  London: 'LHR',
  Paris: 'CDG',
  Rome: 'FCO',
  Florence: 'FLR',
  Venice: 'VCE',
  Madrid: 'MAD',
  Barcelona: 'BCN',
  Seville: 'SVQ',
  Lisbon: 'LIS',
  Porto: 'OPO',
  Sintra: 'LIS',
  Athens: 'ATH',
  Crete: 'HER',
  Santorini: 'JTR',
  Prague: 'PRG',
  Vienna: 'VIE',
  Budapest: 'BUD',
  Tokyo: 'HND',
  Kyoto: 'KIX',
  Osaka: 'KIX',
  Bali: 'DPS',
  Bangkok: 'BKK',
  'Chiang Mai': 'CNX',
  Krabi: 'KBV',
  Cairo: 'CAI',
  Luxor: 'LXR',
  Aswan: 'ASW',
  'Sharm El Sheikh': 'SSH',
  Marrakech: 'RAK',
  Fes: 'FEZ',
  Chefchaouen: 'TNG',
  Istanbul: 'IST',
  Antalya: 'AYT',
  Cappadocia: 'NAV',
  Delhi: 'DEL',
  Agra: 'AGR',
  Jaipur: 'JAI',
  Edinburgh: 'EDI',
  Bath: 'BRS',
  Nice: 'NCE',
  'Loire Valley': 'ORY',
  Hilo: 'ITO',
  Tacoma: 'SEA',
  'St. George': 'SGU',
  Tulum: 'CUN',
  Oaxaca: 'OAX',
};

// The optional time/minute fields on an offer, when present, must be
// the right shape — a malformed time never reaches a fare card.
function okOptionalOfferFields(o: unknown): boolean {
  const r = o as Record<string, unknown>;
  for (const k of ['departTime', 'arriveTime']) {
    if (r[k] !== undefined && typeof r[k] !== 'string') return false;
  }
  for (const k of ['stops', 'departMinutes', 'durationMinutes']) {
    if (r[k] !== undefined && (typeof r[k] !== 'number' || !Number.isFinite(r[k]))) return false;
  }
  if (r.carrierCode !== undefined && typeof r.carrierCode !== 'string') return false;
  if (r.segments !== undefined) {
    if (!Array.isArray(r.segments)) return false;
    for (const s of r.segments as unknown[]) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
      const seg = s as Record<string, unknown>;
      for (const k of ['carrierCode', 'flightNumber', 'departTime', 'arriveTime', 'duration', 'aircraft', 'departIso', 'arriveIso']) {
        if (seg[k] !== undefined && typeof seg[k] !== 'string') return false;
      }
      if (seg.durationMinutes !== undefined && (typeof seg.durationMinutes !== 'number' || !Number.isFinite(seg.durationMinutes))) return false;
      if (typeof seg.carrierName !== 'string' || !seg.carrierName) return false;
      if (typeof seg.from !== 'string' || typeof seg.to !== 'string') return false;
    }
  }
  return true;
}

type DuffelSegment = {
  // Duffel v2 segment shape (verified against Duffel's own typings,
  // Nov 15 2026): carriers carry iata_code + name; flight numbers
  // are separate fields; origin/destination are airports with
  // iata_code; aircraft is { name } when the carrier reports one.
  // Every field is optional here — a segment that lacks one simply
  // renders without it, never with a guessed value.
  operating_carrier?: { name?: string; iata_code?: string };
  marketing_carrier?: { name?: string; iata_code?: string };
  operating_carrier_flight_number?: string;
  marketing_carrier_flight_number?: string;
  origin?: { iata_code?: string; name?: string };
  destination?: { iata_code?: string; name?: string };
  aircraft?: { name?: string } | null;
  duration?: string;
  baggages?: Array<{ type?: string; quantity?: number }>;
  // ISO 8601 times as Duffel reports them (airport-local time).
  departing_at?: string;
  arriving_at?: string;
};

type DuffelOffer = {
  id?: string;
  total_amount?: string;
  total_currency?: string;
  slices?: Array<{ duration?: string; segments?: DuffelSegment[] }>;
};

function parseIsoDuration(iso: string | undefined): string {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return '';
  const h = m[1] ? `${Number(m[1])}h` : '';
  const min = m[2] ? ` ${Number(m[2])}m` : '';
  return `${h}${min}`.trim();
}

// The same ISO duration as total minutes, for sorting — undefined
// when the offer carries no parseable duration, never guessed.
function parseIsoDurationMinutes(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

// "2027-01-15T08:30:00" (or with a timezone offset) → "8:30 AM".
// The time is the airport-local time as Duffel reports it — no
// timezone conversion is applied, and a missing or malformed time
// returns undefined instead of a guessed time.
export function formatTime12(iso: string | undefined): string | undefined {
  const mins = minutesFromIsoTime(iso);
  if (mins === undefined) return undefined;
  const h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, '0');
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function minutesFromIsoTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return undefined;
  return h * 60 + Number(m[2]);
}

function bagsFromSegments(segments: DuffelSegment[]): string | undefined {
  if (!segments.length) return undefined;
  const hasData = segments.some((s) => (s.baggages ?? []).length > 0);
  if (!hasData) return undefined;
  const perSegment = (type: string) =>
    Math.max(
      0,
      ...segments.map((s) =>
        (s.baggages ?? []).filter((b) => b.type === type).reduce((sum, b) => sum + (b.quantity ?? 0), 0)
      )
    );
  const checked = perSegment('checked');
  const carryOn = perSegment('carry_on');
  if (checked > 0) return `${checked} checked bag${checked > 1 ? 's' : ''} included`;
  if (carryOn > 0) return 'carry-on only (no checked bag included)';
  return 'no checked bag included';
}

// The offer → fare mapping, exported so tests can run it against a canned
// Duffel payload (the live call is best-effort and needs a key).
// Segments are mapped in full: carrier code + name, flight number
// (marketing first — the number the traveler booked — operating as
// fallback), airport codes, times, duration, aircraft. Anything
// Duffel does not provide is omitted from the segment, never guessed.
function parseDuffelSegment(s: DuffelSegment): DuffelFareSegment {
  const op = s.operating_carrier ?? {};
  const mk = s.marketing_carrier ?? {};
  const code = op.iata_code || mk.iata_code;
  const flightNumber =
    (mk.iata_code && s.marketing_carrier_flight_number ? `${mk.iata_code}${s.marketing_carrier_flight_number}` : undefined) ||
    (op.iata_code && s.operating_carrier_flight_number ? `${op.iata_code}${s.operating_carrier_flight_number}` : undefined);
  const departTime = formatTime12(s.departing_at);
  const arriveTime = formatTime12(s.arriving_at);
  const duration = parseIsoDuration(s.duration);
  const durationMinutes = parseIsoDurationMinutes(s.duration);
  return {
    ...(code ? { carrierCode: code } : {}),
    carrierName: op.name || mk.name || 'See details',
    ...(flightNumber ? { flightNumber } : {}),
    from: s.origin?.iata_code ?? '',
    to: s.destination?.iata_code ?? '',
    ...(departTime ? { departTime } : {}),
    ...(arriveTime ? { arriveTime } : {}),
    ...(duration ? { duration } : {}),
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
    ...(s.aircraft?.name ? { aircraft: s.aircraft.name } : {}),
    ...(s.departing_at ? { departIso: s.departing_at } : {}),
    ...(s.arriving_at ? { arriveIso: s.arriving_at } : {}),
  };
}

export function parseDuffelOffers(data: { offers?: DuffelOffer[] } | undefined | null): DuffelFareOffer[] {
  return (data?.offers ?? [])
    .filter((o) => o.total_amount && o.slices?.length)
    .map((o) => {
      const slice = o.slices![0];
      const segments = slice.segments ?? [];
      const first = segments[0];
      const last = segments[segments.length - 1];
      const bags = bagsFromSegments(segments);
      const departTime = formatTime12(first?.departing_at);
      const arriveTime = formatTime12(last?.arriving_at);
      const departMinutes = minutesFromIsoTime(first?.departing_at);
      const durationMinutes = parseIsoDurationMinutes(slice.duration);
      const parsedSegments = segments.map(parseDuffelSegment);
      const carrierCode = parsedSegments[0]?.carrierCode;
      return {
        airline: first?.operating_carrier?.name || first?.marketing_carrier?.name || 'See details',
        price: Math.round(Number(o.total_amount)),
        currency: o.total_currency || 'USD',
        stops: Math.max(0, segments.length - 1),
        duration: parseIsoDuration(slice.duration),
        ...(bags ? { bags } : {}),
        ...(departTime ? { departTime } : {}),
        ...(arriveTime ? { arriveTime } : {}),
        ...(departMinutes !== undefined ? { departMinutes } : {}),
        ...(durationMinutes !== undefined ? { durationMinutes } : {}),
        ...(carrierCode ? { carrierCode } : {}),
        ...(parsedSegments.length ? { segments: parsedSegments } : {}),
      };
    })
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);
}

// The cabin the traveler picked, in Duffel's own vocabulary. The
// search widget offers Economy / Premium economy / Business / First;
// the Offer Request takes cabin_class economy / premium_economy /
// business / first. Anything unrecognized (including a Duffel class
// passed straight through) falls back to economy — never a crash,
// never a guessed cabin.
export type DuffelCabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

export function cabinClassFor(value: unknown): DuffelCabinClass {
  if (typeof value !== 'string') return 'economy';
  const v = value.trim().toLowerCase();
  if (v === 'premium_economy' || v === 'premium economy') return 'premium_economy';
  if (v === 'business') return 'business';
  if (v === 'first') return 'first';
  return 'economy';
}

// Which Duffel mode the configured key is: a live key (duffel_live_…)
// means real fares; anything else set — or no key at all — is test
// mode. The fare label follows the key, so swapping test → live
// needs no code change — and so do the prompt block and the summary
// line below, which read the same mode.
export function duffelMode(): 'test' | 'live' {
  return (process.env.DUFFEL_API_KEY ?? '').startsWith('duffel_live_') ? 'live' : 'test';
}

async function offerRequest(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
  travelers: number,
  cabinClass: DuffelCabinClass = 'economy'
): Promise<DuffelFareOffer[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DUFFEL_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          slices: [{ origin, destination, departure_date: date }],
          passengers: Array.from({ length: travelers }, () => ({ type: 'adult' })),
          cabin_class: cabinClass,
        },
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { offers?: DuffelOffer[] };
    };
    if (!res.ok) return [];
    return parseDuffelOffers(json.data);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

const cache = new Map<string, { ts: number; result: LiveFares }>();

export async function fetchLiveFares(opts: {
  origin: string;
  destCity: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  cabinClass?: DuffelCabinClass;
}): Promise<LiveFares> {
  const base: LiveFares = {
    live: false,
    origin: opts.origin,
    destCity: opts.destCity,
    departDate: opts.departDate,
    returnDate: opts.returnDate,
    travelers: opts.travelers,
    out: [],
    back: [],
  };
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return { ...base, reason: 'no_key' };
  const from = CITY_IATA[opts.origin];
  const to = CITY_IATA[opts.destCity];
  if (!from || !to) return { ...base, reason: 'no_airport_code' };
  const cabin = opts.cabinClass ?? 'economy';
  const key = `${from}-${to}-${opts.departDate}-${opts.returnDate}-${opts.travelers}-${cabin}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  const [out, back] = await Promise.all([
    offerRequest(apiKey, from, to, opts.departDate, opts.travelers, cabin),
    offerRequest(apiKey, to, from, opts.returnDate, opts.travelers, cabin),
  ]);
  const result: LiveFares =
    out.length || back.length
      ? { ...base, live: true, out, back }
      : { ...base, reason: 'no_offers' };
  cache.set(key, { ts: Date.now(), result });
  return result;
}

// One-way fares (Nov 15, 2026 — the Flights form's one-way and
// multi-city trip types): a single outbound Offer Request, no return
// leg asked for and none invented. The shape is the same LiveFares
// the round-trip call returns, with back: [] and returnDate standing
// in as the depart date — callers read tripType first and never
// render a return from it.
export async function fetchOneWayFares(opts: {
  origin: string;
  destCity: string;
  departDate: string;
  travelers: number;
  cabinClass?: DuffelCabinClass;
}): Promise<LiveFares> {
  const base: LiveFares = {
    live: false,
    origin: opts.origin,
    destCity: opts.destCity,
    departDate: opts.departDate,
    returnDate: opts.departDate,
    travelers: opts.travelers,
    out: [],
    back: [],
  };
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return { ...base, reason: 'no_key' };
  const from = CITY_IATA[opts.origin];
  const to = CITY_IATA[opts.destCity];
  if (!from || !to) return { ...base, reason: 'no_airport_code' };
  const cabin = opts.cabinClass ?? 'economy';
  const key = `oneway-${from}-${to}-${opts.departDate}-${opts.travelers}-${cabin}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  const out = await offerRequest(apiKey, from, to, opts.departDate, opts.travelers, cabin);
  const result: LiveFares = out.length
    ? { ...base, live: true, out }
    : { ...base, reason: 'no_offers' };
  cache.set(key, { ts: Date.now(), result });
  return result;
}

// The text block the model gets in its prompt: exact dates, the
// cheapest fares with airline names, and the mode label — test fares
// in test mode, real bookable fares in live mode. The label follows
// the key (duffelMode), so a live key never gets called test fares.
export function faresPromptBlock(f: LiveFares): string {
  const line = (o: DuffelFareOffer, from: string, to: string, date: string) =>
    `${o.airline} $${o.price.toLocaleString()} ${o.currency} ${o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`}${o.duration ? `, ${o.duration}` : ''}${o.bags ? `, ${o.bags}` : ''} (${from} → ${to}, ${date})`;
  const out = f.out.map((o) => line(o, f.origin, f.destCity, f.departDate)).join('; ');
  const back = f.back.map((o) => line(o, f.destCity, f.origin, f.returnDate)).join('; ');
  const modeNote =
    duffelMode() === 'live'
      ? `These are real, bookable Duffel fares (live mode). `
      : `These are Duffel test fares (test mode — one carrier may be the fictional 'Duffel Airways'; real bookable fares need Duffel live mode). `;
  return (
    `LIVE FARES — fetched just now from Duffel for this exact trip. ` +
    `Outbound: ${out || 'no live fares found'}. ` +
    `Return: ${back || 'no live fares found'}. ` +
    modeNote +
    `Quote them as the flight prices, with the airline name, and say they are live fares.`
  );
}

// One short line for the built-in fallback reply (no live model).
export function faresSummaryLine(f: LiveFares): string {
  const parts: string[] = [];
  if (f.out.length) {
    const o = f.out[0];
    parts.push(`cheapest live fare out: ${o.airline} $${o.price.toLocaleString()} ${o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`}${o.bags ? `, ${o.bags}` : ''} (${f.origin} → ${f.destCity}, ${f.departDate})`);
  }
  if (f.back.length) {
    const o = f.back[0];
    parts.push(`cheapest live fare back: ${o.airline} $${o.price.toLocaleString()} ${o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`}${o.bags ? `, ${o.bags}` : ''} (${f.destCity} → ${f.origin}, ${f.returnDate})`);
  }
  if (!parts.length) return '';
  const label = duffelMode() === 'live' ? 'Live fares (Duffel)' : 'Live fares (Duffel, test fares)';
  return `${label}: ${parts.join('; ')}.`;
}

// --- Whole-trip price check (competitor learning, Nov 11: Mindtrip /
// Kayak) ---------------------------------------------------------------
// "Book now or wait" as an honest read, not a forecast: the cheapest
// live out+back fares against the plan's own flight budget (the
// Best-value flight leg — a planning estimate). The comparison says
// whether the plan still holds at its quoted total, or whether the
// live fare would push it over. It never predicts where fares go next:
// "fares move both ways" is the whole point, and the plan's totals are
// static — only the live fare moves. A drop is only ever measured
// against the fare the traveler was watching (the watch baseline),
// never against the estimate.
export type PriceCheck = {
  live: boolean;
  // Cheapest live out + cheapest live back, for the same travelers.
  liveTotal: number;
  // The plan's Best-value flight leg for the same trip (an estimate).
  plannerFlight: number;
  // liveTotal - plannerFlight: negative means under the plan's budget.
  diff: number;
  verdict: 'under' | 'over' | 'same' | 'no_fare';
  // The one-line read for the chat reply and the plan view.
  line: string;
};

export function priceCheck(f: LiveFares, plannerFlight: number): PriceCheck {
  const none: PriceCheck = { live: false, liveTotal: 0, plannerFlight, diff: 0, verdict: 'no_fare', line: '' };
  if (!f.live || (!f.out.length && !f.back.length)) return none;
  const liveTotal = (f.out[0]?.price ?? 0) + (f.back[0]?.price ?? 0);
  const diff = liveTotal - plannerFlight;
  // Within 5% (or $10) counts as "about the same" — a $4 wobble is not
  // a reason to book or to wait.
  const band = Math.max(10, Math.round(plannerFlight * 0.05));
  if (Math.abs(diff) <= band) {
    return {
      live: true,
      liveTotal,
      plannerFlight,
      diff,
      verdict: 'same',
      line: `Book-now read: the cheapest live fares out and back total $${liveTotal.toLocaleString()} — about the same as the plan's flight budget ($${plannerFlight.toLocaleString()}). The plan holds at its quoted total. Fares move both ways; this is a snapshot, not a forecast.`,
    };
  }
  if (diff < 0) {
    return {
      live: true,
      liveTotal,
      plannerFlight,
      diff,
      verdict: 'under',
      line: `Book-now read: the cheapest live fares out and back total $${liveTotal.toLocaleString()} — $${Math.abs(diff).toLocaleString()} under the plan's flight budget ($${plannerFlight.toLocaleString()}). The plan holds at its quoted total, and the fare is on your side right now. Fares move both ways; this is a snapshot, not a forecast.`,
    };
  }
  return {
    live: true,
    liveTotal,
    plannerFlight,
    diff,
    verdict: 'over',
    line: `Book-now read: the cheapest live fares out and back total $${liveTotal.toLocaleString()} — $${diff.toLocaleString()} over the plan's flight budget ($${plannerFlight.toLocaleString()}). The plan's total would rise by about $${diff.toLocaleString()} if you booked these fares today. Waiting may help or hurt — fares move both ways and we never predict them. Watch the price and we'll tell you when it drops.`,
  };
}

// --- "Buy now / Wait" + confidence (competitor learning round 2 #3,
// Kayak) -----------------------------------------------------------------
// The trend is a read of the traveler's OWN checks, never a forecast:
// each observation is one live out+back total on one date, taken from
// the price watch (baseline first, then every later check). The
// confidence is humble on purpose — 2 checks is "low", 3 or more is
// "medium", and "high" never exists. No check count, no confidence;
// never "95% accurate" (Hopper) and never a prediction of where fares
// go next.
export type TrendObservation = { at: string; total: number };
export type Trend = {
  confidence: 'none' | 'low' | 'medium';
  // The one humble sentence for the chat reply and the plan view, or ''
  // when there are fewer than 2 observations to read.
  line: string;
};

// Append a fresh check to a history: the same total on the same day is
// not a new observation, so it is not counted — the check count in the
// trend sentence must mean real checks, not button presses.
export function appendObservation(observations: TrendObservation[], total: number, at?: string): TrendObservation[] {
  const now = at ?? new Date().toISOString();
  const list = (observations ?? []).filter((o) => o && typeof o.total === 'number' && o.total > 0 && typeof o.at === 'string' && o.at);
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return list;
  const last = list[list.length - 1];
  if (last && last.total === total && last.at.slice(0, 10) === now.slice(0, 10)) return list;
  return [...list, { at: now, total }];
}

export function trendLine(observations: TrendObservation[]): Trend {
  const valid = (observations ?? []).filter((o) => o && typeof o.total === 'number' && o.total > 0 && typeof o.at === 'string' && o.at);
  if (valid.length < 2) return { confidence: 'none', line: '' };
  const first = valid[0];
  const last = valid[valid.length - 1];
  const started = new Date(first.at).toLocaleDateString();
  const confidence = valid.length >= 3 ? 'medium' : 'low';
  const move =
    last.total < first.total
      ? `fell from $${first.total.toLocaleString()} to $${last.total.toLocaleString()} — $${(first.total - last.total).toLocaleString()} less`
      : last.total > first.total
        ? `rose from $${first.total.toLocaleString()} to $${last.total.toLocaleString()} — $${(last.total - first.total).toLocaleString()} more`
        : `have not moved — $${first.total.toLocaleString()} then, $${last.total.toLocaleString()} now`;
  return {
    confidence,
    line: `Since you started watching on ${started}, the cheapest live fares out and back ${move}. Confidence: ${confidence} — based on ${valid.length} checks of your own fares, not a forecast. Past prices aren't a promise; fares move both ways.`,
  };
}
