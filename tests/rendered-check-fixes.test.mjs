// Rendered-check fixes (Nov 21, 2026): the defects the Nov 21
// ~11:35 rendered check of fujintrip.com found, verified in code
// and fixed — each test pins the fixed behavior so it cannot
// regress silently. Run: node --no-warnings --import
// ./tests/register-loader.mjs --test tests/rendered-check-fixes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalAirlineName, flightBreakdownParts } from '../lib/duffel.ts';
import { countFlightCards } from '../lib/flightOptions.ts';
import { ignavItineraryMatches } from '../lib/ignav.ts';
import { letsfgItineraryMatches } from '../lib/letsfg.ts';
import { liveFilterOptions, searchQueryFromParams } from '../lib/searchPlaces.ts';

const root = new URL('..', import.meta.url).pathname;
const searchResultsSrc = readFileSync(join(root, 'components/SearchResults.tsx'), 'utf8');
const fujinChatSrc = readFileSync(join(root, 'components/FujinChat.tsx'), 'utf8');
const fujinAppSrc = readFileSync(join(root, 'components/FujinApp.tsx'), 'utf8');
const searchWidgetSrc = readFileSync(join(root, 'components/SearchWidget.tsx'), 'utf8');
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

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

// --- (b) canonical airline names ----------------------------------------

test('(b) canonicalAirlineName: one carrier, one name, whatever the supplier calls it', () => {
  assert.equal(canonicalAirlineName('ITA'), 'ITA Airways');
  assert.equal(canonicalAirlineName('TAP'), 'TAP Air Portugal');
  assert.equal(canonicalAirlineName('TAP AIR PORTUGAL'), 'TAP Air Portugal');
  assert.equal(canonicalAirlineName('ITA AIRWAYS'), 'ITA Airways');
  assert.equal(canonicalAirlineName('TAP Air Portugal'), 'TAP Air Portugal');
  assert.equal(canonicalAirlineName('Tap Air Portugal'), 'TAP Air Portugal', 'TAP is the brand acronym — it stays caps, like SAS');
  assert.equal(canonicalAirlineName('ITA Airways'), 'ITA Airways');
  assert.equal(canonicalAirlineName('British Airways'), 'British Airways');
  assert.equal(canonicalAirlineName('BRITISH AIRWAYS'), 'British Airways');
  assert.equal(canonicalAirlineName('SAS'), 'SAS', 'a short all-caps code stays a code');
  assert.equal(canonicalAirlineName('LUFTHANSA'), 'Lufthansa');
  assert.equal(canonicalAirlineName(''), '');
  assert.equal(canonicalAirlineName(canonicalAirlineName('TAP AIR PORTUGAL')), 'TAP Air Portugal', 'idempotent');
});

test('(b) liveFilterOptions: "ITA" and "ITA Airways" are one facet, not two', () => {
  const opts = liveFilterOptions({
    shownOffers: [offer('ITA', 0, 650, 440), offer('ITA Airways', 0, 660, 450)],
    shownItineraries: [itinerary(1700, [offer('TAP AIR PORTUGAL', 1, 700, 1700), offer('Tap Air Portugal', 1, 1300, 1700)])],
    allOffers: [offer('ITA', 0, 650, 440), offer('ITA Airways', 0, 660, 450)],
    allItineraries: [itinerary(1700, [offer('TAP AIR PORTUGAL', 1, 700, 1700), offer('Tap Air Portugal', 1, 1300, 1700)])],
    totalVisible: 3,
    travelers: 1,
  });
  assert.ok(opts, 'options exist when offers are shown');
  assert.deepEqual(opts.airlines, ['ITA Airways', 'TAP Air Portugal'], 'each carrier once, canonical name');
  assert.equal(opts.counts.airlines['ITA Airways'], 2, 'both Duffel legs count under the one facet');
  assert.equal(opts.counts.airlines['ITA'], undefined, 'no bare-code facet survives');
  assert.equal(opts.counts.airlines['TAP Air Portugal'], 1, 'the two TAP legs are one trip');
  assert.equal(opts.counts.airlines['TAP AIR PORTUGAL'], undefined, 'no all-caps facet survives');
});

