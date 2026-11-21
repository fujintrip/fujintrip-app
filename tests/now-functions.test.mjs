// Roadmap "now" functions (Nov 21, 2026): saved trips / wishlist,
// "Everywhere" inspiration search, real-reviews trust. Unit tests
// for the data layer. Run: node --no-warnings --import
// ./tests/register-loader.mjs --test tests/now-functions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fareSavedKey,
  packageSavedKey,
  tripSavedKey,
  savedPriceKindLabel,
  savedDetailLine,
  savedLabel,
  isSavedDetail,
} from '../lib/savedTrips.ts';
import { cheapestDestinations, discoveryDestinations, priceFor } from '../lib/discovery.ts';

const validFare = {
  key: fareSavedKey({ source: 'Ignav', from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-17', travelers: 2, total: 1857, airline: 'British Airways' }),
  kind: 'fare',
  destination: 'London',
  source: 'Ignav',
  priceKind: 'live',
  total: 1857,
  perTraveler: 929,
  travelers: 2,
  route: 'New York → London',
  dates: '2026-12-10 – 2026-12-17',
  checkedAt: '2026-11-21T15:00:00.000Z',
};

test('fare key: the same fare is the same key, a different fare is not', () => {
  const args = { source: 'Ignav', from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-17', travelers: 2, total: 1857, airline: 'British Airways' };
  assert.equal(fareSavedKey(args), fareSavedKey(args), 'stable across calls');
  assert.notEqual(fareSavedKey(args), fareSavedKey({ ...args, total: 1900 }), 'a different total is a different fare');
  assert.notEqual(fareSavedKey(args), fareSavedKey({ ...args, airline: 'Virgin Atlantic' }), 'two airlines at the same total are two different fares');
  assert.notEqual(fareSavedKey(args), fareSavedKey({ ...args, source: 'LetsFG' }), 'a different source is a different fare');
  assert.notEqual(fareSavedKey(args), fareSavedKey({ ...args, ret: '2026-12-18' }), 'different dates are a different fare');
});

test('package and trip keys: same trip and price is the same key', () => {
  assert.equal(packageSavedKey('Thailand', 1250), packageSavedKey('Thailand', 1250));
  assert.notEqual(packageSavedKey('Thailand', 1250), packageSavedKey('Thailand', 950), 'Bali is not Thailand — a different price is a different save');
  assert.notEqual(packageSavedKey('Thailand', 1250), packageSavedKey('Japan', 1250), 'a different destination is a different save');
  assert.equal(tripSavedKey('Portugal', 1150), tripSavedKey('Portugal', 1150));
  assert.notEqual(tripSavedKey('Portugal', 1150), packageSavedKey('Portugal', 1150), 'a trip save and a package save are distinct');
});

test('price-kind labels never dress a test fare or an estimate up as live', () => {
  assert.equal(savedPriceKindLabel('live'), 'Live fare');
  assert.ok(savedPriceKindLabel('test').includes('not bookable'), 'a test fare says so');
  assert.equal(savedPriceKindLabel('estimate'), 'Planning estimate');
});

test('saved detail line: source, kind, totals and checked date — nothing invented', () => {
  const line = savedDetailLine(validFare);
  assert.ok(line.includes('Ignav'), 'names the source');
  assert.ok(line.includes('Live fare'), 'names the kind');
  assert.ok(line.includes('$1,857 total'), 'the party total');
  assert.ok(line.includes('$929 per traveler'), 'the per-traveler figure');
  assert.ok(line.includes('2026-12-10'), 'the dates');
  assert.ok(line.includes('Nov 21, 2026'), 'when it was checked');
  const testLine = savedDetailLine({ ...validFare, priceKind: 'test', source: 'Duffel' });
  assert.ok(testLine.includes('Test fare'), 'a saved test fare keeps its warning');
  assert.ok(!testLine.includes('Live fare'), 'and never reads as live');
});

test('saved labels carry the price kind, so a saved test fare never reads as a deal', () => {
  assert.ok(savedLabel(validFare).includes('New York → London'));
  assert.ok(savedLabel(validFare).includes('Live fare'));
  const estimate = { ...validFare, kind: 'trip', priceKind: 'estimate', source: 'FujinTrip planner' };
  assert.ok(savedLabel(estimate).includes('Planning estimate'));
  assert.ok(savedLabel(estimate).includes('per traveler'));
});

test('isSavedDetail: the writers’ shape passes, corrupt or foreign values do not', () => {
  assert.equal(isSavedDetail(validFare), true);
  assert.equal(isSavedDetail(null), false);
  assert.equal(isSavedDetail('fare'), false);
  assert.equal(isSavedDetail({ ...validFare, key: '' }), false, 'an empty key is not a save');
  assert.equal(isSavedDetail({ ...validFare, kind: 'hotel' }), false, 'an unknown kind is not a save');
  assert.equal(isSavedDetail({ ...validFare, total: 0 }), false, 'a zero total is not a save');
  assert.equal(isSavedDetail({ ...validFare, priceKind: 'deal' }), false, 'an invented price kind is not a save');
  assert.equal(isSavedDetail({ ...validFare, checkedAt: 'yesterday' }), false, 'an unparseable check time is not a save');
  assert.equal(isSavedDetail({ ...validFare, travelers: 0 }), false);
  const { dates, route, ...noOptional } = validFare;
  void dates;
  void route;
  assert.equal(isSavedDetail(noOptional), true, 'route and dates are optional');
});

// --- "Everywhere" inspiration search (F2) --------------------------

test('cheapestDestinations: cheapest first, per traveler, only real planner prices', () => {
  const list = cheapestDestinations(10);
  assert.ok(list.length > 0, 'the planner has priced trips');
  assert.ok(list.length <= 10, 'the requested count is a cap');
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].perTraveler >= list[i - 1].perTraveler, 'cheapest first');
  }
  const names = list.map((l) => l.destination);
  assert.equal(new Set(names).size, names.length, 'no destination twice');
  for (const l of list) {
    assert.ok(l.total > 0 && l.perTraveler > 0, 'every price is a real positive total');
    assert.equal(l.perTraveler, Math.round(l.total / 2), 'per traveler is the 2-traveler total halved');
    assert.equal(l.total, priceFor(l.destination), 'the total is the planner’s price for that destination');
    assert.ok(typeof l.tag === 'string' && l.tag.length > 0, 'every trip carries its tag');
  }
});

