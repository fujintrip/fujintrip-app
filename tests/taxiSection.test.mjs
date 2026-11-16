// Taxis section (Nov 15, 2026): the Taxis search form + results to
// the same standard as the Stays, Car rental, Attractions, Cruises
// and Buses sections — validated date/time, icons, deep-link sync,
// per-tier taxi cards, tier sort, filters with counts, honest
// full-trip planning-estimate labels. Nothing here invents a taxi
// company, a route, a timetable, a rating, a price, or a duration:
// the planner breaks out no taxi leg, so every taxi figure is the
// planner's own per-tier full-trip total, labeled as such — never a
// taxi price. A trip the planner cannot price never gets a row.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/taxiSection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import {
  taxiTierFromValue,
  taxiTierLabel,
  taxiTierOptions,
  taxiTierRows,
  emptySearchQuery,
  formValuesFromQuery,
  nowTimeLocal,
  searchQueryFromParams,
  searchQueryToParams,
  sortTabRows,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('taxiTierFromValue: only the three real tiers win', () => {
  assert.equal(taxiTierFromValue('cheapest'), 'cheapest');
  assert.equal(taxiTierFromValue('best'), 'best');
  assert.equal(taxiTierFromValue('premium'), 'premium');
  assert.equal(taxiTierFromValue('Luxury'), 'best', 'junk falls back to Best value');
  assert.equal(taxiTierFromValue(undefined), 'best');
  assert.equal(taxiTierFromValue(null), 'best');
  assert.equal(taxiTierLabel('cheapest'), 'Cheapest');
  assert.equal(taxiTierLabel('best'), 'Best value');
  assert.equal(taxiTierLabel('premium'), 'Premium');
});

test('taxiTierOptions: the three planner per-tier full-trip totals for the party, per traveler underneath', () => {
  const opts = taxiTierOptions('Central Europe', 2);
  assert.deepEqual(opts, [
    { tier: 'cheapest', label: 'Cheapest', total: 2304, perTraveler: 1152 },
    { tier: 'best', label: 'Best value', total: 3600, perTraveler: 1800 },
    { tier: 'premium', label: 'Premium', total: 5904, perTraveler: 2952 },
  ]);
  // The figures are the planner's own per-tier totals, not a second
  // table: the Best value total matches buildPlan directly, and the
  // per-traveler share never changes the party total.
  assert.equal(taxiTierOptions('Central Europe', 4)[1].total, 7200, 'the party total scales with the party');
  assert.equal(taxiTierOptions('Central Europe', 4)[1].perTraveler, 1800, 'per traveler is unchanged');
  // Clamped like every other party size in the app.
  assert.equal(taxiTierOptions('Central Europe', 0)[1].perTraveler, 1800, '0 travelers clamps to the 2-traveler default');
  assert.equal(taxiTierOptions('Central Europe', 99)[1].total, 16200, '99 travelers clamps to 9');
  // A city the traveler is going to prices on the planner's fallback
  // base — the tier cards work for a city name, not only a route name.
  assert.deepEqual(taxiTierOptions('London', 2), [
    { tier: 'cheapest', label: 'Cheapest', total: 1920, perTraveler: 960 },
    { tier: 'best', label: 'Best value', total: 3000, perTraveler: 1500 },
    { tier: 'premium', label: 'Premium', total: 4920, perTraveler: 2460 },
  ]);
});

test('taxiTierRows: one row per destination, in the chosen tier, consistent with the old Best value list', () => {
  const best = taxiTierRows('best', 2);
  const old = tabRowsFor('taxis', 2);
  assert.equal(best.length, old.length, 'same destinations as the old list');
  assert.equal(best.length, 21, '21 discovery destinations');
  for (let i = 0; i < best.length; i++) {
    assert.equal(best[i].destination, old[i].destination, 'same order as the old list');
    assert.equal(best[i].pricePerTraveler, old[i].pricePerTraveler, 'Best value prices are unchanged');
    assert.equal(best[i].kind, 'full-trip', 'taxi rows are full-trip totals, never taxi prices');
    assert.equal(
      best[i].total,
      buildPlan(best[i].destination, 2, 3).options[1].total,
      'the total is the planner total itself, not the rounded per-traveler figure times the party'
    );
  }
  const cheapest = taxiTierRows('cheapest', 2);
  const ce = cheapest.find((r) => r.destination === 'Central Europe');
  assert.equal(ce?.pricePerTraveler, 1152, 'Central Europe Cheapest is $1,152 per traveler');
  assert.equal(ce?.total, 2304, 'Central Europe Cheapest is $2,304 total');
  const premium = taxiTierRows('premium', 2);
  assert.equal(premium.find((r) => r.destination === 'Central Europe')?.pricePerTraveler, 2952);
  // Every tier is cheaper than the one above it, on every row.
  for (let i = 0; i < best.length; i++) {
    assert.ok(cheapest[i].pricePerTraveler <= best[i].pricePerTraveler, 'Cheapest never beats Best value');
    assert.ok(best[i].pricePerTraveler <= premium[i].pricePerTraveler, 'Best value never beats Premium');
  }
  // The shared sort re-orders the taxi rows by the selected tier.
  const sorted = sortTabRows(taxiTierRows('premium', 2), 'cheapest');
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].pricePerTraveler >= sorted[i - 1].pricePerTraveler, 'cheapest sort is ascending');
  }
  assert.deepEqual(
    sortTabRows(taxiTierRows('best', 2), 'best').map((r) => r.destination),
    best.map((r) => r.destination),
    'best sort keeps the planner order'
  );
});

