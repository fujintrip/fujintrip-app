// All-routes live fares (Nov 25, 2026): the place picker's IATA
// code flows through to the fare APIs, and the city map covers every
// flyable city in Travelpayouts' data — no more 'no airport code'
// for any real city a client picks. Metro codes (NYC, LON, PAR) are
// accepted by Duffel, Ignav, LetsFG and Travelpayouts for fare
// search (verified against their docs Nov 25, 2026), so a passed
// code goes straight through — no metro→airport mapping anywhere.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/all-routes-airport-codes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORT_CODES } from '../lib/airportCodes.generated.ts';
import { airportCodeForCity, normalizeCityName, resolveAirportCode } from '../lib/airportCodes.ts';
import { CITY_IATA, cleanIataCode, fetchLiveFares, fetchOneWayFares } from '../lib/duffel.ts';
import { cleanFlightLeg, emptySearchQuery, flightContextFromSearch, flightLegsFromSearch, searchQueryToParams } from '../lib/searchPlaces.ts';
import { resolveTripAirports } from '../lib/travelpayouts.ts';

// --- Fetch + env stubbing (restored after every test). ---
const realFetch = globalThis.fetch;
const realKey = process.env.DUFFEL_API_KEY;
function stubFetch(handler) {
  globalThis.fetch = handler;
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}
function setTestKey() {
  process.env.DUFFEL_API_KEY = 'test_dummy_key_for_all_routes_tests';
}
function restoreKey() {
  if (realKey === undefined) delete process.env.DUFFEL_API_KEY;
  else process.env.DUFFEL_API_KEY = realKey;
}

test('cleanIataCode: trims, uppercases, rejects junk', () => {
  assert.equal(cleanIataCode('jfk'), 'JFK');
  assert.equal(cleanIataCode(' JFK '), 'JFK');
  assert.equal(cleanIataCode('NYC'), 'NYC');
  assert.equal(cleanIataCode('JK'), null);
  assert.equal(cleanIataCode('JFK1'), null);
  assert.equal(cleanIataCode(''), null);
  assert.equal(cleanIataCode(null), null);
  assert.equal(cleanIataCode(123), null);
});

test('resolveAirportCode: a passed picker code wins over the map', () => {
  // The picker said metro LON for London; the hand map says LHR.
  // The source-provided code wins — every supplier accepts metro
  // codes, so no airport resolution is needed.
  assert.equal(resolveAirportCode('London', 'LON'), 'LON');
  assert.equal(resolveAirportCode('New York', 'NYC'), 'NYC');
  assert.equal(resolveAirportCode('Paris', 'PAR'), 'PAR');
});

test('resolveAirportCode: junk passed codes fall back to the map', () => {
  assert.equal(resolveAirportCode('London', 'xx'), 'LHR');
  assert.equal(resolveAirportCode('London', ''), 'LHR');
  assert.equal(resolveAirportCode('London', undefined), 'LHR');
  assert.equal(resolveAirportCode('Seoul', 'xx'), 'SEL');
  assert.equal(resolveAirportCode('Seoul'), 'SEL');
});

test('airportCodeForCity: the hand map wins over the generated map', () => {
  // Existing entries stay untouched — London is LHR, never LON.
  assert.equal(airportCodeForCity('London'), 'LHR');
  assert.equal(airportCodeForCity('New York'), 'JFK');
  assert.equal(airportCodeForCity('Paris'), 'CDG');
  assert.equal(airportCodeForCity('Tokyo'), 'HND');
  // Barcelona is ambiguous in the dataset (Spain + Venezuela), so
  // the generated map skips it — the hand map still covers it.
  assert.equal(airportCodeForCity('Barcelona'), 'BCN');
  // Rome is the one city where hand and generated disagree: the hand
  // map's airport code FCO beats the dataset's metro code ROM.
  assert.equal(airportCodeForCity('Rome'), 'FCO');
});

