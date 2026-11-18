// Flights trip types (Nov 15, 2026): one-way / round-trip /
// multi-city in the search form, the deep link, the price-check API
// and the results. Nothing here invents a fare, a leg, or a date —
// a bad leg drops, a bad type falls back to round-trip, and a
// one-way search never shows a return it did not ask for.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/flightTripTypes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cheapestMultiCityTotal,
  cheapestOneWayTotal,
  cleanFlightLegs,
  emptySearchQuery,
  flightLegsFromParam,
  flightLegsFromSearch,
  flightLegsToParam,
  flightTripTypeFromValue,
  formValuesFromQuery,
  searchQueryFromParams,
  searchQueryToParams,
  searchRequestLabel,
} from '../lib/searchPlaces.ts';

const TODAY = '2026-11-15';

test('flightTripTypeFromValue: only the three real types win', () => {
  assert.equal(flightTripTypeFromValue('oneway'), 'oneway');
  assert.equal(flightTripTypeFromValue('roundtrip'), 'roundtrip');
  assert.equal(flightTripTypeFromValue('multicity'), 'multicity');
  assert.equal(flightTripTypeFromValue('Rocket'), 'roundtrip', 'junk falls back to round-trip');
  assert.equal(flightTripTypeFromValue(undefined), 'roundtrip');
  assert.equal(flightTripTypeFromValue(null), 'roundtrip');
});

test('searchQueryFromParams: one-way parses, and drops any return it carries', () => {
  const q = searchQueryFromParams(
    { tab: 'flights', type: 'oneway', from: 'New York', to: 'London', depart: '2027-01-15', return: '2027-01-22', travelers: '1', cabin: 'Economy' },
    TODAY
  );
  assert.ok(q, 'a one-way link parses');
  assert.equal(q?.tripType, 'oneway');
  assert.equal(q?.from, 'New York');
  assert.equal(q?.to, 'London');
  assert.equal(q?.depart, '2027-01-15');
  assert.equal(q?.ret, '', 'a one-way search has no return');
  assert.deepEqual(q?.legs, []);
  // Round-trip through the serializer.
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'one-way serialize then parse is the identity');
});

test('searchQueryFromParams: multi-city legs parse, mirror leg 1, round-trip cleanly', () => {
  const legs = 'New York|London|2027-01-15,London|Paris|2027-01-20,Paris|Rome|2027-01-25';
  const q = searchQueryFromParams({ tab: 'flights', type: 'multicity', legs, travelers: '2', cabin: 'Business' }, TODAY);
  assert.ok(q, 'a multi-city link parses');
  assert.equal(q?.tripType, 'multicity');
  assert.deepEqual(q?.legs, [
    { from: 'New York', to: 'London', depart: '2027-01-15' },
    { from: 'London', to: 'Paris', depart: '2027-01-20' },
    { from: 'Paris', to: 'Rome', depart: '2027-01-25' },
  ]);
  assert.equal(q?.from, 'New York', 'leg 1 mirrors onto from');
  assert.equal(q?.to, 'London', 'leg 1 mirrors onto to');
  assert.equal(q?.depart, '2027-01-15', 'leg 1 mirrors onto depart');
  assert.equal(q?.ret, '', 'a multi-city search has no return');
  assert.equal(q?.cabin, 'Business');
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'multi-city serialize then parse is the identity');
});

test('searchQueryFromParams: a round-trip link stays a round-trip, junk type falls back', () => {
  const q = searchQueryFromParams(
    { tab: 'flights', type: 'roundtrip', from: 'New York', to: 'London', depart: '2027-01-15', return: '2027-01-22' },
    TODAY
  );
  assert.equal(q?.tripType, 'roundtrip');
  assert.deepEqual(q?.legs, []);
  const back = searchQueryFromParams(Object.fromEntries(new URLSearchParams(searchQueryToParams(q))));
  assert.deepEqual(back, q, 'round-trip serialize then parse is the identity');
  const junk = searchQueryFromParams({ tab: 'flights', type: 'teleport', from: 'New York', to: 'London' }, TODAY);
  assert.equal(junk?.tripType, 'roundtrip', 'a junk type falls back to round-trip');
  assert.deepEqual(junk?.legs, []);
});

