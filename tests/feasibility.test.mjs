// Feasibility guardrail, S half (round 4 #5, UGC learning §3 —
// FlyerTalk's 55-minute LAX connection, the Doha separate-tickets
// thread, Layla's impossible 7:35 AM Bergamo flight + a day in
// Bellagio). A rule layer on every leg: <90 min international / <60
// min domestic connection = flag; terminal change or separate ticket
// = "no protection"; departure-day guard; chat-vs-card consistency
// audit. The M half (MCT data per airport/leg, transit-visa check)
// is deliberately NOT built — it needs a live data source.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/feasibility.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditTrip,
  checkConnection,
  departureDayFlags,
  feasibilitySummary,
  MIN_CONNECTION_MINUTES,
} from '../lib/feasibility.ts';
import { buildTripCard } from '../lib/tripCard.ts';

test('checkConnection: the 55-minute LAX connection flags on every count', () => {
  const tight = checkConnection({ minutes: 55, international: false, terminalChange: true, separateTicket: true });
  assert.equal(tight.ok, false);
  assert.equal(tight.flags.length, 3, 'tight + terminal change + separate ticket = three flags');
  assert.ok(tight.flags[0].includes('55 minutes'), 'the time is named');
  assert.ok(tight.flags[0].includes('60-minute minimum'), 'the domestic minimum is named');
  assert.ok(tight.flags.some((f) => f.includes('Terminal change')));
  assert.ok(tight.flags.some((f) => f.includes('no protection')), 'the separate-ticket label is the report\'s');
  assert.ok(tight.flags.some((f) => f.includes('you buy a new ticket')), 'the consequence is named');
  const intl = checkConnection({ minutes: 75, international: true });
  assert.equal(intl.ok, false, '75 minutes is under the 90-minute international minimum');
  assert.ok(intl.flags[0].includes('90-minute minimum'));
  assert.equal(checkConnection({ minutes: 90, international: true }).ok, true, '90 minutes exactly is the minimum, not a flag');
  assert.equal(checkConnection({ minutes: 60, international: false }).ok, true);
  assert.equal(checkConnection({ minutes: 120, international: true }).ok, true);
});

test('departureDayFlags: a day trip on a flight day flags; a normal trip does not', () => {
  // A synthetic card with a day trip on Day 1 (arrival day) and on a
  // travel day — the shapes the guard watches for.
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  assert.deepEqual(departureDayFlags(card), [], 'the real Central Europe card has no day trip on a flight day');
  const synthetic = {
    ...card,
    stops: card.stops.map((s, i) =>
      i === 0 ? { ...s, days: [{ ...s.days[0], title: 'Day Trip to the Coast' }, ...s.days.slice(1)] } : s
    ),
  };
  const flags = departureDayFlags(synthetic);
  assert.equal(flags.length, 1, 'one flag for the Day 1 day trip');
  assert.ok(flags[0].includes('Day 1 is your arrival day'), 'the flag names the failure');
  assert.ok(flags[0].includes('no buffer'), 'the reason is named');
  // A day trip the day before an early flight home — synthetic, so the
  // last day of the last stop is a day trip (no real route ends on one
  // with 1-night stops; the guard watches the shape, not the route).
  const earlyBase = buildTripCard({ destination: 'Greece', travelers: 2, days: 7, month: 6, origin: 'New York' });
  assert.ok(earlyBase);
  const early = {
    ...earlyBase,
    stops: earlyBase.stops.map((s, i, arr) =>
      i === arr.length - 1
        ? { ...s, days: s.days.map((d, j) => (j === s.days.length - 1 ? { ...d, title: 'Day Trip to the Coast' } : d)) }
        : s
    ),
  };
  const earlyFlags = departureDayFlags(early, '10:00');
  assert.ok(earlyFlags.some((f) => f.includes('flight home leaves at 10:00')), 'the early flight is named');
  assert.ok(earlyFlags.some((f) => f.includes('no buffer')), 'the reason is named');
  assert.equal(departureDayFlags(early, '14:00').length, 0, 'an afternoon flight leaves the buffer');
});

test('auditTrip: a real card passes — legs sum, nights and dates line up, airports agree', () => {
  for (const dest of ['Central Europe', 'Japan', 'Egypt', 'Southeast Asia', 'UK', 'Kyoto', 'Bali']) {
    const card = buildTripCard({ destination: dest, travelers: 2, days: 14, month: 1, origin: 'New York' });
    assert.ok(card, `${dest} builds`);
    const audit = auditTrip(card);
    assert.equal(audit.ok, true, `${dest} audit passes: ${audit.issues.map((i) => i.message).join('; ')}`);
    assert.deepEqual(audit.issues, []);
  }
  // Live fares change the flight total — the audit still passes,
  // because the legs sum to the live-adjusted total minus activities.
  const live = buildTripCard({
    destination: 'Central Europe',
    travelers: 2,
    days: 14,
    month: 1,
    origin: 'New York',
    liveFares: {
      live: true,
      origin: 'New York',
      destCity: 'Prague',
      departDate: '2027-01-04',
      returnDate: '2027-01-17',
      travelers: 2,
      out: [{ airline: 'Test Air', price: 250, currency: 'USD', stops: 0, duration: 'PT7H' }],
      back: [{ airline: 'Test Air', price: 260, currency: 'USD', stops: 0, duration: 'PT8H' }],
    },
  });
  assert.ok(live);
  assert.equal(live.flight.live, true, 'the test fares are accepted for this trip');
  assert.equal(auditTrip(live).ok, true, 'the audit passes with live fares too');
});

test('auditTrip: a tampered card fails with the exact disagreement named', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  const wrongPrice = { ...card, legs: card.legs.map((l) => (l.id === 'flight-out' ? { ...l, price: l.price + 50 } : l)) };
  const priceAudit = auditTrip(wrongPrice);
  assert.equal(priceAudit.ok, false);
  assert.ok(priceAudit.issues.some((i) => i.kind === 'price' && i.message.includes('Legs sum to')));
  const wrongNights = { ...card, stops: card.stops.map((s, i) => (i === 0 ? { ...s, nights: s.nights + 1 } : s)) };
  assert.ok(auditTrip(wrongNights).issues.some((i) => i.kind === 'nights'));
  const wrongAirport = { ...card, legs: card.legs.map((l) => (l.id === 'flight-back' ? { ...l, label: 'Flight Budapest → Boston' } : l)) };
  assert.ok(auditTrip(wrongAirport).issues.some((i) => i.kind === 'airport'));
});

test('feasibilitySummary: the pass line and the flag line', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  const pass = feasibilitySummary([], auditTrip(card));
  assert.ok(pass.includes('no flags'), 'a clean trip says so');
  assert.ok(pass.includes('legs sum to the total'), 'the audit is named');
  const flagged = feasibilitySummary(['Day 1 is your arrival day, and it plans a day trip'], { ok: false, issues: [{ kind: 'price', message: 'Legs sum to $1 but the total is $2.' }] });
  assert.ok(flagged.includes('2 flags'), 'the count is named');
  assert.ok(flagged.includes('Day 1 is your arrival day'));
  assert.ok(flagged.includes('Legs sum to $1'));
});

test('MIN_CONNECTION_MINUTES: the rule version of MCT', () => {
  assert.equal(MIN_CONNECTION_MINUTES.international, 90);
  assert.equal(MIN_CONNECTION_MINUTES.domestic, 60);
});
