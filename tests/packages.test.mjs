// Ready-made packages (homepage restructure, Nov 15, 2026): every
// price in a package comes from the planner's own math — no invented
// numbers, no test fares, no live quotes. Each package is the
// planner's Best value total per traveler, its tiers are the
// planner's three options, and its inclusions are the planner's
// Best value legs. Without a fare the price is labeled "planning
// estimate"; a Hotelbeds Bundle fare (Nov 21, 2026) replaces the
// hotel leg with a packaged hotel rate — sandbox test data, labeled
// as such, never live, never bookable — and a non-USD Bundle fare
// is shown as the packaged-hotel detail instead of the total.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/packages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner';
import { discoveryDestinations } from '../lib/discovery';
import {
  PACKAGE_BUNDLE_LABEL,
  PACKAGE_ESTIMATE_LABEL,
  allPackages,
  bundleHotelLabel,
  cheapestPackages,
  currencySymbol,
  dealsPackages,
  featuredPackages,
  nextBestMonthStart,
  packageFor,
  packagePrice,
} from '../lib/packages';

test('every package price is the planner math: tiers + Best value legs for 1 traveler', () => {
  for (const pkg of allPackages()) {
    const plan = buildPlan(pkg.destination, 1, pkg.days);
    assert.equal(pkg.tiers.length, 3, `${pkg.destination}: three tiers`);
    assert.deepEqual(
      pkg.tiers.map((t) => t.name),
      ['Cheapest', 'Best value', 'Premium'],
      `${pkg.destination}: tier names in order`,
    );
    for (let i = 0; i < 3; i++) {
      assert.equal(pkg.tiers[i].perTraveler, plan.options[i].total, `${pkg.destination}: ${plan.options[i].name} total`);
    }
    assert.equal(pkg.best.perTraveler, plan.options[1].total, `${pkg.destination}: Best value total`);
    assert.equal(pkg.includes.flight, plan.options[1].flight, `${pkg.destination}: flight leg`);
    assert.equal(pkg.includes.hotel, plan.options[1].hotel, `${pkg.destination}: hotel leg`);
    assert.equal(pkg.includes.car, plan.options[1].car, `${pkg.destination}: car leg`);
    assert.equal(pkg.includes.activities, plan.options[1].activities, `${pkg.destination}: activities leg`);
    // The planner's legs sum to its total (fixLegs) — the card's
    // breakdown must add up to the price it shows.
    assert.equal(
      pkg.includes.flight + pkg.includes.hotel + pkg.includes.car + pkg.includes.activities,
      pkg.best.perTraveler,
      `${pkg.destination}: inclusions sum to the Best value total`,
    );
  }
});

test('packages cover every discovery destination, with stops, nights and a photo or a labeled fallback', () => {
  const all = allPackages();
  assert.equal(all.length, discoveryDestinations().length, 'one package per discovery destination');
  const seen = new Set();
  for (const pkg of all) {
    assert.ok(!seen.has(pkg.id), `${pkg.id}: unique`);
    seen.add(pkg.id);
    assert.ok(pkg.stops.length >= 1, `${pkg.destination}: at least one stop`);
    for (const stop of pkg.stops) assert.ok(stop.length > 0, `${pkg.destination}: stop names are non-empty`);
    assert.ok(pkg.nights >= 1, `${pkg.destination}: at least one night`);
    assert.ok(pkg.days > pkg.nights, `${pkg.destination}: days exceed nights`);
    assert.ok(pkg.tag.length > 0, `${pkg.destination}: has a tag`);
    // A photo is nice; when there is none the card renders a labeled
    // fallback div, never a broken image.
    assert.ok(pkg.photo === null || pkg.photo.startsWith('http'), `${pkg.destination}: photo is a URL or null`);
  }
});

test('featured packages are six, unique, and span the price range', () => {
  const featured = featuredPackages();
  assert.equal(featured.length, 6, 'six featured packages');
  const ids = new Set(featured.map((p) => p.id));
  assert.equal(ids.size, 6, 'featured are unique');
  const prices = featured.map((p) => p.best.perTraveler);
  assert.ok(Math.min(...prices) < 1500, 'featured include a low-priced trip');
  assert.ok(Math.max(...prices) > 1800, 'featured include a higher-priced trip');
  for (const pkg of featured) {
    assert.ok(allPackages().some((p) => p.id === pkg.id), `${pkg.destination}: featured come from the planner`);
  }
});

