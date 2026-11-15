// Direction v3 search (Nov 14, 2026): the search widget's place
// autocomplete source, the search query (URL params in, results out),
// and the honest row sorting. Nothing here invents a place, a price,
// or a date — bad input falls back or drops, never guesses.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/normalSite.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  destinationPhoto,
  emptySearchQuery,
  flightContextFromSearch,
  isKnownPlace,
  knownPlaceNames,
  rowIncludesPlace,
  searchButtonLabel,
  searchQueryFromParams,
  searchQueryToParams,
  searchRequestLabel,
  sortTabRows,
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
  // A bad tab falls back to Stays; a bad date drops; a bad cabin
  // falls back to Economy; a bad traveler count falls back to 2.
  const junk = searchQueryFromParams({
    tab: 'bogus',
    dest: 'Kyoto',
    depart: 'not-a-date',
    return: '2027-02-30',
    travelers: '99',
    cabin: 'Rocket',
  });
  assert.equal(junk?.tab, 'hotels');
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
