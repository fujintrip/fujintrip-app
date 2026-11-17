// Hotelbeds sandbox activities (Nov 16, 2026): the Attractions
// tab's live activity source, in TEST mode — wired, toggle ON
// (interface round, Nov 16 2026, P0 #8).
// The sample payloads below are built from Hotelbeds' own
// Activities docs (availability page + OpenAPI spec, read live
// Nov 16, 2026) — not from live calls: the keys do not exist in
// this VM. The mapping (incl. photo + price), the sandbox
// labeling, the toggle gating, and the cache/degrade behavior are
// all pinned here; sandbox activities are verified after Deploy,
// once the keys are in DigitalOcean and the toggle is flipped.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/hotelbeds-activities.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOTELBEDS_PRODUCTS } from '../lib/hotelbeds.ts';
import {
  activityModalityOptions,
  clearHotelbedsActivitiesCache,
  filterHotelbedsActivities,
  hotelbedsActivitiesEmptyMessage,
  hotelbedsActivitiesSandboxTag,
  mapAvailabilityActivities,
  parseActivitiesResponse,
  searchHotelbedsActivities,
} from '../lib/hotelbeds-activities.ts';

const realFetch = globalThis.fetch;
const realKey = process.env.HOTELBEDS_ACTIVITIES_API_KEY;
const realSecret = process.env.HOTELBEDS_ACTIVITIES_API_SECRET;

function restore() {
  globalThis.fetch = realFetch;
  clearHotelbedsActivitiesCache();
  // The shipped default is ON (interface round, Nov 16 2026 —
  // P0 #8): restore puts the toggle back on, not off.
  HOTELBEDS_PRODUCTS.activities = true;
  if (realKey === undefined) delete process.env.HOTELBEDS_ACTIVITIES_API_KEY;
  else process.env.HOTELBEDS_ACTIVITIES_API_KEY = realKey;
  if (realSecret === undefined) delete process.env.HOTELBEDS_ACTIVITIES_API_SECRET;
  else process.env.HOTELBEDS_ACTIVITIES_API_SECRET = realSecret;
}

function withKeys() {
  process.env.HOTELBEDS_ACTIVITIES_API_KEY = 'test-act-key';
  process.env.HOTELBEDS_ACTIVITIES_API_SECRET = 'test-act-secret';
}

function enable() {
  HOTELBEDS_PRODUCTS.activities = true;
}

// A canned availability reply (official response shape:
// {activities: [{activityCode, country: {code, name,
// destinations: [{node, name}]}, modalities: [{code, name,
// duration, amountsFrom: [{paxType, ageFrom, ageTo, amount,
// boxOfficeAmount}]}], currencyName, amountsFrom: [...],
// content: {name, summary, currency, media: {images:
// [{visualizationOrder, mimeType, urls: [{sizeType,
// resource}]}]}}]}). The cheapest activity is deliberately
// second, so the min-pick is actually tested.
const AVAILABILITY_SAMPLE = {
  auditData: {},
  pagination: { itemsPerPage: 10, page: 1, totalItems: 2 },
  activities: [
    {
      activityCode: 'E-E10-PARHOPONHO',
      country: { code: 'ES', name: 'Spain', destinations: [{ node: 'BCN', name: 'Barcelona' }] },
      operationDays: [{ code: 'MON', name: 'Monday' }],
      modalities: [
        {
          code: '1',
          name: 'Standard ticket',
          duration: 1,
          amountsFrom: [{ paxType: 'ADULT', ageFrom: 12, ageTo: 99, amount: 45.5, boxOfficeAmount: 52 }],
        },
        {
          code: '2',
          name: 'Premium ticket',
          duration: 1,
          amountsFrom: [{ paxType: 'ADULT', ageFrom: 12, ageTo: 99, amount: 89, boxOfficeAmount: 95 }],
        },
      ],
      currencyName: 'Euro',
      amountsFrom: [{ paxType: 'ADULT', ageFrom: 12, ageTo: 99, amount: 45.5, boxOfficeAmount: 52 }],
      content: {
        name: 'Barcelona Hop-On Hop-Off Bus Tour',
        summary: '<p>See the city at your own pace.</p>',
        currency: 'EUR',
        code: 'E-E10-PARHOPONHO',
        media: {
          images: [
            {
              visualizationOrder: 2,
              mimeType: 'image/jpeg',
              urls: [
                { sizeType: 'SMALL', resource: 'https://example.com/small.jpg' },
                { sizeType: 'LARGE', resource: 'https://example.com/large.jpg' },
              ],
            },
            {
              visualizationOrder: 1,
              mimeType: 'image/jpeg',
              urls: [{ sizeType: 'MEDIUM', resource: 'https://example.com/medium.jpg' }],
            },
          ],
        },
      },
    },
    {
      activityCode: 'E-E10-CRUISE',
      country: { code: 'ES', name: 'Spain', destinations: [{ node: 'BCN', name: 'Barcelona' }] },
      modalities: [
        {
          code: '1',
          name: 'Sunset cruise',
          duration: 1,
          amountsFrom: [{ paxType: 'ADULT', ageFrom: 12, ageTo: 99, amount: 29, boxOfficeAmount: 35 }],
        },
      ],
      currencyName: 'Euro',
      amountsFrom: [{ paxType: 'ADULT', ageFrom: 12, ageTo: 99, amount: 29, boxOfficeAmount: 35 }],
      content: {
        name: 'Barcelona Sunset Cruise',
        summary: 'Sail past the skyline at golden hour.',
        currency: 'EUR',
        code: 'E-E10-CRUISE',
        media: { images: [] },
      },
    },
    // No name: dropped, never a blank card.
    { activityCode: 'E-E10-NONAME', modalities: [], amountsFrom: [{ paxType: 'ADULT', amount: 10 }], content: {} },
    // No price: dropped, never a $0 card.
    {
      activityCode: 'E-E10-FREE',
      modalities: [],
      amountsFrom: [],
      content: { name: 'Free Walking Tour', currency: 'EUR' },
    },
  ],
};