test('airportCodeForCity: generated cities resolve (dataset spot-checks)', () => {
  const pairs = [
    ['Seoul', 'SEL'],
    ['Toronto', 'YTO'],
    ['Mumbai', 'BOM'],
    ['Auckland', 'AKL'],
    ['Cape Town', 'CPT'],
    ['Rio de Janeiro', 'RIO'],
    ['Dubai', 'DXB'],
    ['Singapore', 'SIN'],
    ['Hong Kong', 'HKG'],
    ['Moscow', 'MOW'],
    ['Bogota', 'BOG'],
    ['Nairobi', 'NBO'],
    ['Reykjavik', 'REK'],
    ['Oslo', 'OSL'],
    ['Stockholm', 'STO'],
    ['Helsinki', 'HEL'],
    ['Dublin', 'DUB'],
    ['Zurich', 'ZRH'],
    ['Geneva', 'GVA'],
    ['Vienna', 'VIE'],
    ['Prague', 'PRG'],
    ['Warsaw', 'WAW'],
    ['Budapest', 'BUD'],
    ['Athens', 'ATH'],
    ['Lisbon', 'LIS'],
    ['Madrid', 'MAD'],
    ['Milan', 'MIL'],
    ['Berlin', 'BER'],
    ['Munich', 'MUC'],
    ['Frankfurt', 'FRA'],
    ['Amsterdam', 'AMS'],
    ['Brussels', 'BRU'],
    ['Copenhagen', 'CPH'],
    ['Sao Paulo', 'SAO'],
    ['Kunming', 'KMG'],
    ['Chiayi', 'CYI'],
  ];
  for (const [city, code] of pairs) {
    assert.equal(airportCodeForCity(city), code, `${city} should resolve to ${code}`);
  }
});

test('airportCodeForCity: normalization (case, accents, spaces)', () => {
  assert.equal(normalizeCityName('São Paulo'), 'sao paulo');
  assert.equal(airportCodeForCity('sao paulo'), 'SAO');
  assert.equal(airportCodeForCity('São Paulo'), 'SAO');
  assert.equal(airportCodeForCity('  SEOUL  '), 'SEL');
  assert.equal(airportCodeForCity('sEoUl'), 'SEL');
  assert.equal(airportCodeForCity('rio de janeiro'), 'RIO');
});

test('airportCodeForCity: ambiguous and airport-less places stay null', () => {
  // One name, several cities — never guess which one.
  // (Sydney is the sharpest case: Sydney, Australia SYD vs Sydney,
  // Canada YQY. The picker still covers it — the traveler picks a
  // country and the code rides through.)
  for (const name of ['San Jose', 'Lima', 'Kochi', 'Columbus', 'Charleston', 'Sydney']) {
    assert.equal(airportCodeForCity(name), null, `${name} is ambiguous and must not resolve`);
  }
  // A region name, an invented place, and blanks have no airport.
  assert.equal(airportCodeForCity('Central Europe'), null);
  assert.equal(airportCodeForCity('Atlantis'), null);
  assert.equal(airportCodeForCity(''), null);
  assert.equal(airportCodeForCity('   '), null);
});

test('AIRPORT_CODES: generated dataset shape', () => {
  const keys = Object.keys(AIRPORT_CODES);
  assert.ok(keys.length >= 3000, `expected 3000+ generated cities, got ${keys.length}`);
  for (const [name, code] of Object.entries(AIRPORT_CODES)) {
    assert.match(code, /^[A-Z]{3}$/, `${name} has a clean code`);
    assert.ok(!(name in CITY_IATA), `${name} is already in the hand map and must not be regenerated`);
  }
  // Ambiguous names were skipped at generation time.
  for (const name of ['San Jose', 'Lima', 'Kochi', 'Columbus']) {
    assert.ok(!(name in AIRPORT_CODES), `${name} is ambiguous and must be absent`);
  }
  // Hand-map names were skipped too.
  for (const name of ['London', 'Paris', 'Tokyo', 'Barcelona']) {
    assert.ok(!(name in AIRPORT_CODES), `${name} is in the hand map and must be absent`);
  }
});

test('cleanFlightLeg keeps picker codes, drops junk', () => {
  const leg = cleanFlightLeg({ from: 'Seoul', to: 'Tokyo', depart: '2027-03-01', fromIata: 'SEL', toIata: 'TYO' });
  assert.equal(leg?.fromIata, 'SEL');
  assert.equal(leg?.toIata, 'TYO');
  const junk = cleanFlightLeg({ from: 'Seoul', to: 'Tokyo', depart: '2027-03-01', fromIata: 'xx', toIata: '' });
  assert.equal(junk?.fromIata, undefined);
  assert.equal(junk?.toIata, undefined);
});

test('flightContextFromSearch carries picker codes; drops junk', () => {
  const q = emptySearchQuery('flights');
  q.from = 'Seoul';
  q.to = 'Sydney';
  q.fromIata = 'SEL';
  q.toIata = 'SYD';
  q.depart = '2027-03-01';
  q.ret = '2027-03-15';
  const ctx = flightContextFromSearch(q);
  assert.equal(ctx.originIata, 'SEL');
  assert.equal(ctx.destIata, 'SYD');
  const junk = emptySearchQuery('flights');
  junk.from = 'Seoul';
  junk.to = 'Sydney';
  junk.fromIata = 'xx';
  junk.depart = '2027-03-01';
  junk.ret = '2027-03-15';
  assert.equal(flightContextFromSearch(junk).originIata, undefined);
});

