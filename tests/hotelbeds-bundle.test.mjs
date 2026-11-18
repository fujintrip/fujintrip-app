// Hotelbeds bundle (Nov 16, 2026): the Bundle key's packaging
// search — wired and activatable, NO UI, NO planner rebuild.
// There is no separate Bundle API in Hotelbeds' official docs
// (verified Nov 16, 2026 against the OpenAPI repo): bundling is
// a Hotel BookingAPI feature — availability with packaging: true
// + hotelPackage: 'YES' under one confirmation. The planner is
// untouched: it already builds packages from its own legs. The
// route answers GET with its status so activation can be checked
// without spending a quota call. These tests pin the toggle (ON
// since Nov 17, 2026 — activated with the packages API; the Bundle
// key is live in DigitalOcean), the disabled path (toggle forced
// off), the packaging flags in the request, and that the planner
// stays bundle-free.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/hotelbeds-bundle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOTELBEDS_PRODUCTS } from '../lib/hotelbeds.ts';
import {
  clearHotelbedsBundleCache,
  hotelbedsBundleEmptyMessage,
  hotelbedsBundleNote,
  hotelbedsBundleStatus,
  searchHotelbedsBundle,
} from '../lib/hotelbeds-bundle.ts';

const realFetch = globalThis.fetch;
const realKey = process.env.HOTELBEDS_BUNDLE_API_KEY;
const realSecret = process.env.HOTELBEDS_BUNDLE_API_SECRET;

function restore() {
  globalThis.fetch = realFetch;
  clearHotelbedsBundleCache();
  HOTELBEDS_PRODUCTS.bundle = false;
  if (realKey === undefined) delete process.env.HOTELBEDS_BUNDLE_API_KEY;
  else process.env.HOTELBEDS_BUNDLE_API_KEY = realKey;
  if (realSecret === undefined) delete process.env.HOTELBEDS_BUNDLE_API_SECRET;
  else process.env.HOTELBEDS_BUNDLE_API_SECRET = realSecret;
}

function withKeys() {
  process.env.HOTELBEDS_BUNDLE_API_KEY = 'test-bnd-key';
  process.env.HOTELBEDS_BUNDLE_API_SECRET = 'test-bnd-secret';
}

function enable() {
  HOTELBEDS_PRODUCTS.bundle = true;
}

// Canned hotel availability reply, the SAME shape as the hotel
// client tests (docs shape: {hotels: {hotels: [{code, name,
// categoryCode, zoneCode, latitude, longitude, minRate,
// currency, room: [{name, rate: [{net, rateKey, rateType,
// boardCode, boardName}]}]}}}) — reused because the bundle
// client runs the same availability call with packaging on.
const AVAILABILITY_SAMPLE = {
  hotels: {
    checkIn: '2027-01-15',
    checkOut: '2027-01-22',
    total: 1,
    hotel: [
      {
        code: 88,
        name: 'Hotel Example Barcelona',
        categoryCode: '4EST',
        zoneCode: 123,
        latitude: '41.39',
        longitude: '2.17',
        minRate: 150,
        currency: 'EUR',
        room: [
          {
            code: 'DBL',
            name: 'Double',
            rate: [{ rateKey: 'rk1', rateType: 'BOOKABLE', net: 150, boardCode: 'RO', boardName: 'Room only' }],
          },
        ],
      },
    ],
  },
};

const BARCELONA = {
  latitude: 41.39,
  longitude: 2.17,
  destination: 'Barcelona',
  checkIn: '2027-01-15',
  checkOut: '2027-01-22',
  adults: 2,
  rooms: 1,
};

test('toggle: bundle is switched ON by default (activated Nov 17, 2026)', () => {
  assert.equal(HOTELBEDS_PRODUCTS.bundle, true);
  const status = hotelbedsBundleStatus();
  assert.equal(status.source, 'hotelbeds-bundle');
  assert.equal(status.enabled, true);
  // No keys in the test env, so configured/active stay false — the
  // toggle is on, the connection is not.
  assert.equal(status.configured, false);
  assert.equal(status.active, false);
  assert.ok(status.note.includes('planner'), 'the note says the planner builds packages itself');
});

test('status: switched off means disabled, even when the keys are set', () => {
  HOTELBEDS_PRODUCTS.bundle = false;
  withKeys();
  try {
    const status = hotelbedsBundleStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.configured, true);
    assert.equal(status.active, false);
    assert.match(hotelbedsBundleEmptyMessage('disabled'), /switched off/);
  } finally {
    restore();
  }
});

test('search: switched off means disabled and no network call, whatever the keys', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    HOTELBEDS_PRODUCTS.bundle = false;
    withKeys();
    const res = await searchHotelbedsBundle(BARCELONA);
    assert.equal(res.live, false);
    assert.equal(res.reason, 'disabled');
    assert.equal(res.sandbox, true);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('search: on + keys means one availability call with packaging on, hotels mapped', async () => {
  const calls = [];
  let postBody = null;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    postBody = JSON.parse(String(init.body));
    return { ok: true, status: 200, json: async () => AVAILABILITY_SAMPLE };
  };
  try {
    enable();
    withKeys();
    const res = await searchHotelbedsBundle(BARCELONA);
    assert.equal(res.live, true);
    assert.equal(res.active, true);
    assert.equal(res.hotels.length, 1);
    assert.equal(res.hotels[0].name, 'Hotel Example Barcelona');
    assert.equal(res.hotels[0].price, 150);
    // The packaging flags — the whole point of the bundle product.
    assert.equal(postBody.packaging, true, 'packaging: true is sent');
    assert.equal(postBody.hotelPackage, 'YES', "hotelPackage: 'YES' is sent");
    assert.equal(postBody.stay.checkIn, '2027-01-15');
    assert.equal(postBody.stay.checkOut, '2027-01-22');
    assert.equal(calls.length, 1);
    const again = await searchHotelbedsBundle(BARCELONA);
    assert.equal(again.live, true);
    assert.equal(calls.length, 1, 'the second search is served from the 6h cache');
  } finally {
    restore();
  }
});

test('empty messages: no key and quota each name the real cause', () => {
  assert.match(hotelbedsBundleEmptyMessage('no_key'), /not connected yet/);
  assert.match(hotelbedsBundleEmptyMessage('no_key'), /HOTELBEDS_BUNDLE_API_KEY/);
  assert.match(hotelbedsBundleEmptyMessage('quota_exceeded'), /50 requests a day/);
  assert.match(hotelbedsBundleEmptyMessage('no_hotels'), /no test hotels/);
});

test('wiring: the route answers status without spending quota, and the planner is untouched', () => {
  const route = readFileSync(new URL('../app/api/hotelbeds-bundle/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('hotelbedsBundleStatus'), 'GET returns the bundle status');
  assert.ok(route.includes('packaging'), 'the route documents the packaging search');
  assert.ok(route.includes("sandbox: true"), 'the route marks every response sandbox');
  // No UI for bundle: the results component must not reference it.
  const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(!results.includes('HotelbedsBundle'), 'no bundle UI in the results');
  // No planner rebuild: the planner builds packages from its own legs.
  const planner = readFileSync(new URL('../lib/planner.ts', import.meta.url), 'utf8');
  assert.ok(!planner.toLowerCase().includes('hotelbeds'), 'the planner never mentions Hotelbeds');
  assert.ok(planner.includes('function buildPlan'), 'buildPlan still builds packages from its own legs');
  assert.ok(hotelbedsBundleNote().includes('planner'), 'the client note says the planner is untouched');
});
