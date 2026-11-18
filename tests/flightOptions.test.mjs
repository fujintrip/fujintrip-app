// The merged flight-option list (Nov 16, 2026): one card grid, one
// sort, sources interleaved — Duffel pairs + Ignav trips, each card a
// complete trip option so prices are comparable. A Duffel round-trip
// option is an out + back pair (cheapest out + back total, the
// service fee shown separately on the card, never folded into the
// total); an Ignav option is a whole-trip itinerary as priced. A
// one-way leg price is never placed next to a round-trip total —
// one-way merges one-way legs with one-way itineraries only.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/flightOptions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countFlightCards, mergeFlightOptions, ignavItineraryDuration } from '../lib/flightOptions.ts';

const offer = (airline, stops, departMinutes, durationMinutes, price) => ({
  airline,
  stops,
  departMinutes,
  durationMinutes,
  price,
  carrierCode: airline.slice(0, 2).toUpperCase(),
  departTime: '10:50 AM',
  arriveTime: '11:48 PM',
  duration: '7h 58m',
  segments: [],
});

const itinerary = (price, legs) => ({ price, legs, ignavId: `it-${price}` });

// The live JFK–LHR shape: 3 Duffel out + 3 Duffel back legs, 3
// Ignav trips — the grid the Nov 16 live check verified.
const out = [
  offer('British Airways', 0, 480, 360, 216),
  offer('American Airlines', 0, 500, 370, 220),
  offer('Virgin Atlantic', 1, 600, 500, 230),
];
const back = [
  offer('British Airways', 0, 700, 360, 216),
  offer('American Airlines', 0, 720, 380, 225),
  offer('Virgin Atlantic', 1, 800, 510, 240),
];
const ignavTrips = [
  itinerary(788, [offer('JetBlue', 0, 480, 400, 788), offer('JetBlue', 0, 700, 400, 788)]),
  itinerary(796, [offer('Virgin Atlantic', 1, 540, 480, 796), offer('Virgin Atlantic', 0, 720, 420, 796)]),
  itinerary(1028, [offer('British Airways', 0, 480, 360, 1028), offer('British Airways', 0, 700, 360, 1028)]),
];

test('merge round-trip: Duffel pairs + Ignav trips interleaved cheapest-first', () => {
  const merged = mergeFlightOptions({ tripType: 'roundtrip', out, back, ignavItineraries: ignavTrips, sort: 'cheapest' });
  assert.deepEqual(
    merged.map((o) => o.total),
    [432, 445, 470, 788, 796, 1028],
    'cheapest out + back pairs first, then the Ignav trips, by trip total'
  );
  assert.deepEqual(
    merged.map((o) => o.kind),
    ['duffel-pair', 'duffel-pair', 'duffel-pair', 'ignav', 'ignav', 'ignav'],
    'no source grouping — the list is one sort, not two sections'
  );
  // Every Duffel card is a complete round-trip: out + back, never a
  // one-way leg price next to a round-trip total.
  for (const opt of merged.filter((o) => o.kind === 'duffel-pair')) {
    assert.equal(opt.total, opt.out.price + opt.back.price, 'a pair total is out + back');
    assert.ok(opt.out.price > 0 && opt.back.price > 0, 'both directions are priced');
  }
  assert.ok(!merged.some((o) => o.kind === 'duffel-oneway'), 'no one-way card in a round-trip search');
  for (const opt of merged.filter((o) => o.kind === 'ignav')) {
    assert.equal(opt.total, opt.itinerary.price, 'an Ignav card totals the itinerary price');
  }
  assert.equal(new Set(merged.map((o) => o.key)).size, merged.length, 'every card has a unique key');
});

test('merge round-trip: pairs stop at the shorter direction', () => {
  const merged = mergeFlightOptions({
    tripType: 'roundtrip',
    out,
    back: back.slice(0, 1),
    ignavItineraries: [],
    sort: 'cheapest',
  });
  assert.equal(merged.length, 1, 'one back leg makes one complete option');
  assert.equal(merged[0].total, 216 + 216, 'the pair is the cheapest out + the only back');
  assert.deepEqual(
    mergeFlightOptions({ tripType: 'roundtrip', out, back: [], ignavItineraries: [], sort: 'cheapest' }),
    [],
    'no return leg, no round-trip card — an unmatched outbound is not shown as a one-way price'
  );
});

