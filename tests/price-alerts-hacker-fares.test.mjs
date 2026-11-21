// Roadmap wave 4 (Nov 21, 2026): price alerts + DROPS on Ignav
// live fares (F5) and Hacker Fares (F13). Unit tests for the data
// layer. Run: node --no-warnings --import
// ./tests/register-loader.mjs --test tests/price-alerts-hacker-fares.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRICE_DROP_THRESHOLD,
  alertIsDrop,
  createPriceAlert,
  evaluatePriceAlert,
  isPriceAlert,
  isPriceDrop,
  priceAlertKey,
  priceAlertLine,
  priceDropPercent,
} from '../lib/priceAlerts.ts';
import { compareHackerFare, hackerFareLabel, hackerFareSavingsLine } from '../lib/hackerFares.ts';
import { countFlightCards, mergeFlightOptions } from '../lib/flightOptions.ts';

const alertArgs = {
  source: 'Ignav',
  priceKind: 'live',
  tripType: 'roundtrip',
  from: 'New York',
  to: 'London',
  depart: '2026-12-10',
  ret: '2026-12-17',
  travelers: 2,
  cabin: 'economy',
  total: 1615,
  checkedAt: '2026-11-21T15:00:00.000Z',
};

const validAlert = createPriceAlert(alertArgs);
assert.ok(validAlert, 'the fixture alert is created');

