// Stays section (Nov 15, 2026): the Stays search form + results to
// the same standard as the Flights section — validated dates,
// guests/rooms steppers, deep-link sync, per-tier stay cards, tier
// sort, filters with counts, honest planning-estimate labels. Nothing
// here invents a hotel, a rating, a price, or a property: every stay
// figure is the planner's own hotel leg, and a stay the planner
// cannot price never gets a row.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/staySection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner.ts';
import { discoveryDestinations } from '../lib/discovery.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import {
  emptySearchQuery,
  formValuesFromQuery,
  searchQueryFromParams,
  searchQueryToParams,
  sortTabRows,
  stayNightsFor,
  stayTierFromValue,
  stayTierLabel,
  stayTierOptions,
  stayTierRows,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('stayTierFromValue: only the three real tiers win', () => {
  assert.equal(stayTierFromValue('cheapest'), 'cheapest');
  assert.equal(stayTierFromValue('best'), 'best');
  assert.equal(stayTierFromValue('premium'), 'premium');
  assert.equal(stayTierFromValue('Luxury'), 'best', 'junk falls back to Best value');
  assert.equal(stayTierFromValue(undefined), 'best');
  assert.equal(stayTierFromValue(null), 'best');
  assert.equal(stayTierLabel('cheapest'), 'Cheapest');
  assert.equal(stayTierLabel('best'), 'Best value');
  assert.equal(stayTierLabel('premium'), 'Premium');
});

test('stayTierOptions: the three planner hotel legs for the party, per traveler underneath', () => {
  const opts = stayTierOptions('Central Europe', 2);
  assert.deepEqual(opts, [
    { tier: 'cheapest', label: 'Cheapest', hotel: 792, perTraveler: 396 },
    { tier: 'best', label: 'Best value', hotel: 1188, perTraveler: 594 },
    { tier: 'premium', label: 'Premium', hotel: 2232, perTraveler: 1116 },
  ]);
  // The figures are the planner's own hotel legs, not a second table:
  // they match buildPlan's options exactly, for any party size.
  for (const guests of [1, 2, 4, 9]) {
    const fromPlan = buildPlan('Central Europe', guests, 3).options;
    const got = stayTierOptions('Central Europe', guests);
    assert.equal(got[0].hotel, fromPlan[0].hotel, `cheapest hotel for ${guests} guests`);
    assert.equal(got[1].hotel, fromPlan[1].hotel, `best hotel for ${guests} guests`);
    assert.equal(got[2].hotel, fromPlan[2].hotel, `premium hotel for ${guests} guests`);
    assert.equal(got[1].perTraveler, Math.round(fromPlan[1].hotel / guests), 'per traveler is the leg over the party');
  }
  // Party size scales the leg, not the per-traveler share.
  assert.equal(stayTierOptions('Central Europe', 4)[1].hotel, 2376, '4 guests double the 2-guest leg');
  assert.equal(stayTierOptions('Central Europe', 4)[1].perTraveler, 594, 'per traveler is unchanged');
  // Clamped like every other party size in the app.
  assert.equal(stayTierOptions('Central Europe', 0)[1].perTraveler, 594, '0 guests clamps to the 2-guest default');
  assert.equal(stayTierOptions('Central Europe', 99)[1].hotel, 1800 * 0.33 * 9, '99 guests clamps to 9');
});

test('stayTierRows: one row per destination, in the chosen tier, consistent with the old Best value list', () => {
  const best = stayTierRows('best', 2);
  const old = tabRowsFor('hotels', 2);
  assert.equal(best.length, old.length, 'same destinations as the old list');
  assert.equal(best.length, 21, '21 discovery destinations');
  for (let i = 0; i < best.length; i++) {
    assert.equal(best[i].destination, old[i].destination, 'same order as the old list');
    assert.equal(best[i].pricePerTraveler, old[i].pricePerTraveler, 'Best value prices are unchanged');
    assert.equal(best[i].kind, 'leg');
    assert.equal(
      best[i].total,
      buildPlan(best[i].destination, 2, 3).options[1].hotel,
      'the total is the planner leg itself, not the rounded per-traveler figure times the party'
    );
  }
  const cheapest = stayTierRows('cheapest', 2);
  const ce = cheapest.find((r) => r.destination === 'Central Europe');
  assert.equal(ce?.pricePerTraveler, 396, 'Central Europe Cheapest is $396 per traveler');
  assert.equal(ce?.total, 792, 'Central Europe Cheapest is $792 total');
  const premium = stayTierRows('premium', 2);
  assert.equal(premium.find((r) => r.destination === 'Central Europe')?.pricePerTraveler, 1116);
  // Every tier is cheaper than the one above it, on every row.
  for (let i = 0; i < best.length; i++) {
    assert.ok(cheapest[i].pricePerTraveler <= best[i].pricePerTraveler, 'Cheapest never beats Best value');
    assert.ok(best[i].pricePerTraveler <= premium[i].pricePerTraveler, 'Best value never beats Premium');
  }
  // The shared sort re-orders the stay rows by the selected tier.
  const sorted = sortTabRows(stayTierRows('premium', 2), 'cheapest');
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].pricePerTraveler >= sorted[i - 1].pricePerTraveler, 'cheapest sort is ascending');
  }
  assert.deepEqual(
    sortTabRows(stayTierRows('best', 2), 'best').map((r) => r.destination),
    best.map((r) => r.destination),
    'best sort keeps the planner order'
  );
});

