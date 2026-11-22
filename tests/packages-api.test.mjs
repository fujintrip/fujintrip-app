// Packages API (Nov 17, 2026): GET /api/packages serves the 21
// ready-made trips as JSON — the package list, each price resolved
// through packagePrice(), plus a sources block that says plainly
// what is live and what is still waiting. Tour suppliers (TourRadar,
// Intrepid, Viator — enquiries sent Nov 17, 2026) are still awaiting
// replies; the Hotelbeds Bundle packaging search feeds the seam
// since Nov 21, 2026 (see collectLivePackageFares in lib/packages):
// a packaged hotel rate replaces the package's hotel leg, sandbox
// test data labeled as such, planner estimates as the fallback.
// These tests pin the response shape, the honesty labels, the
// featured/destination filters, the checkIn pass-through, and the
// route wiring.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/packages-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PACKAGE_BUNDLE_LABEL,
  PACKAGE_ESTIMATE_LABEL,
  allPackages,
  collectLivePackageFares,
  packageFor,
  packagesResponse,
} from '../lib/packages';
import { clearHotelbedsBundleCache } from '../lib/hotelbeds-bundle.ts';

const BUNDLE_OFF = { enabled: false, configured: false, active: false, sandbox: true };
const BUNDLE_ON = { enabled: true, configured: true, active: true, sandbox: true };

const realFetch = globalThis.fetch;
const realKey = process.env.HOTELBEDS_BUNDLE_API_KEY;
const realSecret = process.env.HOTELBEDS_BUNDLE_API_SECRET;

function restoreBundleEnv() {
  globalThis.fetch = realFetch;
  clearHotelbedsBundleCache();
  if (realKey === undefined) delete process.env.HOTELBEDS_BUNDLE_API_KEY;
  else process.env.HOTELBEDS_BUNDLE_API_KEY = realKey;
  if (realSecret === undefined) delete process.env.HOTELBEDS_BUNDLE_API_SECRET;
  else process.env.HOTELBEDS_BUNDLE_API_SECRET = realSecret;
}

function withBundleKeys() {
  process.env.HOTELBEDS_BUNDLE_API_KEY = 'test-bnd-key';
  process.env.HOTELBEDS_BUNDLE_API_SECRET = 'test-bnd-secret';
}

// One canned packaged hotel, the availability shape the Bundle
// client parses (same shape as the bundle client tests). The
// currency + net are parameters: USD composes into the package
// total, any other currency surfaces as the hotel-only detail.
function bundleAvailability(currency, net) {
  return {
    hotels: {
      total: 1,
      hotel: [
        {
          code: 77,
          name: 'Hotel Example',
          categoryCode: '4EST',
          minRate: net,
          currency,
          room: [
            {
              name: 'Double',
              rate: [{ rateKey: 'rk1', rateType: 'BOOKABLE', net, boardCode: 'RO', boardName: 'Room only' }],
            },
          ],
        },
      ],
    },
  };
}

const NO_HOTELS = { hotels: { total: 0 } };

test('live fares: empty when Bundle is not configured (no keys in this environment)', async () => {
  assert.deepEqual(await collectLivePackageFares(), []);
});

test('response: all 21 packages, every price a labeled planning estimate', async () => {
  const res = await packagesResponse({}, BUNDLE_OFF);
  assert.equal(res.source, 'fujintrip-packages');
  assert.equal(res.packages.length, allPackages().length);
  assert.ok(res.packages.length >= 21, 'the full package list is served');
  assert.deepEqual(res.liveFares, []);
  for (const pkg of res.packages) {
    assert.equal(pkg.price.label, PACKAGE_ESTIMATE_LABEL, `${pkg.destination}: planning estimate`);
    assert.equal(pkg.price.source, null, `${pkg.destination}: no live source yet`);
    assert.equal(pkg.price.perTraveler, pkg.best.perTraveler, `${pkg.destination}: Best value total`);
    assert.equal(pkg.tiers.length, 3, `${pkg.destination}: three tiers`);
  }
  assert.ok(res.checkedAt, 'a check time is carried');
  assert.ok(res.note.includes('planning estimates'), 'the note says prices are estimates');
});

test('response: featured narrows to six; destination narrows to one; unknown destination is an honest empty list', async () => {
  const featured = await packagesResponse({ featured: true }, BUNDLE_OFF);
  assert.equal(featured.packages.length, 6);
  assert.ok(featured.packages.some((p) => p.destination === 'Japan'), 'Japan is featured');

  const one = await packagesResponse({ destination: 'Japan' }, BUNDLE_OFF);
  assert.equal(one.packages.length, 1);
  assert.equal(one.packages[0].destination, 'Japan');
  assert.equal(one.packages[0].price.label, PACKAGE_ESTIMATE_LABEL);

  const none = await packagesResponse({ destination: 'Nowhere' }, BUNDLE_OFF);
  assert.deepEqual(none.packages, []);
  assert.deepEqual(none.liveFares, []);
});

test('sources: the three tour suppliers are awaiting_reply; Bundle status is passed through, never invented', async () => {
  const off = await packagesResponse({}, BUNDLE_OFF);
  assert.equal(off.sources.tourRadar.status, 'awaiting_reply');
  assert.equal(off.sources.intrepid.status, 'awaiting_reply');
  assert.equal(off.sources.viator.status, 'awaiting_reply');
  assert.deepEqual(off.sources.hotelbedsBundle, BUNDLE_OFF);

  const on = await packagesResponse({}, BUNDLE_ON);
  assert.deepEqual(on.sources.hotelbedsBundle, BUNDLE_ON);
  assert.equal(on.sources.tourRadar.status, 'awaiting_reply', 'Bundle on does not fake a tour supplier');
});

