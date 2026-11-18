// Hero search matcher (TripAdvisor homepage build): suggestions come
// only from places FujinTrip already knows — the discovery routes and
// the global destinations — never invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heroSuggestions, seedForDestination } from '../lib/heroSearch.ts';
import { discoveryDestinations } from '../lib/discovery.ts';
import { GLOBAL_DESTINATIONS } from '../lib/data.ts';

test('heroSuggestions: a name prefix ranks first', () => {
  const s = heroSuggestions('kyo');
  assert.ok(s.length >= 1, 'Kyoto matches');
  assert.equal(s[0].name, 'Kyoto');
  assert.deepEqual(s[0].cities, ['Kyoto']);
});

test('heroSuggestions: a stop city matches its route', () => {
  const s = heroSuggestions('prague');
  const central = s.find((x) => x.name === 'Central Europe');
  assert.ok(central, 'Prague matches Central Europe');
  assert.ok(central.cities.includes('Prague'), 'the route carries Prague');
  assert.ok(central.detail.includes('Prague'), 'the detail names the stops');
});

test('heroSuggestions: a country matches its destinations', () => {
  const s = heroSuggestions('japan');
  assert.ok(s.some((x) => x.name === 'Kyoto'), 'Japan matches Kyoto');
});

test('heroSuggestions: no match returns nothing — never invents a place', () => {
  assert.deepEqual(heroSuggestions('zzzzzz'), []);
  assert.deepEqual(heroSuggestions('nowhereville'), []);
});

test('heroSuggestions: empty queries return nothing', () => {
  assert.deepEqual(heroSuggestions(''), []);
  assert.deepEqual(heroSuggestions('  '), []);
});

test('heroSuggestions: even one letter suggests — prefix first', () => {
  const s = heroSuggestions('k');
  assert.ok(s.length >= 1, 'k matches');
  assert.equal(s[0].name, 'Kyoto');
});

test('heroSuggestions: capped at the limit', () => {
  const s = heroSuggestions('a', 3);
  assert.equal(s.length, 3);
  assert.equal(heroSuggestions('a').length, 6, 'default cap is 6');
});

test('heroSuggestions: every suggestion is a place FujinTrip already knows', () => {
  const known = new Set([
    ...discoveryDestinations().map((d) => d.destination),
    ...GLOBAL_DESTINATIONS.map((d) => d.name),
  ]);
  for (const q of ['a', 'e', 'an', 'or', 'ky', 'ba', 'san']) {
    for (const s of heroSuggestions(q)) {
      assert.ok(known.has(s.name), `${s.name} is a known destination`);
      assert.ok(s.cities.length >= 1, `${s.name} carries cities`);
    }
  }
});

test('seedForDestination: a route seeds with its ordered stops', () => {
  assert.deepEqual(seedForDestination('Central Europe'), {
    destination: 'Central Europe',
    cities: ['Prague', 'Vienna', 'Budapest'],
  });
});

test('seedForDestination: a single city seeds with itself', () => {
  const seed = seedForDestination('Kyoto');
  assert.ok(seed, 'Kyoto seeds');
  assert.ok(seed.cities.includes('Kyoto'), 'Kyoto is in its own cities');
});

test('seedForDestination: an unknown name seeds as a bare destination', () => {
  // buildTripCard treats an unknown place as a single stop — the same
  // fallback the template cards use (cities ?? [name]) — so the chat
  // can still plan it instead of failing.
  assert.deepEqual(seedForDestination('Nowhereville'), {
    destination: 'Nowhereville',
    cities: ['Nowhereville'],
  });
});

test('audit round Nov 17: date fields never garble, search is a pill bar ending in a circular button', () => {
  const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const field = readFileSync(new URL('../components/PlaceField.tsx', import.meta.url), 'utf8');
  // No controlled native date/time input remains: a controlled one
  // reports '' mid-typing and React writing '' back clears the
  // in-progress segments ("mm/12/222026").
  assert.ok(!widget.includes('<input type="date"'), 'no controlled date input remains in the widget');
  assert.ok(!widget.includes('<input type="time"'), 'no controlled time input remains in the widget');
  assert.ok(widget.includes('function DateField({'), 'date/time fields go through DateField');
  assert.ok(widget.includes('defaultValue={value}'), 'DateField is uncontrolled');
  assert.ok(widget.includes('if (el && el.value !== value) el.value = value;'), 'external changes sync through the ref');
  assert.ok(widget.includes('<DateField min={today || undefined} value={ret} onChange={setRet} ariaLabel="Return date" />'), 'the Return field uses DateField');
  // Expedia rebuild (Nov 17, 2026): the search is ONE pill bar — the
  // fields are segments, and the bar ends in a circular navy button,
  // magnifier only. The label stays in the HTML (visually hidden)
  // and in aria-label, so the button keeps its name. Multi-city
  // keeps the stacked leg editor with a full-width navy pill.
  assert.ok(widget.includes('<div className="sw-bar">'), 'the search is a pill bar');
  assert.ok(widget.includes('<div className="sw-multicity">'), 'multi-city keeps the stacked editor');
  assert.ok(widget.includes('<button type="submit" className="primary sw-search" aria-label={searchButtonLabel(tab)}>'), 'the search button exists, with its label as its accessible name');
  assert.ok(widget.includes('<span className="sw-search-text">{searchButtonLabel(tab)}</span>'), 'the button label stays in the HTML');
  const barAt = widget.indexOf('<div className="sw-bar">');
  const barButtonAt = widget.lastIndexOf('<button type="submit" className="primary sw-search" aria-label={searchButtonLabel(tab)}>');
  const formClose = widget.indexOf('</form>');
  assert.ok(barAt > 0 && barButtonAt > barAt && barButtonAt < formClose, 'the circular button ends the pill bar');
  assert.ok(css.includes('.sw-bar .sw-search{flex:0 0 auto;width:56px;height:56px;min-height:56px;border-radius:50%;padding:0;margin:0 0 0 8px}'), 'the bar button is a 56px circle');
  assert.ok(css.includes('.sw-multicity .sw-search{width:100%}'), 'the multi-city button is full-width');
  // The type-ahead opens its listbox as soon as a fetch starts, so
  // a slow source shows "Searching…" instead of looking dead.
  assert.ok(field.includes('setOpen(true);\n    timerRef.current = setTimeout'), 'the listbox opens when the fetch starts');
});

test('one-way flights: a stale return never blocks the search with a return-date verdict (Nov 17 2026)', () => {
  const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
  // The generic validation block gates both return checks on
  // one-way: the return field is hidden for one-way, but the state
  // still holds the stale date from a round-trip switch or a deep
  // link, and the submit drops it — so validation must not judge it.
  assert.ok(widget.includes("const hasReturn = !(tab === 'flights' && tripType === 'oneway');"), 'one-way has no return');
  assert.ok(widget.includes('if (hasReturn && ret && ret < now)'), 'the past-return verdict is gated on one-way');
  assert.ok(widget.includes('if (hasReturn && depart && ret && ret < depart)'), 'the before-departure verdict is gated on one-way');
  assert.ok(widget.includes("if (tab === 'flights' && tripType === 'oneway') q.ret = '';"), 'one-way still submits with no return');
});
