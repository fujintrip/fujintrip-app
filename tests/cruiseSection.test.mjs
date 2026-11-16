// Cruises section (Nov 15, 2026): the Cruises search form +
// results to the same standard as the Stays, Car rental and
// Attractions sections — validated month, icons, deep-link sync,
// per-tier cruise cards, tier sort, filters with counts, honest
// full-trip planning-estimate labels. Nothing here invents a cruise
// line, a ship, a sailing, a rating, a price, or a duration: the
// planner breaks out no cruise leg, so every cruise figure is the
// planner's own per-tier full-trip total, labeled as such — never a
// cruise price. A trip the planner cannot price never gets a row.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/cruiseSection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import {
  cruiseTierFromValue,
  cruiseTierLabel,
  cruiseTierOptions,
  cruiseTierRows,
  emptySearchQuery,
  formValuesFromQuery,
  searchQueryFromParams,
  searchQueryToParams,
  sortTabRows,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('cruiseTierFromValue: only the three real tiers win', () => {
  assert.equal(cruiseTierFromValue('cheapest'), 'cheapest');
  assert.equal(cruiseTierFromValue('best'), 'best');
  assert.equal(cruiseTierFromValue('premium'), 'premium');
  assert.equal(cruiseTierFromValue('Luxury'), 'best', 'junk falls back to Best value');
  assert.equal(cruiseTierFromValue(undefined), 'best');
  assert.equal(cruiseTierFromValue(null), 'best');
  assert.equal(cruiseTierLabel('cheapest'), 'Cheapest');
  assert.equal(cruiseTierLabel('best'), 'Best value');
  assert.equal(cruiseTierLabel('premium'), 'Premium');
});

test('cruiseTierOptions: the three planner per-tier full-trip totals for the party, per traveler underneath', () => {
  const opts = cruiseTierOptions('Central Europe', 2);
  assert.deepEqual(opts, [
    { tier: 'cheapest', label: 'Cheapest', total: 2304, perTraveler: 1152 },
    { tier: 'best', label: 'Best value', total: 3600, perTraveler: 1800 },
    { tier: 'premium', label: 'Premium', total: 5904, perTraveler: 2952 },
  ]);
  // The figures are the planner's own per-tier totals, not a second
  // table: the Best value total matches buildPlan directly, and the
  // per-traveler share never changes the party total.
  assert.equal(cruiseTierOptions('Central Europe', 4)[1].total, 7200, 'the party total scales with the party');
  assert.equal(cruiseTierOptions('Central Europe', 4)[1].perTraveler, 1800, 'per traveler is unchanged');
  // Clamped like every other party size in the app.
  assert.equal(cruiseTierOptions('Central Europe', 0)[1].perTraveler, 1800, '0 travelers clamps to the 2-traveler default');
  assert.equal(cruiseTierOptions('Central Europe', 99)[1].total, 16200, '99 travelers clamps to 9');
});

test('cruiseTierRows: one row per destination, in the chosen tier, consistent with the old Best value list', () => {
  const best = cruiseTierRows('best', 2);
  const old = tabRowsFor('cruises', 2);
  assert.equal(best.length, old.length, 'same destinations as the old list');
  assert.equal(best.length, 21, '21 discovery destinations');
  for (let i = 0; i < best.length; i++) {
    assert.equal(best[i].destination, old[i].destination, 'same order as the old list');
    assert.equal(best[i].pricePerTraveler, old[i].pricePerTraveler, 'Best value prices are unchanged');
    assert.equal(best[i].kind, 'full-trip', 'cruise rows are full-trip totals, never cruise prices');
    assert.equal(
      best[i].total,
      buildPlan(best[i].destination, 2, 3).options[1].total,
      'the total is the planner total itself, not the rounded per-traveler figure times the party'
    );
  }
  const cheapest = cruiseTierRows('cheapest', 2);
  const ce = cheapest.find((r) => r.destination === 'Central Europe');
  assert.equal(ce?.pricePerTraveler, 1152, 'Central Europe Cheapest is $1,152 per traveler');
  assert.equal(ce?.total, 2304, 'Central Europe Cheapest is $2,304 total');
  const premium = cruiseTierRows('premium', 2);
  assert.equal(premium.find((r) => r.destination === 'Central Europe')?.pricePerTraveler, 2952);
  // Every tier is cheaper than the one above it, on every row.
  for (let i = 0; i < best.length; i++) {
    assert.ok(cheapest[i].pricePerTraveler <= best[i].pricePerTraveler, 'Cheapest never beats Best value');
    assert.ok(best[i].pricePerTraveler <= premium[i].pricePerTraveler, 'Best value never beats Premium');
  }
  // The shared sort re-orders the cruise rows by the selected tier.
  const sorted = sortTabRows(cruiseTierRows('premium', 2), 'cheapest');
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].pricePerTraveler >= sorted[i - 1].pricePerTraveler, 'cheapest sort is ascending');
  }
  assert.deepEqual(
    sortTabRows(cruiseTierRows('best', 2), 'best').map((r) => r.destination),
    best.map((r) => r.destination),
    'best sort keeps the planner order'
  );
});

