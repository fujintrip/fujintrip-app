// Attractions section (Nov 15, 2026): the Attractions search form +
// results to the same standard as the Stays and Car rental sections
// — validated dates, icons + end date, deep-link sync, per-tier
// attraction cards, tier sort, filters with counts, honest
// planning-estimate labels. Nothing here invents an attraction, a
// tour, an operator, a rating, a price, or a duration: every
// attraction figure is the planner's own activities leg, and a trip
// the planner cannot price never gets a row.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/tourSection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner.ts';
import { discoveryDestinations } from '../lib/discovery.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import {
  tourDaysFor,
  tourTierFromValue,
  tourTierLabel,
  tourTierOptions,
  tourTierRows,
  emptySearchQuery,
  formValuesFromQuery,
  searchQueryFromParams,
  searchQueryToParams,
  sortTabRows,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('tourTierFromValue: only the three real tiers win', () => {
  assert.equal(tourTierFromValue('cheapest'), 'cheapest');
  assert.equal(tourTierFromValue('best'), 'best');
  assert.equal(tourTierFromValue('premium'), 'premium');
  assert.equal(tourTierFromValue('Luxury'), 'best', 'junk falls back to Best value');
  assert.equal(tourTierFromValue(undefined), 'best');
  assert.equal(tourTierFromValue(null), 'best');
  assert.equal(tourTierLabel('cheapest'), 'Cheapest');
  assert.equal(tourTierLabel('best'), 'Best value');
  assert.equal(tourTierLabel('premium'), 'Premium');
});

test('tourTierOptions: the three planner activities legs for the party, per traveler underneath', () => {
  const opts = tourTierOptions('Central Europe', 2);
  assert.deepEqual(opts, [
    { tier: 'cheapest', label: 'Cheapest', activities: 324, perTraveler: 162 },
    { tier: 'best', label: 'Best value', activities: 612, perTraveler: 306 },
    { tier: 'premium', label: 'Premium', activities: 1008, perTraveler: 504 },
  ]);
  // The figures are the planner's own activities legs, not a second
  // table: the Best value leg matches buildPlan directly, and the
  // per-traveler share never changes the party total.
  assert.equal(tourTierOptions('Central Europe', 4)[1].activities, 1224, 'the party total scales with the party');
  assert.equal(tourTierOptions('Central Europe', 4)[1].perTraveler, 306, 'per traveler is unchanged');
  // Clamped like every other party size in the app.
  assert.equal(tourTierOptions('Central Europe', 0)[1].perTraveler, 306, '0 travelers clamps to the 2-traveler default');
  assert.equal(tourTierOptions('Central Europe', 99)[1].activities, 2754, '99 travelers clamps to 9');
});

test('tourTierRows: one row per destination, in the chosen tier, consistent with the old Best value list', () => {
  const best = tourTierRows('best', 2);
  const old = tabRowsFor('tours', 2);
  assert.equal(best.length, old.length, 'same destinations as the old list');
  assert.equal(best.length, 21, '21 discovery destinations');
  for (let i = 0; i < best.length; i++) {
    assert.equal(best[i].destination, old[i].destination, 'same order as the old list');
    assert.equal(best[i].pricePerTraveler, old[i].pricePerTraveler, 'Best value prices are unchanged');
    assert.equal(best[i].kind, 'leg');
    assert.equal(
      best[i].total,
      buildPlan(best[i].destination, 2, 3).options[1].activities,
      'the total is the planner leg itself, not the rounded per-traveler figure times the party'
    );
  }
  const cheapest = tourTierRows('cheapest', 2);
  const ce = cheapest.find((r) => r.destination === 'Central Europe');
  assert.equal(ce?.pricePerTraveler, 162, 'Central Europe Cheapest is $162 per traveler');
  assert.equal(ce?.total, 324, 'Central Europe Cheapest is $324 total');
  const premium = tourTierRows('premium', 2);
  assert.equal(premium.find((r) => r.destination === 'Central Europe')?.pricePerTraveler, 504);
  // Every tier is cheaper than the one above it, on every row.
  for (let i = 0; i < best.length; i++) {
    assert.ok(cheapest[i].pricePerTraveler <= best[i].pricePerTraveler, 'Cheapest never beats Best value');
    assert.ok(best[i].pricePerTraveler <= premium[i].pricePerTraveler, 'Best value never beats Premium');
  }
  // The shared sort re-orders the attraction rows by the selected tier.
  const sorted = sortTabRows(tourTierRows('premium', 2), 'cheapest');
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].pricePerTraveler >= sorted[i - 1].pricePerTraveler, 'cheapest sort is ascending');
  }
  assert.deepEqual(
    sortTabRows(tourTierRows('best', 2), 'best').map((r) => r.destination),
    best.map((r) => r.destination),
    'best sort keeps the planner order'
  );
});