test('deals are the three cheapest by Best value per traveler, in order — excluding the trips that already have a homepage band (UX direction, Nov 19 2026 — P0-7)', () => {
  const deals = dealsPackages();
  assert.equal(deals.length, 3, 'three deals');
  // The exclusions: the featured shelf, the hidden gems, 'Europe'.
  const excluded = new Set([
    ...featuredPackages().map((p) => p.destination),
    'St. George',
    'Tacoma',
    'Hilo',
    'Europe',
  ]);
  for (const d of deals) {
    assert.ok(!excluded.has(d.destination), `${d.destination}: deals never repeat a banded trip`);
  }
  // And they are the cheapest of the REST, in order.
  const rest = [...allPackages()]
    .filter((p) => !excluded.has(p.destination))
    .sort((a, b) => a.best.perTraveler - b.best.perTraveler || a.destination.localeCompare(b.destination));
  assert.deepEqual(
    deals.map((d) => d.id),
    rest.slice(0, 3).map((d) => d.id),
    'deals are the three cheapest of the rest',
  );
  assert.ok(deals[0].best.perTraveler <= deals[1].best.perTraveler, 'deals sorted ascending');
  assert.ok(deals[1].best.perTraveler <= deals[2].best.perTraveler, 'deals sorted ascending');
});

test('cheapestPackages(n, exclude) filters before sorting, so the deals band never repeats a banded trip', () => {
  const featured = featuredPackages().map((p) => p.destination);
  const cheapest = cheapestPackages(8, featured);
  assert.equal(cheapest.length, 8, 'eight trips');
  for (const p of cheapest) {
    assert.ok(!featured.includes(p.destination), `${p.destination}: excluded trips stay out`);
  }
  for (let i = 1; i < cheapest.length; i++) {
    assert.ok(cheapest[i - 1].best.perTraveler <= cheapest[i].best.perTraveler, `trip ${i} not cheaper than trip ${i - 1}`);
  }
});

test('no fares passed: every price is the planning estimate (the fallback)', () => {
  for (const pkg of allPackages()) {
    const price = packagePrice(pkg);
    assert.equal(price.perTraveler, pkg.best.perTraveler, `${pkg.destination}: no fare, Best value stands`);
    assert.equal(price.label, PACKAGE_ESTIMATE_LABEL, `${pkg.destination}: labeled planning estimate`);
    assert.equal(price.source, null, `${pkg.destination}: no source until a fare arrives`);
    assert.equal(price.bundleHotel, undefined, `${pkg.destination}: no packaged hotel without a fare`);
  }
  assert.equal(PACKAGE_ESTIMATE_LABEL, 'planning estimate');
});

test('the live-fares seam: a live fare is preferred and labeled with its source and check time', () => {
  const pkg = packageFor('Japan');
  assert.ok(pkg, 'Japan package exists');
  const live = [{ destination: 'Japan', source: 'Duffel', checkedAt: '2026-11-15T12:00:00.000Z', perTraveler: 1999 }];
  const price = packagePrice(pkg, live);
  assert.equal(price.perTraveler, 1999, 'live fare replaces the estimate');
  assert.equal(price.label, 'Live fare', 'live fare labeled live');
  assert.equal(price.source, 'Duffel · checked 2026-11-15', 'source + check date shown');
  // A live fare for another destination does not leak into this one.
  const other = [{ destination: 'Greece', source: 'Duffel', checkedAt: '2026-11-15T12:00:00.000Z', perTraveler: 100 }];
  assert.equal(packagePrice(pkg, other).perTraveler, pkg.best.perTraveler, 'unrelated live fare ignored');
  // Duffel TEST fares never enter the seam — the caller only passes
  // real live fares; a test-mode label is rejected by the shape.
  const testFare = [{ destination: 'Japan', source: 'Duffel test', checkedAt: '2026-11-15T12:00:00.000Z', perTraveler: 100 }];
  assert.equal(packagePrice(pkg, testFare).perTraveler, pkg.best.perTraveler, 'test fares are not live fares');
});

test('packageFor returns null for a destination the planner cannot price', () => {
  assert.equal(packageFor('Nowhere, not a place'), null);
  assert.equal(packageFor(''), null);
});

test('no "Book now" anywhere in the package data or labels', () => {
  const haystack = JSON.stringify(allPackages()) + PACKAGE_ESTIMATE_LABEL;
  assert.ok(!haystack.includes('Book now'), 'packages never promise booking');
  assert.ok(!haystack.toLowerCase().includes('live fare'), 'package data never claims a live fare');
});

// --- Hotelbeds Bundle fares (Nov 21, 2026) -------------------------
// The Bundle packaging search returns packaged hotel rates (sandbox
// test data). A USD fare composes into the package total by swapping
// the hotel leg; a fare in another currency never enters the total
// and is shown as the packaged-hotel detail instead. No Bundle price
// is ever labeled live, real, or bookable.

