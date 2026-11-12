// Live Duffel fares on the trip card + map (finish-the-web-version
// round, Nov 12, 2026): the card shows the same fares the chat quotes,
// with the airline name and the Duffel test-fare label; hotels, cars and
// activities stay planner estimates; the service fee is a separate line.
// No live network: the fares are canned LiveFares payloads in the shape
// /api/fujin returns. Run: node --no-warnings --import
// ./tests/register-loader.mjs --test tests/livefares.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, serviceFee } from '../lib/planner.ts';
import { addDays, buildTripCard, suggestedStart } from '../lib/tripCard.ts';
import { parseLiveFares } from '../lib/duffel.ts';
import { bundleFromLegs, bundleTotal } from '../lib/bundle.ts';

// Local calendar date (the card formats dates locally, not UTC — see
// lib/tripCard.ts fmtIso).
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// A canned LiveFares payload for a trip, on the card's own suggested
// dates (the server fetches origin → first city and back on exactly
// these dates). Prices are party totals — the Duffel offer is for all
// travelers at once, never per person.
function faresFor({
  destCity,
  days,
  month = 1,
  travelers = 2,
  origin = 'New York',
  outPrice = 250,
  outAirline = 'Iberia',
  backPrice = 260,
  backAirline = 'American',
  out = true,
  back = true,
} = {}) {
  const start = suggestedStart(month);
  const end = addDays(start, days - 1);
  return {
    live: true,
    origin,
    destCity,
    departDate: iso(start),
    returnDate: iso(end),
    travelers,
    out: out ? [{ airline: outAirline, price: outPrice, currency: 'USD', stops: 0, duration: '8h 5m' }] : [],
    back: back ? [{ airline: backAirline, price: backPrice, currency: 'USD', stops: 1, duration: '9h 20m' }] : [],
  };
}

const leg = (card, id) => card.legs.find((l) => l.id === id);
const sumKind = (card, kind) => card.legs.filter((l) => l.kind === kind).reduce((s, l) => s + l.price, 0);

test('parseLiveFares: only a live, well-formed payload passes', () => {
  const good = faresFor({ destCity: 'Prague', days: 14 });
  assert.deepEqual(parseLiveFares(good), good);
  assert.equal(parseLiveFares(null), null);
  assert.equal(parseLiveFares(undefined), null);
  assert.equal(parseLiveFares({ ...good, live: false, reason: 'no_offers' }), null);
  assert.equal(parseLiveFares({ ...good, out: [{ airline: 'Iberia', price: '250' }] }), null);
  assert.equal(parseLiveFares({ ...good, out: [{ airline: '', price: 250 }] }), null);
  assert.equal(parseLiveFares({ ...good, out: [{ airline: 'Iberia', price: 0 }] }), null);
  assert.equal(parseLiveFares({ ...good, departDate: '2027-1-4' }), null);
  assert.equal(parseLiveFares({ ...good, travelers: 0 }), null);
  // One direction missing is still a valid partial payload — the card
  // uses the direction it has and estimates the other.
  assert.notEqual(parseLiveFares({ ...good, back: [] }), null);
});

