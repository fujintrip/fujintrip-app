// Flights filter system (Nov 15–16, 2026): selecting a filter —
// airline, stops, price, times — must narrow the visible live
// offers, and every facet count must be what the filter actually
// shows. The Nov 15 defect: the counts came from every leg of every
// Ignav itinerary the API returned (Nonstop (277), 1 stop (49),
// ~326 airline counts) while only 9 options were on screen. The
// Nov 15 fix (counts from the offers on screen only) was wrong the
// other way: the Ignav list is sliced to the 3 cheapest for display
// and filtering re-slices over the whole response, so British
// Airways read (1) before filtering and the filter then revealed 4
// BA fares. The Nov 16 rule: facet counts come from the FULL
// unfiltered live inventory — all Duffel offers plus all Ignav
// itineraries, each itinerary counted once as a trip — while only
// the "Showing X of Y" line counts what is on screen. The price
// bands count flight fares only, per traveler, never the estimate
// rows below the results.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/flightFilters.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIME_BUCKETS, timeBucketFor } from '../lib/duffel.ts';
import { flightFiltersActive, liveFilterOptions } from '../lib/searchPlaces.ts';

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

test('counts: the full unfiltered inventory, one count per trip', () => {
  const opts = liveFilterOptions({
    shownOffers,
    shownItineraries,
    allOffers: shownOffers,
    allItineraries,
    totalVisible: 9,
    travelers: 1,
  });
  assert.ok(opts, 'options exist when offers are shown');
  assert.equal(opts.shownCount, 9, '6 Duffel legs + 3 Ignav trips on screen');
  assert.equal(opts.totalCount, 9);
  // Stops: 3 Duffel nonstops + the BA trip (nonstop out) + the Aer
  // Lingus trip (nonstop out, 1-stop back — a trip counts by its
  // outbound) + the 160 unshown BA nonstops behind the slice.
  assert.equal(opts.counts.stops[0], 165, 'Nonstop counts the whole inventory, not the slice');
  // 1 stop: 3 Duffel 1-stop legs + the ITA trip (1-stop out).
  assert.equal(opts.counts.stops[1], 4, '1 stop counts the whole inventory');
  // Airlines: BA is 2 Duffel legs + 1 shown trip + 160 unshown
  // itineraries — the count promises what the BA filter reveals.
  assert.equal(opts.counts.airlines['British Airways'], 163, 'BA counts every itinerary, shown or not');
  assert.equal(opts.counts.airlines['American Airlines'], 2);
  // The Aer Lingus itinerary has a nonstop out and a 1-stop return,
  // but both legs are Aer Lingus, so it counts as one Aer Lingus
  // option — and as a nonstop trip, by its outbound.
  assert.equal(opts.counts.airlines['Aer Lingus'], 1, 'both legs Aer Lingus, so the trip counts');
  assert.equal(opts.counts.airlines['ITA Airways'], 1);
  // Times: the outbound departure buckets the whole inventory.
  assert.equal(opts.counts.times.morning, 167, 'morning: 4 Duffel + 3 shown trips + 160 unshown');
  assert.equal(opts.counts.times.afternoon, 1);
  assert.equal(opts.counts.times.evening, 1);
  // Prices: per traveler, flight fares only — the 6 Duffel legs are
  // under $1,000; the 3 shown Ignav trips and 160 unshown are not
  // (cheapest is $1,631); only the $2,000 itinerary joins under
  // $2,000. Never the 21 estimate rows.
  assert.equal(opts.counts.prices[1000], 6, 'Under $1,000 counts fares, not estimate rows');
  assert.equal(opts.counts.prices[1500], 6);
  assert.equal(opts.counts.prices[2000], 10, '6 Duffel + 3 shown Ignav + the $2,000 itinerary');
  // The option lists still cover the full result.
  assert.ok(opts.airlines.includes('British Airways'), 'BA stays an option');
  assert.ok(opts.airlines.includes('ITA Airways'), 'ITA stays an option');
  assert.deepEqual(opts.stops, [0, 1]);
  assert.ok(opts.times.includes('morning'), 'morning departures are an option');
});