test('stayNightsFor: searched dates first, the route nights when there are none', () => {
  assert.equal(stayNightsFor({ depart: '2027-01-04', ret: '2027-01-17', dest: 'Central Europe' }), 13);
  assert.equal(stayNightsFor({ depart: '2027-01-04', ret: '2027-01-05', dest: 'Central Europe' }), 1, 'one night');
  assert.equal(stayNightsFor({ depart: '', ret: '', dest: 'Central Europe' }), 13, 'no dates → the route nights');
  assert.equal(stayNightsFor({ depart: '2027-01-04', ret: '', dest: 'Central Europe' }), 13, 'check-in only → the route nights');
  assert.equal(
    stayNightsFor({ depart: '2027-01-04', ret: '2027-01-04', dest: 'Central Europe' }),
    13,
    'check-out on the check-in day is not a night — the route nights stand in'
  );
  assert.equal(stayNightsFor({ depart: '', ret: '', dest: 'Zanzibar' }), null, 'an unknown place has no nights to fall back to');
  assert.equal(stayNightsFor({ depart: '', ret: '', dest: '' }), null, 'no destination, no dates → no nights');
  // A per-row fallback: the row's own route nights, not the searched destination's.
  const japan = discoveryDestinations().find((e) => e.destination === 'Japan');
  assert.ok(japan, 'Japan is a discovery destination');
  assert.equal(stayNightsFor({ depart: '', ret: '', dest: 'Central Europe' }, 'Japan'), japan.nights);
});

test('searchQueryFromParams: a full stays deep link parses, tier and all', () => {
  const q = searchQueryFromParams(
    { tab: 'hotels', dest: 'Central Europe', depart: '2027-01-04', return: '2027-01-17', guests: '2', rooms: '1', tier: 'cheapest' },
    TODAY
  );
  assert.ok(q, 'a stays link parses');
  assert.equal(q?.tab, 'hotels');
  assert.equal(q?.dest, 'Central Europe');
  assert.equal(q?.depart, '2027-01-04');
  assert.equal(q?.ret, '2027-01-17');
  assert.equal(q?.guests, 2);
  assert.equal(q?.rooms, 1);
  assert.equal(q?.stayTier, 'cheapest');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'stays serialize then parse is the identity');
  // No tier in the link is Best value, and the tier never leaks into the URL then.
  const plain = searchQueryFromParams(
    { tab: 'hotels', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-05' },
    TODAY
  );
  assert.equal(plain?.stayTier, 'best');
  assert.ok(!searchQueryToParams(plain).includes('tier='), 'Best value is the default — no tier param');
  // Junk tier falls back, and a flights link ignores the tier entirely.
  assert.equal(searchQueryFromParams({ tab: 'hotels', dest: 'Kyoto', tier: 'Luxury' }, TODAY)?.stayTier, 'best');
  assert.equal(
    searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'London', tier: 'cheapest' }, TODAY)?.stayTier,
    'best'
  );
});

test('searchQueryFromParams: stale stays dates drop, and a check-out before check-in drops', () => {
  const stale = searchQueryFromParams(
    { tab: 'hotels', dest: 'Kyoto', depart: '2026-01-04', return: '2026-01-17' },
    TODAY
  );
  assert.equal(stale?.depart, '', 'a past check-in drops');
  assert.equal(stale?.ret, '', 'a past check-out drops');
  assert.ok(stale, 'the link still counts as a search from its destination');
  const backwards = searchQueryFromParams(
    { tab: 'hotels', dest: 'Kyoto', depart: '2027-04-05', return: '2027-04-01' },
    TODAY
  );
  assert.equal(backwards?.depart, '2027-04-05');
  assert.equal(backwards?.ret, '', 'a check-out before check-in drops');
  // Out-of-range party sizes fall back to the defaults (the parser's
  // existing rule — it falls back, never clamps).
  const party = searchQueryFromParams({ tab: 'hotels', dest: 'Kyoto', guests: '99', rooms: '99' }, TODAY);
  assert.equal(party?.guests, 2);
  assert.equal(party?.rooms, 1);
});

test('formValuesFromQuery + emptySearchQuery: the stays values round-trip through the widget', () => {
  const q = searchQueryFromParams(
    { tab: 'hotels', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-05', guests: '4', rooms: '2', tier: 'premium' },
    TODAY
  );
  assert.ok(q);
  const v = formValuesFromQuery(q);
  assert.equal(v.place, 'Kyoto', 'the destination is the shared place');
  assert.equal(v.depart, '2027-04-01');
  assert.equal(v.ret, '2027-04-05');
  assert.equal(v.guests, 4);
  assert.equal(v.rooms, 2);
  assert.equal(v.stayTier, 'premium', 'the tier survives the widget re-sync');
  const empty = emptySearchQuery('hotels');
  assert.equal(empty.stayTier, 'best');
  assert.equal(empty.guests, 2);
  assert.equal(empty.rooms, 1);
});
