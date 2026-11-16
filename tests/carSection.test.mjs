// Car rental section (Nov 15, 2026): the Car rental search form +
// results to the same standard as the Stays section — validated
// dates, icons + travelers, deep-link sync, per-tier car cards,
// tier sort, filters with counts, honest planning-estimate labels.
// Nothing here invents a company, a model, a rating, a price, or a
// pickup office: every car figure is the planner's own car leg, and
// a rental the planner cannot price never gets a row.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/carSection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../lib/planner.ts';
import { discoveryDestinations } from '../lib/discovery.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import {
  carDaysFor,
  carTierFromValue,
  carTierLabel,
  carTierOptions,
  carTierRows,
  emptySearchQuery,
  formValuesFromQuery,
  searchQueryFromParams,
  searchQueryToParams,
  sortTabRows,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('carTierFromValue: only the three real tiers win', () => {
  assert.equal(carTierFromValue('cheapest'), 'cheapest');
  assert.equal(carTierFromValue('best'), 'best');
  assert.equal(carTierFromValue('premium'), 'premium');
  assert.equal(carTierFromValue('Luxury'), 'best', 'junk falls back to Best value');
  assert.equal(carTierFromValue(undefined), 'best');
  assert.equal(carTierFromValue(null), 'best');
  assert.equal(carTierLabel('cheapest'), 'Cheapest');
  assert.equal(carTierLabel('best'), 'Best value');
  assert.equal(carTierLabel('premium'), 'Premium');
});

test('carTierOptions: the three planner car legs for the party, per traveler underneath', () => {
  const opts = carTierOptions('Central Europe', 2);
  assert.deepEqual(opts, [
    { tier: 'cheapest', label: 'Cheapest', car: 180, perTraveler: 90 },
    { tier: 'best', label: 'Best value', car: 288, perTraveler: 144 },
    { tier: 'premium', label: 'Premium', car: 504, perTraveler: 252 },
  ]);
  // The figures are the planner's own car legs, not a second table:
  // the Best value leg matches buildPlan directly, and the
  // per-traveler share never changes the party total.
  assert.equal(carTierOptions('Central Europe', 4)[1].car, 576, 'the party total scales with the party');
  assert.equal(carTierOptions('Central Europe', 4)[1].perTraveler, 144, 'per traveler is unchanged');
  // Clamped like every other party size in the app.
  assert.equal(carTierOptions('Central Europe', 0)[1].perTraveler, 144, '0 travelers clamps to the 2-traveler default');
  assert.equal(carTierOptions('Central Europe', 99)[1].car, 1800 * 0.08 * 9, '99 travelers clamps to 9');
});

test('carTierRows: one row per destination, in the chosen tier, consistent with the old Best value list', () => {
  const best = carTierRows('best', 2);
  const old = tabRowsFor('cars', 2);
  assert.equal(best.length, old.length, 'same destinations as the old list');
  assert.equal(best.length, 21, '21 discovery destinations');
  for (let i = 0; i < best.length; i++) {
    assert.equal(best[i].destination, old[i].destination, 'same order as the old list');
    assert.equal(best[i].pricePerTraveler, old[i].pricePerTraveler, 'Best value prices are unchanged');
    assert.equal(best[i].kind, 'leg');
    assert.equal(
      best[i].total,
      buildPlan(best[i].destination, 2, 3).options[1].car,
      'the total is the planner leg itself, not the rounded per-traveler figure times the party'
    );
  }
  const cheapest = carTierRows('cheapest', 2);
  const ce = cheapest.find((r) => r.destination === 'Central Europe');
  assert.equal(ce?.pricePerTraveler, 90, 'Central Europe Cheapest is $90 per traveler');
  assert.equal(ce?.total, 180, 'Central Europe Cheapest is $180 total');
  const premium = carTierRows('premium', 2);
  assert.equal(premium.find((r) => r.destination === 'Central Europe')?.pricePerTraveler, 252);
  // Every tier is cheaper than the one above it, on every row.
  for (let i = 0; i < best.length; i++) {
    assert.ok(cheapest[i].pricePerTraveler <= best[i].pricePerTraveler, 'Cheapest never beats Best value');
    assert.ok(best[i].pricePerTraveler <= premium[i].pricePerTraveler, 'Best value never beats Premium');
  }
  // The shared sort re-orders the car rows by the selected tier.
  const sorted = sortTabRows(carTierRows('premium', 2), 'cheapest');
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].pricePerTraveler >= sorted[i - 1].pricePerTraveler, 'cheapest sort is ascending');
  }
  assert.deepEqual(
    sortTabRows(carTierRows('best', 2), 'best').map((r) => r.destination),
    best.map((r) => r.destination),
    'best sort keeps the planner order'
  );
});