test('flightLegsFromSearch preserves leg codes', () => {
  const q = emptySearchQuery('flights');
  q.tripType = 'multicity';
  q.legs = [
    { from: 'Seoul', to: 'Tokyo', depart: '2027-03-01', fromIata: 'SEL', toIata: 'TYO' },
    { from: 'Tokyo', to: 'Sydney', depart: '2027-03-08', fromIata: 'TYO', toIata: 'SYD' },
  ];
  const legs = flightLegsFromSearch(q);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].fromIata, 'SEL');
  assert.equal(legs[0].toIata, 'TYO');
  assert.equal(legs[1].fromIata, 'TYO');
  assert.equal(legs[1].toIata, 'SYD');
});

test('searchQueryToParams never writes codes into the URL', () => {
  const q = emptySearchQuery('flights');
  q.from = 'Seoul';
  q.to = 'Sydney';
  q.fromIata = 'SEL';
  q.toIata = 'SYD';
  q.legs = [{ from: 'Seoul', to: 'Tokyo', depart: '2027-03-01', fromIata: 'SEL', toIata: 'TYO' }];
  q.tripType = 'multicity';
  const params = searchQueryToParams(q);
  assert.ok(!params.includes('Iata'), `codes must stay out of the URL: ${params}`);
  assert.ok(params.includes('from=Seoul'), 'names still travel in the URL');
});

test('resolveTripAirports prefers passed codes, falls back to the map', () => {
  const passed = resolveTripAirports('New York', 'Kyoto', 'NYC', 'KIX');
  assert.equal(passed.originIata, 'NYC');
  assert.equal(passed.destIata, 'KIX');
  const junk = resolveTripAirports('New York', 'Kyoto', 'xx', undefined);
  assert.equal(junk.originIata, 'JFK');
  assert.equal(junk.destIata, 'KIX');
  const route = resolveTripAirports('New York', 'Central Europe');
  assert.equal(route.destCity, 'Prague');
  assert.equal(route.destIata, 'PRG');
  const missing = resolveTripAirports('Atlantis', 'Kyoto');
  assert.equal(missing.originIata, null);
  assert.equal(missing.destIata, 'KIX');
});

test('fetchLiveFares sends the passed metro code to Duffel', async () => {
  setTestKey();
  const seen = [];
  stubFetch(async (_url, init) => {
    seen.push(JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, json: async () => ({ data: { offers: [] } }) };
  });
  try {
    // Seoul is not in the hand map — without the passed code this
    // would be an honest 'no_airport_code'. With SEL it searches.
    const res = await fetchLiveFares({
      origin: 'Seoul',
      destCity: 'Tokyo',
      departDate: '2027-03-01',
      returnDate: '2027-03-15',
      travelers: 2,
      originIata: 'SEL',
    });
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_offers', 'the search ran — no offers, not no code');
    assert.equal(seen.length, 2, 'outbound + return Offer Requests');
    assert.equal(seen[0].data.slices[0].origin, 'SEL', 'metro code goes to Duffel as-is');
    assert.equal(seen[0].data.slices[0].destination, 'HND', 'hand map still resolves Tokyo');
    assert.equal(seen[1].data.slices[0].origin, 'HND');
    assert.equal(seen[1].data.slices[0].destination, 'SEL');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('fetchLiveFares without a code for an unmapped city stays honest', async () => {
  setTestKey();
  let calls = 0;
  stubFetch(async () => {
    calls++;
    return { ok: true, json: async () => ({ data: { offers: [] } }) };
  });
  try {
    // The generated map is applied by the server-side resolver in
    // the API routes — this function only knows the hand map, so a
    // name-only call for Seoul still reports honestly here.
    const res = await fetchLiveFares({
      origin: 'Seoul',
      destCity: 'Tokyo',
      departDate: '2027-03-02',
      returnDate: '2027-03-16',
      travelers: 2,
    });
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_airport_code');
    assert.equal(calls, 0, 'no Duffel call without a code');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('fetchOneWayFares sends the passed codes to Duffel', async () => {
  setTestKey();
  const seen = [];
  stubFetch(async (_url, init) => {
    seen.push(JSON.parse(String(init?.body ?? '{}')));
    return { ok: true, json: async () => ({ data: { offers: [] } }) };
  });
  try {
    const res = await fetchOneWayFares({
      origin: 'Auckland',
      destCity: 'Sydney',
      departDate: '2027-04-01',
      travelers: 2,
      originIata: 'AKL',
      destIata: 'SYD',
    });
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_offers');
    assert.equal(seen.length, 1, 'one-way is a single Offer Request');
    assert.equal(seen[0].data.slices[0].origin, 'AKL');
    assert.equal(seen[0].data.slices[0].destination, 'SYD');
  } finally {
    restoreFetch();
    restoreKey();
  }
});
