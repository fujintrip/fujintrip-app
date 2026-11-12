// Travelpayouts cached comparison (user chose Nov 12, 2026) — unit
// tests for the data layer. No live network: fetch is stubbed with a
// canned prices_for_dates reply in the shape the official Aviasales
// Data API docs show. Run: node --no-warnings --import
// ./tests/register-loader.mjs --test tests/travelpayouts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __clearCompetitorCache,
  cachedLabel,
  fetchCompetitorFares,
  isoDate,
  resolveTripAirports,
} from '../lib/travelpayouts.ts';

const TODAY = new Date().toISOString().slice(0, 10);
const TEST_TOKEN = 'test-token-not-a-real-key';

// A canned prices_for_dates reply (official response shape: success +
// data[] with price, airline, flight_number, departure_at, return_at,
// transfers, return_transfers, duration, link, currency). The cheapest
// fare is deliberately second, so the min-pick is actually tested.
const cannedRoundTrip = {
  success: true,
  data: [
    {
      origin: 'JFK',
      destination: 'PRG',
      origin_airport: 'JFK',
      destination_airport: 'PRG',
      price: 310,
      airline: 'LH',
      flight_number: '401',
      departure_at: '2027-01-04T15:30:00+01:00',
      return_at: '2027-01-17T11:05:00+01:00',
      transfers: 1,
      return_transfers: 0,
      duration: 690,
      link: '/search/JFK0401PRG17011',
      currency: 'usd',
    },
    {
      origin: 'JFK',
      destination: 'PRG',
      origin_airport: 'JFK',
      destination_airport: 'PRG',
      price: 250,
      airline: 'AA',
      flight_number: '142',
      departure_at: '2027-01-04T18:00:00+01:00',
      return_at: '2027-01-17T09:20:00+01:00',
      transfers: 0,
      return_transfers: 0,
      duration: 480,
      link: '/search/JFK0401PRG17012',
      currency: 'usd',
    },
  ],
};

const realFetch = globalThis.fetch;
const realToken = process.env.TRAVELPAYOUTS_TOKEN;

function stubFetch(handler) {
  globalThis.fetch = handler;
}
function restore() {
  globalThis.fetch = realFetch;
  __clearCompetitorCache();
  if (realToken === undefined) delete process.env.TRAVELPAYOUTS_TOKEN;
  else process.env.TRAVELPAYOUTS_TOKEN = realToken;
}

test('label: every fare carries its check date and says cached, never live', () => {
  const label = cachedLabel('2026-11-12');
  assert.ok(label.includes('2026-11-12'), 'check date is in the label');
  assert.ok(/cached/i.test(label), 'label says cached');
  assert.ok(/indicative/i.test(label), 'label says indicative');
  assert.ok(/not a live quote/i.test(label), 'label says not a live quote');
  assert.ok(/48 hours/i.test(label), 'label says where the fare came from');
});

test('isoDate: Date (local parts), valid string, garbage', () => {
  assert.equal(isoDate(new Date(2027, 0, 4)), '2027-01-04');
  assert.equal(isoDate('2027-01-17'), '2027-01-17');
  assert.equal(isoDate('Jan 4'), '');
  assert.equal(isoDate(''), '');
});

test('resolveTripAirports: route → first city, city → itself, unknown → null', () => {
  // Central Europe starts in Prague — the same fare destination the
  // Duffel live fares use.
  assert.deepEqual(resolveTripAirports('New York', 'Central Europe'), {
    originIata: 'JFK',
    destIata: 'PRG',
    destCity: 'Prague',
  });
  assert.deepEqual(resolveTripAirports('New York', 'Kyoto'), {
    originIata: 'JFK',
    destIata: 'KIX',
    destCity: 'Kyoto',
  });
  assert.deepEqual(resolveTripAirports('Zanzibar', 'Central Europe'), {
    originIata: null,
    destIata: 'PRG',
    destCity: 'Prague',
  });
  assert.deepEqual(resolveTripAirports('New York', 'Zanzibar'), {
    originIata: 'JFK',
    destIata: null,
    destCity: 'Zanzibar',
  });
});

