// Pace guard + pace/energy slots (round 4 #1, UGC learning §3 —
// Suptravel / Cruise Critic / the Tokyo case: "I planned 8
// attractions in one day in Tokyo. I managed to see 3. The rest of
// the trip was catching up on sleep."). The guard is a planner
// constraint: a pace slot, a latest start, a max sights per day, and
// a nap window — and a warning on the day card when a day breaks it.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/pace.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxSightsFor,
  napNoteFor,
  paceCheckDay,
  paceFromProfile,
  paceRevisionPrompt,
  paceWarningsForCard,
  PACE_MAX_SIGHTS,
} from '../lib/pace.ts';
import { parsePreferenceSignals, parseProfile, profileSummary } from '../lib/preferences.ts';
import { buildTripCard } from '../lib/tripCard.ts';

test('paceCheckDay: the report\'s 8-attraction Tokyo day warns on relaxed and moderate, not on packed', () => {
  const warn = paceCheckDay(8, 'moderate');
  assert.equal(warn.ok, false);
  assert.ok(warn.warning?.includes('too packed'), 'the warning names the failure');
  assert.ok(warn.warning?.includes('8 experiences'), 'the count is named');
  assert.ok(warn.warning?.includes('max 6'), 'the max is named');
  assert.ok(warn.warning?.includes('Drop one, or add a day?'), 'the prompt is the report\'s');
  assert.equal(paceCheckDay(8, 'relaxed').ok, false);
  assert.equal(paceCheckDay(8, 'packed').ok, true, 'a packed pace allows 8');
  assert.equal(paceCheckDay(9, 'packed').ok, false, '9 breaks even a packed pace');
  assert.equal(paceCheckDay(6, 'moderate').ok, true, '6 is the moderate max');
  assert.equal(paceCheckDay(3, 'relaxed').ok, true);
});

test('paceCheckDay: a traveler-set max overrides the pace default', () => {
  assert.equal(paceCheckDay(5, 'moderate', 3).ok, false, 'max 3 sights a day beats moderate\'s 6');
  assert.ok(paceCheckDay(5, 'moderate', 3).warning?.includes('max 3'));
  assert.equal(paceCheckDay(5, 'moderate', 7).ok, true, 'a raised max is honored');
  assert.equal(paceCheckDay(5, 'moderate', 99).ok, true, 'an out-of-range override is ignored, never clamped into a surprise');
  assert.equal(maxSightsFor('relaxed'), PACE_MAX_SIGHTS.relaxed);
});

test('paceFromProfile: the profile\'s pace vocabulary maps onto the guard\'s levels', () => {
  assert.equal(paceFromProfile({ pace: 'slow' }), 'relaxed');
  assert.equal(paceFromProfile({ pace: 'relaxed' }), 'moderate');
  assert.equal(paceFromProfile({ pace: 'fast' }), 'packed');
  assert.equal(paceFromProfile({}), 'moderate', 'an unset pace is moderate');
  assert.equal(paceFromProfile(null), 'moderate');
  assert.equal(paceFromProfile(undefined), 'moderate');
});

test('parsePreferenceSignals: the energy slots come from the traveler\'s own words', () => {
  const s = parsePreferenceSignals("don't start before 10, at most 3 sights a day, and we need a nap after lunch");
  assert.equal(s.latestStart, '10:00');
  assert.equal(s.maxSightsPerDay, 3);
  assert.equal(s.napWindow, true);
  assert.equal(parsePreferenceSignals('start at 9am').latestStart, '09:00');
  assert.equal(parsePreferenceSignals('start at 9:30am').latestStart, '09:30');
  assert.equal(parsePreferenceSignals('start no earlier than 11').latestStart, '11:00');
  assert.equal(parsePreferenceSignals('max 2 attractions per day').maxSightsPerDay, 2);
  assert.equal(parsePreferenceSignals('no more than 5 activities a day').maxSightsPerDay, 5);
  assert.equal(parsePreferenceSignals('at most 0 sights a day').maxSightsPerDay, undefined, '0 is not a max');
  assert.equal(parsePreferenceSignals('at most 12 sights a day').maxSightsPerDay, undefined, '12 is out of range');
  assert.equal(parsePreferenceSignals('we like slow travel').latestStart, undefined, 'no start time is invented');
  assert.equal(parsePreferenceSignals('I love food').napWindow, undefined);
});

