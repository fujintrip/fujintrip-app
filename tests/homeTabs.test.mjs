// Homepage tabs (direction v2, Nov 13, 2026): every number under a tab
// comes from an existing source and is labeled as what it is — live
// Duffel test fares, cached competitor fares, or the planner's own
// Best value legs/totals per traveler. Nothing is invented: each row
// derives from comparisonFor / discoveryDestinations, and a tab the
// planner breaks out no leg for shows the full-trip total and says so.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/homeTabs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUFFEL_TEST_LABEL,
  HOME_TABS,
  flightContextFor,
  homeTabIdFromQuery,
  noFareMessage,
  noLegNote,
  tabRowsFor,
} from '../lib/homeTabs.ts';
import { comparisonFor } from '../lib/planner.ts';
import { discoveryDestinations } from '../lib/discovery.ts';
import { bestTimeFor } from '../lib/bestTime.ts';

test('homeTabIdFromQuery: real tab ids pass, anything else is Flights', () => {
  assert.equal(homeTabIdFromQuery('hotels'), 'hotels');
  assert.equal(homeTabIdFromQuery('tours'), 'tours');
  assert.equal(homeTabIdFromQuery(null), 'flights');
  assert.equal(homeTabIdFromQuery(undefined), 'flights');
  assert.equal(homeTabIdFromQuery('bogus'), 'flights');
  assert.equal(homeTabIdFromQuery(['cars', 'hotels']), 'cars');
  assert.equal(HOME_TABS.length, 7, 'seven tabs');
  assert.deepEqual(
    HOME_TABS.map((t) => t.label),
    ['Tours & sightseeing', 'Flights', 'Hotels', 'Car rental', 'Cruises', 'Buses', 'Taxis']
  );
});

test('tabRowsFor: one row per discovery destination, prices from the planner, per traveler', () => {
  const entries = discoveryDestinations();
  assert.equal(entries.length, 21, '21 discovery destinations');
  for (const tab of ['tours', 'flights', 'hotels', 'cars', 'cruises', 'buses', 'taxis']) {
    const rows = tabRowsFor(tab, 2);
    assert.equal(rows.length, 21, `${tab} has one row per destination`);
    for (const r of rows) {
      assert.ok(r.destination.length > 0, 'row names its destination');
      assert.ok(r.routeLine.length > 0, 'row names its route');
      assert.ok(Number.isFinite(r.pricePerTraveler) && r.pricePerTraveler > 0, 'row has a real per-traveler price');
    }
  }
  // The prices are the planner's own numbers, not a second table:
  // every row is exactly the Best value leg (or total) / travelers.
  const legs = { tours: 'activities', flights: 'flight', hotels: 'hotel', cars: 'car' };
  for (const [tab, leg] of Object.entries(legs)) {
    for (const r of tabRowsFor(tab, 2)) {
      assert.equal(r.kind, 'leg', `${tab} rows are category legs`);
      assert.equal(r.pricePerTraveler, Math.round(comparisonFor(r.destination, 2).best[leg] / 2), `${tab} ${r.destination} matches the planner`);
    }
  }
  // Pinned real numbers (Central Europe, BASE 1800, 2 travelers):
  // hotel leg 1188 -> 594/traveler; flight leg 1512 -> 756/traveler.
  const hotel = tabRowsFor('hotels', 2).find((r) => r.destination === 'Central Europe');
  assert.equal(hotel?.pricePerTraveler, 594, 'Central Europe stays from $594 per traveler');
  const flight = tabRowsFor('flights', 2).find((r) => r.destination === 'Central Europe');
  assert.equal(flight?.pricePerTraveler, 756, 'Central Europe flights from $756 per traveler');
  // A different party size re-prices per traveler from the same legs.
  const hotel4 = tabRowsFor('hotels', 4).find((r) => r.destination === 'Central Europe');
  assert.equal(hotel4?.pricePerTraveler, Math.round(comparisonFor('Central Europe', 4).best.hotel / 4));
});

test('tabRowsFor: cruises, buses and taxis show the full trip and say so', () => {
  for (const tab of ['cruises', 'buses', 'taxis']) {
    const rows = tabRowsFor(tab, 2);
    assert.ok(rows.every((r) => r.kind === 'full-trip'), `${tab} rows are full-trip totals`);
    const central = rows.find((r) => r.destination === 'Central Europe');
    assert.equal(central?.pricePerTraveler, 1800, 'Central Europe full trip $1,800 per traveler');
    assert.ok(noLegNote(tab)?.includes("aren't broken out"), `${tab} carries the honest gap note`);
    assert.ok(noLegNote(tab)?.includes('full-trip planning estimates'), `${tab} note names what the rows are`);
  }
  assert.equal(noLegNote('hotels'), null, 'a tab with a planner leg has no gap note');
  assert.equal(noLegNote('flights'), null, 'flights has no gap note');
});

test('flightContextFor: the persisted trip wins, else the Central Europe default', () => {
  const def = flightContextFor(null);
  assert.deepEqual(def, {
    destination: 'Central Europe',
    travelers: 2,
    origin: 'New York',
    month: bestTimeFor('Central Europe').bestMonth,
    durationDays: 14,
  });
  const trip = flightContextFor({ destination: 'Japan', travelers: 3, origin: 'Los Angeles', month: 4, durationDays: 10 });
  assert.deepEqual(trip, { destination: 'Japan', travelers: 3, origin: 'Los Angeles', month: 4, durationDays: 10 });
  // Partial / corrupt slots fall back one by one — never a crash, never
  // a guessed airport or date.
  const partial = flightContextFor({ destination: 'Kyoto', travelers: 0, origin: '', month: 99, durationDays: 1 });
  assert.equal(partial.destination, 'Kyoto');
  assert.equal(partial.travelers, 2);
  assert.equal(partial.origin, 'New York');
  assert.equal(partial.month, bestTimeFor('Kyoto').bestMonth);
  assert.equal(partial.durationDays, 14);
});

test('labels: the Duffel test label and the no-fare lines never promise a live price', () => {
  assert.ok(DUFFEL_TEST_LABEL.includes('Duffel test fare'), 'test fare is named');
  assert.ok(DUFFEL_TEST_LABEL.includes('not a live bookable quote'), 'not bookable is named');
  for (const reason of ['no_key', 'no_airport_code', 'no_offers', 'missing_slots', undefined]) {
    const line = noFareMessage(reason, 1512);
    assert.ok(!/live bookable|book now|from \$830|Estimate/.test(line), `no-fare line for ${reason} promises nothing live`);
    assert.ok(line.includes('$1,512'), `no-fare line for ${reason} keeps the plan flight budget`);
  }
  assert.ok(noFareMessage('no_airport_code', 1512).includes('no airport code'), 'the airport-code gap is named');
});
