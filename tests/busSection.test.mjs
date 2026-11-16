// Buses section (Nov 15, 2026): the Buses search form + results to
// the same standard as the Stays, Car rental, Attractions and Cruises
// sections — validated dates, icons, deep-link sync, per-tier bus
// cards, tier sort, filters with counts, honest full-trip
// planning-estimate labels. Nothing here invents a bus operator, a
// route, a timetable, a rating, a price, or a duration: the planner
// breaks out no bus leg, so every bus figure is the planner's own
// per-tier full-trip total, labeled as such — never a bus price. A
// trip the planner cannot price never gets a row.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/busSection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import {
  busTierFromValue,
  busTierLabel,
  busTierOptions,
  busTierRows,
  emptySearchQuery,
  formValuesFromQuery,
  searchQueryFromParams,
  searchQueryToParams,
  sortTabRows,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('busTierFromValue: only the three real tiers win', () => {
  assert.equal(busTierFromValue('cheapest'), 'cheapest');
  assert.equal(busTierFromValue('best'), 'best');
  assert.equal(busTierFromValue('premium'), 'premium');
  assert.equal(busTierFromValue('Luxury'), 'best', 'junk falls back to Best value');
  assert.equal(busTierFromValue(undefined), 'best');
  assert.equal(busTierFromValue(null), 'best');
  assert.equal(busTierLabel('cheapest'), 'Cheapest');
  assert.equal(busTierLabel('best'), 'Best value');
  assert.equal(busTierLabel('premium'), 'Premium');
});

test('busTierOptions: the three planner per-tier full-trip totals for the party, per traveler underneath', () => {
  const opts = busTierOptions('Central Europe', 2);
  assert.deepEqual(opts, [
    { tier: 'cheapest', label: 'Cheapest', total: 2304, perTraveler: 1152 },
    { tier: 'best', label: 'Best value', total: 3600, perTraveler: 1800 },
    { tier: 'premium', label: 'Premium', total: 5904, perTraveler: 2952 },
  ]);
  // The figures are the planner's own per-tier totals, not a second
  // table: the Best value total matches buildPlan directly, and the
  // per-traveler share never changes the party total.
  assert.equal(busTierOptions('Central Europe', 4)[1].total, 7200, 'the party total scales with the party');
  assert.equal(busTierOptions('Central Europe', 4)[1].perTraveler, 1800, 'per traveler is unchanged');
  // Clamped like every other party size in the app.
  assert.equal(busTierOptions('Central Europe', 0)[1].perTraveler, 1800, '0 travelers clamps to the 2-traveler default');
  assert.equal(busTierOptions('Central Europe', 99)[1].total, 16200, '99 travelers clamps to 9');
  // A city the traveler is going to prices on the planner's fallback
  // base — the tier cards work for a city name, not only a route name.
  assert.deepEqual(busTierOptions('London', 2), [
    { tier: 'cheapest', label: 'Cheapest', total: 1920, perTraveler: 960 },
    { tier: 'best', label: 'Best value', total: 3000, perTraveler: 1500 },
    { tier: 'premium', label: 'Premium', total: 4920, perTraveler: 2460 },
  ]);
});

test('busTierRows: one row per destination, in the chosen tier, consistent with the old Best value list', () => {
  const best = busTierRows('best', 2);
  const old = tabRowsFor('buses', 2);
  assert.equal(best.length, old.length, 'same destinations as the old list');
  assert.equal(best.length, 21, '21 discovery destinations');
  for (let i = 0; i < best.length; i++) {
    assert.equal(best[i].destination, old[i].destination, 'same order as the old list');
    assert.equal(best[i].pricePerTraveler, old[i].pricePerTraveler, 'Best value prices are unchanged');
    assert.equal(best[i].kind, 'full-trip', 'bus rows are full-trip totals, never bus prices');
    assert.equal(
      best[i].total,
      buildPlan(best[i].destination, 2, 3).options[1].total,
      'the total is the planner total itself, not the rounded per-traveler figure times the party'
    );
  }
  const cheapest = busTierRows('cheapest', 2);
  const ce = cheapest.find((r) => r.destination === 'Central Europe');
  assert.equal(ce?.pricePerTraveler, 1152, 'Central Europe Cheapest is $1,152 per traveler');
  assert.equal(ce?.total, 2304, 'Central Europe Cheapest is $2,304 total');
  const premium = busTierRows('premium', 2);
  assert.equal(premium.find((r) => r.destination === 'Central Europe')?.pricePerTraveler, 2952);
  // Every tier is cheaper than the one above it, on every row.
  for (let i = 0; i < best.length; i++) {
    assert.ok(cheapest[i].pricePerTraveler <= best[i].pricePerTraveler, 'Cheapest never beats Best value');
    assert.ok(best[i].pricePerTraveler <= premium[i].pricePerTraveler, 'Best value never beats Premium');
  }
  // The shared sort re-orders the bus rows by the selected tier.
  const sorted = sortTabRows(busTierRows('premium', 2), 'cheapest');
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].pricePerTraveler >= sorted[i - 1].pricePerTraveler, 'cheapest sort is ascending');
  }
  assert.deepEqual(
    sortTabRows(busTierRows('best', 2), 'best').map((r) => r.destination),
    best.map((r) => r.destination),
    'best sort keeps the planner order'
  );
});