test('(b) countFlightCards: a pair flown by "ITA" out and "ITA Airways" back counts once', () => {
  const counts = countFlightCards(
    [
      {
        kind: 'duffel-pair',
        out: offer('ITA', 0, 650, 800),
        back: offer('ITA Airways', 0, 1100, 815),
        total: 1615,
        durationMinutes: 480,
        departMinutes: 650,
        key: 'pair-ita',
      },
    ],
    2
  );
  assert.equal(counts.airlines['ITA Airways'], 1, 'one card, one carrier');
  assert.equal(counts.airlines['ITA'], undefined, 'no split count for the code form');
});

test('(b) the airline filter matches on the canonical name on every source', () => {
  const itaLegs = [offer('ITA', 0, 650, 1615), offer('ITA Airways', 0, 1100, 1615)];
  assert.ok(ignavItineraryMatches(itinerary(1615, itaLegs), [], ['ITA Airways']), 'Ignav: filter "ITA Airways" matches a leg called "ITA"');
  assert.ok(!ignavItineraryMatches(itinerary(1615, itaLegs), [], ['British Airways']), 'Ignav: another carrier does not match');
  const tapLegs = [offer('TAP AIR PORTUGAL', 1, 500, 1700), offer('Tap Air Portugal', 1, 1200, 1700)];
  assert.ok(letsfgItineraryMatches(itinerary(1700, tapLegs), [], ['TAP Air Portugal']), 'LetsFG: filter "TAP Air Portugal" matches a leg called "TAP AIR PORTUGAL"');
});

// --- (f) the breakdown line ----------------------------------------------

test('(f) flightBreakdownParts: every card shows its breakdown, even for one traveler', () => {
  assert.deepEqual(
    flightBreakdownParts(1615, 1),
    ['$1,615 per traveler · 1 traveler'],
    'one traveler still gets a line — a missing line read as a missing price'
  );
  assert.deepEqual(
    flightBreakdownParts(1615, 2),
    ['$808 per traveler · 2 travelers'],
    'two travelers split the total'
  );
  assert.deepEqual(
    flightBreakdownParts(1615, 2, 35),
    ['$808 per traveler · 2 travelers', '+ $35 service fee per flight order'],
    'the Duffel fee sits on the line, separate, never hidden'
  );
  assert.deepEqual(
    flightBreakdownParts(900, 1, 35),
    ['$900 per traveler · 1 traveler', '+ $35 service fee per flight order'],
    'a 1-traveler Duffel card shows the per-traveler figure AND the fee, not the fee alone'
  );
  assert.equal(
    flightBreakdownParts(1615, 2).length,
    1,
    'a live Ignav/LetsFG card carries no fee part — it never had a FujinTrip fee'
  );
});

// --- (g) deep-link aliases -------------------------------------------------

test('(g) searchQueryFromParams: the check’s deep link runs the search', () => {
  const q = searchQueryFromParams(
    {
      tab: 'flights',
      origin: 'JFK',
      destination: 'LHR',
      date: '2026-12-10',
      returnDate: '2026-12-17',
      travelers: '2',
    },
    '2026-11-15'
  );
  assert.ok(q, 'the alias-named link parses instead of returning null');
  assert.equal(q?.tab, 'flights');
  assert.equal(q?.from, 'JFK');
  assert.equal(q?.to, 'LHR');
  assert.equal(q?.depart, '2026-12-10');
  assert.equal(q?.ret, '2026-12-17');
  assert.equal(q?.travelers, 2);
});

test('(g) searchQueryFromParams: the widget’s own names win when both are present', () => {
  const q = searchQueryFromParams(
    {
      tab: 'flights',
      from: 'New York',
      to: 'London',
      depart: '2027-01-15',
      return: '2027-01-22',
      origin: 'JFK',
      destination: 'LHR',
      date: '2027-02-01',
      returnDate: '2027-02-08',
      travelers: '2',
    },
    '2026-11-15'
  );
  assert.ok(q);
  assert.equal(q?.from, 'New York');
  assert.equal(q?.to, 'London');
  assert.equal(q?.depart, '2027-01-15');
  assert.equal(q?.ret, '2027-01-22');
});

// --- (a) the results copy, (e) the test-fare checkout gate -----------------

