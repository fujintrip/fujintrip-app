/**
 * "Tonight, near you, open now" — the food answer (competitor learning
 * round 2 #4).
 *
 * Three named places, walk time, open-now, price band, named dish, one
 * review quote — all from real sources, never invented:
 *
 *  - Wikivoyage's Eat section, read as raw wikitext so the listings are
 *    structured ({{listing|name=…|hours=…|price=…|content=…}}) instead
 *    of a text blob. The dish is the first sentence of the listing's
 *    own description, quoted verbatim; the review quote is the next
 *    sentence, labeled "Wikivoyage says". A name, an hour, a dish or a
 *    review that Wikivoyage does not give is omitted, never made up.
 *  - Open-now comes from the listing's own hours string, parsed
 *    confidently (day ranges + time ranges in the city's timezone).
 *    Hours that do not parse are "hours not verified" — never guessed.
 *  - Walk time is a haversine estimate from the city center (the
 *    trip card's city coordinates) to the place's OpenStreetMap
 *    geocode. If the geocode fails, the walk time is omitted.
 *
 * Results are cached 24h per city (real results only — an empty result
 * is never cached, same policy as Local Voices) and the whole fetch is
 * capped at ~14s so a slow source never holds up the chat reply. The
 * district path (main article + 8 district articles + 3 geocodes) is
 * what makes the budget this wide; a typical fetch takes ~5s.
 */

import { cityCoords } from './tripCard';

const UA = 'FujinTrip/1.0 (fujintrip.com; food-tonight)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_BUDGET_MS = 14000;

// IANA timezone per city in the trip card (51 cities). Intl throws on an
// unknown zone, so openNow treats a missing zone as "not verified".
export const CITY_TZ: Record<string, string> = {
  Lisbon: 'Europe/Lisbon',
  Porto: 'Europe/Lisbon',
  Sintra: 'Europe/Lisbon',
  Madrid: 'Europe/Madrid',
  Barcelona: 'Europe/Madrid',
  Seville: 'Europe/Madrid',
  Paris: 'Europe/Paris',
  'Loire Valley': 'Europe/Paris',
  Nice: 'Europe/Paris',
  Rome: 'Europe/Rome',
  Florence: 'Europe/Rome',
  Venice: 'Europe/Rome',
  Athens: 'Europe/Athens',
  Santorini: 'Europe/Athens',
  Crete: 'Europe/Athens',
  Prague: 'Europe/Prague',
  Vienna: 'Europe/Vienna',
  Budapest: 'Europe/Budapest',
  Cairo: 'Africa/Cairo',
  Luxor: 'Africa/Cairo',
  Aswan: 'Africa/Cairo',
  'Sharm El Sheikh': 'Africa/Cairo',
  Tokyo: 'Asia/Tokyo',
  Kyoto: 'Asia/Tokyo',
  Osaka: 'Asia/Tokyo',
  Bangkok: 'Asia/Bangkok',
  'Chiang Mai': 'Asia/Bangkok',
  Krabi: 'Asia/Bangkok',
  'Siem Reap': 'Asia/Phnom_Penh',
  Hanoi: 'Asia/Ho_Chi_Minh',
  Istanbul: 'Europe/Istanbul',
  Cappadocia: 'Europe/Istanbul',
  Antalya: 'Europe/Istanbul',
  Marrakech: 'Africa/Casablanca',
  Fes: 'Africa/Casablanca',
  Chefchaouen: 'Africa/Casablanca',
  Delhi: 'Asia/Kolkata',
  Agra: 'Asia/Kolkata',
  Jaipur: 'Asia/Kolkata',
  London: 'Europe/London',
  Bath: 'Europe/London',
  Edinburgh: 'Europe/London',
  'Mexico City': 'America/Mexico_City',
  Oaxaca: 'America/Mexico_City',
  Tulum: 'America/Cancun',
  'New York': 'America/New_York',
  'San Francisco': 'America/Los_Angeles',
  'Los Angeles': 'America/Los_Angeles',
  Tacoma: 'America/Los_Angeles',
  Bali: 'Asia/Makassar',
  'St. George': 'America/Denver',
  Hilo: 'Pacific/Honolulu',
};

// Wikivoyage page titles that differ from the trip card's city name.
const PAGE_ALIASES: Record<string, string> = {
  'St. George': 'St. George (Utah)',
};