test('cheapestDestinations: the cheapest trip is the planner’s cheapest priced destination', () => {
  const priced = discoveryDestinations()
    .map((e) => ({ destination: e.destination, total: priceFor(e.destination) }))
    .filter((x) => x.total !== null)
    .sort((a, b) => a.total - b.total);
  const list = cheapestDestinations(10);
  assert.equal(list[0].destination, priced[0].destination, 'the list starts at the planner’s cheapest');
  assert.equal(list[0].total, priced[0].total);
  assert.deepEqual(cheapestDestinations(3), list.slice(0, 3), 'a shorter list is a prefix of the longer one');
  assert.deepEqual(cheapestDestinations(0), [], 'zero asks for none');
  assert.deepEqual(cheapestDestinations(1000).length, priced.length, 'asking for more than exists returns all priced trips, never a guess');
});

test('cheapestDestinations: deterministic — the same list every call', () => {
  assert.deepEqual(cheapestDestinations(10), cheapestDestinations(10));
});

// --- Wiring: the entry points exist where the build put them --------

const widgetSrc = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');
const placeFieldSrc = readFileSync(new URL('../components/PlaceField.tsx', import.meta.url), 'utf8');
const resultsSrc = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
const reelsStoreSrc = readFileSync(new URL('../lib/reelsStore.ts', import.meta.url), 'utf8');
const reelsFeedSrc = readFileSync(new URL('../components/ReelsFeed.tsx', import.meta.url), 'utf8');

test('Everywhere entry point: the flights To field pins Everywhere', () => {
  assert.ok(widgetSrc.includes("name: 'Everywhere'"), 'the widget pins an Everywhere suggestion');
  assert.ok(widgetSrc.includes('value: \'Everywhere\''), 'selecting it searches for Everywhere');
  assert.ok(widgetSrc.includes('pinned={'), 'the flights To field passes the pinned list');
  assert.ok(placeFieldSrc.includes('pinned?: PlaceSuggestion[]'), 'PlaceField takes a pinned list');
  assert.ok(placeFieldSrc.includes('const shown = [...(pinned ?? []), ...suggestions]'), 'pinned items lead the listbox');
});

test('Everywhere results: a destination-less search shows the planner’s cheapest trips, never a live-fare fetch', () => {
  assert.ok(resultsSrc.includes("query.to === 'Everywhere'"), 'the branch keys on To = Everywhere');
  assert.ok(resultsSrc.includes('cheapestDestinations(10)'), 'the list comes from the planner’s cheapest trips');
  assert.ok(resultsSrc.includes('Cheapest trips from'), 'the heading names the origin');
  assert.ok(resultsSrc.includes('not a live fare'), 'every price is labeled a planning estimate, never a live fare');
});

test('reels trust: the seed is always merged in, and the feed reports a count only after a successful load', () => {
  assert.ok(reelsStoreSrc.includes('for (const seed of REELS_SEED)'), 'the seed is merged in even when a data file exists');
  assert.ok(reelsStoreSrc.includes('seedMediaFor'), 'a dead local-dev media URL falls back to the seed media');
  assert.ok(reelsFeedSrc.includes('loadedOk'), 'the feed tracks whether the last load succeeded');
  assert.ok(reelsFeedSrc.includes('if (loadedOk && !loading) onCount?.(posts.length)'), 'the count is reported only after a successful load');
});
