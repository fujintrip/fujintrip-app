// Live place suggestions (API phase round 1, Nov 14, 2026) — unit
// tests for the server chain in lib/places.ts and the client helpers
// the type-ahead uses. No live network: fetch is injected as a stub
// returning canned replies in the shapes the official docs show.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/places.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  __clearPlacesCache,
  __clearPlaceSuggestionCache,
  autocompleteKeyDown,
  fetchPlaceSuggestions,
  normalizePlaceQuery,
  searchPlaces,
  suggestionKindLabel,
  suggestionMeta,
} from '../lib/places.ts';

beforeEach(() => {
  __clearPlacesCache();
  __clearPlaceSuggestionCache();
});

// A canned Travelpayouts places2 reply (official response shape:
// type/code/name/country_code/country_name/city_code/city_name).
// London city first, then its airports; one airport has no city_name
// (value must fall back to the airport name), one city has no code
// (no IATA may be attached — codes are never guessed).
const cannedTravelpayouts = [
  {
    id: 'a6ec1def-4995-4a98-8c93-46b42b10fe7e',
    type: 'city',
    code: 'LON',
    name: 'London',
    country_code: 'GB',
    country_name: 'United Kingdom',
    city_code: 'LON',
    city_name: 'London',
  },
  {
    id: '98d5fa02-8fc2-498c-b288-151f3a504697',
    type: 'airport',
    code: 'LHR',
    name: 'London Heathrow Airport',
    country_code: 'GB',
    country_name: 'United Kingdom',
    city_code: 'LON',
    city_name: 'London',
  },
  {
    id: 'no-city-name',
    type: 'airport',
    code: 'LCY',
    name: 'London City Airport',
    country_code: 'GB',
    country_name: 'United Kingdom',
    city_code: 'LON',
    city_name: null,
  },
  {
    id: 'no-code',
    type: 'city',
    code: null,
    name: 'Londonderry',
    country_code: 'GB',
    country_name: 'United Kingdom',
  },
];

// A canned Nominatim reply (format=jsonv2, featuretype=city): one real
// city, one street-class result that must be filtered out, one city
// with no address block.
const cannedNominatim = [
  { place_id: 1, name: 'Prague', class: 'place', type: 'city', address: { country: 'Czechia' } },
  { place_id: 2, name: 'Prague Main Street', class: 'highway', type: 'residential', address: {} },
  { place_id: 3, name: 'Praha', class: 'place', type: 'city' },
];

function okJson(data) {
  return async () => ({ ok: true, json: async () => data });
}

test('suggestionKindLabel: a name already ending in "Airport" drops the kind word — no "Airport Airport"', () => {
  const heathrow = { name: 'London Heathrow Airport', value: 'London', kind: 'airport', country: 'United Kingdom', iata: 'LHR' };
  assert.equal(suggestionKindLabel(heathrow), '', 'the name already says Airport');
  assert.equal(suggestionMeta(heathrow), 'United Kingdom (LHR)', 'the meta line carries country + IATA only');
  const bare = { name: 'Heathrow', value: 'London', kind: 'airport', country: 'United Kingdom', iata: 'LHR' };
  assert.equal(suggestionKindLabel(bare), 'Airport', 'a name without Airport still gets the kind word');
  assert.equal(suggestionMeta(bare), 'Airport · United Kingdom (LHR)');
  const lower = { name: 'London City airport', value: 'London', kind: 'airport' };
  assert.equal(suggestionKindLabel(lower), '', 'the check is case-insensitive');
  assert.equal(suggestionKindLabel({ name: 'London', value: 'London', kind: 'city', iata: 'LON' }), 'City');
  assert.equal(suggestionKindLabel({ name: 'Central Europe', value: 'Central Europe', kind: 'region' }), 'Region');
  assert.equal(suggestionMeta({ name: 'Paris Orly Airport', value: 'Paris', kind: 'airport', iata: 'ORY' }), '(ORY)', 'kind word dropped, no country, IATA stands alone');
});

