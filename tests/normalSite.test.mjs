// Direction v3 search (Nov 14, 2026): the search widget's place
// autocomplete source, the search query (URL params in, results out),
// and the honest row sorting. Nothing here invents a place, a price,
// or a date — bad input falls back or drops, never guesses.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/normalSite.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  cheapestOutBackTotal,
  destinationPhoto,
  emptySearchQuery,
  flightBudgetCopy,
  flightContextFromSearch,
  formValuesFromQuery,
  isKnownPlace,
  knownPlaceNames,
  rowIncludesPlace,
  searchButtonLabel,
  searchQueryFromParams,
  searchQueryToParams,
  searchRequestLabel,
  sortFareOffers,
  sortTabRows,
  todayIsoLocal,
} from '../lib/searchPlaces.ts';
import { tabRowsFor } from '../lib/homeTabs.ts';
import { bestTimeFor } from '../lib/bestTime.ts';
import { CITY_PHOTOS, GLOBAL_DESTINATIONS, leadPhotoFor } from '../lib/data.ts';

test('knownPlaceNames: every place the app knows, sorted, no duplicates', () => {
  const names = knownPlaceNames();
  assert.ok(names.length >= 60, `expected 60+ known places, got ${names.length}`);
  assert.equal(new Set(names).size, names.length, 'no duplicates');
  for (const n of ['Kyoto', 'Prague', 'Central Europe', 'St. George', 'Tacoma', 'Hilo', 'Bali', 'Paris', 'New York', 'Lisbon']) {
    assert.ok(names.includes(n), `${n} is a known place`);
  }
  assert.ok(!names.includes('Atlantis'), 'an unknown place is never suggested');
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted, 'sorted for the datalist');
  assert.ok(names.every((n) => n.length > 0), 'no empty names');
});

test('flightBudgetCopy: the planner budget is an economy figure — a non-economy cabin says so', () => {
  assert.deepEqual(flightBudgetCopy('Economy'), {
    label: 'Plan flight budget',
    qualifier: 'planning estimate — based on typical prices, not today’s fares',
  });
  assert.deepEqual(flightBudgetCopy(undefined), {
    label: 'Plan flight budget',
    qualifier: 'planning estimate — based on typical prices, not today’s fares',
  });
  assert.deepEqual(flightBudgetCopy('Business'), {
    label: 'Plan flight budget (economy estimate)',
    qualifier: 'economy planning estimate — based on typical prices, not today’s fares',
  });
  assert.deepEqual(flightBudgetCopy('First').label, 'Plan flight budget (economy estimate)');
  assert.deepEqual(flightBudgetCopy('Premium economy').label, 'Plan flight budget (economy estimate)');
});

test('isKnownPlace: exact match only, case-insensitive', () => {
  assert.equal(isKnownPlace('Kyoto'), true);
  assert.equal(isKnownPlace('kyoto'), true);
  assert.equal(isKnownPlace('Central Europe'), true);
  assert.equal(isKnownPlace('Atlantis'), false);
  assert.equal(isKnownPlace(''), false);
});

test('destinationPhoto: a photo where one exists on file, null otherwise', () => {
  assert.ok(destinationPhoto('Kyoto')?.includes('photo-1493976040374-85c8e12f0c0e'), 'Kyoto has its torii photo');
  assert.ok(destinationPhoto('Bali')?.includes('photo-1537996194471'), 'Bali has a photo');
  // Japan's stops include Kyoto, but the route leads with Tokyo
  // (leadPhotoFor, Nov 17 2026) — the Japan tile is no longer a
  // blank block or a Kyoto duplicate.
  assert.ok(destinationPhoto('Japan')?.includes('Tokyo_SkyTree'), 'Japan resolves to the Tokyo photo');
  // Central Europe leads with Vienna (ROUTE_PHOTO_CITY, Nov 17
  // 2026) so it stops duplicating Prague's photo.
  assert.ok(destinationPhoto('Central Europe')?.includes('Wien.Sch'), 'Central Europe resolves to the Vienna photo');
  assert.ok(destinationPhoto('Portugal')?.includes('Le_tram_28'), 'Portugal resolves to the Lisbon tram photo');
  assert.ok(destinationPhoto('Egypt')?.includes('All_Gizah_Pyramids'), 'Egypt resolves to the Giza photo');
  assert.equal(destinationPhoto('Atlantis'), null);
});

test('rowIncludesPlace: the route itself or one of its stops', () => {
  assert.equal(rowIncludesPlace('Central Europe', 'Central Europe'), true);
  assert.equal(rowIncludesPlace('Central Europe', 'Prague'), true);
  assert.equal(rowIncludesPlace('Central Europe', 'Vienna'), true);
  assert.equal(rowIncludesPlace('Central Europe', 'Paris'), false);
  assert.equal(rowIncludesPlace('Japan', 'Kyoto'), true);
  assert.equal(rowIncludesPlace('Japan', ''), false);
});

test('searchQueryFromParams: a full deep link round-trips, junk drops', () => {
  const q = searchQueryFromParams({
    tab: 'flights',
    from: 'New York',
    to: 'Central Europe',
    depart: '2027-01-04',
    return: '2027-01-17',
    travelers: '2',
    cabin: 'Business',
  });
  assert.ok(q, 'a full search parses');
  assert.equal(q?.tab, 'flights');
  assert.equal(q?.from, 'New York');
  assert.equal(q?.to, 'Central Europe');
  assert.equal(q?.depart, '2027-01-04');
  assert.equal(q?.ret, '2027-01-17');
  assert.equal(q?.travelers, 2);
  assert.equal(q?.cabin, 'Business');
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'serialize then parse is the identity');

  // A bare ?tab= is a tab, not a search.
  assert.equal(searchQueryFromParams({ tab: 'hotels' }), null);
  assert.equal(searchQueryFromParams({}), null);
  // A bad tab falls back to Flights; a bad date drops; a bad cabin
  // falls back to Economy; a bad traveler count falls back to 2.
  const junk = searchQueryFromParams({
    tab: 'bogus',
    dest: 'Kyoto',
    depart: 'not-a-date',
    return: '2027-02-30',
    travelers: '99',
    cabin: 'Rocket',
  });
  assert.equal(junk?.tab, 'flights');
  assert.equal(junk?.dest, 'Kyoto');
  assert.equal(junk?.depart, '');
  assert.equal(junk?.ret, '');
  assert.equal(junk?.travelers, 2);
  assert.equal(junk?.cabin, 'Economy');
  // A return before the depart drops the return, keeps the depart.
  const flipped = searchQueryFromParams({ tab: 'flights', from: 'New York', to: 'Japan', depart: '2027-03-10', return: '2027-03-01' });
  assert.equal(flipped?.depart, '2027-03-10');
  assert.equal(flipped?.ret, '');
});

test('searchQueryFromParams: a Dec 10–17 deep link round-trips exactly — no Dec 23 (UX review, Nov 19 2026)', () => {
  // The expert review reported a Dec 17 return rendering as Dec
  // 10–23. It does not reproduce: the params parse to the searched
  // dates, the serializer round-trips identically, and the flight
  // context keeps Dec 17 with an 8-day trip. Dec 10–23 is exactly
  // the no-return fallback (depart + 13 days), so the reviewed link
  // most likely carried no return param. This test pins the exact
  // round-trip so a future seam change cannot silently shift it.
  const q = searchQueryFromParams({
    tab: 'flights',
    from: 'New York',
    to: 'London',
    depart: '2026-12-10',
    return: '2026-12-17',
    travelers: '2',
  });
  assert.equal(q?.depart, '2026-12-10');
  assert.equal(q?.ret, '2026-12-17');
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'serialize then parse is the identity — the return survives');
  const ctx = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'London',
    depart: '2026-12-10',
    ret: '2026-12-17',
  });
  assert.equal(ctx.depart, '2026-12-10');
  assert.equal(ctx.return, '2026-12-17');
  assert.equal(ctx.durationDays, 8, 'Dec 10–17 is 8 days, not 14');
});