test('no token: not configured, available false, fetch never called', async () => {
  delete process.env.TRAVELPAYOUTS_TOKEN;
  __clearCompetitorCache();
  let called = 0;
  stubFetch(async () => {
    called += 1;
    throw new Error('fetch must not be called without a token');
  });
  try {
    const r = await fetchCompetitorFares({
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(r.configured, false);
    assert.equal(r.available, false);
    assert.equal(r.reason, 'not-configured');
    assert.equal(r.farePerTraveler, null);
    assert.equal(r.total, null);
    assert.ok(r.label.includes('not connected'), 'label says the token is missing');
    assert.equal(called, 0);
  } finally {
    restore();
  }
});

test('token + cached round trip: cheapest fare, per-traveler × travelers, dated label', async () => {
  process.env.TRAVELPAYOUTS_TOKEN = TEST_TOKEN;
  __clearCompetitorCache();
  const calls = [];
  stubFetch(async (url, opts) => {
    calls.push({ url: String(url), headers: opts?.headers });
    return { ok: true, status: 200, json: async () => cannedRoundTrip };
  });
  try {
    const r = await fetchCompetitorFares({
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(calls.length, 1, 'one API call');
    const url = calls[0].url;
    assert.ok(url.includes('prices_for_dates'), 'hits the v3 endpoint');
    assert.ok(url.includes('origin=JFK') && url.includes('destination=PRG'), 'IATA codes, not city names');
    assert.ok(url.includes('departure_at=2027-01-04'), 'exact trip start date');
    assert.ok(url.includes('return_at=2027-01-17'), 'exact trip end date');
    assert.ok(url.includes('one_way=false'), 'round-trip offers, not one-way');
    assert.equal(calls[0].headers?.['X-Access-Token'], TEST_TOKEN, 'token goes in the header, never the URL');
    assert.ok(!url.includes(TEST_TOKEN), 'token is not in the query string');
    assert.equal(r.available, true);
    assert.equal(r.configured, true);
    assert.equal(r.farePerTraveler, 250, 'cheapest round-trip fare per traveler');
    assert.equal(r.total, 500, 'fare × travelers');
    assert.equal(r.currency, 'usd');
    assert.equal(r.airline, 'AA');
    assert.equal(r.stops, 0);
    assert.equal(r.returnStops, 0);
    assert.equal(r.checkedAt, TODAY);
    assert.ok(r.label.includes(TODAY), 'label carries the check date');
    assert.ok(/not a live quote/i.test(r.label), 'label says not a live quote');
  } finally {
    restore();
  }
});

test('unknown city: no airport code, no lookup, honest empty', async () => {
  process.env.TRAVELPAYOUTS_TOKEN = TEST_TOKEN;
  __clearCompetitorCache();
  let called = 0;
  stubFetch(async () => {
    called += 1;
    return { ok: true, status: 200, json: async () => cannedRoundTrip };
  });
  try {
    const r = await fetchCompetitorFares({
      origin: 'Zanzibar',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(r.available, false);
    assert.equal(r.reason, 'no-airport-code');
    assert.ok(r.label.includes('Zanzibar'), 'label names the city without a code');
    assert.ok(/never guessed/i.test(r.label), 'label says codes are never guessed');
    assert.equal(called, 0, 'no API call for a city with no code');
  } finally {
    restore();
  }
});

test('API error: lookup failed, no prices, not cached as a result', async () => {
  process.env.TRAVELPAYOUTS_TOKEN = TEST_TOKEN;
  __clearCompetitorCache();
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return { ok: false, status: 500, json: async () => ({ success: false, data: {}, error: 'boom' }) };
  });
  try {
    const r = await fetchCompetitorFares({
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(r.available, false);
    assert.equal(r.reason, 'lookup-failed');
    assert.equal(r.total, null);
    assert.ok(r.label.includes('500'), 'label carries the failure, not a fake fare');
    // A failed lookup is not cached — the next check tries again.
    const r2 = await fetchCompetitorFares({
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(r2.available, false);
    assert.equal(calls, 2, 'failure was retried, not served from cache');
  } finally {
    restore();
  }
});

test('empty cache: no fare for those dates, honest empty, no invented price', async () => {
  process.env.TRAVELPAYOUTS_TOKEN = TEST_TOKEN;
  __clearCompetitorCache();
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) }));
  try {
    const r = await fetchCompetitorFares({
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(r.available, false);
    assert.equal(r.reason, 'no-cached-fare');
    assert.equal(r.total, null);
    assert.ok(r.label.includes('2027-01-04'), 'label names the dates with no fare');
    assert.ok(/Nothing invented/i.test(r.label), 'label says nothing was invented');
  } finally {
    restore();
  }
});

test('server cache: the same trip re-checks from memory, not the API', async () => {
  process.env.TRAVELPAYOUTS_TOKEN = TEST_TOKEN;
  __clearCompetitorCache();
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => cannedRoundTrip };
  });
  try {
    const trip = {
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
    };
    const first = await fetchCompetitorFares(trip);
    const second = await fetchCompetitorFares(trip);
    assert.equal(first.total, 500);
    assert.deepEqual(second, first, 'second check is the cached result');
    assert.equal(calls, 1, 'one API call for two identical checks');
  } finally {
    restore();
  }
});

test('missing dates: no lookup, honest empty', async () => {
  process.env.TRAVELPAYOUTS_TOKEN = TEST_TOKEN;
  __clearCompetitorCache();
  let called = 0;
  stubFetch(async () => {
    called += 1;
    return { ok: true, status: 200, json: async () => cannedRoundTrip };
  });
  try {
    const r = await fetchCompetitorFares({
      origin: 'New York',
      destination: 'Central Europe',
      departDate: '',
      returnDate: '2027-01-17',
      travelers: 2,
    });
    assert.equal(r.available, false);
    assert.equal(r.total, null);
    assert.equal(called, 0);
  } finally {
    restore();
  }
});