test('flightLegsFromParam / flightLegsToParam: the leg encoding round-trips, junk drops', () => {
  const legs = [
    { from: 'New York', to: 'London', depart: '2027-01-15' },
    { from: 'London', to: 'Paris', depart: '2027-01-20' },
  ];
  assert.equal(flightLegsToParam(legs), 'New York|London|2027-01-15,London|Paris|2027-01-20');
  assert.deepEqual(flightLegsFromParam(flightLegsToParam(legs), TODAY), legs);
  // A leg with a bad date or an empty end drops; fewer than 2 clean
  // legs is not a multi-city search.
  assert.deepEqual(flightLegsFromParam('New York|London|not-a-date,London|Paris|2027-01-20', TODAY), []);
  assert.deepEqual(flightLegsFromParam('New York||2027-01-15,London|Paris|2027-01-20', TODAY), []);
  assert.deepEqual(flightLegsFromParam('', TODAY), []);
  assert.deepEqual(flightLegsFromParam('garbage', TODAY), []);
  // A past leg drops; the survivors must still be 2+ to count.
  assert.deepEqual(
    flightLegsFromParam('New York|London|2026-11-01,London|Paris|2027-01-20,Paris|Rome|2027-01-25', TODAY),
    [
      { from: 'London', to: 'Paris', depart: '2027-01-20' },
      { from: 'Paris', to: 'Rome', depart: '2027-01-25' },
    ],
    'the past leg drops, the rest stand'
  );
  assert.deepEqual(
    flightLegsFromParam('New York|London|2026-11-01,London|Paris|2027-01-20', TODAY),
    [],
    'one survivor is not a multi-city search'
  );
});

test('cleanFlightLegs: 2–4 legs, capped, in order', () => {
  const five = [
    { from: 'A', to: 'B', depart: '2027-01-01' },
    { from: 'B', to: 'C', depart: '2027-01-02' },
    { from: 'C', to: 'D', depart: '2027-01-03' },
    { from: 'D', to: 'E', depart: '2027-01-04' },
    { from: 'E', to: 'F', depart: '2027-01-05' },
  ];
  assert.equal(cleanFlightLegs(five).length, 4, 'five legs cap at four');
  assert.equal(cleanFlightLegs(five.slice(0, 2)).length, 2);
  assert.deepEqual(cleanFlightLegs(five.slice(0, 1)), [], 'one leg is not a multi-city search');
  assert.deepEqual(cleanFlightLegs('not-an-array'), []);
  assert.deepEqual(cleanFlightLegs([{ from: '', to: 'B', depart: '2027-01-01' }, { from: 'B', to: 'C', depart: '2027-01-02' }]), []);
});

test('searchQueryFromParams: multi-city with fewer than 2 clean legs falls back to the round-trip the link describes', () => {
  const q = searchQueryFromParams(
    { tab: 'flights', type: 'multicity', legs: 'New York|London|2027-01-15', from: 'New York', to: 'London', depart: '2027-01-15', return: '2027-01-22' },
    TODAY
  );
  assert.equal(q?.tripType, 'roundtrip', 'one clean leg is not a multi-city search');
  assert.deepEqual(q?.legs, []);
  assert.equal(q?.from, 'New York', 'the route survives the fallback');
  assert.equal(q?.ret, '2027-01-22', 'the round-trip return survives the fallback');
});

test('formValuesFromQuery: the widget fields carry the trip type and the legs', () => {
  const multi = formValuesFromQuery({
    ...emptySearchQuery('flights'),
    tripType: 'multicity',
    legs: [
      { from: 'New York', to: 'London', depart: '2027-01-15' },
      { from: 'London', to: 'Paris', depart: '2027-01-20' },
    ],
    from: 'New York',
    to: 'London',
    depart: '2027-01-15',
  });
  assert.equal(multi.tripType, 'multicity');
  assert.equal(multi.legs.length, 2);
  assert.equal(multi.place, 'London');
  const one = formValuesFromQuery({ ...emptySearchQuery('flights'), tripType: 'oneway', from: 'New York', to: 'London', depart: '2027-01-15' });
  assert.equal(one.tripType, 'oneway');
  assert.deepEqual(one.legs, []);
  const round = formValuesFromQuery(null);
  assert.equal(round.tripType, 'roundtrip', 'no query is a round-trip');
  assert.deepEqual(round.legs, []);
});

test('flightLegsFromSearch: legs only for a multi-city search', () => {
  const legs = [
    { from: 'New York', to: 'London', depart: '2027-01-15' },
    { from: 'London', to: 'Paris', depart: '2027-01-20' },
  ];
  assert.deepEqual(flightLegsFromSearch({ ...emptySearchQuery('flights'), tripType: 'multicity', legs }), legs);
  assert.deepEqual(flightLegsFromSearch({ ...emptySearchQuery('flights'), tripType: 'oneway', legs }), []);
  assert.deepEqual(flightLegsFromSearch({ ...emptySearchQuery('flights'), tripType: 'roundtrip', legs }), []);
  assert.deepEqual(flightLegsFromSearch({ ...emptySearchQuery('flights'), tripType: 'multicity', legs: [] }), []);
});

