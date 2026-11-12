// "Where to go" discovery map (design #15) — unit tests for the data
// layer. Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/discovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonFor, ROUTE_STOPS } from '../lib/planner.ts';
import { buildTripCard } from '../lib/tripCard.ts';
import { bestTimeFor } from '../lib/bestTime.ts';
import {
  discoveryDestinations,
  discoveryEntry,
  discoveryPriceLabel,
  priceFor,
  routeLineFor,
} from '../lib/discovery.ts';

const pins = discoveryDestinations();

test('pin list: every planner route plus the standalone base-price places', () => {
  const routes = pins.filter((p) => p.kind === 'route');
  const places = pins.filter((p) => p.kind === 'place');
  assert.equal(routes.length, Object.keys(ROUTE_STOPS).length);
  assert.equal(routes.length, 17);
  // Bali, St. George, Tacoma, Hilo are base-price places with no route;
  // Kyoto and Santorini are route stops, so they get no second pin.
  assert.deepEqual(
    places.map((p) => p.destination).sort(),
    ['Bali', 'Hilo', 'St. George', 'Tacoma'],
  );
  assert.equal(pins.length, 21);
  for (const p of pins) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng), `${p.destination} has coordinates`);
    assert.ok(p.stops.length >= 1, `${p.destination} has stops`);
    assert.ok(p.days >= 3 && p.nights === p.days - 1, `${p.destination} days/nights line up`);
    assert.ok(p.bestMonth >= 1 && p.bestMonth <= 12, `${p.destination} has a best month`);
    assert.ok(p.bestNote.length > 0, `${p.destination} has a best-month note`);
  }
});

test('every pin price is the planner Best value total for 2 travelers, exactly', () => {
  for (const p of pins) {
    const expected = comparisonFor(p.destination, 2).best.total;
    assert.equal(p.price, expected, `${p.destination} pin price must equal the planner table`);
  }
  // Per-route bases, approved by the user Nov 12, 2026 (as drafted):
  // 2-traveler Best value totals range $2,300–$4,400. The base-price
  // places differ (Bali $2,500, St. George $1,560, Tacoma $1,840,
  // Hilo $2,900).
  const expectedRoutePrices = {
    Europe: 4400,
    'Central Europe': 3600,
    Portugal: 2900,
    Egypt: 2400,
    Japan: 4400,
    Italy: 3500,
    France: 3800,
    Spain: 3100,
    Greece: 3500,
    Thailand: 2500,
    'Southeast Asia': 2600,
    Turkey: 2700,
    Morocco: 2300,
    India: 2300,
    UK: 3800,
    Mexico: 2700,
    USA: 4000,
  };
  for (const [route, price] of Object.entries(expectedRoutePrices)) {
    assert.equal(discoveryEntry(route)?.price, price, `${route} bubble is $${price.toLocaleString()}`);
  }
  assert.equal(discoveryEntry('Bali')?.price, 2500);
  assert.equal(discoveryEntry('St. George')?.price, 1560);
  assert.equal(discoveryEntry('Tacoma')?.price, 1840);
  assert.equal(discoveryEntry('Hilo')?.price, 2900);
});

test('essentials match the trip card the plan uses — same stops, nights, counts', () => {
  for (const p of pins) {
    const card = buildTripCard({
      destination: p.destination,
      travelers: 2,
      days: p.days,
      month: p.bestMonth,
      origin: '',
    });
    assert.deepEqual(
      p.stops.map((s) => `${s.city} ${s.nights}n`),
      card.stops.map((s) => `${s.city} ${s.nights}n`),
      `${p.destination} stops match the trip card`,
    );
    assert.equal(p.experiences, card.experiences, `${p.destination} experience count`);
    assert.equal(p.stays, card.hotels, `${p.destination} stay count`);
    assert.equal(p.transports, card.transports, `${p.destination} transport count`);
    assert.equal(p.bestMonth, bestTimeFor(p.destination).bestMonth, `${p.destination} best month`);
  }
  const ce = discoveryEntry('Central Europe');
  assert.equal(routeLineFor(ce.stops), 'Prague (4 nights) → Vienna (3 nights) → Budapest (6 nights)');
  assert.equal(ce.days, 14);
  assert.equal(ce.experiences, 64);
});

test('no two pins share exact coordinates — same-city trips are spread', () => {
  const seen = new Set();
  for (const p of pins) {
    const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    assert.ok(!seen.has(k), `duplicate pin position for ${p.destination} (${k})`);
    seen.add(k);
  }
  // Europe and Portugal both start in Lisbon; Thailand and Southeast
  // Asia both in Bangkok — the pins sit a little apart, on the city.
  const lisbon = pins.filter((p) => p.pinCity === 'Lisbon');
  assert.equal(lisbon.length, 2);
  assert.notEqual(lisbon[0].lng, lisbon[1].lng);
  const bangkok = pins.filter((p) => p.pinCity === 'Bangkok');
  assert.equal(bangkok.length, 2);
  assert.notEqual(bangkok[0].lng, bangkok[1].lng);
});

test('a destination the planner has no price for gets no price, not a guess', () => {
  // Porto is a city the planner knows, but the planner prices trips,
  // not lone cities — so it has no price, and the label says so.
  const porto = discoveryEntry('Porto');
  assert.ok(porto, 'Porto is a known city');
  assert.equal(porto.price, null);
  assert.equal(priceFor('Porto'), null);
  assert.equal(discoveryPriceLabel(porto), 'No planning estimate for this one yet');
  // A name the planner does not know at all — no pin, no price.
  assert.equal(discoveryEntry('Caribbean'), null);
  assert.equal(discoveryEntry('Zanzibar'), null);
  assert.equal(priceFor('Caribbean'), null);
  assert.equal(priceFor('Zanzibar'), null);
});

test('price label reads like the destination cards', () => {
  const ce = discoveryEntry('Central Europe');
  assert.equal(discoveryPriceLabel(ce), 'from $3,600 total');
  assert.equal(discoveryPriceLabel(discoveryEntry('Bali')), 'from $2,500 total');
});