test('searchQueryFromParams: a full cruise deep link parses, month and tier and all', () => {
  const q = searchQueryFromParams(
    {
      tab: 'cruises',
      dest: 'Central Europe',
      month: '12',
      travelers: '2',
      tier: 'premium',
    },
    TODAY
  );
  assert.ok(q, 'a cruise link parses');
  assert.equal(q?.tab, 'cruises');
  assert.equal(q?.dest, 'Central Europe');
  assert.equal(q?.month, '12');
  assert.equal(q?.travelers, 2);
  assert.equal(q?.cruiseTier, 'premium');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'cruises serialize then parse is the identity');
  // No tier in the link is Best value, and the tier never leaks into the URL then.
  // (December — a later month from the November test date, so the month itself stays.)
  const plain = searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: '12' }, TODAY);
  assert.equal(plain?.cruiseTier, 'best');
  assert.ok(!searchQueryToParams(plain).includes('tier='), 'Best value is the default — no tier param');
  // Junk tier falls back, and a flights link ignores the tier entirely.
  assert.equal(searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', tier: 'Luxury' }, TODAY)?.cruiseTier, 'best');
  assert.equal(
    searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'London', tier: 'cheapest' }, TODAY)?.cruiseTier,
    'best'
  );
});

test('searchQueryFromParams: a stale cruise month drops, the current month and later months stay', () => {
  // TODAY is 2026-11-15, so January is a month that already passed.
  const stale = searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: '1', travelers: '2' }, TODAY);
  assert.equal(stale?.month, '', 'a past month drops');
  assert.ok(stale, 'the link still counts as a search from its destination');
  // A link carrying only a past month is a bare tab, not a search.
  assert.equal(searchQueryFromParams({ tab: 'cruises', month: '1' }, TODAY), null, 'a month-only stale link is not a search');
  assert.equal(
    searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: '11' }, TODAY)?.month,
    '11',
    'the current month stays — a cruise this month is still a trip'
  );
  assert.equal(
    searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: '12' }, TODAY)?.month,
    '12',
    'a later month stays'
  );
  // Out-of-range months never parse in the first place.
  assert.equal(searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: '13' }, TODAY)?.month, '');
  assert.equal(searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: '0' }, TODAY)?.month, '');
  assert.equal(searchQueryFromParams({ tab: 'cruises', dest: 'Caribbean', month: 'June' }, TODAY)?.month, '');
});

test('formValuesFromQuery + emptySearchQuery: the cruise values round-trip through the widget', () => {
  const q = searchQueryFromParams(
    {
      tab: 'cruises',
      dest: 'Caribbean',
      month: '12',
      travelers: '4',
      tier: 'cheapest',
    },
    TODAY
  );
  assert.ok(q);
  const v = formValuesFromQuery(q);
  assert.equal(v.place, 'Caribbean', 'the destination is the shared place');
  assert.equal(v.month, '12');
  assert.equal(v.travelers, 4);
  assert.equal(v.cruiseTier, 'cheapest', 'the tier survives the widget re-sync');
  const empty = emptySearchQuery('cruises');
  assert.equal(empty.cruiseTier, 'best');
  assert.equal(empty.month, '', 'no month is a flexible month');
  assert.equal(empty.travelers, 2);
});