test('counts: the live BA repro — a facet count promises what its filter reveals', () => {
  // JFK → LHR, Nov 16, 2026: before filtering BA read (1), yet the
  // BA filter revealed 4 BA fares — 1 Duffel leg plus 3 Ignav trips
  // hiding behind the 3-cheapest slice. The count must read 4.
  const baTrip = (price, stops) =>
    itinerary(price, [offer('British Airways', stops, 650, price), offer('British Airways', stops, 1100, price)]);
  const opts = liveFilterOptions({
    shownOffers: [offer('British Airways', 0, 650, 440), offer('American Airlines', 0, 1100, 445)],
    shownItineraries: [
      itinerary(1644, [offer('Aer Lingus', 0, 540, 1644), offer('Aer Lingus', 1, 1200, 1644)]),
      itinerary(1700, [offer('ITA Airways', 1, 700, 1700), offer('ITA Airways', 1, 1300, 1700)]),
      itinerary(1800, [offer('TAP Air Portugal', 1, 700, 1800), offer('TAP Air Portugal', 1, 1300, 1800)]),
    ],
    allOffers: [offer('British Airways', 0, 650, 440), offer('American Airlines', 0, 1100, 445)],
    allItineraries: [
      itinerary(1644, [offer('Aer Lingus', 0, 540, 1644), offer('Aer Lingus', 1, 1200, 1644)]),
      itinerary(1700, [offer('ITA Airways', 1, 700, 1700), offer('ITA Airways', 1, 1300, 1700)]),
      itinerary(1800, [offer('TAP Air Portugal', 1, 700, 1800), offer('TAP Air Portugal', 1, 1300, 1800)]),
      baTrip(1900, 0),
      baTrip(1950, 0),
      baTrip(2000, 1),
    ],
    totalVisible: 5,
    travelers: 1,
  });
  assert.equal(opts.counts.airlines['British Airways'], 4, '1 Duffel leg + 3 Ignav trips behind the slice');
  assert.equal(opts.shownCount, 5, '2 Duffel legs + 3 sliced Ignav trips on screen');
  assert.equal(opts.totalCount, 5);
  // The hidden BA trips are 1-stop via Madrid on one of them — the
  // stops facet counts trips, not legs.
  assert.equal(opts.counts.stops[1], 3, '1 stop: the ITA + TAP trips + the 1-stop BA trip');
});

test('counts: a 1-stop-out / nonstop-back trip counts once, as 1-stop', () => {
  const madridTrip = itinerary(1631, [
    offer('British Airways', 1, 500, 1631),
    offer('British Airways', 0, 660, 1631),
  ]);
  const opts = liveFilterOptions({
    shownOffers: [offer('British Airways', 0, 650, 440)],
    shownItineraries: [madridTrip],
    allOffers: [offer('British Airways', 0, 650, 440)],
    allItineraries: [madridTrip],
    totalVisible: 2,
    travelers: 1,
  });
  assert.equal(opts.counts.stops[1], 1, 'the Madrid trip is a 1-stop trip');
  assert.equal(opts.counts.stops[0], 1, 'the Duffel leg is the only nonstop');
  assert.equal(opts.counts.airlines['British Airways'], 2, 'one Duffel leg + one trip');
  assert.deepEqual(opts.stops, [0, 1], 'both stop values stay filterable');
});

test('counts: applying a filter does not change the facet counts', () => {
  // The traveler checked Nonstop: 3 Duffel nonstops + the all-nonstop
  // BA itinerary are on screen — but the facets still describe the
  // full inventory, so picking another value stays predictable.
  const opts = liveFilterOptions({
    shownOffers: shownOffers.filter((o) => o.stops === 0),
    shownItineraries: [shownItineraries[0]],
    allOffers: shownOffers,
    allItineraries,
    totalVisible: 9,
    travelers: 1,
  });
  assert.equal(opts.shownCount, 4, 'the summary line follows the screen');
  assert.equal(opts.totalCount, 9, 'the total still names the unfiltered list');
  assert.equal(opts.counts.stops[0], 165, 'the Nonstop count does not shrink with the filter');
  assert.equal(opts.counts.stops[1], 4, '1-stop options are still counted');
  assert.equal(opts.counts.airlines['TAP Air Portugal'], 1, 'TAP is still counted, not zeroed');
  assert.equal(opts.counts.airlines['British Airways'], 163);
  assert.ok(opts.airlines.includes('TAP Air Portugal'), 'TAP stays an option to pick');
  assert.equal(opts.counts.prices[1000], 6, 'the price bands do not shrink with the filter either');
});

test('counts: price bands divide by travelers', () => {
  const opts = liveFilterOptions({
    shownOffers,
    shownItineraries,
    allOffers: shownOffers,
    allItineraries,
    totalVisible: 9,
    travelers: 2,
  });
  // Two travelers: a $1,631 trip is $816 per traveler, so the shown
  // Ignav trips join Under $1,000; the $2,000 itinerary is exactly
  // $1,000 per traveler and joins too.
  assert.equal(opts.counts.prices[1000], 10, '6 Duffel + 3 shown trips + the $2,000 itinerary');
  assert.equal(opts.counts.prices[1500], 169, 'every itinerary is under $1,500 per traveler');
  assert.equal(opts.counts.prices[2000], 169, 'the whole inventory');
});