test('merge: duration sort orders by total trip time across sources', () => {
  const merged = mergeFlightOptions({ tripType: 'roundtrip', out, back, ignavItineraries: ignavTrips, sort: 'duration' });
  assert.deepEqual(
    merged.map((o) => o.total),
    [432, 1028, 445, 788, 796, 470],
    'shortest total duration first — a 720-minute Duffel pair and a 720-minute Ignav trip order by price'
  );
  assert.deepEqual(
    merged.map((o) => o.durationMinutes),
    [720, 720, 750, 800, 900, 1010],
    'a pair duration is out + back; an Ignav duration is the sum of its legs'
  );
});

test('merge: departure sort orders by outbound departure across sources', () => {
  const merged = mergeFlightOptions({ tripType: 'roundtrip', out, back, ignavItineraries: ignavTrips, sort: 'departure' });
  assert.deepEqual(
    merged.map((o) => o.total),
    [432, 788, 1028, 445, 796, 470],
    'earliest outbound first; the two 8:00 AM departures order by price'
  );
});

test('merge: an option with no time sorts last on duration and departure', () => {
  const noTime = offer('NoTimes', 0, undefined, undefined, 100);
  const merged = mergeFlightOptions({
    tripType: 'oneway',
    out: [offer('Early', 0, 400, 300, 200), noTime],
    back: [],
    ignavItineraries: [],
    sort: 'departure',
  });
  assert.equal(merged[merged.length - 1].offer.airline, 'NoTimes', 'no departure time sorts last');
  const byDuration = mergeFlightOptions({
    tripType: 'oneway',
    out: [offer('Early', 0, 400, 300, 200), noTime],
    back: [],
    ignavItineraries: [],
    sort: 'duration',
  });
  assert.equal(byDuration[byDuration.length - 1].offer.airline, 'NoTimes', 'no duration sorts last');
});

test('merge one-way: Duffel legs + Ignav one-way trips by trip price', () => {
  const oneWayTrips = [itinerary(500, [offer('JetBlue', 0, 480, 400, 500)])];
  const merged = mergeFlightOptions({
    tripType: 'oneway',
    out,
    back: [],
    ignavItineraries: oneWayTrips,
    sort: 'cheapest',
  });
  assert.deepEqual(
    merged.map((o) => o.total),
    [216, 220, 230, 500],
    'one-way legs and one-way trips share one price order'
  );
  assert.ok(!merged.some((o) => o.kind === 'duffel-pair'), 'no pair card in a one-way search');
  assert.equal(merged[0].kind, 'duffel-oneway', 'a Duffel one-way card is one leg');
});

test('merge: empty inputs merge to nothing', () => {
  assert.deepEqual(
    mergeFlightOptions({ tripType: 'roundtrip', out: [], back: [], ignavItineraries: [], sort: 'cheapest' }),
    [],
    'no fares, no cards'
  );
  assert.deepEqual(
    mergeFlightOptions({ tripType: 'oneway', out: [], back: [], ignavItineraries: [], sort: 'cheapest' }),
    [],
    'no one-way fares, no cards'
  );
});

test('merge: sorting never mutates the input lists', () => {
  const outCopy = [...out];
  const backCopy = [...back];
  mergeFlightOptions({ tripType: 'roundtrip', out, back, ignavItineraries: ignavTrips, sort: 'cheapest' });
  assert.deepEqual(out, outCopy, 'the outbound list is untouched');
  assert.deepEqual(back, backCopy, 'the return list is untouched');
});

test('ignavItineraryDuration: the sum of its legs, Infinity when a leg has none', () => {
  assert.equal(ignavItineraryDuration(ignavTrips[0]), 800, 'two 400-minute legs');
  assert.equal(
    ignavItineraryDuration(itinerary(500, [offer('A', 0, 100, 300, 500), offer('B', 0, 200, undefined, 500)])),
    Infinity,
    'a leg with no duration makes the trip sort last'
  );
});