test('bundle fare (USD): the composed total replaces the hotel leg and carries the sandbox label', () => {
  const pkg = packageFor('Bali');
  assert.ok(pkg, 'Bali package exists');
  const bundleFare = {
    destination: 'Bali',
    source: 'hotelbeds-bundle',
    checkedAt: '2026-11-22T00:00:00.000Z',
    perTraveler: pkg.best.perTraveler - pkg.includes.hotel + 400,
    kind: 'bundle',
    checkIn: '2027-05-01',
    checkOut: '2027-05-03',
    hotelName: 'Hotel Example Bali',
    currency: 'USD',
    hotelPerTraveler: 400,
  };
  const price = packagePrice(pkg, [bundleFare]);
  assert.equal(price.perTraveler, pkg.best.perTraveler - pkg.includes.hotel + 400, 'hotel leg swapped for the packaged hotel');
  assert.equal(price.label, PACKAGE_BUNDLE_LABEL, 'sandbox label, never Live fare');
  assert.equal(PACKAGE_BUNDLE_LABEL, 'Test data — not a real price');
  assert.ok(price.source.includes('Hotelbeds Bundle (sandbox)'), 'source names Bundle + sandbox');
  assert.ok(price.source.includes('Hotel Example Bali'), 'source names the hotel');
  assert.ok(price.source.includes('2027-05-01'), 'source names the searched dates');
  assert.ok(!price.source.toLowerCase().includes('bookable'), 'never called bookable');
  assert.equal(price.bundleHotel, undefined, 'a composed fare needs no separate hotel line');
});

test('bundle fare (non-USD): the estimate total stands and the packaged hotel is shown in its own currency', () => {
  const pkg = packageFor('Bali');
  assert.ok(pkg, 'Bali package exists');
  const bundleFare = {
    destination: 'Bali',
    source: 'hotelbeds-bundle',
    checkedAt: '2026-11-22T00:00:00.000Z',
    perTraveler: 350,
    kind: 'bundle',
    checkIn: '2027-05-01',
    checkOut: '2027-05-03',
    hotelName: 'Hotel Example Bali',
    currency: 'EUR',
    hotelPerTraveler: 350,
  };
  const price = packagePrice(pkg, [bundleFare]);
  assert.equal(price.perTraveler, pkg.best.perTraveler, 'EUR is never added into the USD total');
  assert.equal(price.label, PACKAGE_ESTIMATE_LABEL, 'total stays the planning estimate');
  assert.equal(price.source, null, 'no live source');
  assert.ok(price.bundleHotel, 'the packaged hotel is still surfaced');
  assert.equal(price.bundleHotel.hotelName, 'Hotel Example Bali');
  assert.equal(price.bundleHotel.perTraveler, 350);
  assert.equal(price.bundleHotel.currency, 'EUR');
  assert.equal(price.bundleHotel.checkIn, '2027-05-01');
  const line = bundleHotelLabel(price.bundleHotel);
  assert.ok(line.includes('Hotel Example Bali'), 'line names the hotel');
  assert.ok(line.includes('€350'), 'line shows the price in its own currency');
  assert.ok(line.includes('Test data — not a real price'), 'line carries the sandbox label');
  assert.ok(!line.includes('Live fare'), 'line never claims a live fare');
  assert.ok(!line.toLowerCase().includes('bookable'), 'line never claims bookable');
});

test('bundle fare never outranks a real live fare, and a test-named Bundle source is not a live fare', () => {
  const pkg = packageFor('Japan');
  assert.ok(pkg, 'Japan package exists');
  const live = [{ destination: 'Japan', source: 'Duffel', checkedAt: '2026-11-15T12:00:00.000Z', perTraveler: 1999 }];
  const bundle = {
    destination: 'Japan',
    source: 'hotelbeds-bundle',
    checkedAt: '2026-11-22T00:00:00.000Z',
    perTraveler: 1500,
    kind: 'bundle',
    checkIn: '2027-05-01',
    checkOut: '2027-05-15',
    hotelName: 'Hotel Example Tokyo',
    currency: 'USD',
    hotelPerTraveler: 500,
  };
  // A real live fare wins over a sandbox Bundle fare.
  assert.equal(packagePrice(pkg, [bundle, ...live]).label, 'Live fare', 'live fare wins');
  assert.equal(packagePrice(pkg, [bundle, ...live]).perTraveler, 1999, 'live fare total wins');
  // A Bundle fare for another destination does not leak in.
  const other = { ...bundle, destination: 'Greece' };
  assert.equal(packagePrice(pkg, [other]).label, PACKAGE_ESTIMATE_LABEL, 'unrelated bundle fare ignored');
});

test('currency symbols and the best-month window', () => {
  assert.equal(currencySymbol('USD'), '$');
  assert.equal(currencySymbol('EUR'), '€');
  assert.equal(currencySymbol('GBP'), '£');
  assert.equal(currencySymbol('JPY'), 'JPY', 'unknown currencies show the code, never a guessed symbol');
  // The 1st of the best month at its next occurrence: May from
  // November is next May; May from June is next year's May.
  assert.equal(nextBestMonthStart(5, new Date('2026-11-21T00:00:00Z')), '2027-05-01');
  assert.equal(nextBestMonthStart(5, new Date('2026-06-15T00:00:00Z')), '2027-05-01');
  assert.equal(nextBestMonthStart(12, new Date('2026-11-21T00:00:00Z')), '2026-12-01');
});