test('tourDaysFor: searched dates first, the route days when there are none', () => {
  assert.equal(tourDaysFor({ depart: '2027-01-04', ret: '2027-01-17', dest: 'Central Europe' }), 13);
  assert.equal(tourDaysFor({ depart: '2027-01-04', ret: '2027-01-05', dest: 'Central Europe' }), 1, 'one day');
  assert.equal(
    tourDaysFor({ depart: '2027-01-04', ret: '2027-01-04', dest: 'Central Europe' }),
    14,
    'an end on the start day is not a visit window — the route days stand in'
  );
  assert.equal(tourDaysFor({ depart: '', ret: '', dest: 'Central Europe' }), 14, 'no dates → the route days');
  assert.equal(tourDaysFor({ depart: '2027-01-04', ret: '', dest: 'Central Europe' }), 14, 'start only → the route days');
  assert.equal(
    tourDaysFor({ depart: '2027-01-04', ret: '2027-01-01', dest: 'Central Europe' }),
    14,
    'an end before the start is not a visit — the route days stand in'
  );
  assert.equal(tourDaysFor({ depart: '', ret: '', dest: 'Zanzibar' }), null, 'an unknown place has no days to fall back to');
  assert.equal(tourDaysFor({ depart: '', ret: '', dest: '' }), null, 'no destination, no dates → no days');
  // A per-row fallback: the row's own route days, not the searched destination's.
  const japan = discoveryDestinations().find((e) => e.destination === 'Japan');
  assert.ok(japan, 'Japan is a discovery destination');
  assert.equal(tourDaysFor({ depart: '', ret: '', dest: 'Central Europe' }, 'Japan'), japan.days);
});

test('searchQueryFromParams: a full attractions deep link parses, tier and all', () => {
  const q = searchQueryFromParams(
    {
      tab: 'tours',
      dest: 'Central Europe',
      depart: '2027-01-04',
      return: '2027-01-17',
      travelers: '2',
      tier: 'premium',
    },
    TODAY
  );
  assert.ok(q, 'an attractions link parses');
  assert.equal(q?.tab, 'tours');
  assert.equal(q?.dest, 'Central Europe');
  assert.equal(q?.depart, '2027-01-04');
  assert.equal(q?.ret, '2027-01-17');
  assert.equal(q?.travelers, 2);
  assert.equal(q?.tourTier, 'premium');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'attractions serialize then parse is the identity');
  // No tier in the link is Best value, and the tier never leaks into the URL then.
  const plain = searchQueryFromParams(
    { tab: 'tours', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-05' },
    TODAY
  );
  assert.equal(plain?.tourTier, 'best');
  assert.ok(!searchQueryToParams(plain).includes('tier='), 'Best value is the default — no tier param');
  // Junk tier falls back, and a flights link ignores the tier entirely.
  assert.equal(searchQueryFromParams({ tab: 'tours', dest: 'Kyoto', tier: 'Luxury' }, TODAY)?.tourTier, 'best');
  assert.equal(
    searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'London', tier: 'cheapest' }, TODAY)?.tourTier,
    'best'
  );
});

test('searchQueryFromParams: stale attraction dates drop, an end before the start drops', () => {
  const stale = searchQueryFromParams(
    { tab: 'tours', dest: 'Kyoto', depart: '2026-01-04', return: '2026-01-17' },
    TODAY
  );
  assert.equal(stale?.depart, '', 'a past start drops');
  assert.equal(stale?.ret, '', 'a past end drops');
  assert.ok(stale, 'the link still counts as a search from its destination');
  const backwards = searchQueryFromParams(
    { tab: 'tours', dest: 'Kyoto', depart: '2027-04-05', return: '2027-04-01' },
    TODAY
  );
  assert.equal(backwards?.depart, '2027-04-05');
  assert.equal(backwards?.ret, '', 'an end before the start drops');
  // Same-day stays in the parsed query — the parser is generic
  // across tabs, and the form validation (not the parser) is what
  // requires the end after the start before the search runs.
  const sameDay = searchQueryFromParams(
    { tab: 'tours', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-01' },
    TODAY
  );
  assert.equal(sameDay?.depart, '2027-04-01');
  assert.equal(sameDay?.ret, '2027-04-01', 'the parser keeps a same-day link — the form names it, the parser does not drop it');
});

test('formValuesFromQuery + emptySearchQuery: the attraction values round-trip through the widget', () => {
  const q = searchQueryFromParams(
    {
      tab: 'tours',
      dest: 'Kyoto',
      depart: '2027-04-01',
      return: '2027-04-05',
      travelers: '4',
      tier: 'cheapest',
    },
    TODAY
  );
  assert.ok(q);
  const v = formValuesFromQuery(q);
  assert.equal(v.place, 'Kyoto', 'the destination is the shared place');
  assert.equal(v.depart, '2027-04-01');
  assert.equal(v.ret, '2027-04-05');
  assert.equal(v.travelers, 4);
  assert.equal(v.tourTier, 'cheapest', 'the tier survives the widget re-sync');
  const empty = emptySearchQuery('tours');
  assert.equal(empty.tourTier, 'best');
  assert.equal(empty.travelers, 2);
});
