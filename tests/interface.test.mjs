// Interface state machine + contrast tokens (Layla-interface direction
// §2, §4, §6). The state machine is what the zones gate on; the contrast
// tests pin the accent rule so a later token change cannot silently
// break small-text legibility in either theme.

import test from 'node:test';
import assert from 'node:assert/strict';
import { interfaceState, interactiveBudget, contrastRatio, meetsContrast } from '../lib/interface.ts';

test('interfaceState: no trip is S0 — chat only', () => {
  assert.equal(interfaceState({}), 'S0');
  assert.equal(interfaceState({ lastParsed: null, plan: null }), 'S0');
  assert.equal(interfaceState({ lastParsed: { destination: '' } }), 'S0');
});

test('interfaceState: destination known, no plan is S1', () => {
  assert.equal(interfaceState({ lastParsed: { destination: 'Central Europe' } }), 'S1');
  // A plan-less trip with a destination is still S1 even with a map card
  // in the picture — the map follows the trip, not the other way round.
  assert.equal(interfaceState({ lastParsed: { destination: 'Japan' }, plan: null }), 'S1');
});

test('interfaceState: a built plan is S2', () => {
  assert.equal(interfaceState({ lastParsed: { destination: 'Japan' }, plan: { stops: [] } }), 'S2');
  assert.equal(interfaceState({ plan: {} }), 'S2');
});

test('interactiveBudget: 10 / 18 / 26 first-viewport elements', () => {
  assert.equal(interactiveBudget('S0'), 10);
  assert.equal(interactiveBudget('S1'), 18);
  assert.equal(interactiveBudget('S2'), 26);
});

test('contrastRatio: white on black is 21:1', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});

test('contrast: light theme — the blue accent passes for small text', () => {
  // The accent itself passes for small text: 5.57:1 on white.
  assert.ok(meetsContrast('#0066cc', '#ffffff'));
  assert.ok(contrastRatio('#0066cc', '#ffffff') > 5.5);
  // accent-text #0052a3 is the small-text colour: 7.68:1.
  assert.ok(meetsContrast('#0052a3', '#ffffff'));
  assert.ok(contrastRatio('#0052a3', '#ffffff') > 7.6);
  // accent-text on its soft background: 6.68:1.
  assert.ok(meetsContrast('#0052a3', '#e8f0fb'));
  // Light-theme body and muted text pass on white.
  assert.ok(meetsContrast('#191e3b', '#ffffff'));
  assert.ok(meetsContrast('#5a6478', '#ffffff'), 'light muted #5a6478 on white');
});

test('contrast: dark theme — small text uses the light link blue', () => {
  // Dark accent-text #8db9f2 on the dark card (warm charcoal).
  assert.ok(meetsContrast('#8db9f2', '#221d15'));
  assert.ok(meetsContrast('#8db9f2', '#221d15'), 'dark accent-text on dark surface');
  // Dark link blue on the dark background.
  assert.ok(meetsContrast('#7db8ff', '#221d15'), 'dark link #7db8ff on dark page');
  // Dark-theme body and muted text pass on the dark background.
  assert.ok(meetsContrast('#f2ede4', '#221d15'));
  assert.ok(meetsContrast('#a89f8c', '#221d15'), 'dark muted #a89f8c on dark page');
  // A filled dark-theme primary button: white text on the brand blue.
  assert.ok(meetsContrast('#ffffff', '#0066cc'));
});