test('(a) "Showing the N cheapest" is one template literal, so the space cannot collapse', () => {
  assert.ok(
    searchResultsSrc.includes('`Showing the ${IGNAV_MAX_ITINERARIES} cheapest live trips from Ignav.`'),
    'the Ignav line keeps its spaces inside one string'
  );
  assert.ok(
    searchResultsSrc.includes('`Showing the ${LETSFG_MAX_ITINERARIES} cheapest live trips from LetsFG.`'),
    'the LetsFG line keeps its spaces inside one string'
  );
  assert.ok(
    !searchResultsSrc.includes('Showing the {IGNAV_MAX_ITINERARIES} cheapest'),
    'no JSX-interpolation form of the Ignav line survives'
  );
  assert.ok(
    !searchResultsSrc.includes('Showing the {LETSFG_MAX_ITINERARIES} cheapest'),
    'no JSX-interpolation form of the LetsFG line survives'
  );
});

test('(e) a Duffel test-fare card never renders a checkout link', () => {
  const gated = searchResultsSrc.match(/\{checkoutHref && !testFare && \(/g) ?? [];
  assert.equal(gated.length, 2, 'both Duffel cards (pair + one-way) gate checkout on !testFare');
  assert.ok(!searchResultsSrc.includes('{checkoutHref && ('), 'no ungated Duffel checkout link survives');
  assert.ok(searchResultsSrc.includes('Continue to checkout'), 'live fares keep their checkout link');
});

// --- (c) Edit search restores the current search ---------------------------

test('(c) Edit search restores the current query and its tab, then focuses the form', () => {
  assert.ok(fujinAppSrc.includes('setWidgetTab(search.tab)'), 'Edit switches the widget to the search’s tab');
  assert.ok(fujinAppSrc.includes('query: search'), 'Edit prefills the full current query, not just the destination');
  assert.ok(fujinAppSrc.includes("document.querySelector<HTMLElement>('#search-widget input')?.focus"), 'Edit focuses the form so it is visibly open');
  assert.ok(searchWidgetSrc.includes('prefill: { destination: string; nonce: number; query?: SearchQuery }'), 'the prefill carries a full query');
  assert.ok(searchWidgetSrc.includes('if (prefill.query) applyFormValues(formValuesFromQuery(prefill.query), prefill.query);'), 'a full-query prefill restores every field');
});

// --- (d) + (h) the chat form -----------------------------------------------

test('(d) the chat has no date fields anymore — the form left the chat, so the cramped chat date fields are gone', () => {
  // Chat rebuild (Nov 24, 2026): the chat is text-only now; the
  // 7-category SearchForm lives on the homepage/search, not inside
  // the chat. The rendered-check defect (date fields too narrow for
  // the full year) cannot recur in the chat — and the homepage pill
  // bar's date fields sit in flexible fields, never squeezed.
  assert.ok(!fujinChatSrc.includes('type="date"'), 'no date input survives in the chat');
  assert.ok(!fujinChatSrc.includes('minWidth: 180'), 'no minWidth-180 date-field fix survives in the chat');
  assert.ok(searchWidgetSrc.includes('function DateField'), 'the homepage pill bar still has its date fields');
  assert.ok(css.includes('.sw-bar .sw-field{flex:1 1 150px;min-width:150px'), 'the pill-bar fields flex wide enough for a full date');
});

test('(h) the search form’s From/To are PlaceFields with suggestions — in the pill bar, not the chat', () => {
  // Chat rebuild (Nov 24, 2026): SearchForm left the chat; the
  // From/To PlaceFields live in the homepage SearchWidget (the pill
  // bar) and nowhere else.
  assert.ok(!fujinChatSrc.includes('PlaceField'), 'the chat no longer imports PlaceField');
  assert.ok(searchWidgetSrc.includes("import PlaceField from './PlaceField';"), 'the pill bar imports PlaceField');
  assert.ok(searchWidgetSrc.includes('<PlaceField'), 'the pill bar renders PlaceField fields');
  assert.ok(searchWidgetSrc.includes('id="flights-from" label="Flying from"'), 'the From field keeps its label');
  assert.ok(searchWidgetSrc.includes('label="Flying to"'), 'the To field keeps its label');
  assert.ok(css.includes('.chat-place-wrap{position:relative;flex:1 1 160px;min-width:160px}'), 'the dropdown anchors to a positioned wrapper');
});