test('normalizePlaceQuery: trims, collapses spaces, caps length, non-string is empty', () => {
  assert.equal(normalizePlaceQuery('  New   York  '), 'New York');
  assert.equal(normalizePlaceQuery('lon'), 'lon');
  assert.equal(normalizePlaceQuery('x'.repeat(200)).length, 80);
  assert.equal(normalizePlaceQuery(null), '');
  assert.equal(normalizePlaceQuery(42), '');
});

test('searchPlaces: Travelpayouts path maps cities and airports, IATA only when provided', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.ok(String(url).startsWith('https://autocomplete.travelpayouts.com/places2'), 'Travelpayouts first');
    assert.ok(String(url).includes('term=lon'), 'query is passed as term');
    return { ok: true, json: async () => cannedTravelpayouts };
  };
  const r = await searchPlaces('lon', fetchImpl);
  assert.equal(r.source, 'travelpayouts');
  assert.equal(calls, 1, 'one upstream call');
  const london = r.places.find((p) => p.name === 'London');
  assert.deepEqual(london, { name: 'London', value: 'London', kind: 'city', country: 'United Kingdom', iata: 'LON' });
  const heathrow = r.places.find((p) => p.name === 'London Heathrow Airport');
  // An airport fills the field with the CITY it serves, so the search
  // still resolves exactly as a typed city today.
  assert.equal(heathrow?.value, 'London');
  assert.equal(heathrow?.kind, 'airport');
  assert.equal(heathrow?.iata, 'LHR');
  const cityAirport = r.places.find((p) => p.name === 'London City Airport');
  assert.equal(cityAirport?.value, 'London City Airport', 'no city_name falls back to the airport name');
  const noCode = r.places.find((p) => p.name === 'Londonderry');
  assert.equal(noCode?.iata, undefined, 'a city with no code gets no invented IATA');
});

test('searchPlaces: Travelpayouts empty falls through to Nominatim, cities only, no IATA', async () => {
  const seen = [];
  let nominatimHeaders = null;
  const fetchImpl = async (url, init) => {
    seen.push(String(url));
    if (String(url).includes('autocomplete.travelpayouts.com')) return { ok: true, json: async () => [] };
    if (String(url).includes('nominatim.openstreetmap.org')) {
      nominatimHeaders = init?.headers ?? null;
      assert.ok(String(url).includes('featuretype=city'), 'Nominatim is asked for cities only');
      return { ok: true, json: async () => cannedNominatim };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const r = await searchPlaces('prag', fetchImpl);
  assert.equal(r.source, 'nominatim');
  assert.ok(
    typeof nominatimHeaders?.['User-Agent'] === 'string' && nominatimHeaders['User-Agent'].includes('FujinTrip'),
    'Nominatim gets an identifying User-Agent header'
  );
  assert.deepEqual(
    r.places.map((p) => p.name),
    ['Prague', 'Praha'],
    'the street-class result is filtered out'
  );
  assert.equal(r.places[0]?.country, 'Czechia');
  assert.equal(r.places[0]?.iata, undefined, 'Nominatim provides no IATA — none attached');
  assert.equal(r.places[1]?.country, undefined);
  assert.ok(seen.some((u) => u.includes('nominatim.openstreetmap.org')), 'Nominatim was consulted');
});

test('searchPlaces: both live sources empty falls back to the known list; junk is an honest empty', async () => {
  const fetchImpl = okJson([]);
  const central = await searchPlaces('Central Europe', fetchImpl);
  assert.equal(central.source, 'known');
  assert.ok(central.places.some((p) => p.name === 'Central Europe' && p.kind === 'region'), 'route names suggest as regions');
  const prague = await searchPlaces('Prag', fetchImpl);
  assert.equal(prague.source, 'known');
  const praguePlace = prague.places.find((p) => p.name === 'Prague');
  assert.equal(praguePlace?.kind, 'city');
  assert.equal(praguePlace?.iata, 'PRG', 'known-list IATA comes from CITY_IATA, never guessed');
  const junk = await searchPlaces('Zzzqxwv', fetchImpl);
  assert.deepEqual(junk.places, []);
  assert.equal(junk.source, 'none');
  assert.equal(junk.reason, 'no-matches');
});

test('searchPlaces: short query never fetches; upstream failure still falls back', async () => {
  let calls = 0;
  const counting = async () => {
    calls += 1;
    return { ok: true, json: async () => [] };
  };
  const short = await searchPlaces('a', counting);
  assert.deepEqual(short.places, []);
  assert.equal(short.reason, 'type-more');
  assert.equal(calls, 0, 'no upstream call for one letter');
  const empty = await searchPlaces('', counting);
  assert.equal(empty.reason, 'type-more');
  assert.equal(calls, 0);

  const failing = async () => {
    throw new Error('network down');
  };
  const fallback = await searchPlaces('Prague', failing);
  assert.equal(fallback.source, 'known', 'both live sources throwing still reaches the known list');
  assert.ok(fallback.places.some((p) => p.name === 'Prague'));
});

test('searchPlaces: Travelpayouts 500 falls through; results are cached', async () => {
  let tpCalls = 0;
  let osmCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('autocomplete.travelpayouts.com')) {
      tpCalls += 1;
      return { ok: false, json: async () => ({}) };
    }
    osmCalls += 1;
    return { ok: true, json: async () => cannedNominatim };
  };
  const first = await searchPlaces('prag', fetchImpl);
  assert.equal(first.source, 'nominatim', 'a 500 from Travelpayouts falls through');
  const second = await searchPlaces('prag', fetchImpl);
  assert.equal(second.source, 'nominatim');
  assert.equal(tpCalls, 1, 'second identical query is served from cache');
  assert.equal(osmCalls, 1);
});

