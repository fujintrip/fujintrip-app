// App-shell round (Nov 12, 2026): the trip panel edits go through the
// same revision machinery as the chat — parseRevision / applyRevision
// in lib/planner.ts — so the panel, the trip card, the map and the chat
// can never disagree about the route or the nights. These tests pin
// that machinery: exact nights, less-time, reorder-after, remove, and
// the weights round-trip (weights equal to the final nights reproduce
// them exactly through distributeNightsForStops).
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/appshell.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRevision,
  buildPlan,
  distributeNightsForStops,
  parseRevision,
  routeKeyForDestination,
  ROUTE_STOPS,
  stopsForRoute,
} from '../lib/planner.ts';

const centralEurope = () => stopsForRoute('centraleurope');
// Central Europe, 14 days = 13 nights by weight: Prague 4, Vienna 3,
// Budapest 6 (weights 4/3/6, total 13).

test('panel nights: +1 night in Prague takes the night from the longest other stop, total stays 13', () => {
  const applied = applyRevision(centralEurope(), { type: 'nights', city: 'Prague', nights: 5 }, 14);
  assert.ok(applied, 'applies');
  assert.equal(applied.note, 'Prague is now 5 nights — Prague 5n · Vienna 3n · Budapest 5n.');
  const again = distributeNightsForStops(stopsForRoute('centraleurope', applied.override), 14);
  assert.deepEqual(
    again.map((s) => [s.city, s.nights]),
    [
      ['Prague', 5],
      ['Vienna', 3],
      ['Budapest', 5],
    ],
    'the override round-trips: weights equal to the nights reproduce them exactly'
  );
  assert.equal(
    again.reduce((s, x) => s + x.nights, 0),
    13,
    'nights still sum to days - 1'
  );
});

test('panel nights: -1 night (lessTime) gives the night to the longest other stop', () => {
  const applied = applyRevision(centralEurope(), { type: 'lessTime', city: 'Prague' }, 14);
  assert.ok(applied, 'applies');
  const again = distributeNightsForStops(stopsForRoute('centraleurope', applied.override), 14);
  assert.deepEqual(
    again.map((s) => [s.city, s.nights]),
    [
      ['Prague', 3],
      ['Vienna', 3],
      ['Budapest', 7],
    ]
  );
});

test('panel nights: clamps to the most a stop can take (every other stop keeps 1 night)', () => {
  const applied = applyRevision(centralEurope(), { type: 'nights', city: 'Prague', nights: 12 }, 14);
  assert.ok(applied, 'applies, clamped');
  const again = distributeNightsForStops(stopsForRoute('centraleurope', applied.override), 14);
  assert.deepEqual(
    again.map((s) => [s.city, s.nights]),
    [
      ['Prague', 11],
      ['Vienna', 1],
      ['Budapest', 1],
    ],
    '11 is the max: 13 nights total, 1 each for the other two stops'
  );
});

test('panel nights: no change returns null, and lessTime at 1 night returns null', () => {
  assert.equal(applyRevision(centralEurope(), { type: 'nights', city: 'Prague', nights: 4 }, 14), null, 'already 4 nights');
  const oneNight = applyRevision(centralEurope(), { type: 'nights', city: 'Prague', nights: 1 }, 14);
  assert.ok(oneNight, 'can go to 1 night');
  const stops = stopsForRoute('centraleurope', oneNight.override);
  assert.equal(applyRevision(stops, { type: 'lessTime', city: 'Prague' }, 14), null, 'cannot go below 1 night');
  assert.equal(applyRevision(centralEurope(), { type: 'nights', city: 'Zanzibar', nights: 3 }, 14), null, 'unknown city');
});

