// Floating itinerary rail over the map (modern-map build, Nov 13 2026):
// the rail lists each stop with its nights and date range, built from
// the trip card's own stops — no new data, no new prices.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/mapRail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapRail, formatRailRange } from '../lib/mapRail.ts';

function stop(city, nights, startDay, endDay) {
  return {
    city,
    country: 'Czechia',
    nights,
    startDate: new Date(2027, 0, startDay),
    endDate: new Date(2027, 0, endDay),
    intro: '',
    stayEstimate: 0,
    days: [],
    transportIn: { mode: '', from: '', price: 0 },
  };
}

test('formatRailRange formats a short range without a year', () => {
  assert.equal(formatRailRange(new Date(2027, 0, 4), new Date(2027, 0, 8)), 'Jan 4 – Jan 8');
  assert.equal(formatRailRange(new Date(2027, 1, 27), new Date(2027, 2, 2)), 'Feb 27 – Mar 2');
});

test('buildMapRail summarizes the Central Europe route', () => {
  const rail = buildMapRail([
    stop('Prague', 4, 4, 8),
    stop('Vienna', 3, 8, 11),
    stop('Budapest', 6, 11, 17),
  ]);
  assert.equal(rail.summary, '3 stops · 13 nights');
  assert.deepEqual(rail.stops, [
    { city: 'Prague', nights: 4, range: 'Jan 4 – Jan 8' },
    { city: 'Vienna', nights: 3, range: 'Jan 8 – Jan 11' },
    { city: 'Budapest', nights: 6, range: 'Jan 11 – Jan 17' },
  ]);
});

test('buildMapRail uses singulars for one stop and one night', () => {
  const rail = buildMapRail([stop('Kyoto', 1, 4, 5)]);
  assert.equal(rail.summary, '1 stop · 1 night');
  assert.deepEqual(rail.stops, [{ city: 'Kyoto', nights: 1, range: 'Jan 4 – Jan 5' }]);
});
