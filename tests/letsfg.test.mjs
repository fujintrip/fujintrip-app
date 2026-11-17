// LetsFG live fares (Nov 16, 2026): the second live comparison column.
// The sample payloads below are built from LetsFG's own OpenAPI spec
// (read live Nov 16, 2026) and from REAL sandbox responses
// (POST /sandbox/flights/search, JFK→LHR Jan 15–22 2027 — no key
// needed). Sandbox prices are FAKE test data: they pin the mapping
// only, never a market price, and are never compared with live fares.
// The async start + poll flow, the cache, and the honest empty states
// are all pinned here; live fares are verified after Deploy.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/letsfg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cheapestLetsfgItinerary,
  clearLetsfgCache,
  letsfgCabinClass,
  letsfgEmptyMessage,
  letsfgFreshnessLabel,
  letsfgItineraryDuration,
  letsfgItineraryFromOffer,
  letsfgItineraryMatches,
  letsfgItineraryStops,
  letsfgSourceTag,
  parseLetsfgPollResponse,
  parseLetsfgStartResponse,
  searchLetsfgFares,
  sortLetsfgItineraries,
} from '../lib/letsfg.ts';

// --- Fetch + env stubbing (restored after every test). ---
const realFetch = globalThis.fetch;
const realKey = process.env.LETSFG_API_KEY;