test('searchQueryFromParams: a full bus deep link parses, route and dates and tier and all', () => {
  const q = searchQueryFromParams(
    {
      tab: 'buses',
      from: 'New York',
      to: 'Central Europe',
      depart: '2027-01-15',
      return: '2027-01-22',
      travelers: '2',
      tier: 'premium',
    },
    TODAY
  );
  assert.ok(q, 'a bus link parses');
  assert.equal(q?.tab, 'buses');
  assert.equal(q?.from, 'New York');
  assert.equal(q?.to, 'Central Europe');
  assert.equal(q?.depart, '2027-01-15');
  assert.equal(q?.ret, '2027-01-22');
  assert.equal(q?.travelers, 2);
  assert.equal(q?.busTier, 'premium');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'buses serialize then parse is the identity');
  // No tier in the link is Best value, and the tier never leaks into the URL then.
  const plain = searchQueryFromParams({ tab: 'buses', from: 'New York', to: 'London', depart: '2027-01-15' }, TODAY);
  assert.equal(plain?.busTier, 'best');
  assert.ok(!searchQueryToParams(plain).includes('tier='), 'Best value is the default — no tier param');
  // Junk tier falls back, and a flights link ignores the tier entirely.
  assert.equal(searchQueryFromParams({ tab: 'buses', from: 'New York', to: 'London', tier: 'Luxury' }, TODAY)?.busTier, 'best');
  assert.equal(
    searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'London', tier: 'cheapest' }, TODAY)?.busTier,
    'best'
  );
});

test('searchQueryFromParams: stale bus dates drop, a return before the departure drops', () => {
  // TODAY is 2026-11-15, so 2020 dates are stale.
  const stale = searchQueryFromParams(
    { tab: 'buses', from: 'New York', to: 'London', depart: '2020-01-04', return: '2020-01-17', travelers: '2' },
    TODAY
  );
  assert.equal(stale?.depart, '', 'a past departure drops');
  assert.equal(stale?.ret, '', 'a past return drops');
  assert.ok(stale, 'the link still counts as a search from its route');
  // A return before the departure is not a trip — it drops, the
  // departure stands.
  const backwards = searchQueryFromParams(
    { tab: 'buses', from: 'New York', to: 'London', depart: '2027-01-22', return: '2027-01-15' },
    TODAY
  );
  assert.equal(backwards?.depart, '2027-01-22');
  assert.equal(backwards?.ret, '', 'a return before the departure drops');
  // A one-way bus search carries no return at all.
  const oneway = searchQueryFromParams({ tab: 'buses', from: 'New York', to: 'London', depart: '2027-01-15' }, TODAY);
  assert.equal(oneway?.ret, '');
});

test('formValuesFromQuery + emptySearchQuery: the bus values round-trip through the widget', () => {
  const q = searchQueryFromParams(
    {
      tab: 'buses',
      from: 'New York',
      to: 'London',
      depart: '2027-01-15',
      return: '2027-01-22',
      travelers: '4',
      tier: 'cheapest',
    },
    TODAY
  );
  assert.ok(q);
  const v = formValuesFromQuery(q);
  assert.equal(v.from, 'New York', 'the origin is the shared from');
  assert.equal(v.place, 'London', 'the destination is the shared place');
  assert.equal(v.depart, '2027-01-15');
  assert.equal(v.ret, '2027-01-22');
  assert.equal(v.travelers, 4);
  assert.equal(v.busTier, 'cheapest', 'the tier survives the widget re-sync');
  const empty = emptySearchQuery('buses');
  assert.equal(empty.busTier, 'best');
  assert.equal(empty.depart, '');
  assert.equal(empty.ret, '', 'no return is a one-way search');
  assert.equal(empty.travelers, 2);
});
