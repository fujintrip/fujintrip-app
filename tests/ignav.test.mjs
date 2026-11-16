// Ignav live fares (Nov 15, 2026): the live comparison column.
// The sample payloads below are built from Ignav's own OpenAPI
// spec (read live Nov 15, 2026) — FareSearchResponseModel,
// FareSearchModel, BookingOptionsResponseModel — not from live
// calls: the key does not exist in this VM yet. The mapping,
// trip-type dispatch, cache, and honest empty states are all
// pinned here; live fares are verified after Deploy.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/ignav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoversFor } from '../lib/duffel.ts';
import {
  cheapestIgnavItinerary,
  clearIgnavCache,
  fetchIgnavBookingLinks,
  ignavBookingContext,
  ignavEmptyMessage,
  ignavFreshnessLabel,
  ignavItineraryMatches,
  ignavItineraryStops,
  ignavSourceTag,
  parseIgnavBookingLinksResponse,
  parseIgnavFareSearchResponse,
  parseIgnavSearchResponse,
  searchIgnavFares,
  sortIgnavItineraries,
} from '../lib/ignav.ts';

function seg({
  code,
  num,
  name,
  from,
  to,
  depLocal,
  depUtc,
  arrLocal,
  arrUtc,
  mins,
  aircraft = 'Boeing 777-300ER',
}) {
  return {
    marketing_carrier_code: code,
    flight_number: num,
    operating_carrier_name: name,
    departure_airport: from,
    departure_time_local: depLocal,
    departure_timezone: 'UTC',
    departure_time_utc: depUtc,
    arrival_airport: to,
    arrival_time_local: arrLocal,
    arrival_timezone: 'UTC',
    arrival_time_utc: arrUtc,
    duration_minutes: mins,
    aircraft,
  };
}

// One-way JFK → LHR, Jan 15 2027: a BA nonstop and a TAP 1-stop.
const ONEWAY_SAMPLE = {
  origin: 'JFK',
  destination: 'LHR',
  departure_date: '2027-01-15',
  return_date: null,
  observed_at: '2026-11-15T18:00:00Z',
  itineraries: [
    {
      price: { amount: 412, currency: 'USD', status: 'verified' },
      outbound: {
        carrier: 'British Airways',
        duration_minutes: 435,
        segments: [
          seg({
            code: 'BA',
            num: '178',
            name: 'British Airways',
            from: 'JFK',
            to: 'LHR',
            depLocal: '2027-01-15T08:30:00',
            depUtc: '2027-01-15T13:30:00Z',
            arrLocal: '2027-01-15T20:45:00',
            arrUtc: '2027-01-15T20:45:00Z',
            mins: 435,
          }),
        ],
      },
      inbound: null,
      cabin_class: 'economy',
      bags: { carry_on: 1, checked: 1 },
      baggage_pricing: null,
      has_mixed_carriers: false,
      ignav_id: 'ig_abc123',
    },
    {
      price: { amount: 380, currency: 'USD', status: 'unverified' },
      outbound: {
        carrier: 'TAP Air Portugal',
        duration_minutes: 705,
        segments: [
          seg({
            code: 'TP',
            num: '211',
            name: 'TAP Air Portugal',
            from: 'JFK',
            to: 'LIS',
            depLocal: '2027-01-15T17:40:00',
            depUtc: '2027-01-15T22:40:00Z',
            arrLocal: '2027-01-16T06:05:00',
            arrUtc: '2027-01-16T06:05:00Z',
            mins: 385,
            aircraft: 'Airbus A330-900neo',
          }),
          seg({
            code: 'TP',
            num: '352',
            name: 'TAP Air Portugal',
            from: 'LIS',
            to: 'LHR',
            depLocal: '2027-01-16T08:00:00',
            depUtc: '2027-01-16T08:00:00Z',
            arrLocal: '2027-01-16T10:35:00',
            arrUtc: '2027-01-16T10:35:00Z',
            mins: 155,
            aircraft: 'Airbus A320neo',
          }),
        ],
      },
      inbound: null,
      cabin_class: 'economy',
      bags: { carry_on: 1, checked: 0 },
      baggage_pricing: null,
      has_mixed_carriers: false,
      ignav_id: 'ig_def456',
    },
  ],
};

