// Live place suggestions for the search widget (API phase round 1,
// Nov 14, 2026): the professional type-ahead behind every place field
// (From / To / Destination / Pick-up / Drop-off). The old widget used a
// native <datalist> over a hardcoded list — no live suggestions, which
// is not how a professional travel app works. This module is the
// server-side source chain for GET /api/places.
//
// Source chain, first non-empty result wins:
//   (a) Travelpayouts Autocomplete API — GET
//       https://autocomplete.travelpayouts.com/places2?term=...&locale=en
//       &types[]=city&types[]=airport (confirmed from Travelpayouts' own
//       Help Center, "Autocomplete API for countries, cities and
//       airports by Aviasales", and verified live Nov 14, 2026: HTTP 200,
//       real cities/airports with IATA codes). No token is needed for
//       this endpoint — the docs show no token parameter and a bare
//       request returns data. The TRAVELPAYOUTS_TOKEN is still only for
//       the cached-fares Data API.
//   (b) OpenStreetMap Nominatim — the no-key fallback, 1 req/s usage
//       policy (server-side throttle below), a proper identifying
//       User-Agent, cities/towns only (featuretype=city). No IATA codes
//       come from Nominatim — none are attached.
//   (c) The known-places list (lib/searchPlaces.ts) — the last resort,
//       so a route display name like "Central Europe" still suggests
//       even when both live sources are down.
//
// Honesty rules (non-negotiable):
// - An IATA code is included ONLY when the source provides it. Nothing
//   is guessed, and no code is derived from a name.
// - A failed or empty live source falls through to the next source;
//   when every source is down or empty the result is an honest empty
//   list with a reason, never an invented place.
// - The token never leaves the server (this module runs server-side
//   only; the client talks to /api/places, never to a supplier).
import { CITY_IATA } from './duffel';
import { discoveryDestinations } from './discovery';
import { knownPlaceNames } from './searchPlaces';

export type PlaceKind = 'city' | 'airport' | 'region';

export type PlaceSuggestion = {
  // Display name in the listbox.
  name: string;
  // The value written into the field on selection. For an airport this
  // is the CITY it serves (city_name), not the airport name — the
  // search results resolve places by city/route name exactly as today,
  // so picking "London Heathrow Airport" still searches London.
  value: string;
  kind: PlaceKind;
  country?: string;
  // Only when the source provides one. Never guessed.
  iata?: string;
};

export type PlacesSource = 'travelpayouts' | 'nominatim' | 'known' | 'none';

export type PlacesResult = {
  places: PlaceSuggestion[];
  source: PlacesSource;
  // Why the list is empty when it is: 'type-more' (query too short) or
  // 'no-matches' (every source came back empty). Absent when places exist.
  reason?: 'type-more' | 'no-matches';
};

const MAX_SUGGESTIONS = 8;
const QUERY_MAX_LEN = 80;
const FETCH_TIMEOUT_MS = 5000;
// Nominatim's usage policy: at most 1 request per second.
const NOMINATIM_MIN_GAP_MS = 1100;
const CACHE_TTL_MS = 10 * 60 * 1000;

const TRAVELPAYOUTS_AUTOCOMPLETE =
  'https://autocomplete.travelpayouts.com/places2?locale=en&types[]=city&types[]=airport&term=';
const NOMINATIM_SEARCH =
  'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&featuretype=city&q=';
const NOMINATIM_USER_AGENT = 'FujinTrip/1.0 (https://fujintrip.com; places autocomplete)';

const cache = new Map<string, { at: number; result: PlacesResult }>();
let lastNominatimAt = 0;

// Tests only — clears the server cache and the Nominatim throttle.
// ---------------------------------------------------------------------------
// Client-side helpers for components/PlaceField.tsx (the type-ahead
// input). These run in the browser; the server chain above runs in
// /api/places. The client never talks to a supplier directly — it asks
// /api/places, which answers from the chain.
// ---------------------------------------------------------------------------

// Short client cache so re-typing a prefix does not re-fetch. Capped —
// the oldest entry goes when it fills.
const clientCache = new Map<string, PlaceSuggestion[]>();
const CLIENT_CACHE_MAX = 50;

