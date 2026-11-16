// Hotelbeds sandbox stays (Nov 16, 2026): the Stays tab's first
// live hotel source, in TEST mode. The sample payloads below are
// built from Hotelbeds' own OpenAPI specs (BookingAPI 3.0 +
// ContentAPI 3.0, read live Nov 16, 2026) — not from live calls:
// the keys do not exist in this VM. The signature, the
// availability mapping (incl. photo + price), the sandbox labeling,
// and the cache/degrade behavior are all pinned here; sandbox
// hotels are verified after Deploy, once the keys are in
// DigitalOcean.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/hotelbeds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clearHotelbedsCache,
  HOTELBEDS_MAX_HOTELS,
  HOTELBEDS_PRODUCTS,
  hotelbedsConfigured,
  hotelbedsEmptyMessage,
  hotelbedsImageUrl,
  hotelbedsProductActive,
  hotelbedsProductConfigured,
  hotelbedsProductEnabled,
  hotelbedsSandboxTag,
  hotelbedsSignature,
  mapAvailabilityHotel,
  mapAvailabilityHotels,
  parseAvailabilityResponse,
  parseContentDetailsResponse,
  searchHotelbedsStays,
} from '../lib/hotelbeds.ts';

const realFetch = globalThis.fetch;
const realKey = process.env.HOTELBEDS_API_KEY;
const realSecret = process.env.HOTELBEDS_API_SECRET;

function restore() {
  globalThis.fetch = realFetch;
  clearHotelbedsCache();
  if (realKey === undefined) delete process.env.HOTELBEDS_API_KEY;
  else process.env.HOTELBEDS_API_KEY = realKey;
  if (realSecret === undefined) delete process.env.HOTELBEDS_API_SECRET;
  else process.env.HOTELBEDS_API_SECRET = realSecret;
}

function withKeys() {
  process.env.HOTELBEDS_API_KEY = 'test-key';
  process.env.HOTELBEDS_API_SECRET = 'test-secret';
}

// A canned availability reply (official response shape:
// {hotels: {total, hotel: [{code, name, categoryCode,
// categoryName, destinationName, zoneName, latitude, longitude,
// minRate, currency, room: [{name, rate: [{net, rateKey,
// rateType, boardCode, boardName}]}]}]}}). The cheapest rate is
// deliberately not first, so the min-pick is actually tested.
const AVAILABILITY_SAMPLE = {
  auditData: { processTime: '12', timestamp: '2026-11-16T10:00:00.000+0000' },
  hotels: {
    checkIn: '2027-01-15',
    checkOut: '2027-01-22',
    total: 4,
    hotel: [
      {
        code: 1067,
        name: 'Hotel Example Palma',
        categoryCode: '4EST',
        categoryName: '4 STARS',
        destinationCode: 'PMI',
        destinationName: 'Majorca',
        zoneCode: 10,
        zoneName: 'Palma',
        latitude: '39.5696',
        longitude: '2.6502',
        minRate: 420.5,
        currency: 'EUR',
        room: [
          {
            code: 'DBL.ST',
            name: 'Double Standard',
            rate: [
              { rateKey: 'rk-expensive', rateType: 'BOOKABLE', net: 455.2, boardCode: 'BB', boardName: 'BED AND BREAKFAST' },
              { rateKey: 'rk-cheapest', rateType: 'RECHECK', net: 420.5, boardCode: 'RO', boardName: 'ROOM ONLY' },
            ],
          },
          {
            code: 'SUI',
            name: 'Suite',
            rate: [{ rateKey: 'rk-suite', rateType: 'BOOKABLE', net: 900, boardCode: 'HB', boardName: 'HALF BOARD' }],
          },
        ],
      },
      {
        code: 2050,
        name: 'Budget Inn',
        categoryCode: '2EST',
        categoryName: '2 STARS',
        destinationName: 'Majorca',
        zoneName: 'Palma',
        latitude: '39.5700',
        longitude: '2.6600',
        minRate: 210,
        currency: 'EUR',
        room: [{ name: 'Single', rate: [{ rateKey: 'rk-budget', rateType: 'BOOKABLE', net: 210, boardCode: 'RO', boardName: 'ROOM ONLY' }] }],
      },
      // No rates and no minRate: dropped, never a $0 card.
      { code: 9999, name: 'Priceless Hotel', currency: 'EUR', room: [] },
      // No name: dropped, never a blank card.
      { code: 8888, currency: 'EUR', minRate: 100, room: [] },
    ],
  },
};