test('flight results: left-rail filters, card grid, merged list, tags kept', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  // Audit round (Nov 17, 2026): flights use the same 230px left
  // rail + results column as every other tab — the full-width
  // breakout and the top filter bar are gone.
  assert.ok(!src.includes('results-section--flights'), 'flights no longer break out of the narrow container');
  assert.ok(!css.includes('.results-section--flights'), 'the breakout rule is gone');
  assert.ok(!src.includes('flight-filter-bar'), 'the top filter bar is gone');
  assert.ok(src.includes('results-layout'), 'flights use the shared rail layout');
  assert.ok(src.includes('results-filters'), 'the facets sit in the left rail');
  assert.ok(css.includes('.results-count-row{display:flex'), 'the count row sits above the list');
  // Cards: one responsive grid, each option a complete trip card.
  assert.ok(src.includes('flight-card-grid'), 'results render as a card grid');
  assert.ok(src.includes('DuffelPairCard'), 'a Duffel round-trip is one pair card');
  assert.ok(css.includes('.flight-card-grid{display:grid'), 'the grid is a responsive grid');
  // Count row above the list, not in a bar.
  assert.ok(src.includes('Showing ${liveOptions.shownOptions} of ${liveOptions.totalOptions} options'), 'the count row counts the merged cards');
  assert.ok(
    src.includes('Showing ${liveOptions.shownCount} of ${liveOptions.totalCount} live fares'),
    'multi-city falls back to fare counts, having no merged grid'
  );
  assert.ok(src.includes('clearAllFlightFilters'), 'the rail clear resets every filter');
  // Mixed sources: one merge, sorted by the active sort.
  assert.ok(src.includes('mergeFlightOptions({'), 'Duffel pairs and Ignav trips merge into one list');
  assert.ok(!src.includes('Outbound — {fares.data.departDate}'), 'no separate outbound list heading anymore');
  // Source tags stay on every card while no filter is active — and
  // hide while any filter is on (Nov 16, 2026, user decision). The
  // filter bar has no source facet, and nothing here hides a fare's
  // source except an active filter.
  assert.ok(src.includes('fare-card-source'), 'each card carries its small source tag');
  assert.ok(src.includes('sourceLabel={duffelTagShown}'), 'Duffel cards carry their tag when unfiltered');
  assert.ok(src.includes('sourceLabel={ignavTagShown}'), 'Ignav cards carry their tag when unfiltered');
  assert.ok(src.includes('sourceLabel={letsfgTagShown}'), 'LetsFG cards carry their tag when unfiltered');
  assert.ok(src.includes('hideSourceTags ? undefined : duffelTag'), 'a filtered view hides the Duffel tag');
  assert.ok(src.includes('hideSourceTags ? undefined : ignavTag'), 'a filtered view hides the Ignav tag');
  assert.ok(src.includes('hideSourceTags ? undefined : letsfgTag'), 'a filtered view hides the LetsFG tag');
  assert.ok(src.includes('hideSourceTags={liveFiltersActive}'), 'the hide state comes from the filter bar');
  assert.ok(!src.includes('sourceLabel={duffelTag}'), 'no card passes the Duffel tag unconditionally');
  assert.ok(!src.includes('sourceLabel={ignavTag}'), 'no card passes the Ignav tag unconditionally');
  assert.ok(!src.includes('sourceLabel={letsfgTag}'), 'no card passes the LetsFG tag unconditionally');
  assert.ok(!src.includes('aria-label="Source"'), 'the filter bar offers no source facet');
});

// --- LetsFG trips in the merge (Nov 16, 2026) ---
const letsfgTrip = (price, legs) => ({ price, legs, letsfgId: `lf-${price}`, bookingUrl: 'https://letsfg.co/x' });

const letsfgTrips = [
  letsfgTrip(650, [offer('Iberia', 0, 825, 219, 650), offer('Iberia', 0, 945, 131, 650)]),
  letsfgTrip(710, [offer('ITA Airways', 0, 1275, 85, 710), offer('ITA Airways', 0, 570, 195, 710)]),
];

test('merge round-trip: LetsFG trips interleave cheapest-first with Duffel pairs and Ignav trips', () => {
  const merged = mergeFlightOptions({
    tripType: 'roundtrip',
    out,
    back,
    ignavItineraries: ignavTrips,
    letsfgItineraries: letsfgTrips,
    sort: 'cheapest',
  });
  assert.deepEqual(
    merged.map((o) => `${o.kind}:${o.total}`),
    ['duffel-pair:432', 'duffel-pair:445', 'duffel-pair:470', 'letsfg:650', 'letsfg:710', 'ignav:788', 'ignav:796', 'ignav:1028'],
    'one list, cheapest first, never grouped by source'
  );
});

