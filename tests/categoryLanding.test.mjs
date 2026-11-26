// Category landing pages (Nov 25, 2026): one route per homepage
// section, each with its own hero + search + destination cards,
// distinct SEO title/meta, honest labelled prices only. Run:
// node --no-warnings --import ./tests/register-loader.mjs --test tests/categoryLanding.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_TABS, tabRowsFor } from '../lib/homeTabs.ts';
import {
  CATEGORY_LANDING,
  FEATURED_FLIGHT_ROUTE,
  categoryRouteFor,
  categoryTabForRoute,
  featuredFlightDates,
} from '../lib/categoryLanding.ts';
import { ALT_CITY_PHOTOS, CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from '../lib/data.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const TABS = HOME_TABS.map((t) => t.id);
const POOL = new Set([
  ...GLOBAL_DESTINATIONS.map((d) => d.image),
  ...HIDDEN_GEMS.map((d) => d.image),
  ...Object.values(CITY_PHOTOS),
  ...Object.values(ALT_CITY_PHOTOS),
]);

test('landing: one config entry per homepage tab, routes unique and absolute', () => {
  assert.deepEqual(Object.keys(CATEGORY_LANDING).sort(), [...TABS].sort());
  const routes = TABS.map((t) => CATEGORY_LANDING[t].route);
  assert.equal(new Set(routes).size, routes.length);
  for (const r of routes) assert.ok(r.startsWith('/'), r);
  assert.equal(categoryRouteFor('flights'), '/flights');
  assert.equal(categoryRouteFor('hotels'), '/hotels');
  assert.equal(categoryRouteFor('cars'), '/cars');
  assert.equal(categoryRouteFor('tours'), '/activities');
  assert.equal(categoryRouteFor('cruises'), '/cruises');
  assert.equal(categoryRouteFor('buses'), '/buses');
  assert.equal(categoryRouteFor('taxis'), '/taxis');
  for (const t of TABS) assert.equal(categoryTabForRoute(CATEGORY_LANDING[t].route), t);
  assert.equal(categoryTabForRoute('/nope'), null);
});

test('landing: distinct SEO titles and descriptions, one H1 each', () => {
  const titles = TABS.map((t) => CATEGORY_LANDING[t].metaTitle);
  const descs = TABS.map((t) => CATEGORY_LANDING[t].metaDescription);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(descs).size, descs.length);
  for (const t of TABS) {
    const c = CATEGORY_LANDING[t];
    assert.ok(c.h1.length > 0);
    assert.ok(c.metaTitle.includes('FujinTrip'), c.metaTitle);
    assert.ok(c.metaDescription.length >= 80, c.metaDescription);
    assert.equal(c.steps.length, 3);
    assert.equal(c.trust.length, 3);
  }
});

test('landing: every hero photo is from the verified pool, never invented', () => {
  for (const t of TABS) {
    const photo = CATEGORY_LANDING[t].heroPhoto;
    assert.ok(photo.length > 0, t);
    assert.ok(POOL.has(photo), `${t}: ${photo} is not in the verified photo pool`);
  }
});

test('landing: copy never promises on-site booking', () => {
  const config = read('lib/categoryLanding.ts');
  const component = read('components/CategoryLanding.tsx');
  for (const src of [config, component]) {
    assert.ok(!/Book now/i.test(src), 'no "Book now" on a referral-first page');
    assert.ok(!/checkout/i.test(src), 'no checkout promise on a referral-first page');
  }
  // Flights say the traveler books on the seller's site; the other
  // categories say live comparison arrives as suppliers connect.
  assert.match(CATEGORY_LANDING.flights.sub, /book on the seller/);
  for (const t of ['hotels', 'cars', 'tours', 'cruises', 'buses', 'taxis']) {
    assert.match(CATEGORY_LANDING[t].liveNote, /arrives as suppliers connect/);
  }
});

