// Ground-transport know-how on every transport leg (ground-transport
// booking plan, Nov 12, 2026): the plan file's §7 TRANSPORT_KNOW_HOW
// strings, keyed to the trip card's LEG_MODE routes, attached to the
// card's legs and transport rows as metadata — prices untouched, so
// the leg-sum invariants hold exactly. No live network: the strings
// are copied verbatim from the plan file. Run: node --no-warnings
// --import ./tests/register-loader.mjs --test tests/groundTransport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripCard } from '../lib/tripCard.ts';
import { buildPlan } from '../lib/planner.ts';
import {
  GENERAL_KNOW_HOW_FOOTER,
  TRANSPORT_KNOW_HOW,
  knowHowForLeg,
  knowHowKeyForRoute,
  passKnowHowForRoute,
} from '../lib/groundTransport.ts';
import { SUPPLIERS, getSupplier, listSuppliers } from '../lib/booking.ts';

const leg = (card, id) => card.legs.find((l) => l.id === id);
const legSum = (card) =>
  card.legs.reduce((s, l) => s + l.price, 0);

test('know-how record: all ten plan-file keys, each with title, lines and the honesty footer', () => {
  const keys = [
    'train-europe', 'train-europe-pass', 'train-japan', 'train-sleeper',
    'train-usa', 'bus-europe', 'bus-general', 'taxi-airport', 'taxi-city',
    'ferry-greece',
  ];
  for (const key of keys) {
    const entry = TRANSPORT_KNOW_HOW[key];
    assert.ok(entry, `missing ${key}`);
    assert.equal(entry.key, key);
    assert.ok(entry.title.length > 0);
    assert.ok(entry.lines.length >= 2 && entry.lines.length <= 3, `${key}: 2–3 lines`);
    assert.ok(entry.notIncluded.length > 0, `${key}: honesty footer`);
    // Nothing invented: no URL, no timetable, no operator phone number.
    for (const line of [...entry.lines, entry.notIncluded]) {
      assert.doesNotMatch(line, /https?:\/\//, `${key}: no invented URL`);
    }
  }
  // The general fallback is the plan file §6 footer, word for word.
  assert.equal(
    GENERAL_KNOW_HOW_FOOTER,
    'Prices and times change — check before you book. This is guidance, not a ticket.'
  );
});

test('knowHowForLeg: train/bus/taxi/ferry legs get the right string per mode and region', () => {
  // Europe trains — every Europe route key maps to train-europe.
  assert.equal(knowHowForLeg('centraleurope', 'transport', '🚆 Train')?.key, 'train-europe');
  assert.equal(knowHowForLeg('france', 'transport', '🚆 TGV')?.key, 'train-europe');
  assert.equal(knowHowForLeg('italy', 'transport', '🚆 High-speed train')?.key, 'train-europe');
  assert.equal(knowHowForLeg('spain', 'transport', '🚆 AVE train')?.key, 'train-europe');
  assert.equal(knowHowForLeg('portugal', 'transport', '🚆 Train')?.key, 'train-europe');
  assert.equal(knowHowForLeg('uk', 'transport', '🚆 Train')?.key, 'train-europe');
  assert.equal(knowHowForLeg('morocco', 'transport', '🚆 Train')?.key, 'train-europe');
  assert.equal(knowHowForLeg('india', 'transport', '🚆 Train')?.key, 'train-europe');
  // Sleeper routes, bullet train, ferry.
  assert.equal(knowHowForLeg('egypt', 'transport', '🚆 Sleeper train')?.key, 'train-sleeper');
  assert.equal(knowHowForLeg('thailand', 'transport', '🚆 Sleeper train')?.key, 'train-sleeper');
  assert.equal(knowHowForLeg('japan', 'transport', '🚆 Bullet train')?.key, 'train-japan');
  assert.equal(knowHowForLeg('greece', 'transport', '⛴️ Ferry')?.key, 'ferry-greece');
  // Flight legs (arrival / departure) get the airport-transfer guidance.
  assert.equal(knowHowForLeg('centraleurope', 'flight', '✈️ Flight')?.key, 'taxi-airport');
  assert.equal(knowHowForLeg('southeastasia', 'flight', '✈️ Flight')?.key, 'taxi-airport');
  // Bus modes split Europe vs general.
  assert.equal(knowHowForLeg('centraleurope', 'transport', '🚌 Bus')?.key, 'bus-europe');
  assert.equal(knowHowForLeg('mexico', 'transport', '🚌 Bus')?.key, 'bus-general');
  // Stay and car legs carry no transport know-how.
  assert.equal(knowHowForLeg('centraleurope', 'stay', '🛏️'), null);
  assert.equal(knowHowForLeg('centraleurope', 'car', '🚗'), null);
});

test('knowHowForLeg: domestic-flight intercity legs are out of scope — no invented guidance', () => {
  // Southeast Asia, Turkey, Mexico intercity legs are domestic flights;
  // the plan file marks them out of scope, so the resolver returns null
  // and the UI falls back to the general footer.
  assert.equal(knowHowForLeg('southeastasia', 'transport', '✈️ Domestic flight'), null);
  assert.equal(knowHowForLeg('turkey', 'transport', '✈️ Domestic flight'), null);
  assert.equal(knowHowForLeg('mexico', 'transport', '✈️ Domestic flight'), null);
});

test('knowHowForLeg: the mode guard keeps train guidance off flight legs (usa)', () => {
  // The plan file maps usa → train-usa, but the card's USA legs are
  // domestic flights — a train string on a flight leg would be wrong.
  assert.equal(knowHowKeyForRoute('usa'), 'train-usa');
  assert.equal(knowHowForLeg('usa', 'transport', '✈️ Domestic flight'), null);
  // ...while a real train mode on the same route still resolves.
  assert.equal(knowHowForLeg('usa', 'transport', '🚆 Train')?.key, 'train-usa');
  // Unknown routes get nothing, never a guessed string.
  assert.equal(knowHowKeyForRoute('atlantis'), null);
  assert.equal(knowHowForLeg('atlantis', 'transport', '🚆 Train'), null);
});

test('passKnowHowForRoute: the rail-pass card only on multi-country Europe trips', () => {
  assert.equal(passKnowHowForRoute('europe')?.key, 'train-europe-pass');
  assert.equal(passKnowHowForRoute('centraleurope')?.key, 'train-europe-pass');
  assert.equal(passKnowHowForRoute('france'), null);
  assert.equal(passKnowHowForRoute('japan'), null);
});

test('tripCard Central Europe: train know-how on the intercity legs, taxi-airport on the flights, sums exact', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier: 1 });
  const plan = buildPlan('Central Europe', 2, 14).options[1];
  // Intercity legs carry the train strings + the pass card.
  for (const id of ['leg-1', 'leg-2']) {
    assert.equal(leg(card, id).knowHow?.key, 'train-europe');
    assert.equal(leg(card, id).knowHow?.title, 'How to book this train');
    assert.equal(leg(card, id).knowHowExtra?.key, 'train-europe-pass');
  }
  // Flight legs carry the airport-transfer guidance, and the live-fare
  // labels are untouched (no live fares here — planning estimates).
  assert.equal(leg(card, 'flight-out').knowHow?.key, 'taxi-airport');
  assert.equal(leg(card, 'flight-back').knowHow?.key, 'taxi-airport');
  assert.match(leg(card, 'flight-out').detail, /planning estimate/);
  // Transport-in rows match the legs, and the return transport too.
  assert.equal(card.stops[0].transportIn.knowHow?.key, 'taxi-airport');
  assert.equal(card.stops[1].transportIn.knowHow?.key, 'train-europe');
  assert.equal(card.stops[1].transportIn.knowHowExtra?.key, 'train-europe-pass');
  assert.equal(card.returnTransport.knowHow?.key, 'taxi-airport');
  // Leg-sum invariant: know-how is metadata, the sums did not move.
  assert.equal(legSum(card), card.total - plan.activities);
  assert.equal(card.total, plan.total);
});