test('cheapestOneWayTotal: the cheapest visible outbound fare, or nothing', () => {
  const out = [
    { airline: 'Cheap', price: 218, currency: 'USD', stops: 0, duration: '7h 5m' },
    { airline: 'Pricey', price: 300, currency: 'USD', stops: 0, duration: '7h 5m' },
  ];
  assert.equal(cheapestOneWayTotal(out), 218);
  assert.equal(cheapestOneWayTotal(out.slice(1)), 300, 'a filtered-out cheapest is not quoted');
  assert.equal(cheapestOneWayTotal([]), 0, 'no fares, no total');
});

test('cheapestMultiCityTotal: the cheapest fare of each leg, summed — or nothing', () => {
  const legs = [
    { out: [{ airline: 'A', price: 218, currency: 'USD', stops: 0, duration: '7h' }] },
    { out: [{ airline: 'B', price: 150, currency: 'USD', stops: 0, duration: '2h' }, { airline: 'C', price: 200, currency: 'USD', stops: 0, duration: '2h' }] },
  ];
  assert.equal(cheapestMultiCityTotal(legs), 368, '218 + 150');
  assert.equal(cheapestMultiCityTotal([{ out: [] }, legs[1]]), 0, 'a leg with no fare breaks the trip total');
  assert.equal(cheapestMultiCityTotal([]), 0, 'no legs, no total');
});

test('searchRequestLabel: the saved request names the trip type', () => {
  const multi = searchRequestLabel({
    ...emptySearchQuery('flights'),
    tripType: 'multicity',
    legs: [
      { from: 'New York', to: 'London', depart: '2027-01-15' },
      { from: 'London', to: 'Paris', depart: '2027-01-20' },
    ],
    travelers: 2,
    cabin: 'Economy',
  });
  assert.equal(multi, 'Flights: New York → London · London → Paris · 2027-01-15, 2027-01-20 · 2 travelers · Economy');
  const one = searchRequestLabel({
    ...emptySearchQuery('flights'),
    tripType: 'oneway',
    from: 'New York',
    to: 'London',
    depart: '2027-01-15',
    travelers: 1,
    cabin: 'Business',
  });
  assert.equal(one, 'Flights: New York → London · 2027-01-15 · 1 traveler · Business');
  for (const label of [multi, one]) {
    assert.ok(!/book now|Book now|confirmed|paid/i.test(label), 'a saved request never claims a booking');
  }
});

test('trip-type control: a real radiogroup, keyboard-operable, with all three types', () => {
  const src = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('role="radiogroup"'), 'the trip-type control is a radiogroup');
  assert.ok(src.includes('role="radio"'), 'each trip type is a radio');
  assert.ok(src.includes('aria-checked={value === t.id}'), 'the selected type is announced');
  assert.ok(src.includes('aria-label="Trip type"'), 'the group is labeled');
  for (const label of ['Round-trip', 'One-way', 'Multi-city']) {
    assert.ok(src.includes(label), `the control offers ${label}`);
  }
  assert.ok(src.includes('Add another flight'), 'a multi-city search can add a leg');
  assert.ok(src.includes('Remove leg'), 'a multi-city leg can be removed');
  assert.ok(src.includes('MAX_FLIGHT_LEGS'), 'the leg count is capped');
  assert.ok(src.includes("tripType === 'oneway'") || src.includes('tripType === "oneway"'), 'one-way is a real branch');
  assert.ok(!src.includes('>Book now<'), 'no rendered Book now button in the widget');
});

