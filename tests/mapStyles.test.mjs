// Map styles (modern-map build, Nov 13 2026): the MapLibre style for
// the current theme, and the no-key fallback tile layers.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/mapStyles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_STYLE_LIGHT,
  MAP_STYLE_DARK,
  FALLBACK_TILE_LIGHT,
  FALLBACK_TILE_DARK,
  styleForTheme,
} from '../lib/mapStyles.ts';

test('styleForTheme picks the OpenFreeMap style for the theme', () => {
  assert.equal(styleForTheme(false), MAP_STYLE_LIGHT);
  assert.equal(styleForTheme(true), MAP_STYLE_DARK);
  assert.notEqual(MAP_STYLE_LIGHT, MAP_STYLE_DARK);
});

test('style URLs are keyless OpenFreeMap styles', () => {
  for (const url of [MAP_STYLE_LIGHT, MAP_STYLE_DARK]) {
    assert.ok(
      url.startsWith('https://tiles.openfreemap.org/styles/'),
      `${url} must be an OpenFreeMap style URL`,
    );
    assert.ok(!url.includes('key') && !url.includes('token'), `${url} must not need a key or token`);
  }
  assert.ok(MAP_STYLE_LIGHT.endsWith('/liberty'), 'light style is liberty');
  assert.ok(MAP_STYLE_DARK.endsWith('/dark'), 'dark style is dark');
});

test('fallback tiles are the no-key Esri/OSM layers', () => {
  assert.ok(
    FALLBACK_TILE_LIGHT.startsWith('https://{s}.tile.openstreetmap.org/'),
    'light fallback is OSM',
  );
  assert.ok(
    FALLBACK_TILE_DARK.startsWith('https://server.arcgisonline.com/'),
    'dark fallback is Esri World Dark Gray Canvas',
  );
  assert.ok(FALLBACK_TILE_DARK.includes('{z}/{y}/{x}'), 'Esri uses the {z}/{y}/{x} REST order');
  assert.ok(!FALLBACK_TILE_LIGHT.includes('cartocdn') && !FALLBACK_TILE_DARK.includes('cartocdn'), 'no CARTO anywhere');
});