test('flightContextFromSearch: dates map to month + length, else the planner defaults', () => {
  const withDates = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Central Europe',
    depart: '2027-01-04',
    ret: '2027-01-17',
  });
  assert.deepEqual(withDates, {
    origin: 'New York',
    destination: 'Central Europe',
    month: 1,
    durationDays: 14,
    depart: '2027-01-04',
    return: '2027-01-17',
    cabin: 'economy',
  });
  // The live defect (Nov 14 2026): a Jan 15–22 search showed Jan 4–11
  // because the heading used the planner's suggested start. The
  // checked dates are the searched dates now — a second pair, in a
  // different month, pins that the dates travel through, not just the
  // month.
  const offSuggested = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Central Europe',
    depart: '2027-01-15',
    ret: '2027-01-22',
  });
  assert.equal(offSuggested.month, 1);
  assert.equal(offSuggested.durationDays, 8);
  assert.equal(offSuggested.depart, '2027-01-15');
  assert.equal(offSuggested.return, '2027-01-22');
  const march = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Japan',
    depart: '2027-03-10',
    ret: '2027-03-12',
  });
  assert.deepEqual(
    { month: march.month, durationDays: march.durationDays, depart: march.depart, return: march.return },
    { month: 3, durationDays: 3, depart: '2027-03-10', return: '2027-03-12' }
  );
  // No dates: the destination's best month + the default 14 days, and
  // the checked dates fall back to the planner's suggested start.
  const noDates = flightContextFromSearch({ ...emptySearchQuery('flights'), from: 'Los Angeles', to: 'Japan' });
  assert.deepEqual(
    { origin: noDates.origin, destination: noDates.destination, month: noDates.month, durationDays: noDates.durationDays },
    {
      origin: 'Los Angeles',
      destination: 'Japan',
      month: bestTimeFor('Japan').bestMonth,
      durationDays: 14,
    }
  );
  assert.match(noDates.depart, /^\d{4}-\d{2}-\d{2}$/, 'a suggested depart date stands in');
  assert.equal(
    Math.round((new Date(`${noDates.return}T00:00:00Z`).getTime() - new Date(`${noDates.depart}T00:00:00Z`).getTime()) / 86400000) + 1,
    14,
    'the fallback return is 14 days out'
  );
  // A one-day trip clamps to the planner's 2-day minimum.
  const oneDay = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Japan',
    depart: '2027-05-01',
    ret: '2027-05-01',
  });
  assert.equal(oneDay.durationDays, 2);
  // No destination at all: the Central Europe default.
  const bare = flightContextFromSearch(emptySearchQuery('flights'));
  assert.equal(bare.destination, 'Central Europe');
  assert.equal(bare.origin, 'New York');
});

test('flightContextFromSearch: the picked cabin travels through, in Duffel vocabulary', () => {
  // Before this round the Offer Request always asked for economy,
  // whatever the traveler picked in the Cabin select — a Business
  // search returned economy fares. The context now carries the cabin
  // the price-check call asks Duffel for.
  const business = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Central Europe',
    depart: '2027-01-04',
    ret: '2027-01-17',
    cabin: 'Business',
  });
  assert.equal(business.cabin, 'business');
  const premium = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Japan',
    cabin: 'Premium economy',
  });
  assert.equal(premium.cabin, 'premium_economy');
  const first = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Japan',
    cabin: 'First',
  });
  assert.equal(first.cabin, 'first');
  const junk = flightContextFromSearch({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Japan',
    cabin: 'Rocket',
  });
  assert.equal(junk.cabin, 'economy', 'a junk cabin falls back to economy');
});

test('results heading clears the sticky header (defect, Nov 14 2026)', () => {
  // After a search submits, the page scrolls to #results — without
  // scroll-margin the "Flights" heading slides underneath the sticky
  // header. The results bar is static now (UX direction round 2,
  // Nov 21 2026 — P0-5), so the margin clears the 61px header +
  // margin only — 76px, desktop and phone alike.
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const m = css.match(/#results\{scroll-margin-top:(\d+)px\}/);
  assert.ok(m, '#results has a scroll-margin-top rule');
  assert.equal(Number(m[1]), 76, `scroll-margin-top clears the header, got ${m[1]}px`);
});

test('results map stays below the sticky header (defect, Nov 14 2026)', () => {
  // While scrolling with the results map open, Leaflet map layers
  // rendered OVER the sticky search-summary bar: Leaflet panes sit at
  // z-index 200–1000, the bar at 40. The fix is stacking only — the
  // map container (.discover-map) is its own stacking context at
  // z-index 0, so every map layer (Leaflet panes and MapLibre
  // markers alike) paints below the sticky site header (60). The
  // results bar is static now (UX direction round 2, Nov 21 2026 —
  // P0-5), so it needs no z-index at all. The map itself is untouched.
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const m = css.match(/\.discover-map\{[^}]*z-index:\s*(\d+)/);
  assert.ok(m, '.discover-map has a z-index rule');
  assert.equal(Number(m[1]), 0, 'the map container sits at z-index 0');
  assert.ok(/\.discover-map\{[^}]*position:\s*relative/.test(css), '.discover-map is positioned (so z-index applies)');
  assert.ok(!/\.results-bar\{[^}]*z-index/.test(css), 'the static results bar carries no z-index');
  const header = css.match(/\.site-header\{[^}]*z-index:\s*(\d+)/);
  assert.ok(header && Number(header[1]) > Number(m[1]), 'the sticky site header paints above the map container');
});

test('sortTabRows: best value keeps the planner order, cheapest sorts by price', () => {
  const rows = tabRowsFor('hotels', 2);
  assert.deepEqual(sortTabRows(rows, 'best'), rows, 'best value is the discovery order');
  const cheap = sortTabRows(rows, 'cheapest');
  assert.notDeepEqual(cheap, rows, 'cheapest reorders');
  const prices = cheap.map((r) => r.pricePerTraveler);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b), 'cheapest is ascending');
  assert.deepEqual(new Set(cheap.map((r) => r.destination)), new Set(rows.map((r) => r.destination)), 'same rows, reordered');
});

test('searchButtonLabel: one verb per category', () => {
  assert.deepEqual(
    ['hotels', 'flights', 'cars', 'tours', 'cruises', 'buses', 'taxis'].map(searchButtonLabel),
    ['Search stays', 'Search flights', 'Search cars', 'Search attractions', 'Search cruises', 'Search buses', 'Search taxis']
  );
});

test('searchRequestLabel: the saved request names the search, never a booking', () => {
  const f = searchRequestLabel({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Central Europe',
    depart: '2027-01-04',
    ret: '2027-01-17',
    travelers: 2,
    cabin: 'Economy',
  });
  assert.equal(f, 'Flights: New York → Central Europe · 2027-01-04 – 2027-01-17 · 2 travelers · Economy');
  const s = searchRequestLabel({ ...emptySearchQuery('hotels'), dest: 'Kyoto', depart: '2027-04-01', ret: '2027-04-05', guests: 2, rooms: 1 }, 'Kyoto');
  assert.equal(s, 'Stays: Kyoto · 2027-04-01 – 2027-04-05 · 2 guests · 1 room');
  const c = searchRequestLabel({ ...emptySearchQuery('cruises'), dest: 'Caribbean', month: '2', travelers: 2 }, 'Caribbean');
  assert.equal(c, 'Cruises: Caribbean · February · 2 travelers');
  for (const label of [f, s, c]) {
    assert.ok(!/book now|Book now|confirmed|paid/i.test(label), 'a saved request never claims a booking');
  }
});

