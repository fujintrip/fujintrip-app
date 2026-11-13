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

test('categories: the 17 planner routes carry categories from their own stops', () => {
  assert.deepEqual(categoriesFor('Europe'), ['Cities & culture']);
  assert.deepEqual(categoriesFor('Central Europe'), ['Cities & culture']);
  assert.deepEqual(categoriesFor('Portugal'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('Egypt'), ['Cities & culture', 'Beach & islands']);
  assert.deepEqual(categoriesFor('Japan'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('Italy'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('France'), ['Cities & culture', 'Food', 'Beach & islands']);
  assert.deepEqual(categoriesFor('Spain'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('Greece'), ['Cities & culture', 'Beach & islands']);
  assert.deepEqual(categoriesFor('Thailand'), ['Cities & culture', 'Food', 'Beach & islands']);
  assert.deepEqual(categoriesFor('Southeast Asia'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('Turkey'), ['Cities & culture', 'Mountains & nature', 'Beach & islands']);
  assert.deepEqual(categoriesFor('Morocco'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('India'), ['Cities & culture', 'Food']);
  assert.deepEqual(categoriesFor('UK'), ['Cities & culture']);
  assert.deepEqual(categoriesFor('Mexico'), ['Cities & culture', 'Food', 'Beach & islands']);
  assert.deepEqual(categoriesFor('USA'), ['Cities & culture']);
});

test('counts: the 26-card library — every pill has a real count, none is empty', () => {
  const LIBRARY = [
    'Europe', 'Central Europe', 'Portugal', 'Egypt', 'Japan', 'Italy', 'France', 'Spain', 'Greece', 'Thailand',
    'Southeast Asia', 'Turkey', 'Morocco', 'India', 'UK', 'Mexico', 'USA',
    'Bali', 'St. George', 'Tacoma', 'Hilo',
    'Santorini', 'Kyoto', 'Caribbean', 'Maldives', 'Paris',
  ];
  assert.equal(LIBRARY.length, 26);
  assert.deepEqual(categoryCounts(LIBRARY), [
    { category: 'Cities & culture', count: 22 },
    { category: 'Beach & islands', count: 11 },
    { category: 'Mountains & nature', count: 4 },
    { category: 'Food', count: 15 },
  ]);
  assert.equal(filterByCategory(LIBRARY, 'Mountains & nature').length, 4);
  assert.equal(filterByCategory(LIBRARY, 'All').length, 26);
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
