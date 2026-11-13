// Forgotten-cost all-in lines (round 4 #4, UGC learning §3 —
// "Most travellers underestimate true costs by 20 to 40 percent"
// and "I blew $4,200 on a 10-day trip to Japan last year. Planned
// budget? $2,800."). The trip total gains labeled estimate lines for
// the categories travelers forget, so the quoted total is the real
// trip total — plus a per-leg warning where a fee is unknown.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/forgotten.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allInLine, forgottenCostLines, forgottenRatesFor } from '../lib/forgotten.ts';
import { buildTripCard } from '../lib/tripCard.ts';

test('forgottenCostLines: every forgotten category is a line, and the lines sum into the total', () => {
  const f = forgottenCostLines({ planTotal: 2800, days: 10, travelers: 2, routeKey: 'japan', nights: 9 });
  const ids = f.lines.map((l) => l.id);
  for (const id of ['food', 'transport', 'transfers', 'bags', 'tax', 'tips', 'sim', 'insurance']) {
    assert.ok(ids.includes(id), `the ${id} line exists`);
  }
  const sum = f.lines.reduce((s, l) => s + l.amount, 0);
  assert.equal(f.total, sum, 'the total is exactly the lines');
  // Every line is labeled an estimate — or, for Japan tips, checked $0.
  for (const line of f.lines) {
    assert.ok(
      line.note.includes('planning estimate') || line.note.includes('checked'),
      `${line.id} is labeled: ${line.note}`
    );
  }
  // Japan food: $50 a day per traveler, 10 days, 2 travelers.
  assert.equal(f.lines.find((l) => l.id === 'food')?.amount, 1000);
  // Japan tips: tipping is not customary — $0, checked, not invented.
  assert.equal(f.lines.find((l) => l.id === 'tips')?.amount, 0);
  assert.ok(f.lines.find((l) => l.id === 'tips')?.note.includes('not customary'));
  // Insurance is ~7% of the plan total.
  assert.equal(f.lines.find((l) => l.id === 'insurance')?.amount, 196);
});

test('forgottenCostLines: the report\'s Japan trip shows the $4,200 reality before booking, not after', () => {
  // $2,800 planned, 10 days, 2 travelers — the forgotten lines are
  // $1,647, for a real trip total of $4,447: the same order of gap as
  // the traveler's $2,800 → $4,200, shown before booking.
  const f = forgottenCostLines({ planTotal: 2800, days: 10, travelers: 2, routeKey: 'japan', nights: 9 });
  assert.ok(f.total > 1000, 'the forgotten lines are substantial, not token');
  assert.equal(2800 + f.total, 4447);
  const line = allInLine(2800, f);
  assert.ok(line.includes('$2,800'), 'the plan total is named');
  assert.ok(line.includes('$1,647'), 'the forgotten lines are named');
  assert.ok(line.includes('$4,447'), 'the real trip total is named');
  assert.ok(line.includes('planning estimates'), 'the reality check is labeled');
});

test('forgottenCostLines: a route with no verified tax rate gets a warning, not a guessed number', () => {
  const f = forgottenCostLines({ planTotal: 2000, days: 7, travelers: 2, routeKey: 'unknown-route', nights: 6 });
  assert.ok(!f.lines.some((l) => l.id === 'tax'), 'no tax line without a verified rate');
  assert.ok(f.feeWarning.includes('no verified rate'), 'the warning says why');
  assert.ok(f.feeWarning.includes('check before booking'), 'the warning names the action');
  const europe = forgottenCostLines({ planTotal: 3600, days: 14, travelers: 2, routeKey: 'centraleurope', nights: 13 });
  assert.ok(europe.lines.some((l) => l.id === 'tax'), 'Europe has a tax line');
  assert.equal(europe.lines.find((l) => l.id === 'tax')?.amount, 4 * 13 * 2, '€4 a night per traveler, 13 nights, 2 travelers');
  assert.ok(europe.feeWarning.includes('confirm the exact amount at booking'));
});

test('forgottenRatesFor: one rate set per region group, never a guess per route', () => {
  assert.equal(forgottenRatesFor('europe').food, forgottenRatesFor('centraleurope').food, 'Europe routes share the Europe rates');
  assert.equal(forgottenRatesFor('thailand').food, forgottenRatesFor('southeastasia').food, 'Asia routes share the Asia rates');
  assert.notEqual(forgottenRatesFor('japan').tips, forgottenRatesFor('usa').tips, 'Japan and the USA tip differently');
});

test('buildTripCard: the forgotten lines ride on the card, and every stay leg carries the fee warning', () => {
  const card = buildTripCard({ destination: 'Japan', travelers: 2, days: 10, month: 4, origin: 'New York' });
  assert.ok(card);
  assert.ok(card.forgotten.total > 0, 'the card carries the forgotten total');
  assert.equal(card.forgotten.total, card.forgotten.lines.reduce((s, l) => s + l.amount, 0), 'the card total is exactly the lines');
  // The all-in total is the card total + the forgotten lines.
  const allIn = card.total + card.forgotten.total;
  assert.ok(allIn > card.total, 'the real trip total is above the plan total');
  const stayLegs = card.legs.filter((l) => l.kind === 'stay');
  assert.ok(stayLegs.length > 0);
  for (const leg of stayLegs) {
    assert.ok(leg.feeWarning?.includes('resort fee / tourist tax'), 'every stay leg warns about the fee');
    assert.ok(leg.feeWarning?.includes('at booking'), 'the warning names the action — confirm at booking');
  }
  const flightLegs = card.legs.filter((l) => l.kind === 'flight');
  for (const leg of flightLegs) {
    assert.equal(leg.feeWarning, undefined, 'only stay legs carry the fee warning');
  }
});
