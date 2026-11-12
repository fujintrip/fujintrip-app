// Template categories (Layla-dynamic round) — unit tests for the
// honest filter pills on the Global packages grid. Run:
// node --no-warnings --import ./tests/register-loader.mjs --test tests/categories.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriesFor, categoryCounts, filterByCategory } from '../lib/tripCategories.ts';

const GLOBAL = ['Santorini', 'Kyoto', 'Bali', 'Caribbean', 'Maldives', 'Paris'];

test('categories: every Global package carries only categories its own card supports', () => {
  assert.deepEqual(categoriesFor('Santorini'), ['Cities & culture', 'Beach & islands']);
  assert.deepEqual(categoriesFor('Kyoto'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('Bali'), ['Beach & islands', 'Food', 'Cities & culture']);
  assert.deepEqual(categoriesFor('Caribbean'), ['Beach & islands', 'Food']);
  assert.deepEqual(categoriesFor('Maldives'), ['Beach & islands']);
  assert.deepEqual(categoriesFor('Paris'), ['Cities & culture', 'Food']);
});

test('categories: hidden gems are categorized from their own cards too', () => {
  assert.deepEqual(categoriesFor('St. George'), ['Mountains & nature']);
  assert.deepEqual(categoriesFor('Tacoma'), ['Mountains & nature', 'Cities & culture']);
  assert.deepEqual(categoriesFor('Hilo'), ['Mountains & nature', 'Beach & islands', 'Food']);
});

test('categories: unknown destinations get no categories — never guessed', () => {
  assert.deepEqual(categoriesFor('Zanzibar'), []);
  assert.deepEqual(categoriesFor('Porto'), []);
  assert.deepEqual(categoriesFor(''), []);
});

test('filter: All returns everything; each category returns exactly its members', () => {
  assert.deepEqual(filterByCategory(GLOBAL, 'All'), GLOBAL);
  assert.deepEqual(filterByCategory(GLOBAL, 'Beach & islands'), ['Santorini', 'Bali', 'Caribbean', 'Maldives']);
  assert.deepEqual(filterByCategory(GLOBAL, 'Cities & culture'), ['Santorini', 'Kyoto', 'Bali', 'Paris']);
  assert.deepEqual(filterByCategory(GLOBAL, 'Food'), ['Kyoto', 'Bali', 'Caribbean', 'Paris']);
  assert.deepEqual(filterByCategory(GLOBAL, 'Mountains & nature'), []);
  // The filter never mutates its input.
  const names = [...GLOBAL];
  filterByCategory(names, 'Food');
  assert.deepEqual(names, GLOBAL);
});

test('counts: pill counts are real — Mountains & nature has no Global package, so it gets no pill', () => {
  assert.deepEqual(categoryCounts(GLOBAL), [
    { category: 'Cities & culture', count: 4 },
    { category: 'Beach & islands', count: 4 },
    { category: 'Food', count: 4 },
  ]);
  // Across all nine cards, Mountains & nature exists — the category is
  // real, just not represented on the Global grid.
  const all = [...GLOBAL, 'St. George', 'Tacoma', 'Hilo'];
  assert.ok(categoryCounts(all).some((c) => c.category === 'Mountains & nature' && c.count === 3));
});