test('panel remove: drops the stop; removing the last stop returns null', () => {
  const applied = applyRevision(centralEurope(), { type: 'remove', city: 'Vienna' }, 14);
  assert.ok(applied, 'applies');
  assert.deepEqual(applied.override.cities, ['Prague', 'Budapest']);
  const nights = distributeNightsForStops(stopsForRoute('centraleurope', applied.override), 14);
  assert.equal(nights.reduce((s, x) => s + x.nights, 0), 13, 'nights still sum to 13 after a removal');
  const last = applyRevision(stopsForRoute('centraleurope', applied.override), { type: 'remove', city: 'Budapest' }, 14);
  assert.ok(last, 'two stops can drop to one');
  assert.deepEqual(last.override.cities, ['Prague']);
  assert.equal(applyRevision(stopsForRoute('centraleurope', last.override), { type: 'remove', city: 'Prague' }, 14), null, 'the last stop cannot be removed');
});

test('panel reorder: move down (after) and move up (before) both work through applyRevision', () => {
  const down = applyRevision(centralEurope(), { type: 'reorder', city: 'Vienna', after: 'Budapest' }, 14);
  assert.ok(down, 'applies');
  assert.deepEqual(down.override.cities, ['Prague', 'Budapest', 'Vienna']);
  const up = applyRevision(centralEurope(), { type: 'reorder', city: 'Budapest', before: 'Vienna' }, 14);
  assert.ok(up, 'applies');
  assert.deepEqual(up.override.cities, ['Prague', 'Budapest', 'Vienna']);
  assert.equal(
    applyRevision(centralEurope(), { type: 'reorder', city: 'Budapest', before: 'Prague' }, 14)?.override.cities.join(),
    'Budapest,Prague,Vienna',
    'before moves the city ahead of the named stop'
  );
  assert.equal(applyRevision(centralEurope(), { type: 'reorder', city: 'Prague', after: 'Prague' }, 14), null, 'a no-op reorder is refused');
});

test('chat parity: the same edits parse from typed sentences', () => {
  assert.deepEqual(parseRevision('3 nights in Prague'), { type: 'nights', city: 'Prague', nights: 3 });
  assert.deepEqual(parseRevision('set Prague to 5 nights'), { type: 'nights', city: 'Prague', nights: 5 });
  assert.deepEqual(parseRevision('Prague for 5 nights'), { type: 'nights', city: 'Prague', nights: 5 });
  assert.deepEqual(parseRevision('one less night in Prague'), { type: 'lessTime', city: 'Prague' });
  assert.deepEqual(parseRevision('less time in Prague'), { type: 'lessTime', city: 'Prague' });
  assert.deepEqual(parseRevision('move Vienna after Budapest'), { type: 'reorder', city: 'Vienna', after: 'Budapest' });
  // The old forms still parse — the panel did not change chat behavior.
  assert.deepEqual(parseRevision('more time in Prague'), { type: 'moreTime', city: 'Prague' });
  assert.deepEqual(parseRevision('drop Vienna'), { type: 'remove', city: 'Vienna' });
  assert.deepEqual(parseRevision('Budapest before Vienna'), { type: 'reorder', city: 'Budapest', before: 'Vienna' });
});

test('trip switcher: a saved trip seeds from its destination — route cities for routes, the city itself for a single stop', () => {
  const seedCities = (destination) => {
    const rk = routeKeyForDestination(destination);
    return rk ? ROUTE_STOPS[rk].map((s) => s.city) : [destination];
  };
  assert.deepEqual(seedCities('Central Europe'), ['Prague', 'Vienna', 'Budapest']);
  assert.equal(routeKeyForDestination('Central Europe'), 'centraleurope');
  assert.deepEqual(seedCities('Kyoto'), ['Kyoto'], 'a single city seeds as its own one-stop route');
  assert.equal(routeKeyForDestination('Kyoto'), '');
});

test('panel travelers: changing travelers re-prices the whole plan from the same base', () => {
  // Central Europe base is $1,800 per traveler (approved Nov 12).
  assert.equal(buildPlan('Central Europe', 2, 14).options[1].total, 3600);
  assert.equal(buildPlan('Central Europe', 3, 14).options[1].total, 5400);
  assert.equal(buildPlan('Central Europe', 1, 14).options[1].total, 1800);
  assert.equal(buildPlan('Central Europe', 3, 14).options[0].total, 3456, 'Cheapest is the same 0.64 factor at any party size');
});
