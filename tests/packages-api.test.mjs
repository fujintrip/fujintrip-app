// Packages API (Nov 17, 2026): GET /api/packages serves the 21
// ready-made trips as JSON — the package list, each price resolved
// through packagePrice(), plus a sources block that says plainly
// what is live and what is still waiting. Today no tour supplier
// has connected (TourRadar, Intrepid, Viator enquiries sent Nov 17,
// 2026, all awaiting replies), so every price is the planner's
// planning estimate and liveFares is empty; the Hotelbeds Bundle
// product is a dated hotel-packaging search, not a per-package tour
// total, so it is reported in sources and never merged into a
// package price. These tests pin the response shape, the honesty
// labels, the featured/destination filters, and the route wiring.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/packages-api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PACKAGE_ESTIMATE_LABEL,
  allPackages,
  collectLivePackageFares,
  packagesResponse,
} from '../lib/packages';

const BUNDLE_OFF = { enabled: false, configured: false, active: false, sandbox: true };
const BUNDLE_ON = { enabled: true, configured: true, active: true, sandbox: true };

test('live fares: none today — the seam is empty until a tour supplier connects', async () => {
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
  assert.ok(route.includes('NextResponse.json'), 'the route answers JSON');
});