// A canned ContentAPI details reply (official shape:
// {hotels: [{code, name, images: [{path, order,
// imageTypeCode}]}]}). The lowest-order image is deliberately not
// first, so the order-pick is actually tested.
const DETAILS_SAMPLE = {
  auditData: {},
  hotels: [
    {
      code: 1067,
      name: 'Hotel Example Palma',
      images: [
        { path: '00/000112/000112a_hb_ro_025.jpg', order: 2, imageTypeCode: 'RES' },
        { path: '00/000112/000112a_hb_a_001.jpg', order: 1, imageTypeCode: 'GEN' },
      ],
    },
    { code: 2050, name: 'Budget Inn', images: [] },
  ],
  total: 2,
};

const PARIS = {
  latitude: 48.86,
  longitude: 2.35,
  destination: 'Paris',
  checkIn: '2027-01-15',
  checkOut: '2027-01-22',
  guests: 2,
  rooms: 1,
};

function okJson(json) {
  return async () => ({ ok: true, status: 200, json: async () => json });
}

test('signature: SHA-256 hex of apiKey + secret + Unix seconds (docs verbatim)', async () => {
  // echo -n "keysecret1700000000" | sha256sum
  const expected = '278d74471a3b5267e27221967122169ad26fac349e0fb6a94779cdf050a0d038';
  assert.equal(await hotelbedsSignature('key', 'secret', 1700000000), expected);
  assert.match(await hotelbedsSignature('key', 'secret', 1700000001), /^[0-9a-f]{64}$/);
  assert.notEqual(
    await hotelbedsSignature('key', 'secret', 1700000001),
    await hotelbedsSignature('key', 'secret', 1700000000)
  );
});

test('image URL: partial ContentAPI path gets the documented photos host', () => {
  assert.equal(
    hotelbedsImageUrl('00/000112/000112a_hb_ro_025.jpg'),
    'https://photos.hotelbeds.com/giata/00/000112/000112a_hb_ro_025.jpg'
  );
  assert.equal(hotelbedsImageUrl('/00/000112/x.jpg'), 'https://photos.hotelbeds.com/giata/00/000112/x.jpg');
  assert.equal(
    hotelbedsImageUrl('https://photos.hotelbeds.com/giata/00/000112/x.jpg'),
    'https://photos.hotelbeds.com/giata/00/000112/x.jpg'
  );
  assert.equal(hotelbedsImageUrl(''), undefined);
  assert.equal(hotelbedsImageUrl(undefined), undefined);
});

test('availability mapping: cheapest rate wins, names and boards carried, prices per night + per traveler', () => {
  const hotels = mapAvailabilityHotels(AVAILABILITY_SAMPLE, 7, 2);
  assert.ok(hotels);
  assert.equal(hotels.length, 2);
  // Cheapest first.
  assert.equal(hotels[0].name, 'Budget Inn');
  assert.equal(hotels[0].price, 210);
  assert.equal(hotels[0].perNight, 30);
  assert.equal(hotels[0].perTraveler, 105);
  assert.equal(hotels[0].currency, 'EUR');
  assert.equal(hotels[0].roomName, 'Single');
  assert.equal(hotels[0].boardName, 'ROOM ONLY');
  assert.equal(hotels[0].rateType, 'BOOKABLE');
  assert.equal(hotels[1].name, 'Hotel Example Palma');
  assert.equal(hotels[1].price, 421);
  assert.equal(hotels[1].perNight, 60);
  assert.equal(hotels[1].perTraveler, 210);
  assert.equal(hotels[1].roomName, 'Double Standard');
  assert.equal(hotels[1].boardName, 'ROOM ONLY');
  assert.equal(hotels[1].rateType, 'RECHECK');
  assert.equal(hotels[1].categoryName, '4 STARS');
  assert.equal(hotels[1].zoneName, 'Palma');
  assert.equal(hotels[1].destinationName, 'Majorca');
});

test('availability mapping: minRate is the fallback when a hotel has no rates', () => {
  const value = {
    hotels: {
      hotel: [
        { code: 1, name: 'Min Rate Only', minRate: 99.4, currency: 'USD', room: [] },
      ],
    },
  };
  const hotels = mapAvailabilityHotels(value, 3, 1);
  assert.ok(hotels);
  assert.equal(hotels.length, 1);
  assert.equal(hotels[0].price, 99);
  assert.equal(hotels[0].roomName, undefined);
});