function stubFetch(handler) {
  globalThis.fetch = handler;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function setKey() {
  process.env.LETSFG_API_KEY = 'test-key-123';
}

function restoreKey() {
  if (realKey === undefined) delete process.env.LETSFG_API_KEY;
  else process.env.LETSFG_API_KEY = realKey;
}

function okJson(json) {
  return { ok: true, status: 200, json: async () => json };
}

function errJson(status) {
  return { ok: false, status, json: async () => ({}) };
}

// One segment, shaped exactly like the sandbox returns it.
function seg({ code, name, num, from, to, dep, arr, secs, aircraft = 'E195' }) {
  return {
    airline: code,
    airline_name: name,
    flight_no: num,
    origin: from,
    destination: to,
    origin_city: from,
    destination_city: to,
    departure: dep,
    arrival: arr,
    duration_seconds: secs,
    cabin_class: 'economy',
    aircraft,
  };
}

// Round-trip JFK → LHR, Jan 15–22 2027, 1 traveler — the IB offer
// from the real sandbox response (price $158 per passenger, fake
// test data — a mapping fixture only).
const RT_OFFER_IB = {
  id: 'sb_JFK_LHR_0004_4f6a10ba',
  price: 158.0,
  currency: 'USD',
  price_formatted: '158.00 USD',
  outbound: {
    segments: [
      seg({
        code: 'IB',
        name: 'Iberia',
        num: 'IB9225',
        from: 'JFK',
        to: 'LHR',
        dep: '2027-01-15T13:45:00',
        arr: '2027-01-15T17:24:00',
        secs: 13140,
      }),
    ],
    total_duration_seconds: 13140,
    stopovers: 0,
  },
  inbound: {
    segments: [
      seg({
        code: 'IB',
        name: 'Iberia',
        num: 'IB7730',
        from: 'LHR',
        to: 'JFK',
        dep: '2027-01-22T15:45:00',
        arr: '2027-01-22T17:56:00',
        secs: 7860,
        aircraft: 'A320',
      }),
    ],
    total_duration_seconds: 7860,
    stopovers: 0,
  },
  airlines: ['IB'],
  owner_airline: 'IB',
  booking_url: 'https://letsfg.co/sandbox-booking?offer=sb_JFK_LHR_0004_4f6a10ba',
  fetched_at: '2026-11-17T00:12:27.060147',
};

// The AZ offer from the same sandbox response ($191, fake test data).
const RT_OFFER_AZ = {
  id: 'sb_JFK_LHR_0002_61f1c6d2',
  price: 191.0,
  currency: 'USD',
  outbound: {
    segments: [
      seg({
        code: 'AZ',
        name: 'ITA Airways',
        num: 'AZ251',
        from: 'JFK',
        to: 'LHR',
        dep: '2027-01-15T21:15:00',
        arr: '2027-01-15T22:40:00',
        secs: 5100,
        aircraft: '737-900',
      }),
    ],
    total_duration_seconds: 5100,
    stopovers: 0,
  },
  inbound: {
    segments: [
      seg({
        code: 'AZ',
        name: 'ITA Airways',
        num: 'AZ9395',
        from: 'LHR',
        to: 'JFK',
        dep: '2027-01-22T09:30:00',
        arr: '2027-01-22T12:45:00',
        secs: 11700,
        aircraft: 'A321neo',
      }),
    ],
    total_duration_seconds: 11700,
    stopovers: 0,
  },
  airlines: ['AZ'],
  owner_airline: 'AZ',
  booking_url: 'https://letsfg.co/sandbox-booking?offer=sb_JFK_LHR_0002_61f1c6d2',
};

// A one-way offer: outbound only, no inbound key at all.
const ONEWAY_OFFER = {
  id: 'sb_JFK_LHR_ow_1',
  price: 246.0,
  currency: 'USD',
  outbound: {
    segments: [
      seg({
        code: 'AA',
        name: 'American Airlines',
        num: 'AA100',
        from: 'JFK',
        to: 'LHR',
        dep: '2027-01-15T08:00:00',
        arr: '2027-01-15T19:50:00',
        secs: 28200,
        aircraft: '777-300ER',
      }),
    ],
    total_duration_seconds: 28200,
    stopovers: 0,
  },
  airlines: ['AA'],
  owner_airline: 'AA',
  booking_url: 'https://letsfg.co/sandbox-booking?offer=sb_JFK_LHR_ow_1',
};

test('parse start response: search_id, poll_url on LetsFG host, interval', () => {
  const parsed = parseLetsfgStartResponse({
    search_id: 's_abc123',
    status: 'pending',
    poll_url: 'https://letsfg.co/developers/api/v1/flights/results/s_abc123',
    poll_interval_seconds: 5,
    note: 'Poll for results.',
  });
  assert.ok(parsed);
  assert.equal(parsed.searchId, 's_abc123');
  assert.equal(parsed.pollUrl, 'https://letsfg.co/developers/api/v1/flights/results/s_abc123');
  assert.equal(parsed.pollIntervalSeconds, 5);
  // A poll URL off LetsFG's own host is never followed.
  assert.equal(
    parseLetsfgStartResponse({ search_id: 's_1', poll_url: 'https://evil.example.com/r/s_1' })?.pollUrl,
    undefined
  );
  assert.equal(parseLetsfgStartResponse({}), null);
  assert.equal(parseLetsfgStartResponse({ poll_url: 'https://letsfg.co/x' }), null, 'no search_id, no start');
  assert.equal(parseLetsfgStartResponse(null), null);
});

test('parse poll response: complete / pending / error / malformed', () => {
  const complete = parseLetsfgPollResponse({
    status: 'complete',
    origin: 'JFK',
    destination: 'LHR',
    offers: [RT_OFFER_IB],
    total_results: 1094,
    currency: 'USD',
  });
  assert.ok(complete);
  assert.equal(complete.status, 'complete');
  assert.equal(complete.offers.length, 1);
  assert.equal(complete.currency, 'USD');
  assert.equal(parseLetsfgPollResponse({ status: 'pending', offers: [] })?.status, 'pending');
  assert.equal(parseLetsfgPollResponse({ status: 'error', error: 'upstream blew up', offers: [] })?.error, 'upstream blew up');
  assert.equal(parseLetsfgPollResponse({ status: 'done', offers: [] }), null, 'unknown status is malformed');
  assert.equal(parseLetsfgPollResponse(null), null);
  assert.equal(parseLetsfgPollResponse({ offers: [] }), null, 'no status, no poll');
});

test('map round-trip offer: two legs, party total, booking URL, segments', () => {
  const it = letsfgItineraryFromOffer(RT_OFFER_IB, 1);
  assert.ok(it);
  assert.equal(it.letsfgId, 'sb_JFK_LHR_0004_4f6a10ba');
  assert.equal(it.price, 158, '1 traveler: per-passenger price is the party total');
  assert.equal(it.currency, 'USD');
  assert.equal(it.bookingUrl, 'https://letsfg.co/sandbox-booking?offer=sb_JFK_LHR_0004_4f6a10ba');
  assert.equal(it.legs.length, 2);
  const out = it.legs[0];
  assert.equal(out.airline, 'Iberia');
  assert.equal(out.carrierCode, 'IB');
  assert.equal(out.price, 158);
  assert.equal(out.stops, 0);
  assert.equal(out.duration, '3h 39m');
  assert.equal(out.durationMinutes, 219);
  assert.equal(out.departTime, '1:45 PM');
  assert.equal(out.arriveTime, '5:24 PM');
  assert.equal(out.departMinutes, 825);
  assert.equal(out.segments.length, 1);
  assert.equal(out.segments[0].flightNumber, 'IB9225');
  assert.equal(out.segments[0].from, 'JFK');
  assert.equal(out.segments[0].to, 'LHR');
  assert.equal(out.segments[0].aircraft, 'E195');
  assert.equal(out.letsfgId, 'sb_JFK_LHR_0004_4f6a10ba');
  const back = it.legs[1];
  assert.equal(back.airline, 'Iberia');
  assert.equal(back.departTime, '3:45 PM');
  assert.equal(back.durationMinutes, 131);
});

test('map price: price_total wins; otherwise per-passenger price × seats', () => {
  const withTotal = letsfgItineraryFromOffer({ ...RT_OFFER_IB, price: 100, price_total: 180 }, 2);
  assert.ok(withTotal);
  assert.equal(withTotal.price, 180, 'price_total is the exact party total');
  const perPassenger = letsfgItineraryFromOffer(RT_OFFER_IB, 2);
  assert.ok(perPassenger);
  assert.equal(perPassenger.price, 316, 'no price_total: $158 × 2 travelers');
  const az = letsfgItineraryFromOffer(RT_OFFER_AZ, 2);
  assert.ok(az);
  assert.equal(az.price, 382);
});

test('map one-way offer: one leg, no inbound invented', () => {
  const it = letsfgItineraryFromOffer(ONEWAY_OFFER, 1);
  assert.ok(it);
  assert.equal(it.legs.length, 1);
  assert.equal(it.price, 246);
  assert.equal(it.legs[0].airline, 'American Airlines');
  assert.equal(it.legs[0].duration, '7h 50m');
});

test('map: unusable offers are dropped, never rendered as guessed fares', () => {
  assert.equal(letsfgItineraryFromOffer({ ...RT_OFFER_IB, price: undefined }, 1), null, 'no price');
  assert.equal(letsfgItineraryFromOffer({ ...RT_OFFER_IB, price: 0 }, 1), null, 'zero price');
  assert.equal(letsfgItineraryFromOffer({ ...RT_OFFER_IB, price: '158' }, 1), null, 'price as a string');
  assert.equal(
    letsfgItineraryFromOffer({ ...RT_OFFER_IB, outbound: { segments: [] }, inbound: null }, 1),
    null,
    'no segments'
  );
  assert.equal(letsfgItineraryFromOffer(null, 1), null);
  assert.equal(letsfgItineraryFromOffer('nope', 1), null);
  // A non-https booking URL is dropped, not rendered as a dead link;
  // a missing currency defaults to USD; a missing airline name falls
  // back to the code.
  const odd = letsfgItineraryFromOffer(
    {
      ...RT_OFFER_IB,
      booking_url: 'http://letsfg.co/x',
      currency: undefined,
      outbound: {
        segments: [{ ...RT_OFFER_IB.outbound.segments[0], airline_name: undefined }],
        total_duration_seconds: 13140,
        stopovers: 0,
      },
    },
    1
  );
  assert.ok(odd);
  assert.equal(odd.bookingUrl, undefined);
  assert.equal(odd.currency, 'USD');
  assert.equal(odd.legs[0].airline, 'IB');
});

test('cabin mapping: Duffel classes to LetsFG M/W/C/F', () => {
  assert.equal(letsfgCabinClass('economy'), 'M');
  assert.equal(letsfgCabinClass('premium_economy'), 'W');
  assert.equal(letsfgCabinClass('business'), 'C');
  assert.equal(letsfgCabinClass('first'), 'F');
  assert.equal(letsfgCabinClass('nonsense'), 'M');
  assert.equal(letsfgCabinClass(undefined), 'M');
});

test('stops / duration / matches / sort: outbound-first, missing sorts last', () => {
  const ib = letsfgItineraryFromOffer(RT_OFFER_IB, 1);
  const az = letsfgItineraryFromOffer(RT_OFFER_AZ, 1);
  assert.ok(ib && az);
  assert.equal(letsfgItineraryStops(ib), 0);
  assert.equal(letsfgItineraryDuration(ib), 219 + 131);
  assert.equal(cheapestLetsfgItinerary([az, ib]), 158);
  assert.equal(cheapestLetsfgItinerary([]), 0);
  assert.equal(letsfgItineraryMatches(ib, [], [], []), true);
  assert.equal(letsfgItineraryMatches(ib, [1], [], []), false, 'nonstop trip fails the 1-stop filter');
  assert.equal(letsfgItineraryMatches(ib, [], ['Iberia'], []), true);
  assert.equal(letsfgItineraryMatches(ib, [], ['ITA Airways'], []), false);
  // A 1-stop-out / nonstop-back trip is a 1-stop trip (outbound
  // rule), whatever the return does.
  const oneStop = letsfgItineraryFromOffer(
    {
      ...RT_OFFER_IB,
      outbound: {
        segments: [
          seg({ code: 'IB', name: 'Iberia', num: 'IB1', from: 'JFK', to: 'MAD', dep: '2027-01-15T08:00:00', arr: '2027-01-15T19:00:00', secs: 25200 }),
          seg({ code: 'IB', name: 'Iberia', num: 'IB2', from: 'MAD', to: 'LHR', dep: '2027-01-15T20:30:00', arr: '2027-01-15T22:00:00', secs: 5400 }),
        ],
        total_duration_seconds: 36000,
        stopovers: 1,
      },
    },
    1
  );
  assert.ok(oneStop);
  assert.equal(letsfgItineraryStops(oneStop), 1);
  assert.equal(letsfgItineraryMatches(oneStop, [1], [], []), true);
  assert.equal(letsfgItineraryMatches(oneStop, [0], [], []), false);
  // Sort: cheapest by price; duration with a missing duration last.
  const noTime = letsfgItineraryFromOffer(
    { ...RT_OFFER_AZ, outbound: { segments: [{ ...RT_OFFER_AZ.outbound.segments[0], duration_seconds: undefined }], total_duration_seconds: undefined, stopovers: 0 } },
    1
  );
  assert.ok(noTime);
  assert.deepEqual(
    sortLetsfgItineraries([az, ib], 'cheapest').map((i) => i.price),
    [158, 191]
  );
  assert.deepEqual(
    sortLetsfgItineraries([noTime, ib], 'duration').map((i) => i.price),
    [158, 191],
    'a leg with no duration sorts last, never guessed'
  );
});

test('source tag + freshness label: LetsFG + named timezone, or no time claimed', () => {
  assert.equal(letsfgSourceTag(null), 'LetsFG · live fare');
  assert.equal(letsfgSourceTag('not-a-date'), 'LetsFG · live fare');
  const tag = letsfgSourceTag('2026-11-17T00:12:27.000Z');
  assert.ok(tag.startsWith('LetsFG · live, checked '), tag);
  assert.ok(/Nov 16|Nov 17/.test(tag), tag);
  assert.equal(letsfgFreshnessLabel(null), 'Live fares from LetsFG');
  assert.ok(letsfgFreshnessLabel('2026-11-17T00:12:27.000Z').startsWith('Live · checked '));
});

test('empty messages: every failure reason has an honest line', () => {
  assert.match(letsfgEmptyMessage('no_key'), /not connected yet/);
  assert.match(letsfgEmptyMessage('unsupported_trip_type'), /multi-city/);
  assert.match(letsfgEmptyMessage('payment_required'), /payment method or balance/);
  assert.match(letsfgEmptyMessage('timeout'), /still searching/);
  assert.match(letsfgEmptyMessage('search_failed'), /failed/);
  assert.match(letsfgEmptyMessage('search_expired'), /expired/);
  assert.match(letsfgEmptyMessage('no_offers'), /no live fares/);
  assert.match(letsfgEmptyMessage('weird-reason'), /couldn't be reached/);
  assert.match(letsfgEmptyMessage(), /couldn't be reached/);
});

test('search without a key: honest empty, no fetch at all', async () => {
  clearLetsfgCache();
  delete process.env.LETSFG_API_KEY;
  let called = false;
  stubFetch(async () => {
    called = true;
    return okJson({});
  });
  try {
    const res = await searchLetsfgFares({
      tripType: 'roundtrip',
      origin: 'JFK',
      destination: 'LHR',
      departDate: '2027-01-15',
      returnDate: '2027-01-22',
      travelers: 1,
    });
    assert.equal(res.live, false);
    assert.equal(res.configured, false);
    assert.equal(res.reason, 'no_key');
    assert.equal(called, false, 'no request is made without a key');
  } finally {
    restoreFetch();
    restoreKey();
    clearLetsfgCache();
  }
});

test('search: start 402 is payment_required, 401 is unauthorized', async () => {
  clearLetsfgCache();
  setKey();
  for (const [status, reason] of [
    [402, 'payment_required'],
    [401, 'unauthorized'],
    [429, 'rate_limited'],
  ]) {
    stubFetch(async () => errJson(status));
    try {
      const res = await searchLetsfgFares(
        { tripType: 'roundtrip', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', returnDate: '2027-01-22', travelers: 1 },
        { pollIntervalMs: 1, maxPolls: 1 }
      );
      assert.equal(res.live, false);
      assert.equal(res.reason, reason, `HTTP ${status}`);
    } finally {
      restoreFetch();
    }
    clearLetsfgCache();
  }
  restoreKey();
});

test('search: async start + pending polls → complete with mapped itineraries', async () => {
  clearLetsfgCache();
  setKey();
  const seen = [];
  stubFetch(async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes('/search/async')) {
      return okJson({ search_id: 's_test1', status: 'pending', poll_interval_seconds: undefined });
    }
    // First poll pending, second complete.
    const polls = seen.filter((s) => String(s.url).includes('/results/')).length;
    if (polls < 2) return okJson({ status: 'pending', offers: [] });
    return okJson({ status: 'complete', offers: [RT_OFFER_IB, RT_OFFER_AZ], total_results: 1094, currency: 'USD' });
  });
  try {
    const res = await searchLetsfgFares(
      { tripType: 'roundtrip', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', returnDate: '2027-01-22', travelers: 1 },
      { pollIntervalMs: 1, maxPolls: 5 }
    );
    assert.equal(res.live, true);
    assert.equal(res.configured, true);
    assert.equal(res.source, 'letsfg');
    assert.equal(res.itineraries.length, 2);
    assert.equal(res.itineraries[0].price, 158);
    assert.equal(res.itineraries[1].price, 191);
    assert.equal(typeof res.observedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(res.observedAt)), 'observedAt is a real timestamp');
    // The start request carries the trip, USD, and the key header.
    const start = seen.find((s) => String(s.url).includes('/search/async'));
    assert.ok(start, 'an async start was posted');
    assert.equal(start.init.headers['X-API-Key'], 'test-key-123');
    const sentBody = JSON.parse(start.init.body);
    assert.equal(sentBody.origin, 'JFK');
    assert.equal(sentBody.destination, 'LHR');
    assert.equal(sentBody.date_from, '2027-01-15');
    assert.equal(sentBody.return_from, '2027-01-22');
    assert.equal(sentBody.adults, 1);
    assert.equal(sentBody.currency, 'USD');
    assert.equal(sentBody.cabin_class, 'M');
    assert.equal(seen.filter((s) => String(s.url).includes('/results/')).length, 2, 'one pending poll, then complete');
  } finally {
    restoreFetch();
    restoreKey();
    clearLetsfgCache();
  }
});

test('search: one-way sends no return window', async () => {
  clearLetsfgCache();
  setKey();
  let sentBody = null;
  stubFetch(async (url, init) => {
    if (String(url).includes('/search/async')) {
      sentBody = JSON.parse(init.body);
      return okJson({ search_id: 's_ow', status: 'pending' });
    }
    return okJson({ status: 'complete', offers: [ONEWAY_OFFER], total_results: 3, currency: 'USD' });
  });
  try {
    const res = await searchLetsfgFares(
      { tripType: 'oneway', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', travelers: 1 },
      { pollIntervalMs: 1, maxPolls: 3 }
    );
    assert.equal(res.live, true);
    assert.equal(res.itineraries.length, 1);
    assert.equal(res.itineraries[0].legs.length, 1, 'one-way: one leg, no return invented');
    assert.equal('return_from' in sentBody, false);
    assert.equal('return_to' in sentBody, false);
  } finally {
    restoreFetch();
    restoreKey();
    clearLetsfgCache();
  }
});

test('search: poll error, expiry, and timeout are honest, never guessed', async () => {
  clearLetsfgCache();
  setKey();
  const input = { tripType: 'roundtrip', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', returnDate: '2027-01-22', travelers: 1 };
  const run = async (pollHandler) => {
    stubFetch(async (url) => {
      if (String(url).includes('/search/async')) return okJson({ search_id: 's_x', status: 'pending' });
      return pollHandler();
    });
    try {
      return await searchLetsfgFares(input, { pollIntervalMs: 1, maxPolls: 3 });
    } finally {
      restoreFetch();
      clearLetsfgCache();
    }
  };
  assert.equal((await run(async () => okJson({ status: 'error', error: 'connector down', offers: [] }))).reason, 'search_failed');
  assert.equal((await run(async () => ({ ok: false, status: 404, json: async () => ({}) }))).reason, 'search_expired');
  assert.equal((await run(async () => okJson({ status: 'pending', offers: [] }))).reason, 'timeout');
  assert.equal((await run(async () => okJson({ status: 'complete', offers: [], total_results: 0 }))).reason, 'no_offers');
  restoreKey();
});

test('search: a completed result is cached; in-flight searches de-dupe', async () => {
  clearLetsfgCache();
  setKey();
  let starts = 0;
  let polls = 0;
  stubFetch(async (url) => {
    if (String(url).includes('/search/async')) {
      starts += 1;
      return okJson({ search_id: 's_c', status: 'pending' });
    }
    polls += 1;
    return okJson({ status: 'complete', offers: [RT_OFFER_IB], total_results: 1, currency: 'USD' });
  });
  const input = { tripType: 'roundtrip', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', returnDate: '2027-01-22', travelers: 1 };
  try {
    // Two callers at once share one in-flight search.
    const [a, b] = await Promise.all([
      searchLetsfgFares(input, { pollIntervalMs: 1, maxPolls: 3 }),
      searchLetsfgFares(input, { pollIntervalMs: 1, maxPolls: 3 }),
    ]);
    assert.equal(a.live, true);
    assert.equal(b.live, true);
    assert.equal(starts, 1, 'one start for two concurrent callers');
    assert.equal(polls, 1, 'one poll for two concurrent callers');
    // A later identical search is served from the cache.
    const c = await searchLetsfgFares(input, { pollIntervalMs: 1, maxPolls: 3 });
    assert.equal(c.live, true);
    assert.equal(starts, 1, 'no second start for a cached trip');
    assert.equal(polls, 1, 'no second poll for a cached trip');
  } finally {
    restoreFetch();
    restoreKey();
    clearLetsfgCache();
  }
});

// --- Wiring: the column is actually connected, not just written. ---
test('wiring: SearchResults fetches LetsFG, renders its group, tags hide with filters', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes("fetch('/api/letsfg-fares'"), 'FlightResults fetches /api/letsfg-fares');
  assert.ok(src.includes('LetsfgItineraryGroup'), 'the LetsFG itinerary group is rendered');
  assert.ok(src.includes('letsfgTagShown'), 'the LetsFG tag follows hideSourceTags');
  assert.ok(src.includes('See booking options on LetsFG'), 'the booking link-out is on the card');
  assert.ok(src.includes('letsfgEmptyMessage'), 'the honest empty state is rendered');
  assert.ok(src.includes("letsfgItineraryMatches"), 'LetsFG trips pass the panel filters');
  assert.ok(src.includes('LETSFG_MAX_ITINERARIES'), 'LetsFG trips are capped like Ignav');
});

test('wiring: merge interleaves LetsFG trips; route guards multi-city', () => {
  const flightOptions = readFileSync(new URL('../lib/flightOptions.ts', import.meta.url), 'utf8');
  assert.ok(flightOptions.includes("kind: 'letsfg'"), 'merge has a letsfg option kind');
  assert.ok(flightOptions.includes('letsfgItineraries'), 'merge takes LetsFG itineraries');
  const route = readFileSync(new URL('../app/api/letsfg-fares/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('searchLetsfgFares'), 'the route calls the LetsFG client');
  assert.ok(route.includes('unsupported_trip_type'), 'multi-city is guarded, never searched');
  assert.ok(route.includes('CITY_IATA'), 'city names resolve to IATA codes, never guessed');
  const lib = readFileSync(new URL('../lib/letsfg.ts', import.meta.url), 'utf8');
  assert.ok(lib.includes('process.env.LETSFG_API_KEY'), 'the key is read from the environment');
  assert.ok(!lib.includes('letsfg_'), 'no key value is hardcoded in the client');
});
