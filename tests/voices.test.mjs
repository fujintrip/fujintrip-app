// Per-city Local Voices (round 3 #1, competitor learning §3): the
// route's stop cities each get their own voices block instead of one
// generic region blob. No live network: the fetch itself is covered by
// the dev-server test; these tests cover the pure selection and
// formatting — cap, dedupe, and the honest empty-city line.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/voices.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citiesForVoices, formatCityVoices } from '../lib/localVoices.ts';

test('citiesForVoices: first three stops, deduped, empties skipped', () => {
  assert.deepEqual(citiesForVoices(['Prague', 'Vienna', 'Budapest']), ['Prague', 'Vienna', 'Budapest']);
  assert.deepEqual(citiesForVoices(['Prague', 'Vienna', 'Budapest', 'Lisbon', 'Porto']), ['Prague', 'Vienna', 'Budapest']);
  assert.deepEqual(citiesForVoices(['Prague', 'prague', '  Vienna  ', '', 'Budapest']), ['Prague', 'Vienna', 'Budapest']);
  assert.deepEqual(citiesForVoices([]), []);
  assert.deepEqual(citiesForVoices(['Kyoto'], 3), ['Kyoto']);
  assert.deepEqual(citiesForVoices(['A', 'B', 'C', 'D'], 2), ['A', 'B']);
});

test('formatCityVoices: one section per city, in route order', () => {
  const out = formatCityVoices([
    { city: 'Prague', voices: { text: 'Fresh traveler material for Prague:\nEat: Trdelník stands', source: 'Wikivoyage' } },
    { city: 'Vienna', voices: { text: 'Fresh traveler material for Vienna:\nEat: Naschmarkt', source: 'Wikivoyage' } },
  ]);
  assert.ok(out.includes('Prague:'), 'Prague section present');
  assert.ok(out.includes('Vienna:'), 'Vienna section present');
  assert.ok(out.indexOf('Prague:') < out.indexOf('Vienna:'), 'route order kept');
  assert.ok(out.includes('Trdelník'), 'real material quoted, not summarized away');
  assert.equal(formatCityVoices([]), '');
});

test('formatCityVoices: a city with no material says so, never invented', () => {
  const out = formatCityVoices([
    { city: 'Prague', voices: { text: 'Fresh traveler material for Prague:\nEat: Trdelník stands', source: 'Wikivoyage' } },
    { city: 'Budapest', voices: { text: '', source: '' } },
  ]);
  assert.ok(out.includes('Budapest: no traveler tips fetched yet'), 'empty city is labeled, not filled in');
  assert.ok(!out.includes('Budapest:\nFresh'), 'no invented material for the empty city');
});
