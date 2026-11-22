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

test('contrast: light theme — small text on accent uses accent-text, not the accent', () => {
  // The accent itself is display-only: 4.15:1 on white fails 4.5:1.
  assert.ok(contrastRatio('#c3603e', '#ffffff') < 4.5, 'accent #c3603e must NOT be used for small text');
  assert.equal(meetsContrast('#c3603e', '#ffffff'), false);
  // accent-text #9e4a2c is the small-text colour: 6.05:1.
  assert.ok(meetsContrast('#9e4a2c', '#ffffff'));
  assert.ok(contrastRatio('#9e4a2c', '#ffffff') > 5.1);
  // Light-theme body and muted text pass on white.
  assert.ok(meetsContrast('#060609', '#ffffff'));
  assert.ok(meetsContrast('#6b6660', '#ffffff'), 'light muted #6b6660 on white');
});

test('contrast: dark theme — small text on accent uses the light accent-text', () => {
  // Dark accent-text #f09357 on the dark page background.
  assert.ok(meetsContrast('#f09357', '#060609'));
  assert.ok(meetsContrast('#f09357', '#161214'), 'dark accent-text on dark surface');
  // Dark-theme body and muted text pass on the dark background.
  assert.ok(meetsContrast('#f5f2ee', '#060609'));
  assert.ok(meetsContrast('#afaaa5', '#060609'), 'dark muted #afaaa5 on dark page');
  // A filled dark-theme accent button: near-black text on the accent.
  assert.ok(meetsContrast('#060609', '#f09357'));
});