test('nowTimeLocal: the local time, zero-padded HH:MM', () => {
  assert.equal(nowTimeLocal(new Date(2026, 10, 15, 9, 5)), '09:05');
  assert.equal(nowTimeLocal(new Date(2026, 10, 15, 0, 0)), '00:00');
  assert.equal(nowTimeLocal(new Date(2026, 10, 15, 23, 59)), '23:59');
});

test('searchQueryFromParams: a full taxi deep link parses, ride and date/time and tier and all', () => {
  const q = searchQueryFromParams(
    {
      tab: 'taxis',
      from: 'New York',
      dropoff: 'Central Europe',
      depart: '2027-01-15',
      time: '09:30',
      travelers: '2',
      tier: 'premium',
    },
    TODAY
  );
  assert.ok(q, 'a taxi link parses');
  assert.equal(q?.tab, 'taxis');
  assert.equal(q?.from, 'New York');
  assert.equal(q?.dropoff, 'Central Europe');
  assert.equal(q?.to, '', 'taxis carry no to — the drop-off is the end');
  assert.equal(q?.depart, '2027-01-15');
  assert.equal(q?.pickupTime, '09:30');
  assert.equal(q?.travelers, 2);
  assert.equal(q?.taxiTier, 'premium');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'taxis serialize then parse is the identity');
  // No tier in the link is Best value, and the tier never leaks into the URL then.
  const plain = searchQueryFromParams(
    { tab: 'taxis', from: 'New York', dropoff: 'London', depart: '2027-01-15' },
    TODAY
  );
  assert.equal(plain?.taxiTier, 'best');
  assert.ok(!searchQueryToParams(plain).includes('tier='), 'Best value is the default — no tier param');
  // Junk tier falls back, and a flights link ignores the tier entirely.
  assert.equal(
    searchQueryFromParams({ tab: 'taxis', from: 'New York', dropoff: 'London', tier: 'Luxury' }, TODAY)?.taxiTier,
    'best'
  );
  assert.equal(
    searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'London', tier: 'cheapest' }, TODAY)?.taxiTier,
    'best'
  );
});

test('searchQueryFromParams: a taxi link naming the drop-off as to= still lands on the drop-off', () => {
  // The widget writes &dropoff=, but a hand-shared link may name the
  // drop-off &to= (the buses shape) — that is the same end, so it
  // folds into dropoff instead of being lost.
  const q = searchQueryFromParams(
    { tab: 'taxis', from: 'New York', to: 'London', depart: '2027-01-15', travelers: '2' },
    TODAY
  );
  assert.ok(q, 'a taxi link with to= parses');
  assert.equal(q?.dropoff, 'London', 'the to= end becomes the drop-off');
  assert.equal(q?.to, '');
  assert.ok(q?.from, 'the pick-up stands');
  // When both are given, the widget's dropoff wins — to= is only the fallback.
  const both = searchQueryFromParams(
    { tab: 'taxis', from: 'New York', to: 'Paris', dropoff: 'London', depart: '2027-01-15' },
    TODAY
  );
  assert.equal(both?.dropoff, 'London', 'an explicit dropoff is never overwritten by to=');
});

test('searchQueryFromParams: stale taxi dates drop', () => {
  // TODAY is 2026-11-15, so 2020 dates are stale.
  const stale = searchQueryFromParams(
    { tab: 'taxis', from: 'New York', dropoff: 'London', depart: '2020-01-04', travelers: '2' },
    TODAY
  );
  assert.equal(stale?.depart, '', 'a past ride date drops');
  assert.ok(stale, 'the link still counts as a search from its ride');
  // A taxi search with no date at all is flexible dates.
  const flexible = searchQueryFromParams(
    { tab: 'taxis', from: 'New York', dropoff: 'London', travelers: '2' },
    TODAY
  );
  assert.equal(flexible?.depart, '');
  assert.equal(flexible?.pickupTime, '');
});

test('formValuesFromQuery + emptySearchQuery: the taxi values round-trip through the widget', () => {
  const q = searchQueryFromParams(
    {
      tab: 'taxis',
      from: 'New York',
      dropoff: 'London',
      depart: '2027-01-15',
      time: '09:30',
      travelers: '4',
      tier: 'cheapest',
    },
    TODAY
  );
  assert.ok(q);
  const v = formValuesFromQuery(q);
  assert.equal(v.from, 'New York', 'the pick-up is the shared from');
  assert.equal(v.dropoff, 'London', 'the drop-off is the shared dropoff');
  assert.equal(v.depart, '2027-01-15');
  assert.equal(v.pickupTime, '09:30', 'the ride time survives the widget re-sync');
  assert.equal(v.travelers, 4);
  assert.equal(v.taxiTier, 'cheapest', 'the tier survives the widget re-sync');
  const empty = emptySearchQuery('taxis');
  assert.equal(empty.taxiTier, 'best');
  assert.equal(empty.depart, '');
  assert.equal(empty.pickupTime, '');
  assert.equal(empty.travelers, 2);
});