test('searchRequestLabel: traveler count pluralizes — "1 traveler", "2 travelers" (UX direction, Nov 19 2026 — P0-8)', () => {
  const one = searchRequestLabel({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'London',
    depart: '2026-12-10',
    ret: '2026-12-17',
    travelers: 1,
    cabin: 'Economy',
  });
  assert.ok(one.includes('1 traveler ·'), 'one traveler, singular');
  assert.ok(!one.includes('1 travelers'), 'no plural on one');
  const two = searchRequestLabel({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'London',
    depart: '2026-12-10',
    ret: '2026-12-17',
    travelers: 2,
    cabin: 'Economy',
  });
  assert.ok(two.includes('2 travelers ·'), 'two travelers, plural');
});

// --- Mobile layout (Nov 15, 2026): phones first ---
// All assertions read app/globals.css directly — the rules are
// small-screen only, so the check is that the rule exists with the
// right value, not a rendered screenshot (no browser here resizes
// to 390px; the rendered phone check runs on the user's phone).

test('mobile: the hero is tight on a phone (defect, Nov 15 2026)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const pads = [...css.matchAll(/\.hero-booking-inner\{padding:(\d+)px \d+px \d+px\}/g)].map((m) => Number(m[1]));
  assert.ok(pads.length >= 2, 'hero padding is declared for desktop and phone');
  assert.ok(pads[pads.length - 1] <= 36, `phone hero top padding is tight, got ${pads[pads.length - 1]}px`);
});

test('mobile: the results bar is static, so it never overlaps the header (UX direction round 2, Nov 21 2026 — P0-5)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(!/\.results-bar\{[^}]*position:sticky/.test(css), 'the results bar is not sticky on desktop');
  assert.ok(!css.includes('.results-bar{top:65px}'), 'no phone sticky-top remains');
  assert.ok(!css.includes('.results-bar{top:61px}'), 'no desktop sticky-top remains');
  assert.ok(css.includes('#results{scroll-margin-top:76px}'), 'the scroll target clears the sticky header');
});

test('mobile: phone rules — no zoom, no horizontal scroll, wrapping bar, fitting header', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('Mobile layout (Nov 15'));
  assert.ok(mobile.length > 0, 'the mobile block exists');
  assert.ok(mobile.includes('input,select,textarea{font-size:16px}'), '16px form fields at ≤640px — iOS never zooms on focus');
  assert.ok(mobile.includes('body{overflow-x:clip}'), 'no horizontal scroll on a phone');
  assert.ok(mobile.includes('.results-bar{flex-wrap:wrap'), 'the results bar wraps on a phone');
  assert.ok(mobile.includes('#results{scroll-margin-top:76px}'), 'the scroll target clears the sticky header (the bar is static now)');
  assert.ok(mobile.includes('.site-theme{padding:10px 12px}'), 'the header fits a 360px phone');
  assert.ok(mobile.includes('.chatmap-s0 .hero-input{flex-wrap:wrap}'), 'the S0 input stacks on a narrow phone');
});

test('mobile: the filter checkbox still sits next to its label (defect, Nov 15 2026)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  // The rail facets use .facet-check now (audit round, Nov 17 2026
  // — the top bar's .filter-check is gone); the protection is the
  // same: the checkbox keeps its natural size.
  assert.ok(/\.facet-check input\{flex:none/.test(css), 'filter checkboxes keep their natural size, so the label sits next to them');
});

// Flights section build (Nov 15, 2026): the sort re-orders the live
// fares too — cheapest, shortest, earliest departure — and a stale
// deep link falls back to flexible dates instead of showing fares
// for dates that have already passed.

test('todayIsoLocal: the local calendar date, not UTC', () => {
  assert.equal(todayIsoLocal(new Date(2026, 10, 15, 23, 30)), '2026-11-15');
  assert.equal(todayIsoLocal(new Date(2027, 0, 4, 0, 5)), '2027-01-04');
});

test('searchQueryFromParams: past dates drop, today and future dates stay', () => {
  const today = '2026-11-15';
  const stale = searchQueryFromParams(
    { tab: 'flights', from: 'New York', to: 'Central Europe', depart: '2026-11-01', return: '2026-11-10', travelers: '2' },
    today
  );
  assert.equal(stale?.depart, '', 'a past departure drops');
  assert.equal(stale?.ret, '', 'a past return drops');
  assert.equal(stale?.from, 'New York', 'the route survives a stale link');
  assert.equal(stale?.to, 'Central Europe');
  const todayTrip = searchQueryFromParams(
    { tab: 'flights', from: 'New York', to: 'Central Europe', depart: '2026-11-15', return: '2026-11-22' },
    today
  );
  assert.equal(todayTrip?.depart, '2026-11-15', "today's date is not past");
  assert.equal(todayTrip?.ret, '2026-11-22');
  const future = searchQueryFromParams(
    { tab: 'flights', from: 'New York', to: 'Central Europe', depart: '2027-01-04', return: '2027-01-17' },
    today
  );
  assert.equal(future?.depart, '2027-01-04');
  assert.equal(future?.ret, '2027-01-17');
});

test('formValuesFromQuery: the widget fields for a query, both directions', () => {
  const flights = formValuesFromQuery({
    ...emptySearchQuery('flights'),
    from: 'New York',
    to: 'Central Europe',
    depart: '2027-01-04',
    ret: '2027-01-17',
    travelers: 1,
    cabin: 'Business',
  });
  assert.equal(flights.place, 'Central Europe', 'the To field feeds the shared place');
  assert.equal(flights.from, 'New York');
  assert.equal(flights.depart, '2027-01-04');
  assert.equal(flights.ret, '2027-01-17');
  assert.equal(flights.travelers, 1);
  assert.equal(flights.cabin, 'Business');
  const hotels = formValuesFromQuery({ ...emptySearchQuery('hotels'), dest: 'Kyoto', guests: 4, rooms: 2 });
  assert.equal(hotels.place, 'Kyoto', 'the Destination field feeds the shared place');
  assert.equal(hotels.guests, 4);
  assert.equal(hotels.rooms, 2);
  assert.deepEqual(formValuesFromQuery(null), {
    place: '',
    from: '',
    depart: '',
    ret: '',
    travelers: 2,
    cabin: 'Economy',
    guests: 2,
    rooms: 1,
    pickupTime: '',
    dropoffTime: '',
    sameLocation: true,
    dropoff: '',
    month: '',
    tripType: 'roundtrip',
    legs: [],
    stayTier: 'best',
    carTier: 'best',
    tourTier: 'best',
    cruiseTier: 'best',
    busTier: 'best',
    taxiTier: 'best',
  });
});

