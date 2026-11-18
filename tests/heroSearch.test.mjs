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

test('audit round Nov 17: date fields never garble, search button sits in the grid', () => {
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
  // The search button is the last cell of the fields grid, level
  // with the inputs — not a lone button below a half-empty row.
  assert.ok(widget.includes('<button type="submit" className="primary sw-search">'), 'the search button exists');
  const gridClose = widget.indexOf('</div>\n      </form>');
  const buttonAt = widget.indexOf('<button type="submit" className="primary sw-search">');
  assert.ok(buttonAt > 0 && buttonAt < gridClose, 'the search button sits inside the fields grid');
  assert.ok(css.includes('.sw-fields .sw-search{margin-top:0;align-self:end;min-height:48px;width:100%}'), 'the grid button aligns with the inputs');
  // The type-ahead opens its listbox as soon as a fetch starts, so
  // a slow source shows "Searching…" instead of looking dead.
  assert.ok(field.includes('setOpen(true);\n    timerRef.current = setTimeout'), 'the listbox opens when the fetch starts');
});