test('landing: one page file per route, each with its metadata and tab', () => {
  const expected = {
    flights: 'app/flights/page.tsx',
    hotels: 'app/hotels/page.tsx',
    cars: 'app/cars/page.tsx',
    tours: 'app/activities/page.tsx',
    cruises: 'app/cruises/page.tsx',
    buses: 'app/buses/page.tsx',
    taxis: 'app/taxis/page.tsx',
  };
  for (const t of TABS) {
    const p = expected[t];
    assert.ok(existsSync(join(ROOT, p)), p);
    const src = read(p);
    assert.ok(src.includes('export const metadata'), p);
    assert.ok(src.includes('CATEGORY_LANDING.'), p);
    assert.ok(src.includes(`<CategoryLanding tab="${t}"`), p);
  }
  // No duplicate route: the stays page is /hotels (matching
  // /hotels/[code]), not a second /stays route.
  assert.ok(!existsSync(join(ROOT, 'app/stays/page.tsx')));
});

test('landing: component renders hero + search + cards + AI path, one H1', () => {
  const src = read('components/CategoryLanding.tsx');
  assert.ok(src.includes('className="hero-booking"'));
  assert.ok(src.includes('<SearchWidget'));
  assert.ok(src.includes('tabRowsFor'));
  assert.ok(src.includes('href="/chat"'));
  assert.ok(src.includes('Plan with AI'));
  assert.equal((src.match(/<h1>/g) ?? []).length, 1);
  // Tab switcher navigates between landing pages; submit goes to
  // the homepage deep link that shows results.
  assert.ok(src.includes('categoryRouteFor(id)'));
  assert.ok(src.includes('searchQueryToParams(q)'));
  // A destination card prefills the widget, it never invents a
  // price: the label comes from tabRowsFor's kind.
  assert.ok(src.includes('planning estimate'));
  assert.ok(src.includes('full-trip planning estimate'));
});

test('landing: live-fare strip is flights-only, labelled live, honest when empty', () => {
  const src = read('components/CategoryLanding.tsx');
  assert.ok(src.includes("tab === 'flights' && <LiveFareStrip"));
  assert.ok(src.includes("fetch('/api/ignav-fares'"));
  assert.ok(src.includes("fetch('/api/letsfg-fares'"));
  assert.ok(src.includes('ignavEmptyMessage'));
  assert.ok(src.includes('letsfgEmptyMessage'));
  assert.ok(src.includes('Live fare'));
  assert.ok(src.includes('checked '));
  assert.ok(src.includes('not on FujinTrip'));
});

test('landing: featured flight dates roll forward, 7-day trip, ISO shape', () => {
  const d = featuredFlightDates(new Date(2026, 10, 25));
  assert.equal(d.depart, '2026-12-23');
  assert.equal(d.return, '2026-12-30');
  assert.match(d.depart, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(FEATURED_FLIGHT_ROUTE.from, 'New York');
  assert.equal(FEATURED_FLIGHT_ROUTE.to, 'London');
  assert.equal(FEATURED_FLIGHT_ROUTE.travelers, 2);
});

test('landing: rows are legs where the planner breaks one out, full-trip elsewhere', () => {
  for (const t of ['flights', 'hotels', 'cars', 'tours']) {
    const rows = tabRowsFor(t, 2);
    assert.ok(rows.length > 0, t);
    assert.ok(rows.every((r) => r.kind === 'leg'), t);
  }
  for (const t of ['cruises', 'buses', 'taxis']) {
    const rows = tabRowsFor(t, 2);
    assert.ok(rows.length > 0, t);
    assert.ok(rows.every((r) => r.kind === 'full-trip'), t);
  }
});

test('landing: homepage links to the landing pages', () => {
  const app = read('components/FujinApp.tsx');
  assert.ok(app.includes('categoryRouteFor(t.id)'), 'footer Book column links landing pages');
  const results = read('components/SearchResults.tsx');
  assert.ok(results.includes('categoryRouteFor(query.tab)'), 'per-tab results link their landing page');
  assert.ok(results.includes('See the {label} page →'));
});

test('landing: CSS exists and collapses to one column on mobile', () => {
  const css = read('app/globals.css');
  for (const cls of ['.landing-cards', '.landing-live', '.landing-live-fares', '.landing-steps', '.landing-trust', '.landing-ai', '.landing-explore']) {
    assert.ok(css.includes(cls), cls);
  }
  assert.ok(css.includes('.landing-steps{grid-template-columns:1fr}'));
  assert.ok(css.includes('.landing-trust{grid-template-columns:1fr}'));
});