test('one-way form: the return field is hidden, not disabled-and-visible', () => {
  const src = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  // The Return field renders only for round-trip — a one-way form has
  // no return input at all in the tree.
  assert.ok(src.includes("tripType === 'roundtrip' &&"), 'the Return field is gated on round-trip');
  const retField = src.match(/tripType === 'roundtrip' && \([\s\S]*?<Field label="Return"/);
  assert.ok(retField, 'the Return field lives inside the round-trip gate');
  // No *field* is disabled-and-visible: the one-way form hides the
  // return instead of disabling it. Stepper buttons disable at their
  // bounds (a clamped stepper, not a hidden field) — that is the
  // honest disabled, so the check names inputs and selects only.
  assert.ok(!/<(?:input|select)[^>]*\bdisabled\b/.test(src), 'no input or select in the widget is disabled');
});

test('modern form: Lucide icons inside the fields, an accent search button, 44px targets', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.sw-trip-type{grid-column:1/-1'), 'the trip-type control spans the field grid');
  assert.ok(css.includes('.sw-trip-type button{min-height:44px') || css.includes('min-height:44px;padding:0 16px'), 'trip-type segments are 44px targets');
  assert.ok(css.includes('.sw-trip-type button.selected{background:var(--accent-text)'), 'the selected segment is filled in the accent');
  assert.ok(css.includes('.sw-field-icon{position:absolute'), 'field icons sit inside the control');
  assert.ok(css.includes('.sw-field-control input,.sw-field-control select{padding-left:38px}'), 'text clears the field icon');
  assert.ok(css.includes('button.primary.sw-search{'), 'the search button names the full selector chain');
  assert.ok(css.includes('background:var(--accent-text)'), 'the search button is the accent');
  assert.ok(css.includes('min-height:56px'), 'the search button is large');
  assert.ok(css.includes('transition:transform 200ms ease,box-shadow 200ms ease'), 'the button micro-interaction is 150–300ms, transform only');
  assert.ok(css.includes('.flight-leg{border:1px solid var(--line)'), 'each multi-city leg is a card');
  assert.ok(css.includes('.flight-leg-add{'), 'an add-leg button exists');
  const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  assert.ok(widget.includes('icon="pin"'), 'place fields carry the pin icon');
  assert.ok(widget.includes('icon="calendar"'), 'date fields carry the calendar icon');
  assert.ok(widget.includes('icon="users"'), 'travelers carry the users icon');
  assert.ok(widget.includes('icon="ticket"'), 'cabin carries the ticket icon');
  assert.ok(widget.includes('<Icon name="search" size={20} />'), 'the search button carries the search icon');
  const icons = readFileSync(new URL('../components/icons.tsx', import.meta.url), 'utf8');
  for (const name of ['arrowLeftRight', 'route', 'plus']) {
    assert.ok(icons.includes(`${name}:`), `the icon set carries ${name}`);
  }
});

test('modern form: the new form stacks cleanly at 390px', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media(max-width:640px){', css.indexOf('.sw-trip-type')));
  assert.ok(mobile.includes('.sw-trip-type{width:100%}'), 'the trip-type control fills the phone width');
  assert.ok(mobile.includes('.sw-trip-type button{flex:1'), 'the three segments share the phone row');
  assert.ok(mobile.includes('.flight-leg{padding:12px}'), 'leg cards lose their desktop padding on a phone');
  assert.ok(css.includes('.sw-fields{grid-template-columns:1fr}'), 'fields stack to one column on a phone');
});

test('results: the fare columns follow the trip type — out only for one-way, per leg for multi-city', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes("tripType === 'oneway'"), 'one-way is a real results branch');
  assert.ok(src.includes("tripType === 'multicity'"), 'multi-city is a real results branch');
  assert.ok(src.includes('Cheapest all legs:'), 'multi-city quotes the summed cheapest total');
  assert.ok(src.includes('cheapestMultiCityTotal'), 'the multi-city total sums the cheapest fare of each leg');
  // Audit round Nov 17, 2026: one trip-card format — the round-trip
  // and one-way cheapest banners are gone (every card carries its
  // own trip total now), and every trip card has one action.
  assert.ok(!src.includes('Cheapest out + back:'), 'no round-trip cheapest banner below the list');
  assert.ok(!src.includes('Cheapest one-way:'), 'no one-way cheapest banner below the list');
  assert.ok(!src.includes('fare-total'), 'no highlighted cheapest banner remains');
  assert.ok(src.includes('TripPriceHeader'), 'one price block serves every trip card');
  assert.ok(src.includes('DuffelOneWayCard'), 'one-way Duffel fares render as trip cards, not bare fare cards');
  assert.ok(src.includes('Save this fare'), 'Duffel cards carry a save action');
  assert.ok(src.includes('flight-option-actions'), 'trip-card actions sit in one footer row');
  assert.ok(src.includes('Leg {i + 1}'), 'multi-city fares render per leg');
  assert.ok(src.includes("tripType === 'roundtrip' && pc?.departDate"), 'the cached competitor column stays round-trip only');
  assert.ok(!src.includes('>Book now<'), 'no rendered Book now button in the results');
});