test('tripCard with live fares: out/back legs are the cheapest Duffel fares, totals stay exact', () => {
  const fares = faresFor({ destCity: 'Prague', days: 14 });
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier: 1, liveFares: fares });
  const plan = buildPlan('Central Europe', 2, 14).options[1];
  assert.equal(card.flight.live, true);
  // The flight legs are the fetched fares, with the airline name.
  assert.equal(leg(card, 'flight-out').price, 250);
  assert.match(leg(card, 'flight-out').detail, /Iberia · Duffel test fare/);
  assert.match(leg(card, 'flight-out').more, /Duffel test fare/);
  assert.match(leg(card, 'flight-out').more, /not bookable/);
  assert.equal(leg(card, 'flight-back').price, 260);
  assert.match(leg(card, 'flight-back').detail, /American · Duffel test fare/);
  // Intercity legs stay planner estimates and say so — Duffel never
  // fetched them. They sum to 20% of the planner flight leg.
  assert.equal(card.flight.intercity.live, false);
  assert.equal(card.flight.intercity.price, Math.round(plan.flight * 0.2));
  assert.equal(sumKind(card, 'transport'), Math.round(plan.flight * 0.2));
  assert.match(leg(card, 'leg-1').more, /stays a planning estimate/);
  assert.equal(leg(card, 'leg-1').detail, 'Planning estimate');
  // The flight summary: live total, planner flight kept, fee separate.
  assert.equal(card.flight.total, 250 + 260 + Math.round(plan.flight * 0.2));
  assert.equal(card.flight.plannerFlight, plan.flight);
  assert.equal(card.flight.serviceFee, serviceFee(card.flight.total));
  assert.ok(card.flight.serviceFee > 0);
  // The card total is the plan total with the flight leg swapped — and
  // the legs still sum to it exactly, minus activities (no leg).
  assert.equal(card.plannerTotal, plan.total);
  assert.equal(card.total, plan.total - plan.flight + card.flight.total);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities);
  // Stays and cars are untouched planner totals.
  assert.equal(sumKind(card, 'stay'), plan.hotel);
  assert.equal(sumKind(card, 'car'), plan.car);
  // The stop rows and the return transport carry the same prices.
  assert.equal(card.stops[0].transportIn.price, 250);
  assert.equal(card.returnTransport.price, 260);
  // "In your plan so far" follows the legs, so it follows the fares.
  const bundle = bundleFromLegs(card.legs, card.legs.map((l) => l.id));
  assert.equal(bundleTotal(bundle), card.total - plan.activities);
  // The all-in line on a live leg names the live total + the fee.
  assert.match(leg(card, 'flight-out').more, /service fee \$\d+ \(per flight order/);
  assert.match(leg(card, 'flight-out').more, new RegExp(`= \\$${(card.flight.total + card.flight.serviceFee).toLocaleString()} all-in`));
});

test('tripCard fallback: no fares means the planner split, unchanged', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier: 1 });
  const plan = buildPlan('Central Europe', 2, 14).options[1];
  assert.equal(card.flight.live, false);
  assert.equal(card.flight.total, plan.flight);
  assert.equal(card.total, plan.total);
  assert.equal(card.plannerTotal, plan.total);
  assert.equal(card.flight.serviceFee, serviceFee(plan.flight));
  assert.equal(sumKind(card, 'flight') + sumKind(card, 'transport'), plan.flight);
  assert.equal(sumKind(card, 'stay'), plan.hotel);
  assert.equal(sumKind(card, 'car'), plan.car);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), plan.total - plan.activities);
  assert.match(leg(card, 'flight-out').detail, /planning estimate/);
  assert.match(leg(card, 'flight-out').more, /Live fares arrive with Duffel live mode/);
});

test('tripCard partial live fares: one direction live, the other estimated', () => {
  const fares = faresFor({ destCity: 'Prague', days: 14, back: false });
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier: 1, liveFares: fares });
  const plan = buildPlan('Central Europe', 2, 14).options[1];
  assert.equal(card.flight.live, true);
  assert.equal(card.flight.out.live, true);
  assert.equal(card.flight.back.live, false);
  assert.equal(leg(card, 'flight-out').price, 250);
  // Back falls back to the 40% planner split for a multi-stop trip.
  assert.equal(leg(card, 'flight-back').price, Math.round(plan.flight * 0.4));
  assert.match(leg(card, 'flight-back').detail, /planning estimate/);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities);
  assert.equal(card.total, plan.total - plan.flight + card.flight.total);
});

test('tripCard: fares for another trip are ignored, never shown', () => {
  const base = { destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier: 1 };
  const plan = buildPlan('Central Europe', 2, 14).options[1];
  const wrongs = [
    // Wrong party size.
    faresFor({ destCity: 'Prague', days: 14, travelers: 3 }),
    // Wrong origin.
    faresFor({ destCity: 'Prague', days: 14, origin: 'Los Angeles' }),
    // Wrong first city (the fares price Vienna, the route starts Prague).
    faresFor({ destCity: 'Vienna', days: 14 }),
    // Wrong dates (a day later than the card's suggested dates).
    { ...faresFor({ destCity: 'Prague', days: 14 }), departDate: iso(addDays(suggestedStart(1), 1)), returnDate: iso(addDays(suggestedStart(1), 14)) },
    // Not live at all.
    { ...faresFor({ destCity: 'Prague', days: 14 }), live: false, reason: 'no_offers' },
  ];
  for (const f of wrongs) {
    const card = buildTripCard({ ...base, liveFares: f });
    assert.equal(card.flight.live, false);
    assert.equal(card.total, plan.total);
    assert.equal(sumKind(card, 'flight') + sumKind(card, 'transport'), plan.flight);
  }
});

