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
};

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

type DuffelSegment = {
  operating_carrier?: { name?: string };
  marketing_carrier?: { name?: string };
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

async function offerRequest(
  apiKey: string,
  origin: string,
  destination: string,
  date: string,
  travelers: number
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
          cabin_class: 'economy',
        },
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { offers?: DuffelOffer[] };
    };
    if (!res.ok) return [];
    return (json.data?.offers ?? [])
      .filter((o) => o.total_amount && o.slices?.length)
      .map((o) => {
        const slice = o.slices![0];
        const segments = slice.segments ?? [];
        const first = segments[0];
        return {
          airline: first?.operating_carrier?.name || first?.marketing_carrier?.name || 'See details',
          price: Math.round(Number(o.total_amount)),
          currency: o.total_currency || 'USD',
          stops: Math.max(0, segments.length - 1),
          duration: parseIsoDuration(slice.duration),
        };
      })
      .sort((a, b) => a.price - b.price)
      .slice(0, 3);
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
  const key = `${from}-${to}-${opts.departDate}-${opts.returnDate}-${opts.travelers}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.result;
  const [out, back] = await Promise.all([
    offerRequest(apiKey, from, to, opts.departDate, opts.travelers),
    offerRequest(apiKey, to, from, opts.returnDate, opts.travelers),
  ]);
  const result: LiveFares =
    out.length || back.length
      ? { ...base, live: true, out, back }
      : { ...base, reason: 'no_offers' };
  cache.set(key, { ts: Date.now(), result });
  return result;
}

// The text block the model gets in its prompt: exact dates, the
// cheapest fares with airline names, and the test-mode label.
export function faresPromptBlock(f: LiveFares): string {
  const line = (o: DuffelFareOffer, from: string, to: string, date: string) =>
    `${o.airline} $${o.price.toLocaleString()} ${o.currency} ${o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`}${o.duration ? `, ${o.duration}` : ''} (${from} → ${to}, ${date})`;
  const out = f.out.map((o) => line(o, f.origin, f.destCity, f.departDate)).join('; ');
  const back = f.back.map((o) => line(o, f.destCity, f.origin, f.returnDate)).join('; ');
  return (
    `LIVE FARES — fetched just now from Duffel for this exact trip. ` +
    `Outbound: ${out || 'no live fares found'}. ` +
    `Return: ${back || 'no live fares found'}. ` +
    `These are Duffel test fares (test mode — one carrier may be the fictional 'Duffel Airways'; real bookable fares need Duffel live mode). ` +
    `Quote them as the flight prices, with the airline name, and say they are live fares.`
  );
}

// One short line for the built-in fallback reply (no live model).
export function faresSummaryLine(f: LiveFares): string {
  const parts: string[] = [];
  if (f.out.length) {
    const o = f.out[0];
    parts.push(`cheapest live fare out: ${o.airline} $${o.price.toLocaleString()} ${o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`} (${f.origin} → ${f.destCity}, ${f.departDate})`);
  }
  if (f.back.length) {
    const o = f.back[0];
    parts.push(`cheapest live fare back: ${o.airline} $${o.price.toLocaleString()} ${o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`} (${f.destCity} → ${f.origin}, ${f.returnDate})`);
  }
  if (!parts.length) return '';
  return `Live fares (Duffel, test fares): ${parts.join('; ')}.`;
}