const BARCELONA = {
  latitude: 41.39,
  longitude: 2.17,
  destination: 'Barcelona',
  from: '2027-01-15',
  to: '2027-01-22',
  travelers: 2,
};

test('toggle: activities is wired and switched on (interface round, Nov 16 2026 — P0 #8)', () => {
  assert.equal(HOTELBEDS_PRODUCTS.activities, true);
});

test('mapping: cheapest first, ADULT from-price, modality + photo + summary carried', () => {
  const activities = mapAvailabilityActivities(AVAILABILITY_SAMPLE, 2);
  assert.ok(activities);
  assert.equal(activities.length, 2);
  assert.equal(activities[0].code, 'E-E10-CRUISE');
  assert.equal(activities[0].name, 'Barcelona Sunset Cruise');
  assert.equal(activities[0].price, 29);
  assert.equal(activities[0].perTraveler, 29);
  assert.equal(activities[0].total, 58);
  assert.equal(activities[0].currency, 'EUR');
  assert.equal(activities[0].modalityName, 'Sunset cruise');
  assert.equal(activities[0].destinationName, 'Barcelona');
  assert.equal(activities[0].countryName, 'Spain');
  assert.equal(activities[0].imageUrl, undefined);
  assert.equal(activities[1].code, 'E-E10-PARHOPONHO');
  assert.equal(activities[1].price, 46);
  assert.equal(activities[1].total, 92);
  assert.equal(activities[1].modalityName, 'Standard ticket');
  assert.equal(activities[1].durationDays, 1);
  // Lowest display order wins, even when it only has MEDIUM.
  assert.equal(activities[1].imageUrl, 'https://example.com/medium.jpg');
  // HTML is stripped from the summary, never injected.
  assert.equal(activities[1].summary, 'See the city at your own pace.');
  assert.ok(!activities.some((a) => a.code === 'E-E10-NONAME' || a.code === 'E-E10-FREE'));
});

test('mapping: malformed responses are null, never guessed tours', () => {
  assert.equal(mapAvailabilityActivities({}, 2), null);
  assert.equal(mapAvailabilityActivities({ activities: 'nope' }, 2), null);
  assert.equal(parseActivitiesResponse(AVAILABILITY_SAMPLE)?.length, 4);
  assert.equal(parseActivitiesResponse(null), null);
});

test('filters: modality options from the returned activities, with counts', () => {
  const activities = mapAvailabilityActivities(AVAILABILITY_SAMPLE, 2);
  assert.deepEqual(activityModalityOptions(activities), [
    { value: 'Standard ticket', label: 'Standard ticket', count: 1 },
    { value: 'Sunset cruise', label: 'Sunset cruise', count: 1 },
  ]);
});

test('filters: modality + duration + max price narrow together; unknown values never match', () => {
  const activities = mapAvailabilityActivities(AVAILABILITY_SAMPLE, 2);
  const none = { modality: null, duration: 'any', maxPrice: null };
  assert.equal(filterHotelbedsActivities(activities, none).length, 2);
  assert.equal(filterHotelbedsActivities(activities, { ...none, modality: 'Sunset cruise' }).length, 1);
  assert.equal(filterHotelbedsActivities(activities, { ...none, modality: 'Sunset cruise' })[0].code, 'E-E10-CRUISE');
  assert.equal(filterHotelbedsActivities(activities, { ...none, modality: 'Walking tour' }).length, 0);
  assert.equal(filterHotelbedsActivities(activities, { ...none, duration: '1' }).length, 2);
  assert.equal(filterHotelbedsActivities(activities, { ...none, duration: '2' }).length, 0);
  assert.equal(filterHotelbedsActivities(activities, { ...none, duration: '3plus' }).length, 0);
  assert.equal(filterHotelbedsActivities(activities, { ...none, maxPrice: 30 }).length, 1);
  assert.equal(filterHotelbedsActivities(activities, { ...none, maxPrice: 30 })[0].code, 'E-E10-CRUISE');
});

test('sandbox labeling: every tag says sandbox + test data + not bookable, with the check date', () => {
  const tag = hotelbedsActivitiesSandboxTag('2027-01-15');
  assert.match(tag, /Hotelbeds/i);
  assert.match(tag, /Sandbox/i);
  assert.match(tag, /test data/i);
  assert.match(tag, /not a bookable activity/i);
  assert.ok(tag.includes('2027-01-15'), 'check date is in the tag');
});