test('tripCard Japan / Greece / Southeast Asia: the right know-how per route, sums exact', () => {
  const japan = buildTripCard({ destination: 'Japan', travelers: 2, days: 14, month: 4, origin: 'New York', tier: 1 });
  assert.equal(leg(japan, 'leg-1').knowHow?.key, 'train-japan');
  assert.match(leg(japan, 'leg-1').knowHow?.lines[0] ?? '', /Japan Rail Pass/);
  assert.equal(leg(japan, 'leg-1').knowHowExtra, undefined);
  assert.equal(leg(japan, 'flight-out').knowHow?.key, 'taxi-airport');

  const greece = buildTripCard({ destination: 'Greece', travelers: 2, days: 14, month: 6, origin: 'New York', tier: 1 });
  assert.equal(leg(greece, 'leg-1').knowHow?.key, 'ferry-greece');
  assert.equal(leg(greece, 'leg-1').knowHow?.title, 'How to book this ferry');

  const sea = buildTripCard({ destination: 'Southeast Asia', travelers: 2, days: 15, month: 1, origin: 'New York', tier: 1 });
  // Domestic-flight intercity legs: no invented train guidance.
  assert.equal(leg(sea, 'leg-1').knowHow, undefined);
  assert.equal(leg(sea, 'leg-2').knowHow, undefined);
  // ...but the arrival and departure still get the transfer guidance.
  assert.equal(leg(sea, 'flight-out').knowHow?.key, 'taxi-airport');
  assert.equal(leg(sea, 'flight-back').knowHow?.key, 'taxi-airport');
  assert.equal(sea.stops[0].transportIn.knowHow?.key, 'taxi-airport');
  assert.equal(sea.returnTransport.knowHow?.key, 'taxi-airport');

  for (const card of [japan, greece, sea]) {
    const plan = buildPlan(card.destination, 2, card.days).options[1];
    assert.equal(legSum(card), card.total - plan.activities);
  }
});

