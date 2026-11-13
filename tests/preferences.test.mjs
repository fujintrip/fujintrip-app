// Preference profile + dietary slot (round 3 #2/#3, competitor learning
// §3 — Mindtrip's persistent profile, Layla/Triply dietary chips).
// Only what the traveler stated or picked is ever in a profile — an
// empty profile says nothing, and no preference is ever invented.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/preferences.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIETARY_OPTIONS,
  dietaryBlock,
  mergeProfile,
  parseDietary,
  parsePreferenceSignals,
  parseProfile,
  preferencesBlock,
  profileLine,
  profileSummary,
} from '../lib/preferences.ts';

test('parseDietary: the traveler\'s own words, nothing guessed', () => {
  assert.equal(parseDietary("I'm vegetarian"), 'vegetarian');
  assert.equal(parseDietary('vegan please'), 'vegan');
  assert.equal(parseDietary('we need halal food'), 'halal');
  assert.equal(parseDietary('gluten-free options'), 'gluten-free');
  assert.equal(parseDietary('I have celiac disease'), 'gluten-free');
  assert.equal(parseDietary('no dietary needs, eat everything'), 'none');
  assert.equal(parseDietary('I love food'), null);
  assert.equal(parseDietary(''), null);
  // Vegan beats vegetarian when both words appear ("vegan, not just vegetarian").
  assert.equal(parseDietary('vegan, not vegetarian'), 'vegan');
});

test('parsePreferenceSignals: typed sentences land in the same fields as chips', () => {
  assert.deepEqual(parsePreferenceSignals('direct flights please, and street food'), {
    flightStyle: 'direct',
    foodStyle: 'street',
  });
  assert.deepEqual(parsePreferenceSignals('cheapest flights, window seat, slow pace, local gems only'), {
    flightStyle: 'cheapest',
    seat: 'window',
    pace: 'slow',
    localGemsOnly: true,
  });
  assert.deepEqual(parsePreferenceSignals('fine dining and avoid tourist traps'), {
    foodStyle: 'fine',
    localGemsOnly: true,
  });
  assert.deepEqual(parsePreferenceSignals('I want a warm beach'), {});
  // A dietary need in the same message joins the profile too.
  assert.deepEqual(parsePreferenceSignals('halal food, direct flights'), {
    flightStyle: 'direct',
    dietary: 'halal',
  });
});

test('profileSummary: only stated fields, in a fixed order', () => {
  assert.equal(profileSummary({}), '');
  assert.equal(profileSummary({ flightStyle: 'direct' }), 'direct flights');
  assert.equal(
    profileSummary({ flightStyle: 'direct', foodStyle: 'street', pace: 'slow', dietary: 'vegetarian' }),
    'direct flights, street food over fine dining, slow pace, vegetarian'
  );
  // 'none' dietary is a real answer but adds nothing to the summary.
  assert.equal(profileSummary({ dietary: 'none' }), '');
  assert.equal(profileSummary({ localGemsOnly: true }), 'local gems only');
});

test('profileLine: the exact line Fujin says on a new trip', () => {
  assert.equal(profileLine({}), '');
  assert.equal(
    profileLine({ flightStyle: 'direct', foodStyle: 'street' }),
    "Using what you told me last time — direct flights, street food over fine dining — tell me if that's changed."
  );
});

test('mergeProfile + parseProfile: later statements win, foreign values dropped', () => {
  const merged = mergeProfile({ flightStyle: 'direct', foodStyle: 'street' }, { pace: 'slow', foodStyle: 'fine' });
  assert.deepEqual(merged, { flightStyle: 'direct', foodStyle: 'fine', pace: 'slow' });
  assert.deepEqual(parseProfile({ flightStyle: 'direct', seat: 'middle', pace: 'slow', unknown: 1 }), {
    flightStyle: 'direct',
    pace: 'slow',
  });
  assert.deepEqual(parseProfile(null), {});
  assert.deepEqual(parseProfile('direct'), {});
  assert.deepEqual(parseProfile({ dietary: 'kosher' }), {}, 'an unlisted dietary value is dropped, never kept');
});

test('preferencesBlock: empty profile sends nothing to the model', () => {
  assert.equal(preferencesBlock({}), '');
  assert.ok(preferencesBlock({ flightStyle: 'direct' }).includes('direct flights'));
  assert.ok(preferencesBlock({ flightStyle: 'direct' }).includes('Never invent a preference'));
});

test('dietaryBlock: never "safe", likely halal is never certified halal', () => {
  const vegan = dietaryBlock('vegan');
  assert.ok(vegan.includes('vegan'), 'names the need');
  assert.ok(vegan.includes('never call a place "safe"'), 'the never-safe rule is in the block');
  const halal = dietaryBlock('halal');
  assert.ok(halal.includes('likely halal'), 'likely halal is the wording');
  assert.ok(halal.includes('never "certified halal"'), 'certified is never claimed without proof');
  assert.ok(dietaryBlock('none').includes('no dietary needs'));
  assert.equal(DIETARY_OPTIONS.length, 6, 'none / vegetarian / vegan / halal / gluten-free / other');
});