test('counts: null when nothing is visible to filter', () => {
  assert.equal(
    liveFilterOptions({
      shownOffers: [],
      shownItineraries: [],
      allOffers: [],
      allItineraries: [],
      totalVisible: 0,
      travelers: 1,
    }),
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
  // Every fare carries its own small source tag — while no filter
  // is active. Nov 16, 2026 (user decision): as soon as any filter
  // is on, every card hides its tag; clearing every filter brings
  // the tags back. The tag is passed as undefined when hidden, and
  // the card renders the tag only when sourceLabel is set.
  assert.ok(src.includes('fare-card-source'), 'the per-fare source tag is styled');
  assert.ok(src.includes('sourceLabel={duffelTagShown}'), 'Duffel fares carry their tag when unfiltered');
  assert.ok(src.includes('sourceLabel={ignavTagShown}'), 'Ignav fares carry their tag when unfiltered');
  assert.ok(src.includes('hideSourceTags ? undefined : duffelTag'), 'a filtered view hides the Duffel tag');
  assert.ok(src.includes('hideSourceTags ? undefined : ignavTag'), 'a filtered view hides the Ignav tag');
  assert.ok(!src.includes('sourceLabel={duffelTag}'), 'no card passes the tag unconditionally');
  assert.ok(!src.includes('sourceLabel={ignavTag}'), 'no card passes the tag unconditionally');
  assert.ok(src.includes('hideSourceTags={liveFiltersActive}'), 'the results hide their tags from the bar state');
  assert.ok(src.includes('flightFiltersActive({'), 'one shared predicate decides "any filter active"');
  assert.ok(src.includes("onClearSort={() => setSort('best')}"), 'clearing from the results restores Best value');
  assert.ok(src.includes("'Duffel · test fare'"), 'test fares are named as test fares on the card');
  assert.ok(src.includes('ignavSourceTag('), 'Ignav fares carry the checked time');
  // The filter system (Nov 16, 2026): the filters sit in a top bar
  // above the merged card grid, not a left sidebar. Times state,
  // max price on live offers, counts from the full live inventory,
  // one summary line — and the line now counts cards: the merged
  // options for round-trip/one-way, live fares for multi-city, which
  // has no merged grid.
  assert.ok(src.includes('timesFilter'), 'a departure-time filter exists');
  assert.ok(src.includes('Departure time'), 'the bar offers departure times');
  assert.ok(src.includes('liveFilterOptions({'), 'counts come from the live inventory');
  assert.ok(src.includes('travelers: query.travelers'), 'the price bands divide by travelers');
  assert.ok(src.includes('liveOptions.counts.prices[max]'), 'the price bands count live fares, not estimate rows');
  assert.ok(src.includes('LIVE_PRICE_BANDS.map'), 'the price bands are one shared list');
  assert.ok(src.includes('flight-filter-bar'), 'the filters sit in a top bar, not a sidebar');
  assert.ok(src.includes('Showing ${liveOptions.shownOptions} of ${liveOptions.totalOptions} options'), 'the bar counts the merged cards');
  assert.ok(src.includes('Showing ${liveOptions.shownCount} of ${liveOptions.totalCount} live fares'), 'multi-city falls back to fare counts');
  assert.ok(!src.includes('Showing {liveOptionsValue.shownCount} of {liveOptionsValue.totalCount} live fares'), 'the old sidebar summary line is gone');
  assert.ok(src.includes('clearAllLiveFilters'), 'clearing restores the full list');
  assert.ok(src.includes('clearAllFlightFilters'), 'the top bar clears every flight filter');
  assert.ok(src.includes("setSort('best')"), 'the top bar clear restores Best value, so the tags come back');
});

test('flightFiltersActive: any filter on hides the source tags, all clear brings them back', () => {
  // Nov 16, 2026 (user decision): the small per-fare source +
  // freshness tag shows only while NO filter is active. Any one of
  // airline, stops, time, max price, or a sort change counts as
  // filtered — the tag hides on every card until all of them clear.
  const unfiltered = { sort: 'best', maxPrice: null, stopsFilter: [], airlinesFilter: [], timesFilter: [] };
  assert.equal(flightFiltersActive(unfiltered), false, 'best sort, no filters: tags show');
  assert.equal(flightFiltersActive({ ...unfiltered, airlinesFilter: ['British Airways'] }), true, 'an airline hides the tags');
  assert.equal(flightFiltersActive({ ...unfiltered, stopsFilter: [0] }), true, 'a stops filter hides the tags');
  assert.equal(flightFiltersActive({ ...unfiltered, timesFilter: ['morning'] }), true, 'a departure-time filter hides the tags');
  assert.equal(flightFiltersActive({ ...unfiltered, maxPrice: 800 }), true, 'a max price hides the tags');
  assert.equal(flightFiltersActive({ ...unfiltered, sort: 'cheapest' }), true, 'a sort change hides the tags');
  assert.equal(flightFiltersActive({ ...unfiltered, sort: 'duration' }), true, 'shortest-first hides the tags');
  assert.equal(flightFiltersActive({ ...unfiltered, sort: 'departure' }), true, 'earliest-departure hides the tags');
  assert.equal(
    flightFiltersActive({ sort: 'best', maxPrice: null, stopsFilter: [], airlinesFilter: [], timesFilter: [] }),
    false,
    'clearing every filter brings the tags back'
  );
});