test('tripCard single-stop with live fares: Kyoto, 50/50 fallback shape, no intercity', () => {
  const fares = faresFor({ destCity: 'Kyoto', days: 3, outPrice: 300, backPrice: 280, outAirline: 'JAL', backAirline: 'ANA' });
  const card = buildTripCard({ destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York', tier: 1, liveFares: fares });
  const plan = buildPlan('Kyoto', 2, 3).options[1];
  assert.equal(card.legs.filter((l) => l.kind === 'transport').length, 0);
  assert.equal(leg(card, 'flight-out').price, 300);
  assert.equal(leg(card, 'flight-back').price, 280);
  assert.equal(card.flight.total, 580);
  assert.equal(card.total, plan.total - plan.flight + 580);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities);
});

test('tripCard live fares: four travelers use the party total as-is, per-person divides cleanly', () => {
  const fares = faresFor({ destCity: 'Prague', days: 14, travelers: 4 });
  const card = buildTripCard({ destination: 'Central Europe', travelers: 4, days: 14, month: 1, origin: 'New York', tier: 1, liveFares: fares });
  const plan = buildPlan('Central Europe', 4, 14).options[1];
  // The Duffel offer already covers all four travelers — the card must
  // not multiply it by the party size.
  assert.equal(leg(card, 'flight-out').price, 250);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities);
  assert.equal(card.flight.serviceFee, serviceFee(card.flight.total));
});

test('tripCard live fares: family party uses the fetched fares; totals stay exact', () => {
  const fares = faresFor({ destCity: 'Prague', days: 14, travelers: 4 });
  const card = buildTripCard({ destination: 'Central Europe', travelers: 4, days: 14, month: 1, origin: 'New York', tier: 1, kids: [4, 7], liveFares: fares });
  const plan = buildPlan('Central Europe', 4, 14, { kids: [4, 7] }).options[1];
  // Duffel fetches the party as adults (its offer is one total for the
  // party); the card shows that total, and the legs still sum exactly.
  assert.equal(card.flight.live, true);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities);
  assert.equal(card.total, plan.total - plan.flight + card.flight.total);
  assert.equal(sumKind(card, 'stay'), plan.hotel);
});

test('tripCard live fares: every tier stays exact, fares are tier-independent', () => {
  const fares = faresFor({ destCity: 'Prague', days: 14 });
  for (const tier of [0, 1, 2]) {
    const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', tier, liveFares: fares });
    const plan = buildPlan('Central Europe', 2, 14).options[tier];
    assert.equal(leg(card, 'flight-out').price, 250, `tier ${tier} out`);
    assert.equal(leg(card, 'flight-back').price, 260, `tier ${tier} back`);
    assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities, `tier ${tier} legs`);
    assert.equal(card.total, plan.total - plan.flight + card.flight.total, `tier ${tier} total`);
  }
});

test('tripCard live fares: the intercity nudge moves only estimates, never the live legs', () => {
  // Morocco Best value: flight $966, intercity 20% = $193 (odd) over
  // two legs — the per-leg split rounds to 97 + 97 = 194, so the nudge
  // must pull $1 off an intercity leg, not off the live fares.
  const fares = faresFor({ destCity: 'Marrakech', days: 10, outPrice: 410, backPrice: 395, outAirline: 'Royal Air Maroc', backAirline: 'Ryanair' });
  const card = buildTripCard({ destination: 'Morocco', travelers: 2, days: 10, month: 1, origin: 'New York', tier: 1, liveFares: fares });
  const plan = buildPlan('Morocco', 2, 10).options[1];
  assert.equal(plan.flight, 966);
  assert.equal(leg(card, 'flight-out').price, 410);
  assert.equal(leg(card, 'flight-back').price, 395);
  assert.equal(sumKind(card, 'transport'), 193);
  // The stop rows carry the nudged leg price, not the pre-nudge split.
  assert.equal(card.stops[1].transportIn.price, leg(card, 'leg-1').price);
  assert.equal(card.stops[2].transportIn.price, leg(card, 'leg-2').price);
  assert.equal(card.legs.reduce((s, l) => s + l.price, 0), card.total - plan.activities);
});