test('wiring: the route serves packagesResponse and reports the Bundle status', () => {
  const route = readFileSync(new URL('../app/api/packages/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('packagesResponse'), 'GET serves packagesResponse');
  assert.ok(route.includes('hotelbedsBundleStatus'), 'GET reports the Bundle status');
  assert.ok(route.includes("featured"), 'the featured filter is wired');
  assert.ok(route.includes('destination'), 'the destination filter is wired');
  assert.ok(route.includes('checkIn'), 'the Bundle search start date is wired');
  assert.ok(route.includes('NextResponse.json'), 'the route answers JSON');
});

// --- Hotelbeds Bundle fares (Nov 21, 2026) -------------------------
// Stubbed upstream: fake Bundle keys + a canned availability reply,
// so the wiring is tested without a real Hotelbeds call (this VM
// has no key and cannot reach api.test.hotelbeds.com).

test('bundle (USD): a packaged hotel composes into the package price with the sandbox label', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => bundleAvailability('USD', 400) };
  };
  try {
    withBundleKeys();
    const bali = packageFor('Bali');
    assert.ok(bali, 'Bali package exists');
    const fares = await collectLivePackageFares({ packages: [bali], checkIn: '2027-05-01' });
    assert.equal(fares.length, 1, 'one Bundle fare for Bali');
    assert.equal(fares[0].destination, 'Bali');
    assert.equal(fares[0].source, 'hotelbeds-bundle');
    assert.equal(fares[0].kind, 'bundle');
    assert.equal(fares[0].currency, 'USD');
    assert.equal(fares[0].checkIn, '2027-05-01');
    assert.equal(fares[0].checkOut, '2027-05-03', 'stay length is the package nights');
    assert.equal(fares[0].hotelName, 'Hotel Example');
    assert.equal(
      fares[0].perTraveler,
      bali.best.perTraveler - bali.includes.hotel + 400,
      'composed total: planner total, hotel leg swapped'
    );
    assert.equal(calls, 1, 'one packaging search for one package');

    const res = await packagesResponse({ destination: 'Bali', checkIn: '2027-05-01' }, BUNDLE_ON);
    assert.equal(res.packages.length, 1);
    assert.equal(res.packages[0].price.label, PACKAGE_BUNDLE_LABEL, 'sandbox label on the package price');
    assert.equal(res.packages[0].price.perTraveler, fares[0].perTraveler, 'the API serves the composed total');
    assert.ok(res.packages[0].price.source.includes('(sandbox)'), 'source says sandbox');
    assert.ok(!res.packages[0].price.source.toLowerCase().includes('bookable'), 'never called bookable');
  } finally {
    restoreBundleEnv();
  }
});

test('bundle (EUR): the estimate total stands and the packaged hotel is surfaced in euros', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => bundleAvailability('EUR', 350) });
  try {
    withBundleKeys();
    const res = await packagesResponse({ destination: 'Bali', checkIn: '2027-05-01' }, BUNDLE_ON);
    assert.equal(res.packages.length, 1);
    assert.equal(res.packages[0].price.label, PACKAGE_ESTIMATE_LABEL, 'EUR never enters the USD total');
    assert.equal(res.packages[0].price.perTraveler, res.packages[0].best.perTraveler, 'total stays the estimate');
    assert.ok(res.packages[0].price.bundleHotel, 'the packaged hotel is still surfaced');
    assert.equal(res.packages[0].price.bundleHotel.currency, 'EUR');
    assert.equal(res.packages[0].price.bundleHotel.perTraveler, 350);
    assert.equal(res.liveFares.length, 1, 'the EUR fare is in the fare list as the hotel detail');
    assert.equal(res.liveFares[0].currency, 'EUR');
  } finally {
    restoreBundleEnv();
  }
});

test('bundle fallback: no hotels, and a route with no coordinates, both keep the planner estimate', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => NO_HOTELS };
  };
  try {
    withBundleKeys();
    const bali = packageFor('Bali');
    assert.ok(bali, 'Bali package exists');
    const fares = await collectLivePackageFares({ packages: [bali], checkIn: '2027-05-01' });
    assert.equal(calls, 1, 'the search ran — the fallback is honest, not skipped');
    assert.deepEqual(fares, [], 'no hotels means no fare — never an invented price');
    const res = await packagesResponse({ destination: 'Bali', checkIn: '2027-05-01' }, BUNDLE_ON);
    assert.equal(calls, 2, 'an empty result is not cached, so the API re-searches instead of serving a stale empty');
    assert.equal(res.packages[0].price.label, PACKAGE_ESTIMATE_LABEL, 'estimate stands');

    // A route whose first stop has no coordinates cannot be served
    // by a geolocation packaging search: no call, no fare, estimate.
    calls = 0;
    const unservable = { ...bali, id: 'nowhere', destination: 'Nowhere Land', stops: ['Nowhere City'] };
    const noFares = await collectLivePackageFares({ packages: [unservable], checkIn: '2027-05-01' });
    assert.deepEqual(noFares, []);
    assert.equal(calls, 0, 'no coordinates means no search at all');
  } finally {
    restoreBundleEnv();
  }
});