test('merge: LetsFG trips order by duration and departure too', () => {
  const byDuration = mergeFlightOptions({
    tripType: 'roundtrip',
    out,
    back,
    ignavItineraries: [],
    letsfgItineraries: letsfgTrips,
    sort: 'duration',
  });
  assert.deepEqual(
    byDuration.map((o) => o.total),
    [710, 650, 432, 445, 470],
    'shortest trip first — the 280-minute LetsFG trip leads'
  );
  const byDeparture = mergeFlightOptions({
    tripType: 'roundtrip',
    out,
    back,
    ignavItineraries: [],
    letsfgItineraries: letsfgTrips,
    sort: 'departure',
  });
  assert.deepEqual(
    byDeparture.map((o) => o.total),
    [432, 445, 470, 650, 710],
    'earliest outbound departure first'
  );
});

test('merge one-way: LetsFG one-way trips interleave with Duffel one-way legs', () => {
  const merged = mergeFlightOptions({
    tripType: 'oneway',
    out,
    back: [],
    ignavItineraries: [],
    letsfgItineraries: [letsfgTrip(300, [offer('Iberia', 0, 825, 219, 300)])],
    sort: 'cheapest',
  });
  assert.deepEqual(
    merged.map((o) => `${o.kind}:${o.total}`),
    ['duffel-oneway:216', 'duffel-oneway:220', 'duffel-oneway:230', 'letsfg:300']
  );
});

test('merge: callers without LetsFG trips get the Duffel + Ignav list unchanged', () => {
  const merged = mergeFlightOptions({ tripType: 'roundtrip', out, back, ignavItineraries: ignavTrips, sort: 'cheapest' });
  assert.ok(merged.every((o) => o.kind !== 'letsfg'), 'no LetsFG option appears unasked');
  assert.equal(merged.length, 6, '3 Duffel pairs + 3 Ignav trips, as before');
});

test('countFlightCards: facet counts count cards, not legs', () => {
  // Audit round (Nov 17, 2026): the live audit read "Under $1,000
  // (23)" next to 6 cards, because the counts counted legs — a
  // round-trip pair is two legs. These 4 cards are 6 legs; every
  // count must come back as cards.
  const out = [
    offer('American', 0, 650, 478, 200),
    offer('Iberia', 0, 650, 478, 220),
  ];
  const back = [
    offer('American', 0, 1100, 478, 229),
    offer('Iberia', 0, 1100, 478, 220),
  ];
  const merged = mergeFlightOptions({
    tripType: 'roundtrip',
    out,
    back,
    ignavItineraries: [
      itinerary(698, [offer('American', 1, 650, 600, 698)]),
      itinerary(754, [offer('Delta', 0, 480, 500, 754)]),
    ],
    sort: 'best',
  });
  assert.equal(merged.length, 4, '2 Duffel pairs + 2 Ignav trips');
  const counts = countFlightCards(merged, 2);
  // Stops: the 2 nonstop pairs + the nonstop Delta trip = 3 cards.
  // Legs would say 5 (each pair is two nonstop legs).
  assert.equal(counts.stops[0], 3, 'nonstop counts cards, not legs');
  assert.equal(counts.stops[1], 1, 'the 1-stop Ignav trip is one card');
  // Airlines: each card counts once per carrier on it.
  assert.equal(counts.airlines['American'], 2, 'one pair + one Ignav trip');
  assert.equal(counts.airlines['Iberia'], 1, 'one pair');
  assert.equal(counts.airlines['Delta'], 1, 'one trip');
  // Times: every card departs in the morning (outbound departure).
  assert.equal(counts.times['morning'], 4, 'all four cards leave in the morning');
  // Prices: trip totals per traveler ($214.50, $220, $349, $377) —
  // all under the $1,000 band as cards, not as 6 leg prices.
  assert.equal(counts.prices[1000], 4, 'every card is under $1,000 per traveler');
  assert.equal(counts.prices[2000], 4, 'every card is under $2,000 per traveler');
});