export type TonightPlace = {
  name: string;
  // Price band from the listing's own $-signs ('$' / '$$' / '$$$');
  // undefined when the listing gives no $-price — never guessed.
  priceBand?: string;
  hours?: string;
  // true = open now, false = closed now, null = hours not verified.
  openNow: boolean | null;
  // The first sentence of the listing's description, verbatim.
  dish?: string;
  // The next sentence of the description, verbatim (the review quote).
  quote?: string;
  // Minutes' walk from the city center (haversine estimate); undefined
  // when the geocode failed or the place is not near the center.
  walkMinutes?: number;
};

export type TonightResult = {
  city: string;
  tz: string | null;
  places: TonightPlace[];
  checkedAt: string;
};

const cache = new Map<string, { at: number; result: TonightResult }>();

async function fetchJson(url: string, ms: number, headers?: Record<string, string>): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(headers ?? {}) }, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Wikivoyage listing parse ------------------------------------------
// The Eat section as raw wikitext: listings are {{listing|…}} (or the
// {{eat|…}} shorthand) with named fields. Split the template body on
// '|' at brace depth 0 so nested {{…}} and [[…]] survive intact.
function splitTemplateFields(inner: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      cur += two;
      i++;
      continue;
    }
    if (two === '}}' || two === ']]') {
      depth = Math.max(0, depth - 1);
      cur += two;
      i++;
      continue;
    }
    if (inner[i] === '|' && depth === 0) {
      fields.push(cur);
      cur = '';
      continue;
    }
    cur += inner[i];
  }
  fields.push(cur);
  return fields;
}

// Strip wikitext markup from a field value, keeping the readable text:
// nested {{USD|15}} → "15", [[Kyoto Station|the station]] → "the
// station", ''italics'' / '''bold''' → plain text.
function cleanWikitext(value: string): string {
  let out = value;
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const parts = String(inner).split('|');
      return parts[parts.length - 1];
    });
  }
  out = out
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

type RawListing = { name: string; hours: string; price: string; content: string };

export function parseListings(wikitext: string): RawListing[] {
  const out: RawListing[] = [];
  const re = /\{\{(listing|eat)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext)) !== null) {
    const start = m.index + 2;
    // Depth 1: the listing's own opening {{ was already consumed by the
    // regex match, so the matching }} brings it back to 0.
    let depth = 1;
    let end = -1;
    for (let i = start; i < wikitext.length - 1; i++) {
      const two = wikitext.slice(i, i + 2);
      if (two === '{{') {
        depth++;
        i++;
      } else if (two === '}}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
        i++;
      }
    }
    if (end === -1) continue;
    const inner = wikitext.slice(start, end);
    const fields = splitTemplateFields(inner);
    const kv: Record<string, string> = {};
    for (const f of fields) {
      const eq = f.indexOf('=');
      if (eq === -1) continue;
      kv[f.slice(0, eq).trim().toLowerCase()] = cleanWikitext(f.slice(eq + 1));
    }
    // A listing in the Eat section is food even when the type field is
    // missing; a listing that says otherwise is not.
    if (kv.type && kv.type.toLowerCase() !== 'eat') continue;
    if (!kv.name) continue;
    out.push({ name: kv.name, hours: kv.hours ?? '', price: kv.price ?? '', content: kv.content ?? '' });
    re.lastIndex = end + 2;
  }
  return out;
}

async function fetchEatListings(city: string): Promise<RawListing[]> {
  const api = 'https://en.wikivoyage.org/w/api.php';
  const page = encodeURIComponent(PAGE_ALIASES[city] ?? city);
  const toc = (await fetchJson(
    `${api}?action=parse&page=${page}&prop=tocdata&format=json&formatversion=2`,
    2000
  )) as { parse?: { tocdata?: { sections?: Array<{ line?: unknown; index?: unknown }> } } } | null;
  const sections = toc?.parse?.tocdata?.sections ?? [];
  const eat = sections.find(
    (s) => typeof s.line === 'string' && typeof s.index === 'string' && s.line.trim().toLowerCase() === 'eat'
  );
  if (!eat) return [];
  const data = (await fetchJson(
    `${api}?action=parse&page=${page}&section=${eat.index}&prop=wikitext&format=json&formatversion=2`,
    2500
  )) as { parse?: { wikitext?: unknown } } | null;
  // formatversion=2 returns the wikitext as a plain string; formatversion=1
  // would wrap it in {'*': …} — accept both.
  const wt = data?.parse?.wikitext;
  const text = typeof wt === 'string' ? wt : typeof wt === 'object' && wt !== null && typeof (wt as { '*'?: unknown })['*'] === 'string' ? ((wt as { '*'?: string })['*'] as string) : '';
  if (!text) return [];
  return parseListings(text);
}

