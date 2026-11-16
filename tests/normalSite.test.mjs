// Direction v3 search (Nov 14, 2026): the search widget's place
// autocomplete source, the search query (URL params in, results out),
// and the honest row sorting. Nothing here invents a place, a price,
// or a date — bad input falls back or drops, never guesses.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/normalSite.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(flightBudgetCopy('Economy'), { label: 'Plan flight budget', qualifier: 'planning estimate' });
  assert.deepEqual(flightBudgetCopy(undefined), { label: 'Plan flight budget', qualifier: 'planning estimate' });
  assert.deepEqual(flightBudgetCopy('Business'), {
    label: 'Plan flight budget (economy estimate)',
    qualifier: 'economy planning estimate',
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
  // Japan's stops include Kyoto, so the route resolves to Kyoto's photo.
  assert.ok(destinationPhoto('Japan')?.includes('photo-1493976040374-85c8e12f0c0e'), 'Japan resolves to a stop photo');
  // Central Europe's first stop is Prague, which has a per-city photo
  // (CITY_PHOTOS, Nov 14 2026) — the route resolves to it now.
  assert.ok(destinationPhoto('Central Europe')?.includes('Prague_07-2016'), 'Central Europe resolves to the Prague photo');
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

test('results heading clears the sticky bar (defect, Nov 14 2026)', () => {
  // After a search submits, the page scrolls to #results — without
  // scroll-margin the "Flights" heading slides underneath the sticky
  // header + sticky results bar. The rule lives in globals.css; the
  // value must clear 61px of header + ~50px of bar + margin.
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const m = css.match(/#results\{scroll-margin-top:(\d+)px\}/);
  assert.ok(m, '#results has a scroll-margin-top rule');
  assert.ok(Number(m[1]) >= 120, `scroll-margin-top clears header + bar, got ${m[1]}px`);
});

test('results map stays below the sticky bar (defect, Nov 14 2026)', () => {
  // While scrolling with the results map open, Leaflet map layers
  // rendered OVER the sticky search-summary bar: Leaflet panes sit at
  // z-index 200–1000, the bar at 40. The fix is stacking only — the
  // map container (.discover-map) is its own stacking context at
  // z-index 0, so every map layer (Leaflet panes and MapLibre
  // markers alike) paints below the sticky results bar (40) and the
  // sticky site header (60). The map itself is untouched.
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const m = css.match(/\.discover-map\{[^}]*z-index:\s*(\d+)/);
  assert.ok(m, '.discover-map has a z-index rule');
  assert.equal(Number(m[1]), 0, 'the map container sits at z-index 0');
  assert.ok(/\.discover-map\{[^}]*position:\s*relative/.test(css), '.discover-map is positioned (so z-index applies)');
  const bar = css.match(/\.results-bar\{[^}]*z-index:\s*(\d+)/);
  assert.ok(bar && Number(bar[1]) > Number(m[1]), 'the sticky results bar paints above the map container');
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

test('mobile: the sticky results bar clears the taller phone header', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(/\.results-bar\{position:sticky;top:61px/.test(css), 'desktop results bar clears the 60px header');
  assert.ok(css.includes('.results-bar{top:65px}'), 'results bar clears the 64px phone header (44px hamburger)');
  assert.ok(css.includes('.results-bar{top:61px}'), 'results bar clears the 60px header at ≤640px');
});

test('mobile: phone rules — no zoom, no horizontal scroll, wrapping bar, fitting header', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('Mobile layout (Nov 15'));
  assert.ok(mobile.length > 0, 'the mobile block exists');
  assert.ok(mobile.includes('input,select,textarea{font-size:16px}'), '16px form fields at ≤640px — iOS never zooms on focus');
  assert.ok(mobile.includes('body{overflow-x:clip}'), 'no horizontal scroll on a phone');
  assert.ok(mobile.includes('.results-bar{flex-wrap:wrap'), 'the results bar wraps on a phone');
  assert.ok(mobile.includes('#results{scroll-margin-top:170px}'), 'the scroll target clears the wrapped results bar');
  assert.ok(mobile.includes('.site-theme{padding:10px 12px}'), 'the header fits a 360px phone');
  assert.ok(mobile.includes('.chatmap-s0 .hero-input{flex-wrap:wrap}'), 'the S0 input stacks on a narrow phone');
});

test('mobile: the filter checkbox still sits next to its label (defect, Nov 15 2026)', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(/\.filter-check input\{flex:none/.test(css), 'filter checkboxes keep their natural size, so the label sits next to them');
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
  // and when it was checked.
  assert.ok(src.includes('fare-card-source'), 'each fare carries its small source tag');
  assert.ok(src.includes("sourceLabel={duffelTag}"), 'Duffel fares carry their tag');
  assert.ok(src.includes("sourceLabel={ignavTag}"), 'Ignav fares carry their tag');
  assert.ok(src.includes("'Duffel · test fare'"), 'test fares are named as test fares on the card');
  assert.ok(src.includes('ignavSourceTag('), 'Ignav fares carry the checked time');
  // The cached comparison block stays, below the live list.
  assert.ok(src.includes('Other sites (cached)'), 'the cached column survives as a standalone block');
  assert.ok(src.includes('<section className="fare-block" aria-label="Other sites (cached)">'), 'the cached block is a section, not a source column');
  assert.ok(!src.includes('Mystifly'), 'no fares from a source that is not connected yet');
  assert.ok(!src.includes('Etraveli'), 'no fares from a source that is not connected yet');
  assert.ok(src.includes('/api/ignav-fares'), 'the Ignav fares fetch from the Ignav route');
  assert.ok(src.includes('IgnavBookingLinks'), 'Ignav fares carry on-click booking options');
  assert.ok(src.includes('fare-total'), 'the cheapest out + back total is a highlighted block');
  assert.ok(src.includes('Clear filters'), 'a filtered-empty list has a way back');
  // "Book now" appears in the file header and in the comment explaining
  // why the "Book-now read" line is NOT rendered — neither is a
  // rendered button. The check is for a rendered Book now action.
  assert.ok(!src.includes('>Book now<'), 'no rendered Book now button in the results');
  assert.ok(!src.includes("primary") || src.includes('Save this search'), 'the primary action is Save this search');
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
    '.pkg-card--hero',
    '.pkg-photo',
    '.pkg-body',
    '.pkg-price',
    '.pkg-includes',
    '.pkg-tiers',
    '.pkg-actions',
    '.fares-strip',
    '.fare-chip',
    '.deals-grid',
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
  assert.ok(Number(price[1]) >= 28, `card price ${price[1]}px is loud (≥28px)`);
  const bodyH3 = css.match(/\.pkg-body h3\{[^}]*font-size:(\d+)px/);
  assert.ok(bodyH3 && Number(price[1]) > Number(bodyH3[1]), 'price larger than the card title');
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

test('restructure: the header, the widget tabs and the category tiles share one icon key per category', () => {
  const icons = readFileSync(new URL('../components/icons.tsx', import.meta.url), 'utf8');
  for (const t of ['flights', 'hotels', 'cars', 'tours', 'cruises', 'buses', 'taxis']) {
    assert.ok(icons.includes(`${t}:`), `TAB_ICONS covers ${t}`);
  }
  const fujinApp = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  assert.ok(fujinApp.includes('<Icon name={t.icon} size={26} />'), 'category tiles render the shared key');
  const header = readFileSync(new URL('../components/SiteHeader.tsx', import.meta.url), 'utf8');
  assert.ok(header.includes('<Icon name={t.icon} size={15} />'), 'header nav renders the shared key');
  const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  assert.ok(widget.includes('<Icon name={t.icon} size={16} />'), 'widget tabs render the shared key');
});

test('restructure: fonts are Inter + DM Sans — DM Sans display, Inter body, no Bricolage', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.ok(layout.includes('DM_Sans'), 'display font is DM Sans');
  assert.ok(layout.includes('Inter'), 'body font is Inter');
  assert.ok(!layout.includes('Bricolage_Grotesque'), 'Bricolage Grotesque is dropped');
  assert.ok(!layout.includes('JetBrains_Mono'), 'no JetBrains Mono — prices use Inter tabular-nums');
  assert.ok(!layout.includes('Plus_Jakarta_Sans'), 'no display-font swap to Plus Jakarta Sans');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(!css.includes('Plus Jakarta Sans'), 'no Plus Jakarta Sans fallback in the CSS');
  assert.ok(!css.includes('Bricolage'), 'no Bricolage fallback in the CSS');
  assert.ok(!css.includes('JetBrains'), 'no JetBrains fallback in the CSS');
  assert.ok(css.includes("--font-display:'DM Sans'"), 'the display token is DM Sans');
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
  assert.ok(mobile.includes('.pkg-grid,.deals-grid{grid-template-columns:1fr}'), 'package + deals grids collapse to one column');
  assert.ok(mobile.includes('.pkg-card--hero{grid-column:auto}'), 'the hero card stops spanning on a phone');
  assert.ok(css.includes('.fares-strip{display:flex'), 'the fares strip scrolls horizontally on a phone');
  assert.ok(css.includes('.pkg-actions button{min-height:44px'), 'package actions are 44px touch targets');
});
