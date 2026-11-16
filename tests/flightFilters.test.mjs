// Flights filter system (Nov 15, 2026): selecting a filter — airline,
// stops, price, times — must narrow the visible live offers, and every
// count must match the offers actually shown. The Nov 15 defect: the
// counts came from every leg of every Ignav itinerary the API returned
// (Nonstop (277), 1 stop (49), ~326 airline counts) while only 9
// options were on screen. Counts now come only from the shown offers;
// the option lists still come from the full live result, because
// filtering re-slices Ignav and a value in a later itinerary is still
// filterable.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/flightFilters.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIME_BUCKETS, timeBucketFor } from '../lib/duffel.ts';
import { liveFilterOptions } from '../lib/searchPlaces.ts';

const offer = (airline, stops, departMinutes, price) => ({
  airline,
  stops,
  departMinutes,
  price,
  carrierCode: airline.slice(0, 2).toUpperCase(),
  departTime: '10:50 AM',
  arriveTime: '11:48 PM',
  duration: '7h 58m',
  segments: [],
});

const itinerary = (price, legs) => ({ price, legs, ignavId: `it-${price}` });

// The live JFK–LHR check: 3 Duffel outbound + 3 Duffel return legs and
// 3 Ignav trips on screen — but Ignav's API returned many more
// itineraries behind the 3 shown.
const shownOffers = [
  offer('British Airways', 0, 650, 440),
  offer('American Airlines', 0, 1100, 445),
  offer('Virgin Atlantic', 1, 400, 460),
  offer('British Airways', 0, 660, 450),
  offer('American Airlines', 1, 1020, 470),
  offer('TAP Air Portugal', 1, 500, 480),
];
const shownItineraries = [
  itinerary(1631, [offer('British Airways', 0, 650, 1631), offer('British Airways', 0, 1100, 1631)]),
  itinerary(1644, [offer('Aer Lingus', 0, 540, 1644), offer('Aer Lingus', 1, 1200, 1644)]),
  itinerary(1700, [offer('ITA Airways', 1, 700, 1700), offer('ITA Airways', 1, 1300, 1700)]),
];
// Behind the shown 3, Ignav returned ~163 itineraries — the old code
// counted every leg of every one of them.
const allItineraries = [
  ...shownItineraries,
  ...Array.from({ length: 160 }, (_, i) =>
    itinerary(2000 + i, [offer('British Airways', 0, 600, 2000 + i), offer('British Airways', 0, 1000, 2000 + i)])
  ),
];

test('time buckets: fixed clock ranges, no time means no bucket', () => {
  assert.equal(timeBucketFor(0), 'night');
  assert.equal(timeBucketFor(359), 'night');
  assert.equal(timeBucketFor(360), 'morning');
  assert.equal(timeBucketFor(650), 'morning');
  assert.equal(timeBucketFor(719), 'morning');
  assert.equal(timeBucketFor(720), 'afternoon');
  assert.equal(timeBucketFor(1079), 'afternoon');
  assert.equal(timeBucketFor(1080), 'evening');
  assert.equal(timeBucketFor(1439), 'evening');
  assert.equal(timeBucketFor(undefined), null, 'no departure time is no bucket, never guessed');
  assert.equal(TIME_BUCKETS.length, 4, 'four buckets cover the whole day');
});