test('sortFareOffers: price, duration and departure re-order the live fares', () => {
  const offers = [
    { airline: 'Slow', price: 300, currency: 'USD', stops: 1, duration: '11h 45m', departTime: '5:40 PM', departMinutes: 1060, durationMinutes: 705 },
    { airline: 'Cheap', price: 218, currency: 'USD', stops: 0, duration: '7h 5m', departTime: '8:30 AM', departMinutes: 510, durationMinutes: 425 },
    { airline: 'Early', price: 250, currency: 'USD', stops: 0, duration: '9h 20m', departTime: '6:00 AM', departMinutes: 360, durationMinutes: 560 },
    { airline: 'NoTimes', price: 240, currency: 'USD', stops: 0, duration: '', departTime: undefined, departMinutes: undefined, durationMinutes: undefined },
  ];
  assert.deepEqual(
    sortFareOffers(offers, 'cheapest').map((o) => o.airline),
    ['Cheap', 'NoTimes', 'Early', 'Slow'],
    'cheapest is price ascending'
  );
  assert.deepEqual(
    sortFareOffers(offers, 'best').map((o) => o.airline),
    ['Cheap', 'NoTimes', 'Early', 'Slow'],
    'best value is the price order for live fares'
  );
  assert.deepEqual(
    sortFareOffers(offers, 'duration').map((o) => o.airline),
    ['Cheap', 'Early', 'Slow', 'NoTimes'],
    'shortest first, an offer with no duration sorts last'
  );
  assert.deepEqual(
    sortFareOffers(offers, 'departure').map((o) => o.airline),
    ['Early', 'Cheap', 'Slow', 'NoTimes'],
    'earliest departure first, an offer with no time sorts last'
  );
  assert.deepEqual(
    offers.map((o) => o.airline),
    ['Slow', 'Cheap', 'Early', 'NoTimes'],
    'sorting never mutates the input list'
  );
});

test('sortTabRows: duration and departure leave estimate rows in best-value order', () => {
  const rows = tabRowsFor('flights', 2);
  assert.deepEqual(sortTabRows(rows, 'duration'), rows, 'estimates carry no duration');
  assert.deepEqual(sortTabRows(rows, 'departure'), rows, 'estimates carry no departure time');
});

test('flights: one merged live-fares list — no supplier column headers, a small tag per fare', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('fare-live-list'), 'one clean live list, not supplier-branded sections');
  assert.ok(!src.includes('FareSourceColumn'), 'the per-source column component is gone');
  assert.ok(!src.includes('title="Duffel"'), 'no big Duffel header');
  assert.ok(!src.includes('title="Ignav — live"'), 'no big Ignav header');
  // The per-fare tag is required — a test fare must never read as a
  // real bookable fare, and every fare is labelled with its source
  // and when it was checked — while NO filter is active. Nov 16,
  // 2026 (user decision): any active filter hides the tag on every
  // card; clearing every filter brings the tags back.
  assert.ok(src.includes('fare-card-source'), 'each fare carries its small source tag');
  assert.ok(src.includes('sourceLabel={duffelTagShown}'), 'Duffel fares carry their tag when unfiltered');
  assert.ok(src.includes('sourceLabel={ignavTagShown}'), 'Ignav fares carry their tag when unfiltered');
  assert.ok(src.includes('hideSourceTags ? undefined : duffelTag'), 'a filtered view hides the Duffel tag');
  assert.ok(src.includes('hideSourceTags ? undefined : ignavTag'), 'a filtered view hides the Ignav tag');
  assert.ok(!src.includes('sourceLabel={duffelTag}'), 'no card passes the Duffel tag unconditionally');
  assert.ok(!src.includes('sourceLabel={ignavTag}'), 'no card passes the Ignav tag unconditionally');
  assert.ok(src.includes("'Duffel · test fare'"), 'test fares are named as test fares on the card');
  assert.ok(src.includes('ignavSourceTag('), 'Ignav fares carry the checked time');
  // The cached comparison block stays, below the live list.
  assert.ok(src.includes('Other sites (cached)'), 'the cached column survives as a standalone block');
  assert.ok(src.includes('<section className="fare-block" aria-label="Other sites (cached)">'), 'the cached block is a section, not a source column');
  assert.ok(!src.includes('Mystifly'), 'no fares from a source that is not connected yet');
  assert.ok(!src.includes('Etraveli'), 'no fares from a source that is not connected yet');
  assert.ok(src.includes('/api/ignav-fares'), 'the Ignav fares fetch from the Ignav route');
  assert.ok(src.includes('IgnavBookingLinks'), 'Ignav fares carry on-click booking options');
  // Audit round Nov 17, 2026: the cheapest banner is gone — every
  // trip card carries its own trip total and one action.
  assert.ok(!src.includes('fare-total'), 'no highlighted cheapest banner below the flight list');
  assert.ok(src.includes('Save this fare'), 'Duffel trip cards carry a save action');
  assert.ok(src.includes('Clear filters'), 'a filtered-empty list has a way back');
  // "Book now" appears in the file header and in the comment explaining
  // why the "Book-now read" line is NOT rendered — neither is a
  // rendered button. The check is for a rendered Book now action.
  assert.ok(!src.includes('>Book now<'), 'no rendered Book now button in the results');
  assert.ok(!src.includes("primary") || src.includes('Save this search'), 'the primary action is Save this search');
});

test('UX direction Nov 19 P0-4: a Duffel test fare is unmissable and never headlines cheapest', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../lib/homeTabs.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const merge = readFileSync(new URL('../lib/flightOptions.ts', import.meta.url), 'utf8');
  // The warning text lives in one place and says exactly what it is.
  assert.ok(tabs.includes("DUFFEL_TEST_FARE_WARNING = 'Test fare — not bookable, not a real price'"), 'the warning names the fare as test, unbookable, not real');
  // Every Duffel card renders it, in both formats and multi-city.
  assert.ok(src.includes('testFare={duffelTest}'), 'Duffel cards get the test flag');
  assert.ok(src.includes('<p className="fare-test-warning">{DUFFEL_TEST_FARE_WARNING}</p>'), 'the warning renders on the card');
  assert.ok(css.includes('.fare-test-warning{'), 'the warning has its own style');
  assert.ok(css.includes('color:var(--danger)'), 'the warning is danger red, not small grey');
  // The merge sorts test fares after live fares (see
  // tests/flightOptions.test.mjs for the ordering itself).
  assert.ok(merge.includes('duffelTest?: boolean'), 'the merge takes the test flag');
  assert.ok(merge.includes('testRank'), 'test fares rank behind live fares in every sort');
  assert.ok(src.includes('duffelTest,'), 'the results pass the flag into the merge');
});

test('UX direction Nov 19 P0-2: results pages are results only — no browse shelf below the results', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  for (const shelf of [
    'Flights by destination',
    'Stays by destination',
    'Cars by destination',
    'Attractions by destination',
    'Cruises by destination',
    'Buses by destination',
    'Taxis by destination',
  ]) {
    assert.ok(!src.includes(shelf), `no "${shelf}" shelf in the results`);
  }
  // The per-destination row cards are gone with the shelves.
  for (const card of ['StayCard', 'CarCard', 'TourCard', 'CruiseCard', 'BusCard', 'TaxiCard']) {
    assert.ok(!src.includes(`function ${card}(`), `no ${card} component remains`);
  }
  // The live sections stay: Hotelbeds sandbox hotels, activities and
  // transfers are results, not browse shelves.
  assert.ok(src.includes('HotelbedsStays'), 'sandbox hotels stay on the Stays results page');
  assert.ok(src.includes('HotelbedsActivities'), 'sandbox activities stay on the Attractions results page');
  assert.ok(src.includes('HotelbedsTransfers'), 'sandbox transfers stay on the Taxis results page');
  // One loading state: the per-source lines are gone; the count-row
  // line is the single "Checking live fares…" in the results.
  assert.ok(!src.includes('Checking live fares from Ignav'), 'no per-source Ignav loading line');
  assert.ok(!src.includes('Checking live fares from LetsFG'), 'no per-source LetsFG loading line');
  assert.ok(src.includes("Checking live fares…"), 'one loading line remains');
});

