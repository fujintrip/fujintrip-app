// Solo mode (round 3 #4, competitor learning §3 — Layla FAQ,
// MonkeyTravel, Sorom): 1 traveler is not a smaller group. The single
// supplement is NAMED, never priced — the planner has no live single
// supplement to quote, so no dollar figure is invented. No place is
// ever labeled safe.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/solo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askFujin, soloLine } from '../lib/planner.ts';

test('soloLine: names the supplement, the workaround, the social options', () => {
  const line = soloLine();
  assert.ok(line.includes('single supplement'), 'the supplement is named');
  assert.ok(line.includes('50–100%'), 'the cruise supplement range from the report');
  assert.ok(line.includes('hostel private room'), 'the workaround is offered');
  assert.ok(line.includes('Group walking tours'), 'social options are suggested');
  assert.ok(!line.includes('$'), 'no dollar figure is invented for the supplement');
  assert.ok(!line.toLowerCase().includes('safe'), 'no safe label anywhere in the line');
});

test('askFujin: a solo trip summary carries the solo framing', () => {
  const r = askFujin(
    'Kyoto in January for 10 days, flying from New York, budget $2000',
    1,
    '',
    'Kyoto in January for 10 days, flying from New York, budget $2000'
  );
  assert.equal(r.travelers, 1);
  assert.ok(r.reply.includes('single supplement'), 'solo framing in the Trip Summary');
  assert.ok(r.reply.includes('hostel private room'), 'workaround in the summary');
});

test('askFujin: 2 travelers get no solo framing', () => {
  const r = askFujin(
    'Kyoto in January for 10 days, flying from New York, budget $2000',
    2,
    '',
    'Kyoto in January for 10 days, flying from New York, budget $2000'
  );
  assert.equal(r.travelers, 2);
  assert.ok(!r.reply.includes('single supplement'), 'no solo framing for a couple');
});

test('askFujin: "just me" / "solo" means 1 traveler', () => {
  const r = askFujin('just me, Central Europe in January', 2, '', 'just me, Central Europe in January');
  assert.equal(r.travelers, 1);
});