test('counts: only the offers on screen, never the full Ignav response', () => {
  const opts = liveFilterOptions({
    shownOffers,
    shownItineraries,
    allOffers: shownOffers,
    allItineraries,
    totalVisible: 9,
  });
  assert.ok(opts, 'options exist when offers are shown');
  assert.equal(opts.shownCount, 9, '6 Duffel legs + 3 Ignav trips');
  assert.equal(opts.totalCount, 9);
  // Stops: the 3 Duffel nonstops + the all-nonstop BA itinerary.
  assert.equal(opts.counts.stops[0], 4, 'Nonstop counts the shown nonstop options only');
  // The mixed Aer Lingus itinerary (nonstop out, 1-stop back) counts
  // in NEITHER stops bucket — the Nonstop filter needs every leg.
  assert.equal(opts.counts.stops[1], 4, '1 stop counts the shown 1-stop options only');
  assert.equal(opts.counts.airlines['British Airways'], 3, 'BA: 2 Duffel legs + 1 itinerary');
  assert.equal(opts.counts.airlines['American Airlines'], 2);
  // The Aer Lingus itinerary has a nonstop out and a 1-stop return,
  // so it counts in NO stops bucket — but both legs are Aer Lingus,
  // so it counts as one Aer Lingus option.
  assert.equal(opts.counts.airlines['Aer Lingus'], 1, 'both legs Aer Lingus, so the trip counts');
  // The option lists still cover the full result — BA appears in the
  // 160 unshown itineraries too, so it stays filterable.
  assert.ok(opts.airlines.includes('British Airways'), 'BA stays an option');
  assert.ok(opts.airlines.includes('ITA Airways'), 'ITA stays an option');
  assert.deepEqual(opts.stops, [0, 1]);
  assert.ok(opts.times.includes('morning'), 'morning departures are an option');
});

test('counts: a filtered view counts only what the filter leaves', () => {
  // The traveler checked Nonstop: 3 Duffel nonstops + the all-nonstop
  // BA itinerary are on screen.
  const opts = liveFilterOptions({
    shownOffers: shownOffers.filter((o) => o.stops === 0),
    shownItineraries: [shownItineraries[0]],
    allOffers: shownOffers,
    allItineraries,
    totalVisible: 9,
  });
  assert.equal(opts.shownCount, 4);
  assert.equal(opts.totalCount, 9, 'the total still names the unfiltered list');
  assert.equal(opts.counts.stops[0], 4);
  assert.equal(opts.counts.stops[1] ?? 0, 0, 'no 1-stop option is shown');
  assert.equal(opts.counts.airlines['TAP Air Portugal'] ?? 0, 0, 'no TAP option is shown');
  assert.equal(opts.counts.airlines['British Airways'], 3);
  assert.ok(opts.airlines.includes('TAP Air Portugal'), 'TAP stays an option to pick');
});

test('counts: null when nothing is visible to filter', () => {
  assert.equal(
    liveFilterOptions({ shownOffers: [], shownItineraries: [], allOffers: [], allItineraries: [], totalVisible: 0 }),
    null,
    'no offers, no filter panel'
  );
});

test('filter system: the results wire every filter to the live offers', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  // The merged list: one live list, no supplier-branded sections.
  assert.ok(src.includes('fare-live-list'), 'one clean live-fares list');
  assert.ok(!src.includes('FareSourceColumn'), 'no per-source column component remains');
  assert.ok(!src.includes('title="Duffel"'), 'no big Duffel header');
  assert.ok(!src.includes('title="Ignav — live"'), 'no big Ignav header');
  assert.ok(src.includes('Other sites (cached)'), 'the cached comparison block stays');
  // Every fare carries its own small source tag.
  assert.ok(src.includes('fare-card-source'), 'the per-fare source tag is styled');
  assert.ok(src.includes("sourceLabel={duffelTag}"), 'Duffel fares carry their tag');
  assert.ok(src.includes("sourceLabel={ignavTag}"), 'Ignav fares carry their tag');
  assert.ok(src.includes("'Duffel · test fare'"), 'test fares are named as test fares on the card');
  assert.ok(src.includes('ignavSourceTag('), 'Ignav fares carry the checked time');
  // The filter system: times state, max price on live offers, counts
  // from the visible lists, one summary line.
  assert.ok(src.includes('timesFilter'), 'a departure-time filter exists');
  assert.ok(src.includes('Departure time'), 'the panel offers departure times');
  assert.ok(src.includes('liveFilterOptions({'), 'counts come from the visible offers');
  assert.ok(src.includes('Showing {liveOptionsValue.shownCount} of {liveOptionsValue.totalCount} live fares'), 'one summary line counts what is shown');
  assert.ok(src.includes('clearAllLiveFilters'), 'clearing restores the full list');
});