test('parseProfile + profileSummary: the new slots validate and summarize, nothing invented', () => {
  const p = parseProfile({ latestStart: '10:00', maxSightsPerDay: 3, napWindow: true, pace: 'slow' });
  assert.equal(p.latestStart, '10:00');
  assert.equal(p.maxSightsPerDay, 3);
  assert.equal(p.napWindow, true);
  const summary = profileSummary(p);
  assert.ok(summary.includes('starts no earlier than 10:00'));
  assert.ok(summary.includes('max 3 sights a day'));
  assert.ok(summary.includes('nap window after lunch'));
  assert.equal(parseProfile({ latestStart: '25:00' }).latestStart, undefined, 'a malformed time is dropped');
  assert.equal(parseProfile({ latestStart: '10am' }).latestStart, undefined);
  assert.equal(parseProfile({ maxSightsPerDay: 0 }).maxSightsPerDay, undefined);
  assert.equal(parseProfile({ maxSightsPerDay: 11 }).maxSightsPerDay, undefined);
  assert.equal(parseProfile({ napWindow: 'yes' }).napWindow, undefined, 'only a true boolean counts');
  assert.equal(profileSummary({}), '', 'an empty profile still says nothing');
});

test('napNoteFor: the protected rest note needs a young child AND the slot', () => {
  assert.equal(napNoteFor([2, 5], true), 'Protected rest after lunch — nap window for the little ones.');
  assert.equal(napNoteFor([6, 9], true), '', 'no child under 5, no nap note');
  assert.equal(napNoteFor([2], false), '', 'no slot, no note');
  assert.equal(napNoteFor([], true), '');
});

test('paceWarningsForCard: a Budapest 7-experience day warns on moderate, and the card carries it', () => {
  // Budapest day 4 ("City Park and Thermal Bath Relaxation") plans 7
  // experiences — over the moderate max of 6, under packed's 8.
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', pace: 'moderate' });
  assert.ok(card);
  assert.ok(card.paceWarnings.length >= 1, 'at least the 7-experience Budapest day warns');
  const budapest = card.paceWarnings.find((w) => w.city === 'Budapest');
  assert.ok(budapest, 'the Budapest warning is named');
  assert.equal(budapest.experiences, 7);
  assert.equal(budapest.max, 6);
  const day = card.stops.find((s) => s.city === 'Budapest')?.days.find((d) => d.day === budapest.day);
  assert.ok(day?.paceWarning?.includes('too packed'), 'the warning is on the day card itself');
  const packed = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', pace: 'packed' });
  assert.equal(packed?.paceWarnings.length, 0, 'the same trip is fine on a packed pace');
  const custom = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', pace: 'moderate', maxSightsPerDay: 3 });
  assert.ok((custom?.paceWarnings.length ?? 0) > (card?.paceWarnings.length ?? 0), 'a traveler-set max of 3 warns on more days');
});

test('paceWarningsForCard: the prompt names the day and offers the report\'s choice', () => {
  const warnings = paceWarningsForCard(
    { stops: [{ city: 'Tokyo', days: [{ day: 1, title: 'Shibuya and Harajuku', experiences: 8 }] }] },
    'moderate'
  );
  assert.equal(warnings.length, 1);
  const prompt = paceRevisionPrompt(warnings);
  assert.ok(prompt.includes('Day 1 in Tokyo'), 'the day is named');
  assert.ok(prompt.includes('8 experiences'), 'the count is named');
  assert.ok(prompt.includes('drop one, or add a day?'), 'the choice is the report\'s');
  assert.ok(prompt.includes('Everything else in the plan stays as it was'), 'a follow-up is an edit, never a rebuild');
  assert.equal(paceRevisionPrompt([]), '', 'no warnings, no prompt');
});