test('registry: the trains category exists, with honest states — nothing live', () => {
  const trains = listSuppliers('trains').map((s) => s.id);
  for (const id of [
    'gopaxo', 'distribusion', 'tictactrip',
    'trainline-api', 'trainline-affiliate', 'omio', 'rail-europe', 'eurail',
  ]) {
    assert.ok(trains.includes(id), `trains category is missing ${id}`);
  }
  // Nothing in the trains category is bookable today: the states are
  // only not_configured (access exists in principle) and not_applied
  // (needs the user's application) — never live, never faked.
  for (const s of listSuppliers('trains')) {
    assert.ok(
      s.state === 'not_configured' || s.state === 'not_applied',
      `${s.id}: state ${s.state} — a train supplier must not read as live`
    );
  }
  // The three suppliers that were buses-only now carry trains too.
  for (const id of ['gopaxo', 'distribusion', 'tictactrip']) {
    assert.ok(getSupplier(id).categories.includes('trains'), `${id} carries the trains category`);
    assert.ok(getSupplier(id).categories.includes('buses'), `${id} still carries buses`);
  }
  // Gopaxo is #1 for trains + buses; Distribusion carries the newer
  // ~3,000-carrier figure from the research (not the older 2,000+).
  assert.match(getSupplier('gopaxo').notes, /#1 for trains \+ buses together/);
  assert.match(getSupplier('distribusion').data, /~3,000 carriers/);
  assert.match(getSupplier('trainline-affiliate').notes, /no-code train path/);
  assert.equal(getSupplier('trainline-affiliate').mode, 'affiliate_link');
  assert.equal(getSupplier('trainline-affiliate').quickWin, true);
});

test('registry: Karhoo is the Bolt route, HolidayTaxis is corrected, Grab stays know-how only', () => {
  const karhoo = getSupplier('karhoo');
  assert.ok(karhoo, 'Karhoo is in the registry');
  assert.equal(karhoo.state, 'not_applied');
  assert.ok(karhoo.categories.includes('taxis'));
  assert.match(karhoo.notes ?? '', /UNVERIFIED/, 'Karhoo notes flag the Bolt-inventory question as unverified');

  const ht = getSupplier('holidaytaxis');
  assert.ok(ht, 'HolidayTaxis is in the registry');
  // The correction: Supplier Connect is supply-side, not a seller API —
  // so the entry is unavailable for selling, and says so.
  assert.equal(ht.state, 'unavailable');
  assert.match(ht.notes ?? '', /SUPPLY-SIDE/);
  assert.match(ht.notes ?? '', /Do NOT build against it/);
  assert.match(ht.access, /Hotelbeds transfers/, 'the seller route is via Hotelbeds, flagged unverified');

  // Grab is know-how only (no B2B/partner API was found) — it must not
  // appear as a supplier the app could book through.
  assert.equal(getSupplier('grab'), undefined);
  assert.ok(!SUPPLIERS.some((s) => s.id === 'grab'));
  // ...but the Grab note IS in the taxi know-how strings (Uber does not
  // run rides in Southeast Asia).
  assert.match(TRANSPORT_KNOW_HOW['taxi-airport'].lines[1], /Grab in Southeast Asia/);
  assert.match(TRANSPORT_KNOW_HOW['taxi-city'].lines[0], /Grab in Southeast Asia/);
});

test('tripCard with live fares: know-how does not disturb the live-fare labels or totals', () => {
  const start = new Date(2027, 0, 4);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fares = {
    live: true, origin: 'New York', destCity: 'Prague',
    departDate: iso(start), returnDate: iso(new Date(2027, 0, 17)), travelers: 2,
    out: [{ airline: 'Iberia', price: 250, currency: 'USD', stops: 0, duration: '8h 5m' }],
    back: [{ airline: 'American', price: 260, currency: 'USD', stops: 1, duration: '9h 20m' }],
  };
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier: 1, liveFares: fares });
  assert.equal(card.flight.live, true);
  assert.match(leg(card, 'flight-out').detail, /Iberia · Duffel test fare/);
  assert.equal(leg(card, 'flight-out').knowHow?.key, 'taxi-airport');
  assert.equal(leg(card, 'leg-1').knowHow?.key, 'train-europe');
  const plan = buildPlan('Central Europe', 2, 14).options[1];
  assert.equal(legSum(card), card.total - plan.activities);
});