test('availability mapping: priceless and nameless hotels are dropped, malformed is null', () => {
  const hotels = mapAvailabilityHotels(AVAILABILITY_SAMPLE, 7, 2);
  assert.ok(hotels);
  assert.ok(!hotels.some((h) => h.code === 9999 || h.code === 8888));
  assert.equal(mapAvailabilityHotels({}, 7, 2), null);
  assert.equal(mapAvailabilityHotels({ hotels: {} }, 7, 2), null);
  assert.equal(mapAvailabilityHotels({ hotels: { hotel: 'nope' } }, 7, 2), null);
  assert.equal(parseAvailabilityResponse(AVAILABILITY_SAMPLE)?.length, 4);
  assert.equal(parseAvailabilityResponse(null), null);
});

test('availability mapping: the list caps at the panel count, cheapest first', () => {
  const many = {
    hotels: {
      hotel: Array.from({ length: 12 }, (_, i) => ({
        code: 100 + i,
        name: `Hotel ${i}`,
        minRate: 500 - i * 10,
        currency: 'USD',
        room: [],
      })),
    },
  };
  const hotels = mapAvailabilityHotels(many, 7, 2);
  assert.ok(hotels);
  assert.equal(hotels.length, HOTELBEDS_MAX_HOTELS);
  assert.equal(hotels[0].price, 390);
  assert.equal(hotels[hotels.length - 1].price, 440);
});

test('content details mapping: lowest-order image wins, imageless hotels map to nothing', () => {
  const images = parseContentDetailsResponse(DETAILS_SAMPLE);
  assert.equal(images.get(1067), 'https://photos.hotelbeds.com/giata/00/000112/000112a_hb_a_001.jpg');
  assert.equal(images.has(2050), false);
  assert.equal(parseContentDetailsResponse({}).size, 0);
  // Single-hotel form.
  const single = parseContentDetailsResponse({
    hotel: { code: 7, images: [{ path: 'a/b.jpg', order: 0 }] },
  });
  assert.equal(single.get(7), 'https://photos.hotelbeds.com/giata/a/b.jpg');
});

test('sandbox labeling: every tag says sandbox + test data + not bookable, with the check date', () => {
  const tag = hotelbedsSandboxTag('2027-01-15');
  assert.match(tag, /Hotelbeds/i);
  assert.match(tag, /Sandbox/i);
  assert.match(tag, /test data/i);
  assert.match(tag, /not a bookable room/i);
  assert.ok(tag.includes('2027-01-15'), 'check date is in the tag');
  assert.ok(!/live (price|quote|fare)/i.test(hotelbedsSandboxTag(null)), 'no live-price claim without a date either');
});

test('empty messages: each reason names the real cause, never an invented hotel', () => {
  assert.match(hotelbedsEmptyMessage('no_key'), /not connected yet/);
  assert.match(hotelbedsEmptyMessage('no_key'), /HOTELBEDS_API_KEY/);
  assert.match(hotelbedsEmptyMessage('quota_exceeded'), /50 requests a day/);
  assert.match(hotelbedsEmptyMessage('no_hotels'), /no test hotels/);
  assert.match(hotelbedsEmptyMessage('unauthorized'), /rejected the API key/);
  assert.match(hotelbedsEmptyMessage('no_dates'), /check-in and check-out dates/);
  assert.match(hotelbedsEmptyMessage('no_coordinates'), /no location on file/);
  assert.match(hotelbedsEmptyMessage('error'), /could not be reached/);
});