test('searchPlaces: Nominatim is throttled to 1 req/s', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('autocomplete.travelpayouts.com')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => cannedNominatim };
  };
  const start = Date.now();
  await searchPlaces('prag', fetchImpl);
  // A different query, so the server cache does not answer — the second
  // Nominatim call must wait out the 1s gap since the first.
  await searchPlaces('praha', fetchImpl);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 1000, `second Nominatim call waited out the 1s gap, elapsed ${elapsed}ms`);
});

test('fetchPlaceSuggestions: reads /api/places, caches, fails empty', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.ok(String(url).startsWith('/api/places?q='), 'client asks our own endpoint');
    return { ok: true, json: async () => ({ places: [{ name: 'London', value: 'London', kind: 'city', iata: 'LON' }], source: 'travelpayouts' }) };
  };
  const first = await fetchPlaceSuggestions('lon', fetchImpl);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.name, 'London');
  const second = await fetchPlaceSuggestions('lon', fetchImpl);
  assert.equal(calls, 1, 're-typing the same prefix does not re-fetch');
  assert.deepEqual(second, first);

  const failing = async () => {
    throw new Error('offline');
  };
  assert.deepEqual(await fetchPlaceSuggestions('par', failing), [], 'a failed fetch is an empty list');
  const bad = async () => ({ ok: false, json: async () => ({}) });
  assert.deepEqual(await fetchPlaceSuggestions('rom', bad), [], 'a non-200 is an empty list');
  assert.deepEqual(await fetchPlaceSuggestions('x', fetchImpl), [], 'one letter never fetches');
  assert.equal(calls, 1, 'short query added no call');
});