// Round-trip JFK → LHR → JFK: one itinerary, outbound + return.
const ROUNDTRIP_SAMPLE = {
  origin: 'JFK',
  destination: 'LHR',
  departure_date: '2027-01-15',
  return_date: '2027-01-22',
  observed_at: '2026-11-15T18:05:00Z',
  itineraries: [
    {
      price: { amount: 824, currency: 'USD', status: 'verified' },
      outbound: ONEWAY_SAMPLE.itineraries[0].outbound,
      inbound: {
        carrier: 'British Airways',
        duration_minutes: 480,
        segments: [
          seg({
            code: 'BA',
            num: '179',
            name: 'British Airways',
            from: 'LHR',
            to: 'JFK',
            depLocal: '2027-01-22T09:15:00',
            depUtc: '2027-01-22T09:15:00Z',
            arrLocal: '2027-01-22T12:15:00',
            arrUtc: '2027-01-22T17:15:00Z',
            mins: 480,
          }),
        ],
      },
      cabin_class: 'economy',
      bags: { carry_on: 1, checked: 1 },
      baggage_pricing: null,
      has_mixed_carriers: false,
      ignav_id: 'ig_rt789',
    },
  ],
};

// Flexible search, 2 legs: JFK → LHR, then LHR → CDG.
const SEARCH_SAMPLE = {
  legs: [
    { origin: 'JFK', destination: 'LHR', departure_date: '2027-01-15' },
    { origin: 'LHR', destination: 'CDG', departure_date: '2027-01-18' },
  ],
  observed_at: '2026-11-15T18:10:00Z',
  itineraries: [
    {
      price: { amount: 610, currency: 'USD', status: 'verified' },
      legs: [
        ONEWAY_SAMPLE.itineraries[0].outbound,
        {
          carrier: 'British Airways',
          duration_minutes: 75,
          segments: [
            seg({
              code: 'BA',
              num: '306',
              name: 'British Airways',
              from: 'LHR',
              to: 'CDG',
              depLocal: '2027-01-18T07:20:00',
              depUtc: '2027-01-18T07:20:00Z',
              arrLocal: '2027-01-18T09:35:00',
              arrUtc: '2027-01-18T08:35:00Z',
              mins: 75,
              aircraft: 'Airbus A320',
            }),
          ],
        },
      ],
      cabin_class: 'economy',
      bags: { carry_on: 1, checked: 1 },
      baggage_pricing: null,
      has_mixed_carriers: false,
      ignav_id: 'ig_mc012',
    },
  ],
};

const BOOKING_LINKS_SAMPLE = {
  itinerary: {
    price: { amount: 412, currency: 'USD', status: 'verified' },
    outbound: ONEWAY_SAMPLE.itineraries[0].outbound,
    inbound: null,
    cabin_class: 'economy',
    bags: { carry_on: 1, checked: 1 },
    baggage_pricing: null,
    has_mixed_carriers: false,
  },
  booking_options: [
    {
      legs: ['outbound'],
      links: [
        {
          provider_name: 'British Airways',
          provider_type: 'airline',
          specificity: 'exact_flight',
          fare_name: 'Basic',
          price: { amount: 412, currency: 'USD', status: 'verified' },
          baggage_pricing: null,
          url: 'https://www.britishairways.com/book/example',
        },
      ],
    },
    {
      legs: ['outbound'],
      links: [
        {
          provider_name: 'CheapOair',
          provider_type: 'third_party',
          specificity: 'search_results',
          fare_name: null,
          price: null,
          baggage_pricing: null,
          url: 'https://www.cheapoair.com/search/example',
        },
      ],
    },
  ],
};

// --- Fetch + env stubbing (restored after every test). ---
const realFetch = globalThis.fetch;
const realKey = process.env.IGNAV_API_KEY;

