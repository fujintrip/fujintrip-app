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
  // The accent itself is display-only: 2.8:1 on white fails 4.5:1.
  assert.ok(contrastRatio('#f97316', '#ffffff') < 4.5, 'accent #f97316 must NOT be used for small text');
  assert.equal(meetsContrast('#f97316', '#ffffff'), false);
  // accent-text #c2410c is the small-text colour: 5.18:1.
  assert.ok(meetsContrast('#c2410c', '#ffffff'));
  assert.ok(contrastRatio('#c2410c', '#ffffff') > 5.1);
  // Light-theme body and muted text pass on white.
  assert.ok(meetsContrast('#0a0a0a', '#ffffff'));
  assert.ok(meetsContrast('#6b7280', '#ffffff'), 'light muted #6b7280 on white');
});

test('contrast: dark theme — small text on accent uses the light accent-text', () => {
  // Dark accent-text #fb923c on the dark page background.
  assert.ok(meetsContrast('#fb923c', '#0b0a09'));
  assert.ok(meetsContrast('#fb923c', '#141210'), 'dark accent-text on dark surface');
  // Dark-theme body and muted text pass on the dark background.
  assert.ok(meetsContrast('#f5f4f0', '#0b0a09'));
  assert.ok(meetsContrast('#a3a3a3', '#0b0a09'), 'dark muted #a3a3a3 on dark page');
  // A filled dark-theme accent button: near-black text on the accent.
  assert.ok(meetsContrast('#1c0a00', '#fb923c'));
});