test('carDaysFor: searched dates first, the route days when there are none', () => {
  assert.equal(carDaysFor({ depart: '2027-01-04', ret: '2027-01-17', dest: 'Central Europe' }), 13);
  assert.equal(carDaysFor({ depart: '2027-01-04', ret: '2027-01-05', dest: 'Central Europe' }), 1, 'one day');
  assert.equal(
    carDaysFor({ depart: '2027-01-04', ret: '2027-01-04', dest: 'Central Europe' }),
    1,
    'same-day pick-up and drop-off is one rental day, not zero'
  );
  assert.equal(carDaysFor({ depart: '', ret: '', dest: 'Central Europe' }), 14, 'no dates → the route days');
  assert.equal(carDaysFor({ depart: '2027-01-04', ret: '', dest: 'Central Europe' }), 14, 'pick-up only → the route days');
  assert.equal(
    carDaysFor({ depart: '2027-01-04', ret: '2027-01-01', dest: 'Central Europe' }),
    14,
    'a drop-off before pick-up is not a rental — the route days stand in'
  );
  assert.equal(carDaysFor({ depart: '', ret: '', dest: 'Zanzibar' }), null, 'an unknown place has no days to fall back to');
  assert.equal(carDaysFor({ depart: '', ret: '', dest: '' }), null, 'no destination, no dates → no days');
  // A per-row fallback: the row's own route days, not the searched destination's.
  const japan = discoveryDestinations().find((e) => e.destination === 'Japan');
  assert.ok(japan, 'Japan is a discovery destination');
  assert.equal(carDaysFor({ depart: '', ret: '', dest: 'Central Europe' }, 'Japan'), japan.days);
});

test('searchQueryFromParams: a full car rental deep link parses, tier and all', () => {
  const q = searchQueryFromParams(
    {
      tab: 'cars',
      dest: 'Central Europe',
      depart: '2027-01-04',
      return: '2027-01-17',
      travelers: '2',
      time: '10:00',
      tier: 'cheapest',
    },
    TODAY
  );
  assert.ok(q, 'a car rental link parses');
  assert.equal(q?.tab, 'cars');
  assert.equal(q?.dest, 'Central Europe');
  assert.equal(q?.depart, '2027-01-04');
  assert.equal(q?.ret, '2027-01-17');
  assert.equal(q?.travelers, 2);
  assert.equal(q?.pickupTime, '10:00');
  assert.equal(q?.carTier, 'cheapest');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'car rental serialize then parse is the identity');
  // No tier in the link is Best value, and the tier never leaks into the URL then.
  const plain = searchQueryFromParams(
    { tab: 'cars', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-05' },
    TODAY
  );
  assert.equal(plain?.carTier, 'best');
  assert.ok(!searchQueryToParams(plain).includes('tier='), 'Best value is the default — no tier param');
  // Junk tier falls back, and a flights link ignores the tier entirely.
  assert.equal(searchQueryFromParams({ tab: 'cars', dest: 'Kyoto', tier: 'Luxury' }, TODAY)?.carTier, 'best');
  assert.equal(
    searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'London', tier: 'cheapest' }, TODAY)?.carTier,
    'best'
  );
  // A different drop-off location survives the round-trip.
  const oneway = searchQueryFromParams(
    { tab: 'cars', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-05', dropoff: 'Osaka', same: '0' },
    TODAY
  );
  assert.equal(oneway?.dropoff, 'Osaka');
  assert.equal(oneway?.sameLocation, false);
  const onewayBack = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(oneway))));
  assert.deepEqual(onewayBack, oneway, 'a different drop-off round-trips too');
});

test('searchQueryFromParams: stale car dates drop, a drop-off before pick-up drops, same-day stays', () => {
  const stale = searchQueryFromParams(
    { tab: 'cars', dest: 'Kyoto', depart: '2026-01-04', return: '2026-01-17' },
    TODAY
  );
  assert.equal(stale?.depart, '', 'a past pick-up drops');
  assert.equal(stale?.ret, '', 'a past drop-off drops');
  assert.ok(stale, 'the link still counts as a search from its destination');
  const backwards = searchQueryFromParams(
    { tab: 'cars', dest: 'Kyoto', depart: '2027-04-05', return: '2027-04-01' },
    TODAY
  );
  assert.equal(backwards?.depart, '2027-04-05');
  assert.equal(backwards?.ret, '', 'a drop-off before pick-up drops');
  const sameDay = searchQueryFromParams(
    { tab: 'cars', dest: 'Kyoto', depart: '2027-04-01', return: '2027-04-01' },
    TODAY
  );
  assert.equal(sameDay?.depart, '2027-04-01');
  assert.equal(sameDay?.ret, '2027-04-01', 'same-day pick-up and drop-off is a real rental — it stays');
});

test('formValuesFromQuery + emptySearchQuery: the car values round-trip through the widget', () => {
  const q = searchQueryFromParams(
    {
      tab: 'cars',
      dest: 'Kyoto',
      depart: '2027-04-01',
      return: '2027-04-05',
      travelers: '4',
      time: '09:30',
      tier: 'premium',
    },
    TODAY
  );
  assert.ok(q);
  const v = formValuesFromQuery(q);
  assert.equal(v.place, 'Kyoto', 'the destination is the shared place');
  assert.equal(v.depart, '2027-04-01');
  assert.equal(v.ret, '2027-04-05');
  assert.equal(v.travelers, 4);
  assert.equal(v.pickupTime, '09:30');
  assert.equal(v.carTier, 'premium', 'the tier survives the widget re-sync');
  const empty = emptySearchQuery('cars');
  assert.equal(empty.carTier, 'best');
  assert.equal(empty.travelers, 2);
  assert.equal(empty.sameLocation, true);
});
