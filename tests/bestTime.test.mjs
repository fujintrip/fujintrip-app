// Best time to travel — temperatures are Fahrenheit, and a range
// where low equals high is a single value, never "37–37".
// (Defect, Nov 14 2026: the strip printed °F numbers with a °C unit —
// January "typically 37–37°C" — while the checklist on the same page
// correctly said 37°F.)
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/bestTime.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestTimeFor,
  bestTimeLine,
  bestMonthTempLabel,
  tempRangeLabel,
} from '../lib/bestTime.ts';

test('tempRangeLabel: a real range prints °F', () => {
  assert.equal(tempRangeLabel(79, 82), ', typically 79–82°F');
});

test('tempRangeLabel: low equals high is a single value, never a degenerate range', () => {
  assert.equal(tempRangeLabel(37, 37), ', typically 37°F');
  assert.ok(!tempRangeLabel(37, 37).includes('–'), 'no en-dash when low equals high');
});

test('tempRangeLabel: no temperature data is an empty string', () => {
  assert.equal(tempRangeLabel(null, 82), '');
  assert.equal(tempRangeLabel(37, null), '');
  assert.equal(tempRangeLabel(null, null), '');
});

test('bestTimeFor Central Europe: January is 37°F at every stop, July spans 79–82°F', () => {
  const bt = bestTimeFor('Central Europe');
  assert.deepEqual(bt.cities, ['Prague', 'Vienna', 'Budapest']);
  const jan = bt.months[0];
  assert.equal(jan.tempLow, 37);
  assert.equal(jan.tempHigh, 37);
  assert.equal(tempRangeLabel(jan.tempLow, jan.tempHigh), ', typically 37°F');
  const jul = bt.months[6];
  assert.equal(jul.tempLow, 79);
  assert.equal(jul.tempHigh, 82);
  assert.equal(tempRangeLabel(jul.tempLow, jul.tempHigh), ', typically 79–82°F');
});

test('bestMonthTempLabel: best month carries the range and the cities', () => {
  const bt = bestTimeFor('Central Europe');
  const label = bestMonthTempLabel(bt);
  assert.ok(label.includes('°F'), 'label uses °F');
  assert.ok(!label.includes('°C'), 'label never uses °C');
  assert.ok(label.includes('Prague'), 'label names the cities');
});

test('bestTimeLine: Fahrenheit throughout, never °C, and no degenerate range', () => {
  const line = bestTimeLine('Central Europe', 1);
  assert.ok(line.includes('°F'), 'line uses °F');
  assert.ok(!line.includes('°C'), 'line never uses °C');
  assert.ok(!line.includes('37–37'), 'no degenerate 37–37 range');
  assert.ok(line.includes('typically 37°F'), 'January reads as a single 37°F value');
});