test('cheapestOutBackTotal: the total follows the visible fares, never a filtered-out fare', () => {
  const out = [
    { airline: 'Cheap', price: 218, currency: 'USD', stops: 0, duration: '7h 5m' },
    { airline: 'Pricey', price: 300, currency: 'USD', stops: 0, duration: '7h 5m' },
  ];
  const back = [
    { airline: 'Cheap', price: 216, currency: 'USD', stops: 0, duration: '7h 5m' },
    { airline: 'Pricey', price: 290, currency: 'USD', stops: 0, duration: '7h 5m' },
  ];
  assert.equal(cheapestOutBackTotal(out, back), 434, 'cheapest out + cheapest back');
  // A filter that hides the cheapest outbound leaves the next cheapest.
  assert.equal(cheapestOutBackTotal(out.slice(1), back), 516);
  assert.equal(cheapestOutBackTotal([], back), 0, 'no outbound, no round-trip total');
  assert.equal(cheapestOutBackTotal(out, []), 0, 'no return, no round-trip total');
});

// Homepage restructure (Nov 15, 2026): one Lucide icon set, the
// DM Sans + Inter stack, calm minimalism.
test('restructure: the new section styles exist in the CSS', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  for (const cls of [
    '.eyebrow',
    '.pkg-grid',
    '.pkg-card',
    '.feature-row',
    '.feature-photo',
    '.feature-body',
    '.pkg-photo',
    '.pkg-body',
    '.pkg-price',
    '.pkg-actions',
    '.fare-test-warning',
    '.steps',
    '.step',
    '.voices-teaser',
    '.voices-chips',
  ]) {
    assert.ok(css.includes(cls), `CSS defines ${cls}`);
  }
});

test('restructure: the card price is the largest type on the card', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const price = css.match(/\.pkg-price\{[^}]*font-size:(\d+)px/);
  assert.ok(price, '.pkg-price has a font-size');
  // UX direction round 2 (Nov 21, 2026 — P0-2): the type scale
  // grows — the package price is 24/700 in the display face, still
  // the largest type on the card, ahead of the 20px title.
  assert.equal(Number(price[1]), 24, `card price ${price[1]}px is the 24px price-card`);
  const bodyH3 = css.match(/\.pkg-body h3\{[^}]*font-size:(\d+)px/);
  assert.ok(bodyH3 && Number(price[1]) > Number(bodyH3[1]), 'price larger than the card title');
  assert.equal(Number(bodyH3[1]), 20, 'card titles are 20px (round-2 scale)');
});

test('restructure: icons are Lucide, one pack, one stroke — no emoji, no hand-rolled svg', () => {
  const icons = readFileSync(new URL('../components/icons.tsx', import.meta.url), 'utf8');
  assert.ok(icons.includes("from 'lucide-react'"), 'icons come from lucide-react');
  assert.ok(!icons.includes('<svg'), 'no hand-rolled svg in the icon set');
  assert.ok(icons.includes('strokeWidth={1.75}'), 'one stroke width for the whole set');
  const emoji = ['🏨', '✈️', '🚗', '🎡', '🚢', '🚌', '🚕', '✦', '☀', '☾', '☰', '✕'];
  for (const file of ['../components/icons.tsx', '../lib/homeTabs.ts', '../components/SiteHeader.tsx', '../components/SearchWidget.tsx', '../components/FujinApp.tsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const e of emoji) assert.ok(!src.includes(e), `${file} has no emoji icon ${e}`);
  }
});

test('restructure: the header nav and the widget tabs share one icon key per category', () => {
  const icons = readFileSync(new URL('../components/icons.tsx', import.meta.url), 'utf8');
  for (const t of ['flights', 'hotels', 'cars', 'tours', 'cruises', 'buses', 'taxis']) {
    assert.ok(icons.includes(`${t}:`), `TAB_ICONS covers ${t}`);
  }
  const fujinApp = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  // The category tiles are gone (UX direction, Nov 19 2026 — P1-1):
  // the header nav and the widget tabs are the category entries.
  assert.ok(!fujinApp.includes('CATEGORY_TILES'), 'no category tiles remain');
  const header = readFileSync(new URL('../components/SiteHeader.tsx', import.meta.url), 'utf8');
  // The header nav is text-only (review round, Nov 17 2026 — gap 12).
  assert.ok(!header.includes('<Icon name={t.icon}'), 'no category icon in the header nav');
  const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  assert.ok(widget.includes('<Icon name={t.icon} size={16} />'), 'widget tabs render the shared key');
});

test('restructure: fonts are Inter + Plus Jakarta Sans — Jakarta display, Inter body, no Bricolage (UX direction round 2, Nov 21 2026 — P0-2)', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.ok(layout.includes('Plus_Jakarta_Sans'), 'display font is Plus Jakarta Sans');
  assert.ok(!layout.includes('DM_Sans'), 'DM Sans is dropped — it spoke in the same voice as Inter');
  assert.ok(layout.includes('Inter'), 'body font is Inter');
  assert.ok(!layout.includes('Bricolage_Grotesque'), 'Bricolage Grotesque is dropped');
  assert.ok(!layout.includes('JetBrains_Mono'), 'no JetBrains Mono — prices use the display face with tabular-nums');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('Plus Jakarta Sans'), 'Plus Jakarta Sans is the display fallback in the CSS');
  assert.ok(!css.includes('Bricolage'), 'no Bricolage fallback in the CSS');
  assert.ok(!css.includes('JetBrains'), 'no JetBrains fallback in the CSS');
  assert.ok(css.includes("--font-display:'Plus Jakarta Sans'"), 'the display token is Plus Jakarta Sans');
  assert.ok(css.includes("--font-body:'Inter'"), 'the body token is Inter');
  assert.ok(!css.includes('--font-mono'), 'no mono font token');
});