// Tests only — clears the server cache and the Nominatim throttle.
export function __clearPlacesCache(): void {
  cache.clear();
  lastNominatimAt = 0;
}

// Tests only.
export function __clearPlaceSuggestionCache(): void {
  clientCache.clear();
}

// The listbox meta line for one suggestion — the kind word, the
// country and the IATA code. An airport whose name already ends
// with "Airport" (Travelpayouts returns "London Heathrow Airport")
// does NOT get the kind word again: "London Heathrow Airport
// Airport" (defect, Nov 15 2026) is the kind of unprofessional
// label a traveler notices immediately. The check is
// case-insensitive and trailing-space tolerant.
export function suggestionKindLabel(s: PlaceSuggestion): string {
  if (s.kind === 'airport' && /airport$/i.test(s.name.trim())) return '';
  return s.kind === 'airport' ? 'Airport' : s.kind === 'region' ? 'Region' : 'City';
}

export function suggestionMeta(s: PlaceSuggestion): string {
  const parts = [suggestionKindLabel(s), s.country].filter((p): p is string => Boolean(p));
  let meta = parts.join(' · ');
  if (s.iata) meta += `${meta ? ' ' : ''}(${s.iata})`;
  return meta;
}

// Fetch suggestions for a typed prefix from /api/places. Any failure
// (network, bad JSON, server error) is an honest empty list — the field
// stays usable as a plain input and the known-list fallback already ran
// server-side.
export async function fetchPlaceSuggestions(
  query: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<PlaceSuggestion[]> {
  const q = normalizePlaceQuery(query);
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = clientCache.get(key);
  if (hit) return hit;
  let places: PlaceSuggestion[] = [];
  try {
    const res = await fetchImpl(`/api/places?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && Array.isArray((data as { places?: unknown }).places)) {
        places = (data as { places: PlaceSuggestion[] }).places.filter(
          (p) => p && typeof p === 'object' && typeof p.name === 'string' && typeof p.value === 'string'
        );
      }
    }
  } catch {
    places = [];
  }
  if (clientCache.size >= CLIENT_CACHE_MAX) {
    const oldest = clientCache.keys().next().value;
    if (oldest !== undefined) clientCache.delete(oldest);
  }
  clientCache.set(key, places);
  return places;
}

// The combobox keyboard model, pure so the unit test can pin it:
// ArrowDown/ArrowUp cycle through the suggestions, Enter selects the
// highlighted one, Escape closes without selecting. Anything else is a
// no-op (the input handles the typing itself).
export type AutocompleteState = { open: boolean; active: number };

export function autocompleteKeyDown(
  state: AutocompleteState,
  key: string,
  count: number
): { state: AutocompleteState; selected: number | null } {
  if (key === 'ArrowDown' && count > 0) {
    const active = state.active < 0 ? 0 : (state.active + 1) % count;
    return { state: { open: true, active }, selected: null };
  }
  if (key === 'ArrowUp' && count > 0) {
    const active = state.active < 0 ? count - 1 : (state.active - 1 + count) % count;
    return { state: { open: true, active }, selected: null };
  }
  if (key === 'Enter' && state.open && state.active >= 0 && state.active < count) {
    return { state: { open: false, active: -1 }, selected: state.active };
  }
  if (key === 'Escape') {
    return { state: { open: false, active: -1 }, selected: null };
  }
  return { state, selected: null };
}

export function normalizePlaceQuery(q: unknown): string {
  if (typeof q !== 'string') return '';
  return q.trim().replace(/\s+/g, ' ').slice(0, QUERY_MAX_LEN);
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

function dedupe(places: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  for (const p of places) {
    const key = `${p.kind}:${p.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

type TravelpayoutsPlace = {
  type?: unknown;
  code?: unknown;
  name?: unknown;
  country_name?: unknown;
  city_name?: unknown;
};

function fromTravelpayouts(data: unknown): PlaceSuggestion[] {
  if (!Array.isArray(data)) return [];
  const out: PlaceSuggestion[] = [];
  for (const item of data as TravelpayoutsPlace[]) {
    if (!item || typeof item !== 'object') continue;
    const type = typeof item.type === 'string' ? item.type : '';
    if (type !== 'city' && type !== 'airport') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    const code = typeof item.code === 'string' && /^[A-Z]{3}$/.test(item.code) ? item.code : undefined;
    const country = typeof item.country_name === 'string' ? item.country_name : undefined;
    if (type === 'city') {
      out.push({ name, value: name, kind: 'city', country, iata: code });
    } else {
      const cityName = typeof item.city_name === 'string' && item.city_name.trim() ? item.city_name.trim() : name;
      out.push({ name, value: cityName, kind: 'airport', country, iata: code });
    }
  }
  return dedupe(out);
}

type NominatimPlace = {
  name?: unknown;
  class?: unknown;
  type?: unknown;
  address?: { country?: unknown };
};

// Nominatim with featuretype=city returns cities/towns — but the filter
// stays explicit: only place-class results with a name are kept, so a
// street or venue can never slip into a place field.
function fromNominatim(data: unknown): PlaceSuggestion[] {
  if (!Array.isArray(data)) return [];
  const out: PlaceSuggestion[] = [];
  for (const item of data as NominatimPlace[]) {
    if (!item || typeof item !== 'object') continue;
    if (item.class !== 'place') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    const country =
      item.address && typeof item.address === 'object' && typeof item.address.country === 'string'
        ? item.address.country
        : undefined;
    out.push({ name, value: name, kind: 'city', country });
  }
  return dedupe(out);
}

function fromKnownList(query: string): PlaceSuggestion[] {
  const lower = query.toLowerCase();
  const regions = new Set(discoveryDestinations().map((d) => d.destination));
  const matches = knownPlaceNames().filter((n) => n.toLowerCase().includes(lower));
  matches.sort((a, b) => {
    const aStarts = a.toLowerCase().startsWith(lower) ? 0 : 1;
    const bStarts = b.toLowerCase().startsWith(lower) ? 0 : 1;
    return aStarts - bStarts || a.localeCompare(b);
  });
  return dedupe(
    matches.slice(0, MAX_SUGGESTIONS).map((name) => ({
      name,
      value: name,
      kind: (regions.has(name) ? 'region' : 'city') as PlaceKind,
      iata: CITY_IATA[name],
    }))
  );
}

async function fetchTravelpayouts(
  query: string,
  fetchImpl: typeof fetch
): Promise<PlaceSuggestion[]> {
  const { signal, done } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${TRAVELPAYOUTS_AUTOCOMPLETE}${encodeURIComponent(query)}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    return fromTravelpayouts(await res.json());
  } catch {
    return [];
  } finally {
    done();
  }
}

async function fetchNominatim(query: string, fetchImpl: typeof fetch): Promise<PlaceSuggestion[]> {
  // The 1 req/s policy is enforced server-side: wait out the gap since
  // the previous Nominatim call before issuing another.
  const wait = NOMINATIM_MIN_GAP_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
  const { signal, done } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${NOMINATIM_SEARCH}${encodeURIComponent(query)}`, {
      signal,
      headers: { Accept: 'application/json', 'User-Agent': NOMINATIM_USER_AGENT },
    });
    if (!res.ok) return [];
    return fromNominatim(await res.json());
  } catch {
    return [];
  } finally {
    done();
  }
}

// The source chain for GET /api/places. First non-empty result wins;
// an empty list with a reason is returned when every source is down or
// empty — never an invented place.
export async function searchPlaces(
  query: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<PlacesResult> {
  const q = normalizePlaceQuery(query);
  if (q.length < 2) return { places: [], source: 'none', reason: 'type-more' };
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  let result: PlacesResult;
  const live = await fetchTravelpayouts(q, fetchImpl);
  if (live.length > 0) {
    result = { places: live, source: 'travelpayouts' };
  } else {
    const osm = await fetchNominatim(q, fetchImpl);
    if (osm.length > 0) {
      result = { places: osm, source: 'nominatim' };
    } else {
      const known = fromKnownList(q);
      result =
        known.length > 0
          ? { places: known, source: 'known' }
          : { places: [], source: 'none', reason: 'no-matches' };
    }
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}
