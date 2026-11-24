// P2 fixes (UX direction, Nov 19 2026 — independent expert review).
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/p2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { featuredPackages, isoWeekOfYear, tripOfTheWeek, tripOfTheWeekPreview } from '../lib/packages.ts';
import { buildPlan } from '../lib/planner.ts';
import { assignPhotos, ALT_CITY_PHOTOS, CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from '../lib/data.ts';
import { discoveryDestinations, priceFor } from '../lib/discovery.ts';
import { contrastRatio } from '../lib/interface.ts';
import { createPriceAlert } from '../lib/priceAlerts.ts';

const root = new URL('..', import.meta.url).pathname;
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
const fujinAppSrc = readFileSync(join(root, 'components/FujinApp.tsx'), 'utf8');
const packagesSectionSrc = readFileSync(join(root, 'components/PackagesSection.tsx'), 'utf8');
const reelsFeedSrc = readFileSync(join(root, 'components/ReelsFeed.tsx'), 'utf8');
const reelCardSrc = readFileSync(join(root, 'components/ReelCard.tsx'), 'utf8');
const searchResultsSrc = readFileSync(join(root, 'components/SearchResults.tsx'), 'utf8');
const reelComposerSrc = readFileSync(join(root, 'components/ReelComposer.tsx'), 'utf8');

// --- P2-1: Trip of the week -------------------------------------------

test('P2-1: isoWeekOfYear matches the ISO calendar week', () => {
  // Verified with `date +%V`: 2026-01-01 (Thu) is week 1, 2026-01-05
  // (Mon) week 2, 2026-11-23 week 48, 2026-12-28 week 53, and
  // 2025-12-29 (Mon) is week 1 of 2026.
  assert.equal(isoWeekOfYear(new Date('2026-01-01T12:00:00Z')), 1);
  assert.equal(isoWeekOfYear(new Date('2026-01-05T12:00:00Z')), 2);
  assert.equal(isoWeekOfYear(new Date('2026-11-23T12:00:00Z')), 48);
  assert.equal(isoWeekOfYear(new Date('2026-12-28T12:00:00Z')), 53);
  assert.equal(isoWeekOfYear(new Date('2025-12-29T12:00:00Z')), 1);
});

test('P2-1: Trip-of-the-week rotation is deterministic by week and covers all six', () => {
  const mondays = ['2026-01-01', '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02'];
  const picks = mondays.map((d) => tripOfTheWeek(new Date(`${d}T12:00:00Z`)).id);
  // Same week, same trip — deterministic, server and browser agree.
  assert.equal(tripOfTheWeek(new Date('2026-01-05T12:00:00Z')).id, tripOfTheWeek(new Date('2026-01-05T12:00:00Z')).id);
  // Six consecutive weeks pick all six featured packages, exactly once.
  assert.equal(new Set(picks).size, 6, `weeks 1–6 must cover all six featured packages, got ${picks.join(', ')}`);
  assert.deepEqual([...new Set(picks)].sort(), featuredPackages().map((p) => p.id).sort());
  // Week 53 wraps by the modulo: it picks the same trip as week 5.
  assert.equal(tripOfTheWeek(new Date('2026-12-28T12:00:00Z')).id, tripOfTheWeek(new Date('2026-01-26T12:00:00Z')).id);
  // The default (today) is always a featured package.
  assert.ok(featuredPackages().some((p) => p.id === tripOfTheWeek().id));
});

test('P2-1: the 3-day preview is the first three days of the package’s own plan — never invented', () => {
  for (const pkg of featuredPackages()) {
    const preview = tripOfTheWeekPreview(pkg);
    const expected = buildPlan(pkg.destination, 2, pkg.days).days.slice(0, 3);
    assert.deepEqual(preview, expected, `${pkg.destination}: preview must be the plan’s first three days`);
    assert.equal(preview.length, 3);
    assert.deepEqual(preview.map((d) => d.day), [1, 2, 3]);
    for (const d of preview) {
      assert.ok(d.title.length > 0 && d.morning.length > 0, 'every preview day has a title and a morning line');
    }
  }
});

test('P2-1: PackagesSection renders the Trip-of-the-week hero with its preview', () => {
  assert.ok(packagesSectionSrc.includes('tripOfTheWeek()'), 'the section picks the week’s trip');
  assert.ok(packagesSectionSrc.includes('Trip of the week'), 'the hero card is labeled Trip of the week');
  assert.ok(packagesSectionSrc.includes('pkg-preview'), 'the hero card carries the 3-day preview list');
  assert.ok(packagesSectionSrc.includes('tripOfTheWeekPreview(weekTrip)'), 'the preview comes from the week’s trip');
  assert.ok(packagesSectionSrc.includes('photosById'), 'the section takes the one-photo assignment');
});

// --- P2-2: price tools — PARTLY BUILT, Nov 21 2026 -------------------
// The review says "only on live fares, never on estimates". There are
// no live fares a calendar or trend could be driven from: Ignav and
// LetsFG are the only live flight sources and neither can drive a fare
// calendar, Duffel fares are test-only, and every other price on the
// site is a planning estimate. Building fare calendars or price-trend
// lines on estimates would present guesses as quotes, so those two
// stay deferred — no code for them exists. Price alerts are the
// exception: roadmap move 4 (F5, Nov 21 2026) built them on live
// Ignav fares only — the traveler opts in on a live fare, the drop
// is measured against the fare when the alert was set, and the
// re-check runs only when My Trips opens. These tests pin both
// halves: calendar and trend stay absent, alerts exist only on
// live Ignav fares.

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next') walkFiles(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

test('P2-2 (deferred): no fare-calendar / price-trend code exists', () => {
  const priceTool = /fare[-_ ]?calendar|price[-_ ]?trend/i;
  const files = [...walkFiles(join(root, 'components')), ...walkFiles(join(root, 'lib')), ...walkFiles(join(root, 'app'))];
  const offenders = files.filter((f) => priceTool.test(f));
  assert.deepEqual(offenders, [], `price-tool files must not exist while P2-2 is deferred: ${offenders.join(', ')}`);
  assert.ok(!priceTool.test(searchResultsSrc), 'flight results render no fare calendar or price trend');
  assert.ok(!searchResultsSrc.includes('trendLine'), 'flight results never compute a trend — a trend needs live-fare history, not estimates');
});

test('P2-2 (built Nov 21 2026 — F5): price alerts exist, on live Ignav fares only', () => {
  // The alert module exists and the fare card offers it.
  assert.ok(searchResultsSrc.includes('Set price alert'), 'the Ignav fare card offers Set price alert');
  assert.ok(searchResultsSrc.includes('priceAlerts'), 'flight results wire the alert helpers');
  assert.ok(fujinAppSrc.includes('Price alerts'), 'My Trips surfaces the alerts');
  // And the creator still refuses anything that is not a live Ignav
  // fare — the deferral’s "only on live fares" rule, kept.
  const live = { source: 'Ignav', priceKind: 'live', tripType: 'roundtrip', from: 'New York', to: 'London', depart: '2026-12-10', ret: '2026-12-17', travelers: 2, cabin: 'economy', total: 1615, checkedAt: '2026-11-21T15:00:00.000Z' };
  assert.ok(createPriceAlert(live), 'a live Ignav fare takes an alert');
  assert.equal(createPriceAlert({ ...live, priceKind: 'test' }), null, 'a test fare never takes an alert');
  assert.equal(createPriceAlert({ ...live, priceKind: 'estimate' }), null, 'an estimate never takes an alert');
});

test('P2-2 (deferred): the planner’s estimates are never a price-tool baseline', () => {
  // The account page says it plainly, and the code must keep saying
  // it: a watch measures the live fare against the fare when watching
  // started; the plan’s own prices are estimates and never move, so
  // they are never the baseline.
  assert.ok(
    fujinAppSrc.includes('The plan&apos;s own prices are estimates and never move, so they are never the baseline'),
    'the price-watch explainer still states that estimates are never the baseline',
  );
});

// --- P2-3: community as a real shelf ----------------------------------

test('P2-3: the reel price line uses the planner’s real price — or nothing at all', () => {
  // Kyoto has a planner price (Best value total for 2 travelers), so
  // its reels can carry a price; a place with no planner price shows
  // no price line, never a guessed one.
  const kyoto = priceFor('Kyoto');
  assert.ok(typeof kyoto === 'number' && kyoto > 0, 'Kyoto has a planner price');
  assert.equal(priceFor('Nowhere Atoll'), null, 'a place with no planner price has no price');
  assert.ok(reelCardSrc.includes('priceFor(post.destination)'), 'ReelCard prices from the planner, not from the reel');
  assert.ok(reelCardSrc.includes('planning estimate'), 'the reel price line is labeled a planning estimate');
});

test('P2-3: the feed shows prices, the shelf hides while empty, and the heading counts real reels', () => {
  assert.ok(reelsFeedSrc.includes('showTripPrice'), 'ReelsFeed passes showTripPrice to the cards');
  assert.ok(fujinAppSrc.includes('reelsCount !== 0'), 'the Travelers’ stories band still hides while the feed is empty');
  assert.ok(fujinAppSrc.includes('reel${reelsCount'), 'the heading counts the real reels once the feed reports');
  // The composer storage note is an open user decision — this round
  // leaves it exactly as it is.
  assert.ok(reelComposerSrc.includes('stored on this server for now'), 'the composer storage note is untouched by this round');
});

// --- P2-4: image discipline in the data -------------------------------

// The homepage card list in claim order — the same order FujinApp
// builds in its homepagePhotos memo (featured → gems → voices →
// Popular). LOCAL_VOICES_PLACES is ['Kyoto', 'Barcelona', 'Tokyo']
// (components/HomeSections.tsx); mirrored here so the test does not
// import a .tsx component.
function homepageCards() {
  const cards = [];
  for (const p of featuredPackages()) {
    cards.push({ key: `pkg:${p.id}`, destination: p.destination, stopCities: p.stops });
  }
  for (const g of HIDDEN_GEMS) {
    cards.push({ key: `gem:${g.name}`, destination: g.name, ownPhoto: g.image });
  }
  for (const place of ['Kyoto', 'Barcelona', 'Tokyo']) {
    cards.push({ key: `voice:${place}`, destination: place });
  }
  const homeBandNames = new Set([
    ...featuredPackages().map((p) => p.destination),
    ...HIDDEN_GEMS.map((g) => g.name),
    'Europe',
    'Kyoto',
    'Barcelona',
    'Tokyo',
  ]);
  const discovery = discoveryDestinations();
  for (const e of discovery) {
    if (homeBandNames.has(e.destination)) continue;
    cards.push({ key: `popular:${e.destination}`, destination: e.destination, stopCities: e.stops.map((s) => s.city) });
  }
  for (const d of GLOBAL_DESTINATIONS) {
    if (discovery.some((e) => e.destination === d.name)) continue;
    if (homeBandNames.has(d.name)) continue;
    cards.push({ key: `popular:${d.name}`, destination: d.name });
  }
  return cards;
}

test('P2-4: one photo per destination — no photo URL appears on two homepage cards', () => {
  const m = assignPhotos(homepageCards());
  assert.equal(m.size, 27, 'the homepage has 27 photo cards');
  const seen = new Map();
  for (const [key, photos] of m) {
    for (const p of photos) {
      assert.ok(!seen.has(p), `${key} reuses the photo already on ${seen.get(p)}: ${p}`);
      seen.set(p, key);
    }
  }
});

test('P2-4: the featured band keeps its photos; the three collisions fall back honestly', () => {
  const m = assignPhotos(homepageCards());
  for (const p of featuredPackages()) {
    const photos = m.get(`pkg:${p.id}`) ?? [];
    assert.ok(photos.length > 0, `featured ${p.destination} keeps a photo — the hero must be photo-led`);
    assert.equal(photos[0], p.photo, `featured ${p.destination} keeps its own lead photo`);
  }
  // The three collisions, in claim order: the place's own card keeps
  // its photo; the route or duplicate card falls back to the labeled
  // tile instead of a borrowed photo. (Round 2, Nov 21 2026 — P0-6b:
  // Tokyo and Spain used to collide too, until the Shibuya second
  // photo and the Madrid stop photo gave them their own.)
  assert.deepEqual(m.get('voice:Tokyo'), [ALT_CITY_PHOTOS.Tokyo], 'Tokyo’s voices card takes the Shibuya second photo — the Skytree belongs to the Japan package');
  assert.deepEqual(m.get('popular:Spain'), [CITY_PHOTOS.Madrid], 'Spain takes the Madrid stop photo — the Sagrada Familia belongs to Barcelona’s voices card');
  assert.deepEqual(m.get('popular:Santorini'), [], 'Santorini’s own card falls back — its photo belongs to the Greece package');
  assert.deepEqual(m.get('popular:Paris'), [], 'Paris’s own card falls back — its photo belongs to the France route');
  assert.ok((m.get('voice:Kyoto') ?? []).length > 0, 'Kyoto keeps its photo on its own voices card');
  assert.ok((m.get('voice:Barcelona') ?? []).length > 0, 'Barcelona keeps its photo on its own voices card');
});

test('P2-4: the assignment is deterministic and uses only the verified photo pool', () => {
  const a = assignPhotos(homepageCards());
  const b = assignPhotos(homepageCards());
  assert.deepEqual([...a.entries()], [...b.entries()], 'same input, same assignment');
  const pool = new Set([
    ...Object.values(CITY_PHOTOS),
    ...Object.values(ALT_CITY_PHOTOS),
    ...GLOBAL_DESTINATIONS.map((d) => d.image),
    ...HIDDEN_GEMS.map((d) => d.image),
  ]);
  for (const [key, photos] of a) {
    for (const p of photos) {
      assert.ok(pool.has(p), `${key} uses a photo outside the verified pool: ${p}`);
    }
  }
});

test('P2-4: the homepage wires the assignment through — packages, gems, voices, Popular', () => {
  assert.ok(fujinAppSrc.includes('assignPhotos('), 'FujinApp builds the homepage photo assignment');
  assert.ok(fujinAppSrc.includes('<PackagesSection photosById={homepagePhotos}'), 'PackagesSection receives the assignment');
  assert.ok(fujinAppSrc.includes('photoByPlace={'), 'LocalVoicesTeaser receives its assigned photos');
  assert.ok(fujinAppSrc.includes('homepagePhotos.get(`popular:'), 'Popular entries use the assigned photos');
  assert.ok(fujinAppSrc.includes('homepagePhotos.get(`gem:'), 'hidden gems use the assigned photos');
  // A destination with no verified photo gets the labeled fallback,
  // never a borrowed one.
  assert.ok(packagesSectionSrc.includes('pkg-photo-fallback'), 'package cards keep their labeled fallback');
  assert.ok(fujinAppSrc.includes('className="img-fallback"'), 'gem and voice cards keep their labeled fallback');
});

test('P2-4: media boxes reserve their space while loading, so cards never flash blank white', () => {
  assert.ok(css.includes('.reelcard img,.reelcard video{width:100%;aspect-ratio:4/3;'), 'reel media reserves a 4/3 box before it loads');
  assert.ok(css.includes('.img-loading'), 'SafeImg/PhotoCarousel keep their shimmer placeholder while loading');
});

// --- P2-5: accessibility and dark-mode pass ---------------------------

test('P2-5: primary actions and pills meet 4.5:1 contrast in both themes', () => {
  // The primary blue #0066cc is the same fill in both themes —
  // white on it is 5.57:1, so primary buttons keep white text in
  // dark mode too (the dark override exists to pin that).
  assert.ok(contrastRatio('#ffffff', '#0066cc') >= 4.5, `white on brand #0066cc must be ≥ 4.5:1, got ${contrastRatio('#ffffff', '#0066cc').toFixed(2)}`);
  // Dark mode: pills read in the light link blue, not the brand blue.
  assert.ok(contrastRatio('#7db8ff', '#221d15') >= 4.5, `dark pill link on card must be ≥ 4.5:1, got ${contrastRatio('#7db8ff', '#221d15').toFixed(2)}`);
  assert.ok(contrastRatio('#0066cc', '#221d15') < 4.5, 'brand blue as pill text fails in dark mode — that is why pills use the link blue');
  // Light mode: the success green was darkened from #0c8a4a (4.42:1)
  // to #0b7f45 so success text passes on white and on its soft bg.
  assert.ok(contrastRatio('#0b7f45', '#ffffff') >= 4.5, `light success on white must be ≥ 4.5:1, got ${contrastRatio('#0b7f45', '#ffffff').toFixed(2)}`);
  assert.ok(contrastRatio('#0b7f45', '#e9f5ee') >= 4.5, `light success on success-soft must be ≥ 4.5:1, got ${contrastRatio('#0b7f45', '#e9f5ee').toFixed(2)}`);
  // Dark mode success was already passing and is unchanged.
  assert.ok(contrastRatio('#4ade80', '#12291a') >= 4.5, 'dark success on dark success-soft stays passing');
});

test('P2-5: the CSS carries the fixes — a.primary styling, dark overrides, focus rings', () => {
  assert.ok(css.includes('--success:#0b7f45'), 'light success token is the darkened #0b7f45');
  assert.ok(css.includes('button.primary,a.primary{'), '<a className="primary"> links get the primary button styling');
  assert.ok(css.includes('[data-theme="dark"] button.primary,[data-theme="dark"] a.primary,[data-theme="dark"] .hero-cta a{color:#fff}'), 'dark-mode primary actions use white text');
  assert.ok(css.includes('[data-theme="dark"] .pill{color:var(--link)}'), 'dark-mode pills use the link blue');
  assert.ok(css.includes('a:focus-visible'), 'links get a visible focus ring');
  assert.ok(css.includes('textarea:focus-visible'), 'textareas get a visible focus ring');
  assert.ok(css.includes('.sw-bar .sw-field:focus-within{background:var(--accent-soft);border-radius:var(--r-sm);outline:2px solid var(--brand);outline-offset:2px}'), 'focused search fields get a blue outline on the white bar');
  assert.ok(css.includes('.pkg-preview{'), 'the Trip-of-the-week preview list is styled');
  assert.ok(css.includes('.reel-trip-price{'), 'the reel trip-price line is styled');
});