test('alert key: one alert per trip — same trip, same key; a different trip is not', () => {
  const key = priceAlertKey({ from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-17', travelers: 2, cabin: 'economy' });
  assert.equal(key, priceAlertKey({ from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-17', travelers: 2, cabin: 'economy' }), 'stable across calls');
  assert.notEqual(key, priceAlertKey({ from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-18', travelers: 2, cabin: 'economy' }), 'different dates are a different alert');
  assert.notEqual(key, priceAlertKey({ from: 'New York', to: 'Paris', depart: '2026-12-10', ret: '2026-12-17', travelers: 2, cabin: 'economy' }), 'a different destination is a different alert');
  assert.notEqual(key, priceAlertKey({ from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-17', travelers: 3, cabin: 'economy' }), 'a different party is a different alert');
});

test('the 20% drop threshold: exactly 20% counts, 19% does not', () => {
  assert.equal(PRICE_DROP_THRESHOLD, 0.2, 'the DROPS threshold is 20%');
  assert.equal(isPriceDrop(1000, 800), true, 'exactly 20% lower is a drop');
  assert.equal(isPriceDrop(1000, 799), true, 'more than 20% lower is a drop');
  assert.equal(isPriceDrop(1000, 810), false, '19% lower is not a drop');
  assert.equal(isPriceDrop(1000, 1000), false, 'unchanged is not a drop');
  assert.equal(isPriceDrop(1000, 1200), false, 'a rise is not a drop');
  assert.equal(isPriceDrop(1000, 0), false, 'a zero price is never a drop');
  assert.equal(isPriceDrop(0, 0), false, 'a zero baseline is never a drop');
  assert.equal(priceDropPercent(1000, 800), 20, 'the percent is exact');
  assert.equal(priceDropPercent(1000, 1200), 0, 'a rise reports 0%');
});

test('createPriceAlert refuses anything that is not a live Ignav fare', () => {
  assert.ok(createPriceAlert(alertArgs), 'a live Ignav fare takes an alert');
  assert.equal(createPriceAlert({ ...alertArgs, priceKind: 'test' }), null, 'a Duffel test fare never takes an alert');
  assert.equal(createPriceAlert({ ...alertArgs, priceKind: 'estimate' }), null, 'a planning estimate never takes an alert');
  assert.equal(createPriceAlert({ ...alertArgs, source: 'LetsFG' }), null, 'a LetsFG fare never takes an alert');
  assert.equal(createPriceAlert({ ...alertArgs, source: 'Duffel' }), null, 'a Duffel fare never takes an alert');
  assert.equal(createPriceAlert({ ...alertArgs, total: 0 }), null, 'a zero total is not an alert');
  assert.equal(createPriceAlert({ ...alertArgs, travelers: 0 }), null, 'zero travelers is not an alert');
});

test('evaluatePriceAlert: a live re-check updates the price and the time; a failed check does not invent one', () => {
  const dropped = evaluatePriceAlert(validAlert, 1290, '2026-11-22T09:00:00.000Z');
  assert.equal(dropped.lastPrice, 1290, 'the last price moves');
  assert.equal(dropped.lastCheckedAt, '2026-11-22T09:00:00.000Z', 'the checked time moves');
  assert.equal(dropped.lastCheckOk, true, 'the check is marked good');
  assert.equal(dropped.baselineTotal, 1615, 'the baseline never moves');
  assert.equal(alertIsDrop(dropped), true, '1615 → 1290 is a 20% drop');
  const failed = evaluatePriceAlert(validAlert, null, '2026-11-22T09:00:00.000Z');
  assert.equal(failed.lastPrice, 1615, 'a failed check keeps the last known price');
  assert.equal(failed.lastCheckOk, false, 'and marks the check failed');
  assert.equal(alertIsDrop(failed), false, 'a failed check is never shown as a drop');
  const rose = evaluatePriceAlert(validAlert, 1700, '2026-11-22T09:00:00.000Z');
  assert.equal(alertIsDrop(rose), false, 'a rise is not a drop');
});

test('priceAlertLine: baseline, last price, drop and last-checked — never a check that did not happen', () => {
  const line = priceAlertLine(validAlert);
  assert.ok(line.includes('Ignav'), 'names the source');
  assert.ok(line.includes('New York → London'), 'names the route');
  assert.ok(line.includes('Dec 10'), 'names the dates');
  assert.ok(line.includes('$1,615 when set'), 'the baseline');
  assert.ok(line.includes('last checked Nov 21, 2026'), 'when it was last checked');
  const dropped = priceAlertLine(evaluatePriceAlert(validAlert, 1290, '2026-11-22T09:00:00.000Z'));
  assert.ok(dropped.includes('now $1,290'), 'the new price');
  assert.ok(dropped.includes('20% lower'), 'the drop size');
  const failed = priceAlertLine(evaluatePriceAlert(validAlert, null, '2026-11-22T09:00:00.000Z'));
  assert.ok(failed.includes('no live fare found on the last check'), 'a failed check says so');
  assert.ok(!failed.includes('now $'), 'and shows no new price');
});

test('isPriceAlert: the creator’s shape passes, corrupt or foreign values do not', () => {
  assert.equal(isPriceAlert(validAlert), true);
  assert.equal(isPriceAlert(null), false);
  assert.equal(isPriceAlert('alert'), false);
  assert.equal(isPriceAlert({ ...validAlert, source: 'LetsFG' }), false, 'only Ignav alerts exist');
  assert.equal(isPriceAlert({ ...validAlert, baselineTotal: 0 }), false);
  assert.equal(isPriceAlert({ ...validAlert, lastCheckOk: 'yes' }), false);
  assert.equal(isPriceAlert({ ...validAlert, return: '' }), false, 'a round-trip alert needs a return date');
});

// --- Hacker Fares -------------------------------------------------

const leg = (airline, price, departMinutes = 600, durationMinutes = 480, stops = 0) => ({
  airline,
  price,
  currency: 'USD',
  stops,
  duration: '8h 0m',
  durationMinutes,
  departMinutes,
  segments: [],
});
const itinerary = (price, airline, departMinutes = 600) => ({
  ignavId: `id-${airline}-${price}`,
  price,
  currency: 'USD',
  priceStatus: 'verified',
  legs: [leg(airline, price, departMinutes)],
});

test('compareHackerFare: two one-ways win only when strictly cheaper', () => {
  const win = compareHackerFare({
    roundTrip: itinerary(1615, 'ITA Airways'),
    outOneWay: itinerary(700, 'ITA Airways'),
    backOneWay: itinerary(800, 'British Airways'),
    roundTripCheckedAt: '2026-11-21T15:00:00.000Z',
    outCheckedAt: '2026-11-21T15:01:00.000Z',
    backCheckedAt: '2026-11-21T15:02:00.000Z',
  });
  assert.ok(win, '700 + 800 beats 1615');
  assert.equal(win.combinedTotal, 1500, 'the combined total');
  assert.equal(win.roundTripTotal, 1615, 'the round trip it beat');
  assert.equal(win.savings, 115, 'the saving');
  assert.equal(win.outCheckedAt, '2026-11-21T15:01:00.000Z', 'each leg keeps its own checked time');
  assert.equal(win.backCheckedAt, '2026-11-21T15:02:00.000Z', 'each leg keeps its own checked time');
  assert.equal(
    compareHackerFare({ roundTrip: itinerary(1500, 'ITA Airways'), outOneWay: itinerary(700, 'ITA Airways'), backOneWay: itinerary(800, 'British Airways') }),
    null,
    'equal is not a hacker fare — no saving to show'
  );
  assert.equal(
    compareHackerFare({ roundTrip: itinerary(1400, 'ITA Airways'), outOneWay: itinerary(700, 'ITA Airways'), backOneWay: itinerary(800, 'British Airways') }),
    null,
    'more expensive is not a hacker fare'
  );
  assert.equal(
    compareHackerFare({ roundTrip: itinerary(1615, 'ITA Airways'), outOneWay: null, backOneWay: itinerary(800, 'British Airways') }),
    null,
    'a missing leg is no hacker fare'
  );
  assert.equal(
    compareHackerFare({ roundTrip: null, outOneWay: itinerary(700, 'ITA Airways'), backOneWay: itinerary(800, 'British Airways') }),
    null,
    'no round trip to compare against is no hacker fare'
  );
});

test('hacker fare labels: two one-ways, live, saving named against the round trip', () => {
  assert.equal(hackerFareLabel(), 'Two one-way fares · Ignav · live');
  const win = compareHackerFare({
    roundTrip: itinerary(1615, 'ITA Airways'),
    outOneWay: itinerary(700, 'ITA Airways'),
    backOneWay: itinerary(800, 'British Airways'),
  });
  assert.ok(win);
  assert.equal(hackerFareSavingsLine(win), '$115 less than the cheapest round trip ($1,615)', 'the saving names the round trip it beat');
});

// --- Merge ----------------------------------------------------------

test('mergeFlightOptions: a winning hacker combo ranks with the live fares by its combined total', () => {
  const win = compareHackerFare({
    roundTrip: itinerary(1615, 'ITA Airways'),
    outOneWay: itinerary(700, 'ITA Airways', 600),
    backOneWay: itinerary(800, 'British Airways', 700),
  });
  const merged = mergeFlightOptions({
    tripType: 'roundtrip',
    out: [],
    back: [],
    ignavItineraries: [itinerary(1615, 'ITA Airways', 600)],
    sort: 'cheapest',
    hackerComparison: win,
  });
  assert.equal(merged.length, 2, 'the hacker card joins the grid');
  assert.equal(merged[0].kind, 'hacker', 'the cheaper combo sorts first');
  assert.equal(merged[0].total, 1500, 'by its combined total');
  assert.equal(merged[1].kind, 'ignav', 'the round trip follows');
  const counts = countFlightCards(merged, 2);
  assert.equal(counts.stops[0], 2, 'both cards count as nonstop');
  assert.ok(counts.airlines['ITA Airways'] >= 1, 'the hacker legs count their airlines');
  assert.ok(counts.airlines['British Airways'] >= 1, 'both legs count, not just the first');
});

test('mergeFlightOptions: a hacker combo is live — it ranks ahead of Duffel test fares', () => {
  const win = compareHackerFare({
    roundTrip: itinerary(1615, 'ITA Airways'),
    outOneWay: itinerary(700, 'ITA Airways', 600),
    backOneWay: itinerary(800, 'British Airways', 700),
  });
  const duffelOut = { ...leg('American', 433, 630), offerId: 'out-1' };
  const duffelBack = { ...leg('American', 432, 700), offerId: 'back-1' };
  const merged = mergeFlightOptions({
    tripType: 'roundtrip',
    out: [duffelOut],
    back: [duffelBack],
    ignavItineraries: [],
    sort: 'cheapest',
    duffelTest: true,
    hackerComparison: win,
  });
  assert.equal(merged[0].kind, 'hacker', 'the live hacker combo outranks the test pair even though the test total is lower');
  assert.equal(merged[1].kind, 'duffel-pair', 'the test pair sorts last');
});

// --- No background machinery --------------------------------------

test('no cron, no email, no background check in the alert and hacker modules', () => {
  for (const file of ['../lib/priceAlerts.ts', '../lib/hackerFares.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    // Actual scheduling / sending constructs, not the words in the
    // comments explaining that none exist.
    assert.ok(!/setInterval\s*\(|setTimeout\s*\(|node-cron|cron\.schedule/.test(src), `${file} schedules nothing`);
    assert.ok(!/nodemailer|sendMail\s*\(|fetch\s*\(/.test(src), `${file} sends nothing and fetches nothing — pure functions only`);
  }
  const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes("variant !== 'account'"), 'the alert re-check only runs on the account page');
  const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(!results.includes('fujintrip-price-alerts'), 'SearchResults never touches alert storage directly — FujinApp owns it');
});