test('autocompleteKeyDown: arrows cycle, Enter selects, Escape closes, other keys are no-ops', () => {
  const closed = { open: false, active: -1 };
  const down = autocompleteKeyDown(closed, 'ArrowDown', 3);
  assert.deepEqual(down.state, { open: true, active: 0 });
  assert.equal(down.selected, null);
  const down2 = autocompleteKeyDown(down.state, 'ArrowDown', 3);
  assert.equal(down2.state.active, 1);
  const wrap = autocompleteKeyDown({ open: true, active: 2 }, 'ArrowDown', 3);
  assert.equal(wrap.state.active, 0, 'ArrowDown cycles past the last suggestion');
  const up = autocompleteKeyDown(closed, 'ArrowUp', 3);
  assert.equal(up.state.active, 2, 'ArrowUp from nothing lands on the last suggestion');
  const upWrap = autocompleteKeyDown({ open: true, active: 0 }, 'ArrowUp', 3);
  assert.equal(upWrap.state.active, 2, 'ArrowUp cycles past the first suggestion');
  const enter = autocompleteKeyDown({ open: true, active: 1 }, 'Enter', 3);
  assert.equal(enter.selected, 1, 'Enter selects the highlighted suggestion');
  assert.deepEqual(enter.state, { open: false, active: -1 });
  const enterNone = autocompleteKeyDown({ open: true, active: -1 }, 'Enter', 3);
  assert.equal(enterNone.selected, null, 'Enter with nothing highlighted selects nothing');
  const esc = autocompleteKeyDown({ open: true, active: 1 }, 'Escape', 3);
  assert.deepEqual(esc.state, { open: false, active: -1 });
  assert.equal(esc.selected, null);
  const other = autocompleteKeyDown({ open: true, active: 1 }, 'a', 3);
  assert.deepEqual(other.state, { open: true, active: 1 }, 'typing a letter does not move the highlight');
  assert.equal(other.selected, null);
  const empty = autocompleteKeyDown(closed, 'ArrowDown', 0);
  assert.deepEqual(empty.state, closed, 'no suggestions, no highlight');
});

test('searchPlaces: an empty result is never cached — the next try re-fetches', async () => {
  // Audit round (Nov 17, 2026 — gap 12): both live sources failing
  // once used to cache the empty list for 10 minutes, so the place
  // stayed unfindable after the sources recovered.
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls <= 2) throw new Error('transient outage');
    if (String(url).includes('autocomplete.travelpayouts.com')) return { ok: true, json: async () => cannedTravelpayouts };
    return { ok: true, json: async () => [] };
  };
  const first = await searchPlaces('Zzzqxwv', fetchImpl);
  assert.deepEqual(first.places, [], 'first try finds nothing anywhere');
  assert.equal(first.reason, 'no-matches');
  const second = await searchPlaces('Zzzqxwv', fetchImpl);
  assert.equal(second.source, 'travelpayouts', 'the second try re-fetches instead of serving the cached empty list');
  assert.ok(second.places.some((p) => p.name === 'London'), 'the recovered source answers');
  assert.ok(calls > 2, 'the second query actually called upstream');
});

test('fetchPlaceSuggestions: an empty result is never cached client-side', async () => {
  // Same defect, client side: a failed fetch cached [] for the
  // session, so re-typing the place kept returning nothing while
  // other places worked.
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('network down');
    return { ok: true, json: async () => ({ places: [{ name: 'New York', value: 'New York', kind: 'city', country: 'United States', iata: 'NYC' }] }) };
  };
  const first = await fetchPlaceSuggestions('New York', fetchImpl);
  assert.deepEqual(first, [], 'the failed fetch is an honest empty list');
  const second = await fetchPlaceSuggestions('New York', fetchImpl);
  assert.equal(second.length, 1, 're-typing re-fetches instead of serving the cached empty list');
  assert.equal(second[0].name, 'New York');
  assert.equal(calls, 2, 'the second query actually called /api/places');
});

test('fetchPlaceSuggestions: a hung request times out instead of hanging the listbox', () => {
  const src = readFileSync(new URL('../lib/places.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('CLIENT_FETCH_TIMEOUT_MS = 8000'), 'the client fetch times out after 8s');
  assert.ok(src.includes('signal: controller.signal'), 'the timeout aborts the request');
  assert.ok(src.includes('if (places.length > 0) {'), 'only non-empty results reach the client cache');
});