test('empty messages: disabled, no key, and quota each name the real cause', () => {
  assert.match(hotelbedsActivitiesEmptyMessage('disabled'), /switched off/);
  assert.match(hotelbedsActivitiesEmptyMessage('no_key'), /not connected yet/);
  assert.match(hotelbedsActivitiesEmptyMessage('no_key'), /HOTELBEDS_ACTIVITIES_API_KEY/);
  assert.match(hotelbedsActivitiesEmptyMessage('quota_exceeded'), /50 requests a day/);
  assert.match(hotelbedsActivitiesEmptyMessage('no_activities'), /no test activities/);
});

test('search: switched off means disabled and no network call, whatever the keys', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    withKeys();
    // The shipped default is ON — this case flips it off itself.
    HOTELBEDS_PRODUCTS.activities = false;
    const res = await searchHotelbedsActivities(BARCELONA);
    assert.equal(res.live, false);
    assert.equal(res.enabled, false);
    assert.equal(res.reason, 'disabled');
    assert.equal(res.sandbox, true);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('search: on + keys means one availability call, photos attached, second search cached', async () => {
  const calls = [];
  let postBody = null;
  let postHeaders = null;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    postBody = JSON.parse(String(init.body));
    postHeaders = init.headers;
    return { ok: true, status: 200, json: async () => AVAILABILITY_SAMPLE };
  };
  try {
    enable();
    withKeys();
    const res = await searchHotelbedsActivities(BARCELONA);
    assert.equal(res.live, true);
    assert.equal(res.enabled, true);
    assert.equal(res.active, true);
    assert.equal(res.activities.length, 2);
    assert.equal(res.checkedAt, new Date().toISOString().slice(0, 10));
    const tour = res.activities.find((a) => a.code === 'E-E10-PARHOPONHO');
    assert.equal(tour.imageUrl, 'https://example.com/medium.jpg');
    // The request itself: GPS filter, dates, adult paxes, PRICE order.
    assert.deepEqual(postBody.filters, [{ searchFilterItems: [{ type: 'GPS', value: '41.39, 2.17' }] }]);
    assert.equal(postBody.from, '2027-01-15');
    assert.equal(postBody.to, '2027-01-22');
    assert.deepEqual(postBody.paxes, [{ age: 30 }, { age: 30 }]);
    assert.equal(postBody.order, 'PRICE');
    assert.equal(postHeaders['Api-key'], 'test-act-key');
    assert.match(postHeaders['X-Signature'], /^[0-9a-f]{64}$/);
    assert.equal(calls.length, 1);
    // Second identical search: served from the 6h cache, no new calls.
    const again = await searchHotelbedsActivities(BARCELONA);
    assert.equal(again.live, true);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test('search: on but no keys means no_key and no network call', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    enable();
    delete process.env.HOTELBEDS_ACTIVITIES_API_KEY;
    delete process.env.HOTELBEDS_ACTIVITIES_API_SECRET;
    const res = await searchHotelbedsActivities(BARCELONA);
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_key');
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('search: a 403 quota answer blocks further calls without burning the quota', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 403, json: async () => ({}) };
  };
  try {
    enable();
    withKeys();
    const first = await searchHotelbedsActivities(BARCELONA);
    assert.equal(first.reason, 'quota_exceeded');
    const second = await searchHotelbedsActivities(BARCELONA);
    assert.equal(second.reason, 'quota_exceeded');
    assert.equal(calls, 1, 'the second search never hit the network');
  } finally {
    restore();
  }
});

test('wiring: the Attractions tab gates the section on the toggle and keeps its header while off', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('HotelbedsActivities'), 'TourResults renders the Hotelbeds section');
  assert.ok(src.includes("hotelbedsProductEnabled('activities')"), 'the section mounts only while the toggle is on');
  assert.ok(src.includes('/api/hotelbeds-activities'), 'the section fetches the new route');
  assert.ok(src.includes('hotelbedsActivitiesSandboxTag'), 'every activity card carries the sandbox tag');
  assert.ok(
    src.includes('Live tours arrive when Viator / GetYourGuide / Klook connect.'),
    'the header still says live tours arrive with Viator — the product is off, so nothing claims otherwise'
  );
  const cardStart = src.indexOf('function HotelbedsActivityCard');
  const cardEnd = src.indexOf('function HotelbedsActivities');
  assert.ok(cardStart > -1 && cardEnd > cardStart, 'activity card component exists');
  const card = src.slice(cardStart, cardEnd);
  assert.ok(card.includes('SafeImg'), 'activity cards show the photo');
  assert.ok(card.includes('Save this search'), 'activity cards keep Save this search');
  assert.ok(!/Book now/i.test(card), 'no Book now on a sandbox activity card');
  const route = readFileSync(new URL('../app/api/hotelbeds-activities/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('CITY_INFO'), 'the route resolves city names via lat/lng, never a guessed code');
  assert.ok(route.includes("sandbox: true"), 'the route marks every response sandbox');
});