test('search: no keys means no_key and no network call at all', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    delete process.env.HOTELBEDS_API_KEY;
    delete process.env.HOTELBEDS_API_SECRET;
    assert.equal(hotelbedsConfigured(), false);
    const res = await searchHotelbedsStays(PARIS);
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_key');
    assert.equal(res.sandbox, true);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('search: one availability call + one details call, photos attached, second search is cached', async () => {
  const calls = [];
  let postBody = null;
  let postHeaders = null;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('/hotel-api/1.0/hotels')) {
      postBody = JSON.parse(String(init.body));
      postHeaders = init.headers;
      return { ok: true, status: 200, json: async () => AVAILABILITY_SAMPLE };
    }
    if (String(url).includes('/hotel-content-api/1.0/hotels/')) {
      // One call for both hotel codes on screen.
      assert.ok(String(url).includes('2050'), 'both codes in one details call');
      assert.ok(String(url).includes('1067'), 'both codes in one details call');
      return { ok: true, status: 200, json: async () => DETAILS_SAMPLE };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    withKeys();
    const res = await searchHotelbedsStays(PARIS);
    assert.equal(res.live, true);
    assert.equal(res.configured, true);
    assert.equal(res.sandbox, true);
    assert.equal(res.hotels.length, 2);
    assert.equal(res.nights, 7);
    assert.equal(res.checkedAt, new Date().toISOString().slice(0, 10));
    const palma = res.hotels.find((h) => h.code === 1067);
    assert.equal(
      palma.imageUrl,
      'https://photos.hotelbeds.com/giata/00/000112/000112a_hb_a_001.jpg'
    );
    const budget = res.hotels.find((h) => h.code === 2050);
    assert.equal(budget.imageUrl, undefined);
    // The request itself: dates, occupancy, geolocation, auth.
    assert.deepEqual(postBody.stay, { checkIn: '2027-01-15', checkOut: '2027-01-22' });
    assert.deepEqual(postBody.occupancies, [{ rooms: 1, adults: 2, children: 0 }]);
    assert.equal(postBody.geolocation.latitude, 48.86);
    assert.equal(postBody.geolocation.longitude, 2.35);
    assert.equal(postBody.geolocation.unit, 'km');
    assert.equal(postHeaders['Api-key'], 'test-key');
    assert.match(postHeaders['X-Signature'], /^[0-9a-f]{64}$/);
    // Second identical search: served from the 6h cache, no new calls.
    const again = await searchHotelbedsStays(PARIS);
    assert.equal(again.live, true);
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

test('search: a failed details call leaves hotels imageless, never errored', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/hotel-api/1.0/hotels')) {
      return { ok: true, status: 200, json: async () => AVAILABILITY_SAMPLE };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  try {
    withKeys();
    const res = await searchHotelbedsStays(PARIS);
    assert.equal(res.live, true);
    assert.equal(res.hotels.length, 2);
    assert.equal(res.hotels.every((h) => h.imageUrl === undefined), true);
  } finally {
    restore();
  }
});

test('search: empty availability is no_hotels, never an invented hotel', async () => {
  globalThis.fetch = okJson({ hotels: { total: 0, hotel: [] } });
  try {
    withKeys();
    const res = await searchHotelbedsStays(PARIS);
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_hotels');
    assert.deepEqual(res.hotels, []);
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
    withKeys();
    const first = await searchHotelbedsStays(PARIS);
    assert.equal(first.live, false);
    assert.equal(first.reason, 'quota_exceeded');
    const second = await searchHotelbedsStays(PARIS);
    assert.equal(second.reason, 'quota_exceeded');
    assert.equal(calls, 1, 'the second search never hit the network');
  } finally {
    restore();
  }
});

test('search: a 401 is unauthorized, a 500 is upstream_unavailable', async () => {
  try {
    withKeys();
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    assert.equal((await searchHotelbedsStays(PARIS)).reason, 'unauthorized');
    clearHotelbedsCache();
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.equal((await searchHotelbedsStays(PARIS)).reason, 'upstream_unavailable');
  } finally {
    restore();
  }
});

test('wiring: the Stays tab renders the sandbox section with Save this search, never Book now', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('HotelbedsStays'), 'StayResults renders the Hotelbeds section');
  assert.ok(src.includes('/api/hotelbeds-stays'), 'the section fetches the new route');
  assert.ok(src.includes('hotelbedsSandboxTag'), 'every hotel card carries the sandbox tag');
  assert.ok(src.includes('Hotels in {query.dest'), 'the section names the searched destination');
  assert.ok(src.includes('Hotelbeds sandbox is connected'), 'the header says sandbox is connected');
  // The hotel card's own block: photo + price + sandbox tag + Save
  // this search, and no booking action anywhere near it.
  const cardStart = src.indexOf('function HotelbedsHotelCard');
  const cardEnd = src.indexOf('function HotelbedsStays');
  assert.ok(cardStart > -1 && cardEnd > cardStart, 'hotel card component exists');
  const card = src.slice(cardStart, cardEnd);
  assert.ok(card.includes('SafeImg'), 'hotel cards show the ContentAPI photo');
  assert.ok(card.includes('Save this search'), 'hotel cards keep Save this search');
  assert.ok(!/Book now/i.test(card), 'no Book now on a sandbox hotel card');
  const route = readFileSync(new URL('../app/api/hotelbeds-stays/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('CITY_INFO'), 'the route resolves city names via lat/lng, never a guessed code');
  assert.ok(route.includes("sandbox: true"), 'the route marks every response sandbox');
});

test('toggles: hotel on, activities/transfers/bundle off — one place flips a product', () => {
  assert.deepEqual(HOTELBEDS_PRODUCTS, {
    hotel: true,
    activities: false,
    transfers: false,
    bundle: false,
  });
  assert.equal(hotelbedsProductEnabled('hotel'), true);
  assert.equal(hotelbedsProductEnabled('activities'), false);
  assert.equal(hotelbedsProductEnabled('transfers'), false);
  assert.equal(hotelbedsProductEnabled('bundle'), false);
});

test('toggles: a product is active only when its toggle is on AND its keys are set', () => {
  const saved = {
    activitiesKey: process.env.HOTELBEDS_ACTIVITIES_API_KEY,
    activitiesSecret: process.env.HOTELBEDS_ACTIVITIES_API_SECRET,
    transfersKey: process.env.HOTELBEDS_TRANSFERS_API_KEY,
    transfersSecret: process.env.HOTELBEDS_TRANSFERS_API_SECRET,
  };
  try {
    // No keys anywhere: nothing is active, even the hotel toggle.
    delete process.env.HOTELBEDS_API_KEY;
    delete process.env.HOTELBEDS_API_SECRET;
    delete process.env.HOTELBEDS_ACTIVITIES_API_KEY;
    delete process.env.HOTELBEDS_ACTIVITIES_API_SECRET;
    delete process.env.HOTELBEDS_TRANSFERS_API_KEY;
    delete process.env.HOTELBEDS_TRANSFERS_API_SECRET;
    delete process.env.HOTELBEDS_BUNDLE_API_KEY;
    delete process.env.HOTELBEDS_BUNDLE_API_SECRET;
    assert.equal(hotelbedsProductConfigured('hotel'), false);
    assert.equal(hotelbedsProductActive('hotel'), false);
    assert.equal(hotelbedsProductConfigured('activities'), false);
    assert.equal(hotelbedsProductActive('activities'), false);
    // Keys set but toggle off: configured, never active.
    process.env.HOTELBEDS_ACTIVITIES_API_KEY = 'test-act-key';
    process.env.HOTELBEDS_ACTIVITIES_API_SECRET = 'test-act-secret';
    process.env.HOTELBEDS_TRANSFERS_API_KEY = 'test-trf-key';
    process.env.HOTELBEDS_TRANSFERS_API_SECRET = 'test-trf-secret';
    assert.equal(hotelbedsProductConfigured('activities'), true);
    assert.equal(hotelbedsProductActive('activities'), false, 'toggle off wins over set keys');
    assert.equal(hotelbedsProductConfigured('transfers'), true);
    assert.equal(hotelbedsProductActive('transfers'), false, 'toggle off wins over set keys');
    // Hotel: toggle on + keys = active.
    withKeys();
    assert.equal(hotelbedsProductConfigured('hotel'), true);
    assert.equal(hotelbedsProductActive('hotel'), true);
    // Flipping the toggle in code turns the product off without touching keys.
    HOTELBEDS_PRODUCTS.hotel = false;
    assert.equal(hotelbedsProductEnabled('hotel'), false);
    assert.equal(hotelbedsProductActive('hotel'), false);
  } finally {
    HOTELBEDS_PRODUCTS.hotel = true;
    if (saved.activitiesKey === undefined) delete process.env.HOTELBEDS_ACTIVITIES_API_KEY;
    else process.env.HOTELBEDS_ACTIVITIES_API_KEY = saved.activitiesKey;
    if (saved.activitiesSecret === undefined) delete process.env.HOTELBEDS_ACTIVITIES_API_SECRET;
    else process.env.HOTELBEDS_ACTIVITIES_API_SECRET = saved.activitiesSecret;
    if (saved.transfersKey === undefined) delete process.env.HOTELBEDS_TRANSFERS_API_KEY;
    else process.env.HOTELBEDS_TRANSFERS_API_KEY = saved.transfersKey;
    if (saved.transfersSecret === undefined) delete process.env.HOTELBEDS_TRANSFERS_API_SECRET;
    else process.env.HOTELBEDS_TRANSFERS_API_SECRET = saved.transfersSecret;
    restore();
  }
});

test('toggles: the Stays tab gates its section on the hotel toggle', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes("hotelbedsProductEnabled('hotel')"), 'StayResults mounts HotelbedsStays only while hotel is on');
});

test('search: hotel toggle off means disabled and no network call, whatever the keys', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    withKeys();
    HOTELBEDS_PRODUCTS.hotel = false;
    const res = await searchHotelbedsStays(PARIS);
    assert.equal(res.live, false);
    assert.equal(res.enabled, false);
    assert.equal(res.reason, 'disabled');
    assert.equal(res.sandbox, true);
    assert.equal(calls, 0);
    assert.match(hotelbedsEmptyMessage('disabled'), /switched off/);
  } finally {
    HOTELBEDS_PRODUCTS.hotel = true;
    restore();
  }
});