function stubFetch(handler) {
  globalThis.fetch = handler;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function setKey() {
  process.env.IGNAV_API_KEY = 'test-key-123';
}

function restoreKey() {
  if (realKey === undefined) delete process.env.IGNAV_API_KEY;
  else process.env.IGNAV_API_KEY = realKey;
}

function okJson(json) {
  return { ok: true, status: 200, json: async () => json };
}

test('parse one-way: the FareCard shape carries airline, code, price, times, segments, bags', () => {
  const parsed = parseIgnavFareSearchResponse(ONEWAY_SAMPLE);
  assert.ok(parsed, 'a well-formed response parses');
  assert.equal(parsed.itineraries.length, 2);
  assert.equal(parsed.observedAt, '2026-11-15T18:00:00Z');
  const [ba, tap] = parsed.itineraries;
  assert.equal(ba.price, 412);
  assert.equal(ba.currency, 'USD');
  assert.equal(ba.priceStatus, 'verified');
  assert.equal(ba.ignavId, 'ig_abc123');
  assert.equal(ba.legs.length, 1);
  const out = ba.legs[0];
  assert.equal(out.airline, 'British Airways');
  assert.equal(out.carrierCode, 'BA');
  assert.equal(out.price, 412);
  assert.equal(out.stops, 0);
  assert.equal(out.duration, '7h 15m');
  assert.equal(out.durationMinutes, 435);
  assert.equal(out.departTime, '8:30 AM');
  assert.equal(out.arriveTime, '8:45 PM');
  assert.equal(out.bags, '1 checked bag included');
  assert.equal(out.segments.length, 1);
  assert.equal(out.segments[0].flightNumber, 'BA178');
  assert.equal(out.segments[0].from, 'JFK');
  assert.equal(out.segments[0].to, 'LHR');
  assert.equal(out.segments[0].aircraft, 'Boeing 777-300ER');
  // The connecting itinerary: 1 stop, layover computed from the
  // segment timestamps (06:05 → 08:00 in Lisbon = 1h 55m).
  const tapOut = tap.legs[0];
  assert.equal(tapOut.stops, 1);
  assert.equal(tapOut.priceStatus, undefined, 'price status lives on the itinerary, not the leg offer');
  assert.equal(tapOut.bags, 'carry-on only (no checked bag included)');
  assert.equal(tap.priceStatus, 'unverified');
  const layovers = layoversFor(tapOut);
  assert.equal(layovers.length, 1);
  assert.equal(layovers[0].airport, 'LIS');
  assert.equal(layovers[0].minutes, 115);
});

test('parse round-trip: one itinerary, two legs, one trip price on both', () => {
  const parsed = parseIgnavFareSearchResponse(ROUNDTRIP_SAMPLE);
  assert.ok(parsed);
  assert.equal(parsed.itineraries.length, 1);
  const it = parsed.itineraries[0];
  assert.equal(it.price, 824);
  assert.equal(it.legs.length, 2);
  assert.equal(it.legs[0].airline, 'British Airways');
  assert.equal(it.legs[0].stops, 0);
  assert.equal(it.legs[1].airline, 'British Airways');
  assert.equal(it.legs[1].segments[0].flightNumber, 'BA179');
  assert.equal(it.legs[1].departTime, '9:15 AM');
  assert.equal(it.ignavId, 'ig_rt789');
});

test('parse flexible search: one itinerary, two legs in order', () => {
  const parsed = parseIgnavSearchResponse(SEARCH_SAMPLE);
  assert.ok(parsed);
  assert.equal(parsed.itineraries.length, 1);
  const it = parsed.itineraries[0];
  assert.equal(it.price, 610);
  assert.equal(it.legs.length, 2);
  assert.equal(it.legs[0].segments[0].to, 'LHR');
  assert.equal(it.legs[1].segments[0].to, 'CDG');
  assert.equal(it.legs[1].segments[0].flightNumber, 'BA306');
  assert.equal(it.ignavId, 'ig_mc012');
});

test('parse: a malformed payload is an error, never a guessed fare list', () => {
  assert.equal(parseIgnavFareSearchResponse(null), null);
  assert.equal(parseIgnavFareSearchResponse({}), null);
  assert.equal(parseIgnavFareSearchResponse({ itineraries: 'nope' }), null);
  assert.equal(parseIgnavSearchResponse({ itineraries: [{ price: { amount: 0 }, legs: [] }] })?.itineraries.length, 0, 'an itinerary with no price is skipped');
  const noSegs = parseIgnavFareSearchResponse({
    itineraries: [{ price: { amount: 100, currency: 'USD', status: 'verified' }, outbound: { carrier: 'X', segments: [] }, inbound: null, ignav_id: 'x' }],
    observed_at: null,
  });
  assert.equal(noSegs.itineraries.length, 0, 'an itinerary with no segments is skipped');
});

test('search without a key: honest empty, no fetch at all', async () => {
  clearIgnavCache();
  delete process.env.IGNAV_API_KEY;
  let called = false;
  stubFetch(async () => {
    called = true;
    return okJson({});
  });
  try {
    const res = await searchIgnavFares({
      tripType: 'oneway',
      origin: 'JFK',
      destination: 'LHR',
      departDate: '2027-01-15',
      travelers: 1,
    });
    assert.equal(res.live, false);
    assert.equal(res.configured, false);
    assert.equal(res.reason, 'no_key');
    assert.equal(called, false, 'no request is made without a key');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('trip-type dispatch: one-way, round-trip, flexible search, per-leg multi-city', async () => {
  clearIgnavCache();
  setKey();
  const calls = [];
  stubFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), key: init.headers['X-Api-Key'] });
    const u = String(url);
    if (u.endsWith('/fares/search')) return okJson(SEARCH_SAMPLE);
    if (u.endsWith('/fares/round-trip')) return okJson(ROUNDTRIP_SAMPLE);
    return okJson(ONEWAY_SAMPLE);
  });
  try {
    const one = await searchIgnavFares({ tripType: 'oneway', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', travelers: 1, cabin: 'economy' });
    assert.equal(one.live, true);
    assert.equal(one.itineraries.length, 2);
    const rt = await searchIgnavFares({ tripType: 'roundtrip', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', returnDate: '2027-01-22', travelers: 2, cabin: 'business' });
    assert.equal(rt.live, true);
    assert.equal(rt.itineraries[0].legs.length, 2);
    const mc2 = await searchIgnavFares({
      tripType: 'multicity',
      origin: 'JFK',
      destination: 'LHR',
      departDate: '2027-01-15',
      legs: [
        { origin: 'JFK', destination: 'LHR', date: '2027-01-15' },
        { origin: 'LHR', destination: 'CDG', date: '2027-01-18' },
      ],
      travelers: 1,
    });
    assert.equal(mc2.live, true);
    assert.equal(mc2.itineraries[0].legs.length, 2);
    const mc3 = await searchIgnavFares({
      tripType: 'multicity',
      origin: 'JFK',
      destination: 'LHR',
      departDate: '2027-01-15',
      legs: [
        { origin: 'JFK', destination: 'LHR', date: '2027-01-15' },
        { origin: 'LHR', destination: 'CDG', date: '2027-01-18' },
        { origin: 'CDG', destination: 'FCO', date: '2027-01-20' },
      ],
      travelers: 1,
    });
    assert.equal(mc3.live, true);
    assert.equal(mc3.legs.length, 3);
    assert.equal(mc3.itineraries.length, 0, '3–4 legs use per-leg fares, not itineraries');

    assert.equal(calls[0].url, 'https://ignav.com/api/fares/one-way');
    assert.equal(calls[0].key, 'test-key-123', 'the key travels as X-Api-Key');
    assert.equal(calls[0].body.origin, 'JFK');
    assert.equal(calls[0].body.departure_date, '2027-01-15');
    assert.equal(calls[0].body.adults, 1);
    assert.equal(calls[0].body.cabin_class, 'economy');
    assert.equal(calls[0].body.market, 'US');
    assert.equal(calls[1].url, 'https://ignav.com/api/fares/round-trip');
    assert.equal(calls[1].body.return_date, '2027-01-22');
    assert.equal(calls[1].body.cabin_class, 'business');
    assert.equal(calls[2].url, 'https://ignav.com/api/fares/search');
    assert.equal(calls[2].body.legs.length, 2);
    assert.equal(calls[2].body.legs[1].destination, 'CDG');
    // The 3-leg trip runs one one-way request per leg.
    assert.equal(calls.slice(3).length, 3);
    assert.ok(calls.slice(3).every((c) => c.url === 'https://ignav.com/api/fares/one-way'));
    assert.equal(calls[5].body.destination, 'FCO');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('cache: the same search twice costs one request', async () => {
  clearIgnavCache();
  setKey();
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return okJson(ONEWAY_SAMPLE);
  });
  try {
    const input = { tripType: 'oneway', origin: 'JFK', destination: 'LHR', departDate: '2027-01-15', travelers: 1 };
    await searchIgnavFares(input);
    await searchIgnavFares(input);
    assert.equal(calls, 1, 'the second identical search hits the cache');
    clearIgnavCache();
    await searchIgnavFares(input);
    assert.equal(calls, 2, 'clearing the cache re-fetches');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('errors: 401/402/network map to honest reasons, never a retry loop', async () => {
  clearIgnavCache();
  setKey();
  const input = { tripType: 'oneway', origin: 'JFK', destination: 'LHR', departDate: '2027-01-16', travelers: 1 };
  const statuses = [
    [401, 'unauthorized'],
    [402, 'payment_required'],
    [429, 'rate_limited'],
    [424, 'upstream_unavailable'],
  ];
  for (const [status, reason] of statuses) {
    clearIgnavCache();
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return { ok: false, status, json: async () => ({ error: { type: 'x', code: 'x', message: 'x' } }) };
    });
    try {
      const res = await searchIgnavFares(input);
      assert.equal(res.live, false);
      assert.equal(res.reason, reason);
      assert.equal(calls, 1, 'one attempt, no retry loop');
    } finally {
      restoreFetch();
    }
  }
  clearIgnavCache();
  stubFetch(async () => {
    throw new Error('network down');
  });
  try {
    const res = await searchIgnavFares(input);
    assert.equal(res.live, false);
    assert.equal(res.reason, 'error');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('freshness label: observed_at becomes a checked time, null stays generic', () => {
  assert.ok(ignavFreshnessLabel('2026-11-15T18:00:00Z').startsWith('Live · checked'), 'a timestamp labels the check');
  assert.ok(ignavFreshnessLabel('2026-11-15T18:00:00Z').includes('Nov 15'), 'the check date is visible');
  // The zone is named (Nov 16, 2026): a bare clock time is UTC in
  // one browser and local time in another, so the label carries the
  // zone the time was rendered in.
  const d = new Date('2026-11-15T18:00:00Z');
  const zone = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    .split(' ')
    .pop();
  assert.ok(ignavFreshnessLabel('2026-11-15T18:00:00Z').endsWith(zone), 'the checked time names its timezone');
  assert.equal(ignavFreshnessLabel(null), 'Live fares from Ignav');
  assert.equal(ignavFreshnessLabel('not-a-date'), 'Live fares from Ignav');
});

test('sort + filter: itineraries sort by price/duration/departure and match the panel filters', () => {
  const parsed = parseIgnavFareSearchResponse(ONEWAY_SAMPLE);
  const its = parsed.itineraries;
  assert.deepEqual(
    sortIgnavItineraries(its, 'cheapest').map((i) => i.price),
    [380, 412],
    'cheapest first'
  );
  assert.deepEqual(
    sortIgnavItineraries(its, 'duration').map((i) => i.price),
    [412, 380],
    'shortest first (435m beats 705m)'
  );
  assert.deepEqual(
    sortIgnavItineraries(its, 'departure').map((i) => i.price),
    [412, 380],
    'earliest departure first (8:30 AM beats 5:40 PM)'
  );
  assert.equal(ignavItineraryMatches(its[0], [0], []), true, 'the nonstop matches a Nonstop filter');
  assert.equal(ignavItineraryMatches(its[1], [0], []), false, 'the 1-stop does not pass a Nonstop filter');
  assert.equal(ignavItineraryMatches(its[0], [], ['British Airways']), true);
  assert.equal(ignavItineraryMatches(its[0], [], ['TAP Air Portugal']), false);
  assert.equal(cheapestIgnavItinerary(its), 380);
  assert.equal(cheapestIgnavItinerary([]), 0);
});

test('stops: a trip counts by its outbound — a 1-stop-out / nonstop-back trip is 1-stop', () => {
  // The live Nov 16 defect: three BA trips 1-stop via Madrid read
  // "1 stop (0)" because the old rule needed every leg to agree on
  // one stop count, and a 1-stop out + nonstop back agreed on none.
  const mixed = {
    price: 900,
    ignavId: 'mix',
    legs: [
      { airline: 'British Airways', stops: 1, departMinutes: 500, price: 900 },
      { airline: 'British Airways', stops: 0, departMinutes: 600, price: 900 },
    ],
  };
  assert.equal(ignavItineraryStops(mixed), 1, 'the trip is 1-stop — the way out stops once');
  assert.equal(ignavItineraryMatches(mixed, [1], []), true, 'the 1-stop trip passes a 1-stop filter');
  assert.equal(ignavItineraryMatches(mixed, [0], []), false, 'the 1-stop trip does not pass a Nonstop filter');
  const nonstop = {
    price: 800,
    ignavId: 'ns',
    legs: [
      { airline: 'British Airways', stops: 0, departMinutes: 500, price: 800 },
      { airline: 'British Airways', stops: 0, departMinutes: 600, price: 800 },
    ],
  };
  assert.equal(ignavItineraryStops(nonstop), 0, 'nonstop both ways is nonstop');
  assert.equal(ignavItineraryMatches(nonstop, [0], []), true, 'the nonstop passes a Nonstop filter');
});

test('time filter: an itinerary matches on its outbound departure bucket only', () => {
  const parsed = parseIgnavFareSearchResponse(ONEWAY_SAMPLE);
  const its = parsed.itineraries;
  // its[0] is the BA nonstop departing 8:30 AM (morning); its[1] is
  // the TAP 1-stop departing 5:40 PM (afternoon — evening starts 6 PM).
  assert.equal(ignavItineraryMatches(its[0], [], [], ['morning']), true, 'the 8:30 AM departure is morning');
  assert.equal(ignavItineraryMatches(its[0], [], [], ['afternoon']), false, 'the 8:30 AM departure is not afternoon');
  assert.equal(ignavItineraryMatches(its[1], [], [], ['afternoon']), true, 'the 5:40 PM departure is afternoon');
  assert.equal(ignavItineraryMatches(its[1], [], [], ['morning']), false, 'the 5:40 PM departure is not morning');
  assert.equal(ignavItineraryMatches(its[0], [], []), true, 'no time filter passes everything');
  assert.equal(ignavItineraryMatches(its[0], [0], [], ['morning']), true, 'stops and time filters combine');
  assert.equal(ignavItineraryMatches(its[0], [1], [], ['morning']), false, 'a nonstop fails a 1-stop filter even in the right time bucket');
});

test('source tag: every live fare is labelled with its source and when it was checked', () => {
  // The tag shows the freshness time in the viewer's local timezone
  // (the live site renders it in the traveler's browser), so the
  // expected clock reading is derived from the same instant — a
  // hardcoded '9:17 PM' only passes when the process runs in UTC.
  // The zone is named too (Nov 16, 2026): a bare time is UTC in one
  // browser and local time in another.
  const ts = '2026-11-15T21:17:00.000Z';
  const d = new Date(ts);
  const expected = `Ignav · live, checked ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
    'en-US',
    { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
  )}`;
  assert.equal(ignavSourceTag(ts), expected, 'the tag carries the freshness time and its zone');
  assert.equal(ignavSourceTag(undefined), 'Ignav · live fare', 'no timestamp is still a live tag, never a fake time');
  assert.equal(ignavSourceTag('not-a-date'), 'Ignav · live fare', 'an unparseable timestamp is never shown');
});

test('booking links: parse flattens options, drops dead links', () => {
  const links = parseIgnavBookingLinksResponse(BOOKING_LINKS_SAMPLE);
  assert.equal(links.length, 2);
  assert.equal(links[0].providerName, 'British Airways');
  assert.equal(links[0].providerType, 'airline');
  assert.equal(links[0].specificity, 'exact_flight');
  assert.equal(links[0].price, 412);
  assert.equal(links[0].fareName, 'Basic');
  assert.equal(links[1].providerName, 'CheapOair');
  assert.equal(links[1].providerType, 'third_party');
  assert.equal(links[1].specificity, 'search_results');
  assert.equal(links[1].price, undefined, 'a link with no price carries none');
  assert.equal(parseIgnavBookingLinksResponse(null).length, 0);
  assert.equal(parseIgnavBookingLinksResponse({ booking_options: [{ links: [{ provider_name: 'X' }] }] }).length, 0, 'a link without a URL is dropped');
  assert.equal(parseIgnavBookingLinksResponse({ booking_options: [{ links: [{ provider_name: 'X', url: 'javascript:alert(1)' }] }] }).length, 0, 'a non-http URL is dropped');
});

test('booking links: fetched on demand with the ignav_id, cached per itinerary', async () => {
  clearIgnavCache();
  setKey();
  const calls = [];
  stubFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return okJson(BOOKING_LINKS_SAMPLE);
  });
  try {
    const first = await fetchIgnavBookingLinks({
      ignavId: 'ig_abc123',
      origin: 'JFK',
      destination: 'LHR',
      departureDate: '2027-01-15',
      outboundCarrierCode: 'BA',
      outboundFlightNumber: 'BA178',
      adults: 1,
    });
    assert.equal(first.available, true);
    assert.equal(first.links.length, 2);
    const second = await fetchIgnavBookingLinks({ ignavId: 'ig_abc123' });
    assert.equal(second.available, true);
    assert.equal(calls.length, 1, 'the second lookup for the same itinerary hits the cache');
    assert.equal(calls[0].url, 'https://ignav.com/api/fares/booking-links');
    assert.equal(calls[0].body.ignav_id, 'ig_abc123');
    assert.equal(calls[0].body.outbound_flight_number, 'BA178');
    const missing = await fetchIgnavBookingLinks({ ignavId: '' });
    assert.equal(missing.available, false);
    assert.equal(missing.reason, 'missing_id');
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('booking links without a key: honest empty, no fetch', async () => {
  clearIgnavCache();
  delete process.env.IGNAV_API_KEY;
  let called = false;
  stubFetch(async () => {
    called = true;
    return okJson(BOOKING_LINKS_SAMPLE);
  });
  try {
    const res = await fetchIgnavBookingLinks({ ignavId: 'ig_abc123' });
    assert.equal(res.available, false);
    assert.equal(res.configured, false);
    assert.equal(res.reason, 'no_key');
    assert.equal(called, false);
  } finally {
    restoreFetch();
    restoreKey();
  }
});

test('booking context: the itinerary hands the links endpoint what it needs', () => {
  const parsed = parseIgnavFareSearchResponse(ROUNDTRIP_SAMPLE);
  const ctx = ignavBookingContext(parsed.itineraries[0]);
  assert.equal(ctx.ignavId, 'ig_rt789');
  assert.equal(ctx.origin, 'JFK');
  assert.equal(ctx.destination, 'JFK');
  assert.equal(ctx.departureDate, '2027-01-15');
  assert.equal(ctx.returnDate, '2027-01-22');
  assert.equal(ctx.outboundCarrierCode, 'BA');
  assert.equal(ctx.outboundFlightNumber, 'BA178');
  assert.equal(ctx.inboundCarrierCode, 'BA');
  assert.equal(ctx.inboundFlightNumber, 'BA179');
});

test('empty messages: every reason says plainly what happened', () => {
  assert.ok(ignavEmptyMessage('no_key').includes('not connected yet'));
  assert.ok(ignavEmptyMessage('no_offers').includes('no live fares'));
  assert.ok(ignavEmptyMessage('unauthorized').includes('rejected the API key'));
  assert.ok(ignavEmptyMessage('payment_required').includes('free allowance'));
  assert.ok(ignavEmptyMessage('bogus').includes("couldn't be reached"));
});