test('restructure: micro-interactions animate transform only, 150–300ms', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('/* Homepage restructure (Nov 15, 2026)'));
  const transitions = [...block.matchAll(/transition:([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(transitions.length >= 3, 'the new sections declare transitions');
  for (const t of transitions) {
    assert.ok(/^transform \d+ms ease$/.test(t), `transition is transform-only 150–300ms: ${t}`);
    const ms = Number(t.match(/(\d+)ms/)[1]);
    assert.ok(ms >= 150 && ms <= 300, `duration ${ms}ms is within 150–300ms`);
  }
});

test('restructure: the new grids stack to one column at 390px', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width:640px){', css.indexOf('/* Homepage restructure')));
  assert.ok(mobile.includes('.pkg-card{grid-column:span 12}'), 'package cards stack to one column');
  assert.ok(mobile.includes('.grid>.card{grid-column:span 12}'), 'destination cards stack to one column');
  assert.ok(mobile.includes('.step{grid-column:span 12}'), 'how-it-works steps stack to one column');
  assert.ok(!css.includes('.fares-strip'), 'the cheapest-fares strip is gone');
  assert.ok(css.includes('.pkg-actions button,.pkg-actions a{min-height:44px'), 'package actions are 44px touch targets');
});

// Dribbble makeover (Nov 21, 2026): the design language is the
// shot's — a wide 1200px container with 24px gutters, one radius
// scale (12px fields, 16px panels, 24px cards), barely-there
// resting shadows, and one 24px gap token between cards (UX
// direction round 2, Nov 21 2026 — P0-3). Visual layer only: no
// layout, copy, or behavior changes. Brand, fonts, and the photo
// hero are FujinTrip's own.
test('dribbble makeover: wide container, one radius scale, airy grids', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.wrap{max-width:1200px;margin:0 auto;padding:0 24px}'), 'the container is 1200px with 24px gutters');
  assert.ok(css.includes('calc((100vw - 1200px)/2 + 24px)'), 'the sticky header caps at the same 1200px container');
  for (const cls of ['.card', '.result-card', '.pkg-card', '.fare-card', '.flight-option-card', '.step', '.voices-teaser']) {
    assert.ok(new RegExp(`\\${cls}\\{[^}]*border-radius:var\\(--r-lg\\)`).test(css), `${cls} uses the 24px card radius`);
  }
  // The search widget is a transparent wrapper — the 24px radius
  // lives on the pill bar's phone form, and the bar itself is a
  // 999px pill.
  assert.ok(/\.sw-bar\{[^}]*border-radius:999px/.test(css), 'the search bar is a 999px pill');
  assert.ok(/\.sw-field input,\.sw-field select\{[^}]*border-radius:var\(--r-sm\)/.test(css), 'search fields use the 12px radius');
  assert.ok(/\.results-bar\{[^}]*border-radius:var\(--r-lg\)/.test(css), 'the results bar uses the 24px radius');
  // The stays top bar is gone (review round, Nov 17 2026 — gap 6:
  // sort, max price, tier and the sandbox facets all live in the
  // sidebar now — one filter surface). The flights top bar is gone
  // too (audit round, Nov 17 2026 — gap 8: the facets moved into
  // the same left rail, the count row sits above the list).
  assert.ok(!css.includes('.flight-filter-bar'), 'the flights filter bar is gone — its facets live in the rail');
  assert.ok(css.includes('.results-count-row{display:flex'), 'the flight count row sits above the list');
  assert.ok(!css.includes('.stay-filter-bar'), 'the stays filter bar is gone — its filters live in the sidebar');
  for (const grid of ['.result-cards', '.pkg-grid', '.flight-card-grid']) {
    assert.ok(new RegExp(`\\${grid}\\{[^}]*gap:var\\(--gap\\)`).test(css), `${grid} breathes at the 24px gap token`);
  }
  assert.ok(css.includes('--gap:24px'), 'one 24px gap token drives every grid');
  assert.ok(css.includes('footer{border-top:1px solid var(--line);padding:48px 0 32px;color:var(--muted);font-size:13px;background:var(--surface)}'), 'the footer is a surface-1 band with tightened bottom padding');
  assert.ok(css.includes("--font-display:'Plus Jakarta Sans'"), 'the display face is Plus Jakarta Sans, not Expedia’s');
  assert.ok(css.includes("--font-body:'Inter'"), 'the body face is still Inter');
});

// Review fixes (Nov 16, 2026 — second pair of eyes on the interface
// round): the flights shelf must not claim live fares don't exist yet
// (Ignav and LetsFG are live), no <h3> may sit inside a <summary>
// (invalid HTML — a styled span carries the heading look), and no
// result-price line may sit at column 0.
test('review fixes: flights shelf copy, summary headings, price indentation', () => {
  const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(!app.includes('Live fares arrive as suppliers connect'), 'the flights shelf never claims live fares are still coming');
  // The flights shelf is gone (UX direction, Nov 19 2026 — P1-1):
  // the live-sources line lives in the results bar now, where the
  // fares actually appear.
  assert.ok(!app.includes('Live fares from Ignav and LetsFG appear in the flight results'), 'no flights-shelf copy remains on the homepage');
  assert.ok(
    results.includes('plus live fares from Ignav and LetsFG'),
    'the results bar names the live fare sources',
  );
  assert.ok(!app.includes('<summary><h3'), 'no heading sits inside a summary element');
  assert.ok(app.includes('className="details-heading"'), 'the summary headings use the styled span');
  assert.ok(css.includes('.details-heading{'), 'the details heading style exists');
  assert.ok(!/^<p className="result-price">/m.test(results), 'no result-price line sits at column 0');
});

// Review round (Nov 17, 2026 — second pair of eyes, Expedia re-study):
// 12 ranked gaps, each pinned here so the next round cannot silently
// reintroduce them.
test('review round Nov 17: the 12 interface fixes are in place', () => {
  const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const homeTabs = readFileSync(new URL('../lib/homeTabs.ts', import.meta.url), 'utf8');
  const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const pkgs = readFileSync(new URL('../components/PackagesSection.tsx', import.meta.url), 'utf8');
  const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  const data = readFileSync(new URL('../lib/data.ts', import.meta.url), 'utf8');
  const voices = readFileSync(new URL('../components/HomeSections.tsx', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../components/SiteHeader.tsx', import.meta.url), 'utf8');
  // 1 — the landing shelf is cut (UX direction, Nov 19 2026 —
  // P1-1): a ?tab= link switches the widget tab, nothing more. No
  // shelf state, no shelf copy, no null-returning tab parser.
  assert.ok(!homeTabs.includes('homeTabIdFromQueryOrNull'), 'the null-returning tab parser is gone with the shelf');
  assert.ok(!page.includes('initialLandingTab'), 'the homepage passes no landing tab anymore');
  assert.ok(page.includes('initialTab={homeTabIdFromQuery'), 'a ?tab= link still switches the widget tab');
  assert.ok(!app.includes('SHELF_COPY'), 'no shelf copy remains');
  assert.ok(!app.includes('shelfEntries'), 'no shelf entries remain');
  // 2 — distinct section grammars: portrait destination cards with
  // the name + price overlaid on the photo (Dribbble makeover, Nov
  // 21, 2026 — reversing the audit-round gap-10 call that moved the
  // price into the white body; the bottom gradient keeps the white
  // text readable).
  assert.ok(!app.includes('dest-card--photo'), 'destination cards no longer use the overlay variant');
  assert.ok(app.includes('dest-overlay'), 'the name + from-price overlay the photo on the gradient');
  assert.ok(app.includes('<p className="result-price">from $'), 'the from-price sits on the photo in the frosted pill');
  assert.ok(css.includes('.dest-overlay'), 'the overlay style exists');
  assert.ok(css.includes('.dest-overlay .result-price{flex:0 0 auto;background:rgba(252,252,252,.16)'), 'the overlay price is a frosted pill');
  assert.ok(!css.includes('.pkg-card--row{'), 'the row-card style is gone');
  assert.ok(!existsSync(new URL('../components/DealsSection.tsx', import.meta.url)), 'the deals component is deleted with the band');
  assert.ok(!css.includes('.deals-grid'), 'no deals-grid style remains');
  // 3 — package cards show one price and one action (UX direction,
  // Nov 19 2026 — P0-3): the includes breakdown + tiers moved to
  // the package detail page; the expander is gone.
  assert.ok(!pkgs.includes('<details className="pkg-details">'), 'no includes expander on the card');
  assert.ok(!pkgs.includes("See what&apos;s included"), 'no expander label remains');
  assert.ok(!css.includes('.pkg-details{'), 'the expander style is gone');
  assert.ok(!css.includes('.pkg-tiers'), 'the tiers row style is gone');
  assert.ok(pkgs.includes('>View trip<'), 'the single card action is View trip');
  // 4 — non-flight prices lead the card at 24px.
  assert.ok(css.includes('.result-price{font-family:var(--font-display);font-size:24px'), 'result prices are 24px, not body size');
  // 5 — hotel cards are horizontal rows with a fixed price column.
  assert.ok(results.includes('result-card--wide'), 'Hotelbeds cards use the wide variant');
  assert.ok(results.includes('result-wide-side'), 'the price + action sit in the side column');
  assert.ok(results.includes('result-cards--wide'), 'the hotel list is a single column');
  assert.ok(css.includes('.result-card--wide{display:grid'), 'the wide-row style exists');
  // 6 — Stays filters live in one sidebar, as checkbox lists.
  assert.ok(!results.includes('stayFilterBar'), 'the stays top bar is gone');
  assert.ok(!results.includes('stay-filter-bar'), 'no stays top-bar class remains');
  assert.ok(results.includes('className="facet-check"'), 'star / area / meal plan render as checkbox lists');
  assert.ok(results.includes('type="checkbox"'), 'the facets use real checkboxes');
  assert.ok(css.includes('.facet-check{'), 'the facet checkbox style exists');
  assert.ok(!css.includes('.stay-filter-bar'), 'the stays bar rule is gone from the CSS');
  // 7 — the weekend band is cut (UX direction, Nov 19 2026 —
  // P1-1): "Weekend trips near you" goes until location actually
  // works. The local-trip data stays in lib/data.ts for the future
  // "Near you" filter — the band just doesn't render it.
  assert.ok(!app.includes('Weekend trips near you'), 'no weekend band on the homepage');
  assert.ok(!app.includes('LOCAL_TRIPS'), 'the homepage no longer reads the local trips');
  assert.ok(data.includes('LOCAL_TRIPS'), 'the local-trip data stays for later');
  // 8 — Local Voices is photo cards with one View trip action
  // (UX direction, Nov 19 2026 — P0-3).
  assert.ok(voices.includes('voicePhoto'), 'each place resolves a photo');
  assert.ok(voices.includes('>View trip<'), 'the cards carry one View trip action');
  assert.ok(!voices.includes('Destination guide →'), 'no separate guide link — View trip is the one action');
  assert.ok(!voices.includes('<strong>To try</strong>'), 'the full guide text moved off the card');
  // 9 — My Trips lives on /account now (UX direction, Nov 19 2026
  // — P1-1): the account page renders the trips, preferences,
  // emergency contact, embassy number and price watches directly —
  // never collapsed behind a homepage <details> anymore.
  assert.ok(app.includes("variant === 'account'"), 'the account variant exists');
  assert.ok(app.includes('<h1 id="mytrips">My Trips</h1>'), 'the account page carries the My Trips heading');
  assert.ok(!app.includes('myTripsEmpty'), 'no homepage collapse state remains');
  // 10 — the results page no longer triple-stacks chrome.
  assert.ok(!results.includes('<h2>{label}</h2>'), 'the redundant results heading is gone');
  assert.ok(!results.includes('results-honesty'), 'the standalone honesty paragraph is gone');
  assert.ok(results.includes('results-bar-note'), 'the honesty line lives in the results bar');
  assert.ok(!css.includes('.results-honesty'), 'the honesty style is gone');
  // 11 — the fares strip is gone; the honesty line lives in the
  // widget now (UX direction, Nov 19 2026 — P1-3): one line per
  // page, not twenty. The deals band is gone with it (P1-1).
  assert.ok(!existsSync(new URL('../components/FaresStrip.tsx', import.meta.url)), 'the fares strip component is deleted');
  assert.ok(widget.includes('Prices are planning estimates until live suppliers connect'), 'the widget carries the one honesty line');
  assert.ok(widget.includes('how pricing works'), 'the honesty line links the pricing explainer');
  // 12 — the header nav is text-only.
  assert.ok(!header.includes('<Icon name={t.icon}'), 'no category icon in the header nav');
});

test('audit round Nov 17: results-only page, Expedia tokens, one flight-card format', () => {
  const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  // 2 — a search hides the browse sections AND My Trips (UX
  // direction, Nov 19 2026 — P0-2: results pages are results only),
  // and "Clear search" brings the browse sections back.
  assert.ok(app.includes('{!search && ('), 'the browse sections hide while a search is active');
  assert.equal((app.match(/\{!search && \(/g) || []).length, 1, 'the browse sections gate once — My Trips lives on /account, not behind the search gate');
  assert.ok(app.includes("{variant === 'home' && !search && ("), 'the continue bar hides on results pages too');
  assert.ok(app.includes('onClearSearch={() => setSearch(null)}'), 'clearing the search restores the browse page');
  assert.ok(results.includes('Clear search'), 'the results bar offers a way back to browse');
  assert.ok(results.includes('onClearSearch: () => void'), 'the clear callback is a declared prop');
  // Tokens — Dribbble radius scale: cards 24px, buttons pill,
  // inputs 12px; no 16px radius remains.
  assert.ok(!css.includes('border-radius:16px'), 'no 16px radius remains in the stylesheet');
  assert.ok(css.includes('--brand:#4a3f4b'), 'plum is the primary-action color');
  assert.ok(css.includes('--ink:#060609'), 'ink is the near-black');
  assert.ok(css.includes('--line:#e3ded9'), 'hairlines are the warm greige');
  // Tokens — section headings 24px, sections 48px apart.
  assert.ok(css.includes('section h2{font-size:24px'), 'section headings are 24px');
  assert.ok(css.includes('.home-section{padding:48px 0}'), 'sections sit 48px apart');
  // 4 + 5 + 6 — package photos, section rhythm. (The deals grid is
  // gone with the deals band — UX direction, Nov 19 2026, P1-1.)
  assert.ok(!css.includes('.deals-grid'), 'no deals-grid style remains');
  assert.ok(css.includes('.pkg-photo{width:100%;aspect-ratio:4/3'), 'package photos are 4:3, not thin strips');
  assert.ok(css.includes('.pkg-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:auto'), 'package actions pin to the card bottom');
  assert.ok(css.includes('section{padding:48px 0}'), 'sections sit 48px apart, not 64px');
  assert.ok(!css.includes('--r-lg:16px'), 'no 16px radius tier remains');
  // 1 + 3 — one flight-card format, one price block, one action.
  assert.ok(results.includes('TripPriceHeader'), 'one price block serves every trip card');
  assert.ok(results.includes('DuffelOneWayCard'), 'one-way Duffel fares render as trip cards');
  assert.ok(results.includes('Save this fare'), 'Duffel trip cards carry a save action');
  assert.ok(results.includes("Saved ✓"), 'the save action confirms inline');
  assert.ok(!results.includes('fare-total'), 'no highlighted cheapest banner below the flight list');
  assert.ok(!results.includes('priceNote'), 'no per-card fee note remains');
  assert.ok(css.includes('.flight-option-price strong{font-family:var(--font-display);font-size:24px'), 'trip totals are 24px in the display face');
});

test('audit round Nov 17: no two cards lead with the same photo', () => {
  const lisbon = CITY_PHOTOS['Lisbon'];
  const kyoto = GLOBAL_DESTINATIONS.find((d) => d.name === 'Kyoto')?.image;
  const paris = GLOBAL_DESTINATIONS.find((d) => d.name === 'Paris')?.image;
  // Routes that share a first stop lead with a different stop.
  assert.equal(leadPhotoFor('Europe', ['Lisbon', 'Madrid', 'Barcelona', 'Paris', 'Rome', 'Athens']), paris);
  assert.equal(leadPhotoFor('Portugal', ['Lisbon', 'Porto', 'Sintra']), lisbon);
  assert.notEqual(leadPhotoFor('Europe', ['Lisbon', 'Paris', 'Rome']), leadPhotoFor('Portugal', ['Lisbon', 'Porto']));
  assert.equal(leadPhotoFor('Japan', ['Tokyo', 'Kyoto', 'Osaka']), CITY_PHOTOS['Tokyo']);
  assert.equal(leadPhotoFor('Central Europe', ['Prague', 'Vienna', 'Budapest']), CITY_PHOTOS['Vienna']);
  assert.equal(leadPhotoFor('Southeast Asia', ['Bangkok', 'Siem Reap', 'Hanoi']), CITY_PHOTOS['Hanoi']);
  assert.equal(leadPhotoFor('Thailand', ['Bangkok', 'Chiang Mai', 'Krabi']), CITY_PHOTOS['Bangkok']);
  // Japan used to fall back to a blank tile: its first stop (Tokyo)
  // had no photo. It now resolves, and it is not Kyoto's photo.
  assert.notEqual(leadPhotoFor('Japan', ['Tokyo', 'Kyoto', 'Osaka']), kyoto);
  assert.ok(destinationPhoto('Japan')?.includes('Tokyo_SkyTree'), 'the search photo for Japan is Tokyo, not Kyoto');
  // One shared rule: packages, destination cards and search photos.
  const pkgs = readFileSync(new URL('../lib/packages.ts', import.meta.url), 'utf8');
  const voices = readFileSync(new URL('../components/HomeSections.tsx', import.meta.url), 'utf8');
  assert.ok(pkgs.includes('leadPhotoFor(entry.destination'), 'package photos use the shared rule');
  // The voices are single destinations now (UX direction, Nov 19
  // 2026 — P0-7): Central Europe and Japan were routes that already
  // have a featured package card, so they no longer appear here.
  // Barcelona and Tokyo use their own photos; Kyoto keeps its own.
  assert.ok(voices.includes("LOCAL_VOICES_PLACES = ['Kyoto', 'Barcelona', 'Tokyo']"), 'the voices are three single destinations');
  assert.ok(voices.includes("if (place === 'Barcelona') return CITY_PHOTOS['Barcelona']"), 'the Barcelona voice uses its own photo');
  assert.ok(voices.includes("if (place === 'Tokyo') return CITY_PHOTOS['Tokyo']"), 'the Tokyo voice uses its own photo');
  assert.ok(!voices.includes("if (place === 'Central Europe')"), 'Central Europe has no voice card — it has a featured package');
  assert.ok(!voices.includes("if (place === 'Japan')"), 'Japan has no voice card — it has a featured package');
});

test('audit round Nov 17: one primary pill + one text link per card', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const pkgs = readFileSync(new URL('../components/PackagesSection.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  const share = readFileSync(new URL('../components/ShareMenu.tsx', import.meta.url), 'utf8');
  // Type scale (UX direction round 2, Nov 21 2026 — P0-2):
  // homepage section heads 32, card titles 20/600, card body 16,
  // prices 24 in the display face. (Detail-section h2s stay 24px —
  // see the section rule below.)
  assert.ok(css.includes('.home-section h2{margin:0 0 6px;font-size:32px'), 'homepage section heads are 32px');
  assert.ok(css.includes('.card .body h3{font-size:20px;font-weight:600;margin:0 0 4px}'), 'card titles are 20px/600');
  assert.ok(css.includes('.pkg-body h3{margin:10px 0 2px;font-size:20px;font-weight:600}'), 'package titles are 20px/600');
  assert.ok(css.includes('.card .body p{font-size:16px'), 'card body text is 16px');
  assert.ok(css.includes('.pkg-price{font-family:var(--font-display);font-size:24px;font-weight:700'), 'package prices are the 24px price-card');
  // Pills are auto-width, never a full-width peach bar: a
  // flex-column body stretches its children, so the pill pins
  // itself to the start.
  assert.ok(css.includes('.card .body .pill,.pkg-body .pill{align-self:flex-start}'), 'tag pills are auto-width in flex-column bodies');
  assert.ok(css.includes('.card-top{display:flex'), 'cards have a top row for tag + share');
  // Package cards: one price, one action — a single "View trip"
  // link in the action row; share lives in the top row as a text link.
  assert.ok(pkgs.includes('className="card-top"'), 'package cards have the top row');
  assert.ok(pkgs.includes('buttonClassName="linklike"'), 'package share is a text link');
  assert.ok(pkgs.includes('>View trip<'), 'the single card action is View trip');
  assert.ok(!pkgs.includes('View package'), 'no View package action remains');
  assert.ok(!pkgs.includes('Save this search'), 'no Save action on package cards — the detail page carries it');
  // Destination cards: same shape — top row + single View trip link.
  assert.ok(app.includes('className="card-top"'), 'destination cards have the top row');
  assert.ok(app.includes('buttonClassName="linklike"'), 'destination share is a text link');
  assert.ok(app.includes('>View trip<'), 'destination cards carry one View trip action');
  assert.ok(!app.includes('Search this destination'), 'no Search-prefill button on destination cards');
  // ShareMenu takes the trigger style from its caller.
  assert.ok(share.includes('buttonClassName'), 'ShareMenu accepts a trigger style');
  assert.ok(share.includes("buttonClassName = 'ghost'"), 'reels and plans keep the ghost share button');
});

test('audit round Nov 17: destination price below the photo; the cheapest-fares strip is gone, merged into Deals (UX direction, Nov 19 2026 — P0-7)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  // Photos are 4:3 everywhere a card shows one — the 180px strips
  // cropped every photo the same way.
  assert.ok(css.includes('.card img{width:100%;aspect-ratio:4/3'), 'card photos are 4:3');
  assert.ok(css.includes('.photocarousel img{width:100%;aspect-ratio:4/3'), 'carousel photos are 4:3');
  assert.ok(css.includes('.card .img-fallback{aspect-ratio:4/3'), 'photo fallbacks are 4:3');
  // The fares strip is gone: its cheapest trips live in the Deals
  // band now, so no trip appears twice — no scroller, no chips.
  assert.ok(!css.includes('.fares-strip'), 'no fares-strip style remains');
  assert.ok(!css.includes('.fare-chip'), 'no fare-chip style remains');
  assert.ok(!css.includes('scroll-snap-type:x mandatory'), 'no horizontal scroller remains');
  assert.ok(!existsSync(new URL('../components/FaresStrip.tsx', import.meta.url)), 'the FaresStrip component is deleted');
});

test('audit round Nov 17: live-fares loading is one styled state, not three lines (UX direction, Nov 19 2026 — P0-8)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(css.includes('.results-loading{display:flex'), 'the loading state is a styled row');
  assert.ok(css.includes('.results-loading::after'), 'the loading state carries a shimmer bar');
  // One loading state: the per-source lines are gone; the results
  // bar above carries the single "Checking live fares…" line while
  // the first live data is still on its way.
  assert.ok(!results.includes('Checking live fares from Ignav'), 'no per-source Ignav loading line');
  assert.ok(!results.includes('Checking live fares from LetsFG'), 'no per-source LetsFG loading line');
  assert.ok(!results.includes('<p className="results-loading">Checking live fares…</p>'), 'no per-source Duffel loading line');
  assert.ok(results.includes("'Checking live fares…'"), 'one loading line remains, on the results bar');
  assert.ok(!results.includes("&& <p>Checking live fares"), 'no bare loading line remains');
});

test('audit round Nov 17: the footer is one 4-column grid, no link farm, no repeated trust strip', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  // The 4-column grid stays (Book / Company / Help / Account).
  assert.ok(css.includes('.footer-cols{display:grid;grid-template-columns:repeat(4,1fr)'), 'the footer keeps its 4-column grid');
  assert.ok(css.includes('footer{border-top:1px solid var(--line);padding:48px 0 32px'), 'the footer is a surface-1 band');
  // The hub is one link per destination — the 42 repeated category
  // links are gone (the Book column already links the 7 categories).
  assert.ok(app.includes('aria-label="Top destinations"'), 'the hub lists top destinations');
  assert.ok(!app.includes('aria-label="Top destinations by category"'), 'the per-category hub is gone');
  assert.ok(!app.includes('/?tab=${t.id}&plan='), 'no destination × category link farm remains');
  assert.ok(css.includes('.footer-hub{display:flex;flex-wrap:wrap'), 'the hub is one row of links');
  assert.ok(!css.includes('.footer-hub-dest ul'), 'the hub list style is gone');
  // The trust strip is gone (UX direction round 2, Nov 21 2026 —
  // P0-4): the trust line lives once, inside the hero — never in
  // the footer, never as a standalone strip.
  assert.ok(!app.includes('trustStrip('), 'no trust strip renders anywhere');
  assert.ok(!app.includes('trust-strip'), 'no trust strip class remains');
  assert.equal((app.match(/hero-trust/g) || []).length, 1, 'the hero trust line renders exactly once');
});