// District fallback: big-city articles (Kyoto, Tokyo, Paris…) carry no
// listings in their own Eat section — it is prose plus {{seeDistricts}},
// and the restaurants live in the district sub-articles (Kyoto/
// Higashiyama, …). List the subpages, fetch each one's Eat section in
// parallel, and combine the listings. A subpage with no Eat section is
// skipped; district order is Wikivoyage order.
async function fetchDistrictEatListings(city: string): Promise<RawListing[]> {
  const api = 'https://en.wikivoyage.org/w/api.php';
  const page = PAGE_ALIASES[city] ?? city;
  const all = (await fetchJson(
    `${api}?action=query&list=allpages&apprefix=${encodeURIComponent(page + '/')}&aplimit=20&apnamespace=0&format=json&formatversion=2`,
    2000
  )) as { query?: { allpages?: Array<{ title?: unknown }> } } | null;
  const titles = (all?.query?.allpages ?? [])
    .map((p) => (typeof p.title === 'string' ? p.title : ''))
    .filter(Boolean)
    .slice(0, 8);
  if (!titles.length) return [];
  const perDistrict = await Promise.all(
    titles.map(async (title) => {
      try {
        const toc = (await fetchJson(
          `${api}?action=parse&page=${encodeURIComponent(title)}&prop=tocdata&format=json&formatversion=2`,
          1500
        )) as { parse?: { tocdata?: { sections?: Array<{ line?: unknown; index?: unknown }> } } } | null;
        const eat = (toc?.parse?.tocdata?.sections ?? []).find(
          (s) => typeof s.line === 'string' && typeof s.index === 'string' && s.line.trim().toLowerCase() === 'eat'
        );
        if (!eat) return [] as RawListing[];
        const data = (await fetchJson(
          `${api}?action=parse&page=${encodeURIComponent(title)}&section=${eat.index}&prop=wikitext&format=json&formatversion=2`,
          2000
        )) as { parse?: { wikitext?: unknown } } | null;
        const wt = data?.parse?.wikitext;
        const text = typeof wt === 'string' ? wt : typeof wt === 'object' && wt !== null && typeof (wt as { '*'?: unknown })['*'] === 'string' ? ((wt as { '*'?: string })['*'] as string) : '';
        return text ? parseListings(text) : ([] as RawListing[]);
      } catch {
        return [] as RawListing[];
      }
    })
  );
  // Dedupe by name (a place can appear in two district guides).
  const seen = new Set<string>();
  return perDistrict.flat().filter((l) => {
    const k = l.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- Open-now ------------------------------------------------------------
// Confident parse only: day ranges (M-Sa, Tu-Su, Daily, Weekdays,
// Weekends) + one or two time ranges per day group, 24h or 12h clock.
// Anything else — "Closed on Mondays", a free-text note, a missing
// hours field — returns null ("hours not verified"), never a guess.
const DAY_NUM: Record<string, number> = {
  M: 1, Mo: 1, Mon: 1, Tu: 2, Tue: 2, W: 3, We: 3, Wed: 3, Th: 4, Thu: 4, F: 5, Fr: 5, Fri: 5, Sa: 6, Sat: 6, Su: 0, Sun: 0,
};

function parseDayGroup(raw: string): number[] | null {
  const s = raw.trim().toLowerCase();
  if (s === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (s === 'weekdays') return [1, 2, 3, 4, 5];
  if (s === 'weekends') return [6, 0];
  const m = s.match(/^([a-z]{1,3})-([a-z]{1,3})$/);
  const cap = (d: string) => d.charAt(0).toUpperCase() + d.slice(1);
  if (m) {
    const from = DAY_NUM[cap(m[1])];
    const to = DAY_NUM[cap(m[2])];
    if (from === undefined || to === undefined) return null;
    const days: number[] = [];
    let d = from;
    for (let i = 0; i < 7; i++) {
      days.push(d);
      if (d === to) break;
      d = (d + 1) % 7;
    }
    return days;
  }
  const single = DAY_NUM[cap(s)];
  return single === undefined ? null : [single];
}

function parseClock(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] ?? '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function parseHours(hours: string): Array<{ days: number[]; start: number; end: number }> | null {
  const h = (hours ?? '').trim();
  if (!h) return null;
  if (/^(24\s*hours?|24\/7|always open)$/i.test(h)) {
    return [{ days: [0, 1, 2, 3, 4, 5, 6], start: 0, end: 24 * 60 }];
  }
  // Split on ';' and ',' — a comma separates day groups ("Su 12:00-20:00,
  // M-Sa 10:00-22:00") AND second ranges for the same days ("M-Sa
  // 11:30-15:00, 17:30-23:00"); a segment without a day part inherits
  // the last one, daily when the whole string has none.
  const segments = h.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const out: Array<{ days: number[]; start: number; end: number }> = [];
  let activeDays: number[] = [0, 1, 2, 3, 4, 5, 6];
  for (const seg of segments) {
    const dayMatch = seg.match(/^(daily|weekdays|weekends|[a-z]{1,3}(?:-[a-z]{1,3})?)\s+/i);
    let rest = seg;
    if (dayMatch) {
      const days = parseDayGroup(dayMatch[1]);
      if (!days) return null;
      activeDays = days;
      rest = seg.slice(dayMatch[0].length).trim();
    }
    const ranges = rest.split(/\s+and\s+/i);
    for (const range of ranges) {
      const rm = range.trim().match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
      if (!rm) return null;
      const start = parseClock(rm[1]);
      const end = parseClock(rm[2]);
      if (start === null || end === null) return null;
      out.push({ days: activeDays, start, end });
    }
  }
  return out.length ? out : null;
}

function nowInTz(tz: string, now: Date): { weekday: number; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }[get('weekday') ?? ''];
    if (wd === undefined) return null;
    const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
    return { weekday: wd, minutes };
  } catch {
    return null;
  }
}

// true = open now, false = closed now, null = hours not verified.
export function openNow(hours: string | undefined, tz: string | null, now: Date = new Date()): boolean | null {
  if (!hours || !tz) return null;
  const ranges = parseHours(hours);
  if (!ranges) return null;
  const here = nowInTz(tz, now);
  if (!here) return null;
  for (const r of ranges) {
    if (!r.days.includes(here.weekday)) continue;
    // A range ending at or before it starts crosses midnight (17:00-02:00).
    if (r.end <= r.start) {
      if (here.minutes >= r.start || here.minutes < r.end) return true;
    } else if (here.minutes >= r.start && here.minutes < r.end) {
      return true;
    }
  }
  return false;
}

// --- Walk time -----------------------------------------------------------
// OpenStreetMap Nominatim geocode (best-effort, User-Agent required by
// its usage policy); walk minutes are a haversine estimate from the
// city center at ~5 km/h. A failed geocode or a place far from the
// center simply omits the walk time.
async function geocodePlace(name: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${name}, ${city}`)}`;
  const data = (await fetchJson(url, 1500)) as Array<{ lat?: unknown; lon?: unknown }> | null;
  const hit = Array.isArray(data) ? data[0] : null;
  const lat = typeof hit?.lat === 'string' ? Number(hit.lat) : NaN;
  const lng = typeof hit?.lon === 'string' ? Number(hit.lon) : NaN;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function firstSentences(text: string): string[] {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export async function fetchTonight(city: string, now: Date = new Date()): Promise<TonightResult> {
  const key = city.trim().toLowerCase();
  const empty: TonightResult = { city, tz: CITY_TZ[city] ?? null, places: [], checkedAt: new Date().toISOString() };
  if (!key) return empty;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const work = (async (): Promise<TonightResult> => {
    const tz = CITY_TZ[city] ?? null;
    const center = cityCoords(city);
    let listings = await fetchEatListings(city).catch(() => [] as RawListing[]);
    // District-split cities (Kyoto, Tokyo, Paris…) keep their restaurants
    // in the district sub-articles, not the main article.
    if (!listings.length) listings = await fetchDistrictEatListings(city).catch(() => [] as RawListing[]);
    if (!listings.length) return empty;
    // Rank: open now first, then hours-unverified, then closed (never
    // shown); within a group, listings with a description first, then
    // Wikivoyage order.
    const scored = listings
      .map((l, i) => {
        const open = openNow(l.hours, tz, now);
        const sentences = firstSentences(l.content);
        const dollarCount = (l.price.match(/\$/g) ?? []).length;
        return {
          l,
          i,
          open,
          group: open === false ? 2 : open === true ? 0 : 1,
          hasText: sentences.length > 0 ? 0 : 1,
          sentences,
          priceBand: dollarCount >= 1 && dollarCount <= 3 ? '$'.repeat(dollarCount) : undefined,
        };
      })
      .filter((s) => s.group !== 2)
      .sort((a, b) => a.group - b.group || a.hasText - b.hasText || a.i - b.i)
      .slice(0, 3);
    const places: TonightPlace[] = [];
    for (const s of scored) {
      const place: TonightPlace = {
        name: s.l.name,
        ...(s.priceBand ? { priceBand: s.priceBand } : {}),
        ...(s.l.hours ? { hours: s.l.hours } : {}),
        openNow: s.open,
        ...(s.sentences[0] ? { dish: s.sentences[0].slice(0, 140) } : {}),
        ...(s.sentences[1] ? { quote: s.sentences[1].slice(0, 200) } : {}),
      };
      // Walk time, best-effort: the center geocode is from the trip
      // card, the place's from Nominatim. Sequential with a small gap —
      // Nominatim asks for at most one request per second, and a failed
      // lookup just omits the walk time.
      if (center) {
        const geo = await geocodePlace(s.l.name, city).catch(() => null);
        await new Promise((r) => setTimeout(r, 200));
        if (geo) {
          const km = haversineKm(center, geo);
          // Near you means a walk: beyond ~45 minutes it is a taxi or
          // metro ride, not a walk — the place stays, the walk time is
          // omitted rather than shown as a 2-hour walk.
          const minutes = Math.round((km * 1000) / 83);
          if (minutes <= 45) place.walkMinutes = Math.max(1, minutes);
        }
      }
      places.push(place);
    }
    return { city, tz, places, checkedAt: new Date().toISOString() };
  })();

  const result = await Promise.race([
    work,
    new Promise<TonightResult>((resolve) => setTimeout(() => resolve(empty), FETCH_BUDGET_MS)),
  ]).catch(() => empty);
  // Cache only real results — see the note above the cache declaration.
  if (result.places.length) cache.set(key, { at: Date.now(), result });
  return result;
}

// The prompt block: the model names ONLY these places, with their
// open-now status, walk time, price band and dish — and quotes the
// Wikivoyage sentence as the review. It may only say "open now" when
// the block says so.
export function foodBlock(t: TonightResult): string {
  const lines = t.places.map((p, i) => {
    const bits = [
      p.priceBand ? `price ${p.priceBand}` : 'price not listed',
      p.openNow === true ? 'open now' : p.openNow === false ? 'closed now' : 'hours not verified',
      p.walkMinutes ? `about ${p.walkMinutes}-min walk from the city center (estimate)` : null,
      p.dish ? `dish: ${p.dish}` : null,
      p.quote ? `Wikivoyage says: "${p.quote}"` : null,
    ].filter(Boolean);
    return `${i + 1}. ${p.name} — ${bits.join(' · ')}`;
  });
  return `Tonight in ${t.city} (checked ${new Date(t.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${t.tz ? `, ${t.tz}` : ''}):\n${lines.join('\n')}`;
}

// The fallback reply version: the same facts, in readable lines.
export function foodReply(t: TonightResult): string {
  const lines = t.places.map((p) => {
    const status = p.openNow === true ? 'Open now' : p.openNow === false ? 'Closed now' : 'Hours not verified';
    const walk = p.walkMinutes ? ` · about ${p.walkMinutes}-min walk from the city center (estimate)` : '';
    const price = p.priceBand ? ` · ${p.priceBand}` : '';
    const dish = p.dish ? `\n${p.dish}` : '';
    const quote = p.quote ? `\nWikivoyage says: "${p.quote}"` : '';
    return `• ${p.name}${price} — ${status}${walk}${dish}${quote}`;
  });
  return `Tonight in ${t.city}, open now:\n${lines.join('\n')}`;
}
