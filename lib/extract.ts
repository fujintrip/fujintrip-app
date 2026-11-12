/**
 * Start Anywhere (competitor learning round 2 #6, Mindtrip) — paste a
 * link or a block of text and get a plan, with the source tip attached
 * to each stop.
 *
 * How it works:
 *  - extractPlacesFromText scans the text for the cities the app knows
 *    (the trip card's 52 cities) and the route names it knows (Japan,
 *    Central Europe, Southeast Asia, …), in order of appearance. A
 *    country expands to its whole route. The tip for a stop is the
 *    sentence that named it — the source's own words, quoted verbatim,
 *    never paraphrased into a new claim.
 *  - fetchUrlText fetches a page server-side (8s timeout, http(s)
 *    only, ~20k chars) and strips it to text. A PDF or an image is
 *    unreadable: the API says so honestly instead of inventing a trip
 *    from it. Screenshots cannot be pasted at all — the client says so
 *    in the box itself.
 *
 * Nothing is invented: a place the app does not know is skipped, and
 * when no place is found the API returns an empty list.
 */

import { CITY_INFO } from './tripCard';
import { COUNTRY_ROUTES, ROUTE_STOPS } from './planner';

export type ExtractedStop = { city: string; country: string; tip: string };
export type ExtractedTrip = {
  destination: string;
  stops: ExtractedStop[];
  // The ordered cities, ready for a RouteOverride.
  cities: string[];
};

// Common country names that are not route display names, mapped to the
// route they belong to.
const COUNTRY_ALIASES: Record<string, string> = {
  'czech republic': 'centraleurope',
  czechia: 'centraleurope',
  'united states': 'usa',
  america: 'usa',
  'united kingdom': 'uk',
  england: 'uk',
  scotland: 'uk',
  vietnam: 'southeastasia',
  cambodia: 'southeastasia',
  'united arab emirates': 'turkey',
};

const CITY_ALIASES: Record<string, string> = {
  nyc: 'New York',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceAround(text: string, index: number, maxLen = 200): string {
  const sentences = sentencesOf(text);
  let cursor = 0;
  for (const s of sentences) {
    const at = text.indexOf(s, cursor);
    if (at !== -1 && index >= at && index < at + s.length) {
      return s.length > maxLen ? `${s.slice(0, maxLen).trimEnd()}…` : s;
    }
    cursor = at === -1 ? cursor : at + s.length;
  }
  return '';
}

function routeKeyForCity(city: string): string {
  for (const [key, stops] of Object.entries(ROUTE_STOPS)) {
    if (stops.some((s) => s.city === city)) return key;
  }
  return '';
}

type Match = { index: number; kind: 'city' | 'country'; name: string; routeKey: string };

export function extractPlacesFromText(text: string): ExtractedTrip {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return { destination: '', stops: [], cities: [] };
  const matches: Match[] = [];
  const add = (name: string, kind: 'city' | 'country', routeKey: string) => {
    const re = new RegExp(`(^|[^A-Za-z])(${escapeRegExp(name)})(?=[^A-Za-z]|$)`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      // The name starts after the leading separator character.
      matches.push({ index: m.index + m[1].length, kind, name, routeKey });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };
  // Cities first (longest names first so "New York" wins over "York",
  // though York is not a city here — the order also keeps the match
  // list stable).
  const cityNames = Object.keys(CITY_INFO).sort((a, b) => b.length - a.length);
  for (const city of cityNames) add(city, 'city', routeKeyForCity(city));
  for (const [alias, city] of Object.entries(CITY_ALIASES)) add(alias, 'city', routeKeyForCity(city));
  for (const [key, v] of Object.entries(COUNTRY_ROUTES)) add(v.display, 'country', key);
  for (const [alias, key] of Object.entries(COUNTRY_ALIASES)) add(alias, 'country', key);
  // Longest match wins at the same position, and a match inside another
  // match's span is dropped — "Central Europe" must not also expand the
  // plain "Europe" route (Lisbon, Madrid, …) on top of it.
  matches.sort((a, b) => a.index - b.index || b.name.length - a.name.length);
  const deduped: Match[] = [];
  for (const m of matches) {
    const last = deduped[deduped.length - 1];
    if (last && m.index < last.index + last.name.length) continue;
    deduped.push(m);
  }

  const stops: ExtractedStop[] = [];
  const seen = new Set<string>();
  const tipForCity = (city: string, fallbackIndex: number): string => {
    // The city's own sentence when the city is named; otherwise the
    // sentence that named the region.
    const cityMatch = matches.find((m) => m.kind === 'city' && (m.name === city || CITY_ALIASES[m.name.toLowerCase()] === city));
    return sentenceAround(clean, cityMatch ? cityMatch.index : fallbackIndex);
  };
  for (const m of deduped) {
    if (m.kind === 'city') {
      const city = CITY_ALIASES[m.name.toLowerCase()] ?? m.name;
      if (seen.has(city)) continue;
      seen.add(city);
      stops.push({ city, country: CITY_INFO[city]?.country ?? '', tip: sentenceAround(clean, m.index) });
    } else {
      const route = ROUTE_STOPS[m.routeKey] ?? [];
      for (const s of route) {
        if (seen.has(s.city)) continue;
        seen.add(s.city);
        stops.push({ city: s.city, country: s.country, tip: tipForCity(s.city, m.index) });
      }
    }
    if (stops.length >= 8) break;
  }
  if (!stops.length) return { destination: '', stops: [], cities: [] };
  // The destination is the first thing named: a country gives its route
  // display name; a city gives the display of the route it belongs to,
  // or the city itself when it belongs to no route (Bali).
  const first = deduped[0];
  let destination = '';
  if (first.kind === 'country') {
    destination = COUNTRY_ROUTES[first.routeKey]?.display ?? '';
  } else {
    const city = CITY_ALIASES[first.name.toLowerCase()] ?? first.name;
    const key = routeKeyForCity(city);
    destination = key ? (COUNTRY_ROUTES[key]?.display ?? city) : city;
  }
  return { destination, stops: stops.slice(0, 8), cities: stops.slice(0, 8).map((s) => s.city) };
}

// Fetch a page server-side and return its readable text (or an
// unreadable error for PDFs and images — never a made-up trip).
export type UrlTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'unreadable' | 'fetch_failed' | 'bad_url' };

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchUrlText(url: string): Promise<UrlTextResult> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, reason: 'bad_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'bad_url' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'FujinTrip/1.0 (fujintrip.com; start-anywhere)' },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: 'fetch_failed' };
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('application/pdf') || type.startsWith('image/')) {
      return { ok: false, reason: 'unreadable' };
    }
    const body = await res.text().catch(() => '');
    if (!body) return { ok: false, reason: 'fetch_failed' };
    const text = type.includes('text/html') ? stripHtml(body) : body.replace(/\s+/g, ' ').trim();
    return { ok: true, text: text.slice(0, 20000) };
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  } finally {
    clearTimeout(timeout);
  }
}
