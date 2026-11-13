// Summary == built plan (plan-mismatch fix, Nov 13, 2026). The live
// browser check caught it on Central Europe, January, 2 travelers:
// the summary said Prague 4n → Vienna 3n → Budapest 6n, Jan 4–17,
// but "Build my plan" built a 3-day plan, Jan 4–6, 1 night per city —
// the preview assumed 14 days while build() used 3 when the length
// was unknown. The fix is one helper, tripDays(): every consumer
// (preview card, built card, summary, panel edits) reads it. These
// tests pin the invariant at the seam the client actually uses:
// the summary's nights, dates and totals must equal the built card's,
// for a fresh trip with no length given AND for an explicit length.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/planMatch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  DEFAULT_TRIP_DAYS,
  distributeNights,
  routeKeyForDestination,
  tripDays,
} from '../lib/planner.ts';
import { addDays, buildTripCard, suggestedStart } from '../lib/tripCard.ts';
import { auditTrip } from '../lib/feasibility.ts';

// The summary's route line, as the Trip Summary renders it from the
// same distribution the card uses (route key, not display name).
const summaryRouteLine = (destination, days) =>
  distributeNights(routeKeyForDestination(destination), days).map((l) => `${l.city} ${l.nights}n`).join(' → ');

test('tripDays: the 14-day default, stated lengths kept, extremes clamped to the card window', () => {
  assert.equal(DEFAULT_TRIP_DAYS, 14, 'the preview’s long-established default is kept');
  assert.equal(tripDays(undefined), 14, 'no length given → 14');
  assert.equal(tripDays(0), 14, '0 means unset, not a 0-day trip');
  assert.equal(tripDays(7), 7, 'a stated length is kept');
  assert.equal(tripDays(14), 14);
  assert.equal(tripDays(1), 2, '1 day clamps to the card’s 2-day minimum');
  assert.equal(tripDays(60), 30, '60 days clamps to the card’s 30-day maximum');
  assert.equal(tripDays(-5), 14, 'a nonsense length falls back to the default');
});

test('summary == built plan, fresh Central Europe January trip with no length given (the live bug case)', () => {
  // The traveler said "Central Europe in January, 2 travelers" and
  // nothing about length — exactly what the live check did.
  const days = tripDays(undefined);
  assert.equal(days, 14, 'the fresh trip resolves to the 14-day default, not the old 3-day build default');

  const summaryRoute = summaryRouteLine('Central Europe', days);
  assert.equal(summaryRoute, 'Prague 4n → Vienna 3n → Budapest 6n', 'the summary the traveler sees');

  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days, month: 1, origin: 'New York' });
  assert.ok(card, 'the built card builds');
  assert.equal(card.stops.map((s) => `${s.city} ${s.nights}n`).join(' → '), summaryRoute, 'the built card’s nights are the summary’s nights');
  assert.equal(card.days, 14);
  assert.equal(card.nights, 13, 'nights = days − 1');

  const start = suggestedStart(1);
  const end = addDays(start, days - 1);
  assert.equal(card.startDate.getTime(), start.getTime(), 'the card starts when the summary starts');
  assert.equal(card.endDate.getTime(), end.getTime(), 'the card ends when the summary ends');
  assert.equal(card.startDate.toISOString().slice(0, 10), '2027-01-04', 'January starts Jan 4, 2027');
  assert.equal(card.endDate.toISOString().slice(0, 10), '2027-01-17', 'and the 14-day trip ends Jan 17 — the summary’s dates');

  // Totals: the summary's totals were computed on the preview length,
  // so the built plan's totals must match them for the same trip.
  const plan = buildPlan('Central Europe', 2, days);
  for (const tier of [0, 1, 2]) {
    const tierCard = buildTripCard({ destination: 'Central Europe', travelers: 2, days, month: 1, origin: 'New York', tier });
    assert.ok(tierCard);
    assert.equal(tierCard.total, plan.options[tier].total, `tier ${tier} card total is the plan total`);
    assert.equal(tierCard.plannerTotal, plan.options[tier].total);
  }

  // Legs still sum to the plan total minus activities (the regression
  // invariant), and the site's own feasibility audit passes on the
  // freshly built plan — it used to flag exactly this disagreement.
  const best = plan.options[1];
  const legSum = card.legs.reduce((a, l) => a + l.price, 0);
  assert.equal(legSum, card.total - best.activities, 'legs sum to total minus activities');
  const audit = auditTrip(card);
  assert.equal(audit.ok, true, `audit passes on the fresh build: ${audit.issues.map((i) => i.message).join('; ')}`);
  assert.deepEqual(audit.issues, []);

  // Pin the old bug: a 3-day card (the old build default) does NOT
  // match the 14-day summary — if the default ever drifts back to 3,
  // the test above fails on the nights, and this names why.
  const oldBug = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 3, month: 1, origin: 'New York' });
  assert.ok(oldBug);
  assert.notEqual(oldBug.stops.map((s) => `${s.city} ${s.nights}n`).join(' → '), summaryRoute, '3 days gives 1n/1n/1n, not the summary');
  assert.equal(oldBug.endDate.toISOString().slice(0, 10), '2027-01-06', 'and it ends Jan 6, not Jan 17');
});

test('summary == built plan, explicit 7-day length', () => {
  const days = tripDays(7);
  assert.equal(days, 7);
  const summaryRoute = summaryRouteLine('Central Europe', days);
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days, month: 1, origin: 'New York' });
  assert.ok(card);
  assert.equal(card.stops.map((s) => `${s.city} ${s.nights}n`).join(' → '), summaryRoute, 'nights agree at 7 days too');
  assert.equal(card.nights, 6);
  const start = suggestedStart(1);
  assert.equal(card.startDate.getTime(), start.getTime());
  assert.equal(card.endDate.getTime(), addDays(start, 6).getTime(), 'Jan 4–10');
  const plan = buildPlan('Central Europe', 2, days);
  assert.equal(card.total, plan.options[1].total, 'Best value total agrees at 7 days');
  assert.equal(auditTrip(card).ok, true, 'the audit passes at 7 days too');
});

test('summary == built plan, single-city destination (Kyoto) with no length given', () => {
  const days = tripDays(undefined);
  const card = buildTripCard({ destination: 'Kyoto', travelers: 2, days, month: 4, origin: 'New York' });
  assert.ok(card);
  assert.equal(card.stops.length, 1, 'one stop');
  assert.equal(card.stops[0].nights, 13, 'the whole stay is 13 nights');
  assert.equal(card.nights, 13);
  assert.equal(auditTrip(card).ok, true, 'the audit passes for the single-city case too');
});
