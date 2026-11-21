// UX round 2 (Nov 21, 2026 — direction files/ux-expert-direction-2026-11-21-round2.md).
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/ux-round2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { bestTimeFor, bestTimeLine } from '../lib/bestTime.ts';
import { buildPlan } from '../lib/planner.ts';
import { priceFor } from '../lib/discovery.ts';
import { readyMadePackages, tripOfTheWeek } from '../lib/packages.ts';
import { REELS_SEED } from '../lib/reelsSeed.ts';
import { listPosts } from '../lib/reelsStore.ts';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
const fujinAppSrc = readFileSync(join(root, 'components/FujinApp.tsx'), 'utf8');
const packagesSectionSrc = readFileSync(join(root, 'components/PackagesSection.tsx'), 'utf8');
const searchWidgetSrc = readFileSync(join(root, 'components/SearchWidget.tsx'), 'utf8');
const searchResultsSrc = readFileSync(join(root, 'components/SearchResults.tsx'), 'utf8');
const homeSectionsSrc = readFileSync(join(root, 'components/HomeSections.tsx'), 'utf8');
const duffelSrc = readFileSync(join(root, 'lib/duffel.ts'), 'utf8');

// --- P0-1: photographic hero --------------------------------------------

test('round 2 P0-1: the hero is a photo with a scrim, one question, one line, AI as a quiet text link', () => {
  assert.ok(css.includes('.hero-photo{background-size:cover;background-position:center;position:relative}'), 'the photo hero is full-bleed');
  assert.ok(css.includes('.hero-photo::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,14,35,.55)'), 'a scrim keeps the white text readable');
  assert.ok(css.includes('.hero-photo .hero-booking-inner{position:relative;z-index:1;padding:72px 24px 64px}'), 'the photo hero has room to breathe');
  assert.ok(fujinAppSrc.includes("className={`hero-booking${heroPhoto ? ' hero-photo' : ''}`}"), 'the hero takes the photo class only when a photo exists');
  assert.ok(fujinAppSrc.includes('backgroundImage: `url(${heroPhoto})`'), 'the hero photo is this week’s trip’s own lead photo');
  assert.ok(fujinAppSrc.includes('Named for Fujin, Japan’s wind god — ride the wind, pay less.'), 'the eyebrow names the wind god');
  assert.ok(fujinAppSrc.includes('One trip, one price, one plan — flights, stay, car and activities included. All-in, no hidden fees.'), 'one line, one price, one plan');
  assert.ok(fujinAppSrc.includes('Not sure yet? <a href="/chat">Ask Fujin AI →</a>'), 'AI is a quiet text link, not a button');
  assert.ok(fujinAppSrc.includes('All-in prices · No hidden fees · Compare prices from different sources'), 'the trust line lives inside the hero');
  assert.ok(!fujinAppSrc.includes('trustStrip('), 'no standalone trust strip remains');
});

// --- P0-2: typography -----------------------------------------------------

test('round 2 P0-2: Plus Jakarta Sans display, one scale — hero 56–72, sections 32, cards 20, prices 24, body 16', () => {
  const layout = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
  assert.ok(layout.includes('Plus_Jakarta_Sans'), 'the display face loads via next/font/google');
  assert.ok(!layout.includes('DM_Sans'), 'DM Sans is dropped');
  assert.ok(css.includes("--font-display:'Plus Jakarta Sans'"), 'the display token is Plus Jakarta Sans');
  assert.ok(css.includes('.hero-booking-inner h1{color:var(--ink);font-size:clamp(40px,5.5vw,72px);font-weight:800'), 'the hero headline is 56–72px at weight 800');
  assert.ok(css.includes('.home-section h2{margin:0 0 6px;font-size:32px;font-weight:800}'), 'section titles are 32px/800');
  assert.ok(css.includes('.pkg-body h3{margin:10px 0 2px;font-size:20px'), 'card titles are 20px');
  assert.ok(css.includes('.card .body h3{font-size:20px'), 'destination card titles are 20px');
  assert.ok(css.includes('.pkg-price{font-family:var(--font-display);font-size:24px'), 'package prices are 24px in the display face');
  assert.ok(css.includes('.result-price{font-family:var(--font-display);font-size:24px'), 'destination prices are 24px in the display face');
  assert.ok(css.includes('.fare-card-price strong{display:block;font-family:var(--font-display);font-size:24px'), 'fare totals are 24px in the display face');
  assert.ok(css.includes('.flight-option-price strong{font-family:var(--font-display);font-size:24px'), 'trip totals are 24px in the display face');
  assert.ok(css.includes('.card .body p{font-size:16px'), 'body text is 16px');
  assert.ok(css.includes('.eyebrow{font-size:12px;font-weight:700;text-transform:uppercase'), 'eyebrows are 12px uppercase');
});

// --- P0-3: one grid ---------------------------------------------------------

test('round 2 P0-3: one 12-column grid, one 24px gap token, one card component', () => {
  assert.ok(css.includes('--gap:24px'), 'one gap token');
  assert.ok(css.includes('.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--gap)}'), 'the destination grid is 12 columns');
  assert.ok(css.includes('.grid>.card{grid-column:span 4}'), 'cards span 4');
  assert.ok(css.includes('.pkg-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--gap)}'), 'the package grid is the same 12 columns');
  assert.ok(css.includes('.pkg-card{grid-column:span 4}'), 'package cards span 4');
  assert.ok(css.includes('.steps{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--gap)}'), 'how-it-works is the same 12 columns');
  assert.ok(css.includes('.step{grid-column:span 4}'), 'steps span 4');
  assert.ok(css.includes('.feature-row{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--gap)'), 'the feature row is the same 12 columns');
  assert.ok(css.includes('.feature-photo{grid-column:span 7'), 'the feature photo spans 7');
  assert.ok(css.includes('.feature-body{grid-column:span 5'), 'the feature body spans 5');
  assert.ok(!css.includes('.pkg-card--hero'), 'no hero card variant remains');
  assert.ok(!packagesSectionSrc.includes('hero?: boolean'), 'no hero prop on the card component');
  assert.ok(!packagesSectionSrc.includes('hero={'), 'no hero prop passed anywhere');
  for (const grid of ['.result-cards', '.reels-grid', '.continue-cards', '.flight-card-grid']) {
    assert.ok(new RegExp(`\\${grid}\\{[^}]*gap:var\\(--gap\\)`).test(css), `${grid} uses the gap token`);
  }
});

// --- P0-4: six-band section plan -------------------------------------------

test('round 2 P0-4: Trip of the week, then Ready-made (6, week trip never repeats), Destinations with gems, Plan/Book/Follow, Community', () => {
  const weekTrip = tripOfTheWeek();
  const ready = readyMadePackages();
  assert.equal(ready.length, 6, 'six Ready-made cards');
  assert.ok(!ready.some((p) => p.id === weekTrip.id), 'the week’s trip never repeats in Ready-made');
  assert.ok(ready.some((p) => p.destination === 'India'), 'the cheapest trip with no other band fills the sixth slot');
  assert.ok(packagesSectionSrc.includes('export function TripOfTheWeekFeature'), 'the week’s trip is a feature row in its own band');
  assert.ok(fujinAppSrc.includes('<TripOfTheWeekFeature'), 'the homepage renders the feature row');
  assert.ok(fujinAppSrc.indexOf('<TripOfTheWeekFeature') < fujinAppSrc.indexOf('<PackagesSection'), 'the feature row precedes Ready-made');
  assert.ok(fujinAppSrc.includes('<PackagesSection photosById={homepagePhotos} savedKeys={savedKeys} onSavePackage={savePackageDetail} />'), 'Ready-made renders after the feature row');
  assert.ok(fujinAppSrc.includes('className="gems-row"'), 'hidden gems are a labelled row inside Destinations');
  assert.ok(fujinAppSrc.includes('<p className="eyebrow">Hidden gems</p>'), 'the gems row is labeled');
  assert.ok(!fujinAppSrc.includes('Show more destinations'), 'no destinations expander');
  assert.ok(homeSectionsSrc.includes('export function ContinueBar'), 'the compact continue bar exists');
  assert.ok(fujinAppSrc.includes('<ContinueBar'), 'the homepage shows the one-line bar under the hero');
  assert.ok(fujinAppSrc.includes('<ContinueStrip'), 'the full strip lives on /account');
});

// --- P0-5: search-widget repair --------------------------------------------

test('round 2 P0-5: the trip type sits above the bar, fields fit, the dropdown is wide, the results bar is static', () => {
  // The trip-type control is a flex child no more: it renders above
  // the bar in the form, so the bar holds only fields + the button.
  const barAt = searchWidgetSrc.indexOf('<div className="sw-bar">');
  const controlAt = searchWidgetSrc.indexOf('<TripTypeControl value={tripType} onChange={switchTripType} />', searchWidgetSrc.indexOf(') : ('));
  assert.ok(controlAt > -1 && controlAt < barAt, 'the trip-type control renders above the bar');
  assert.ok(!searchWidgetSrc.slice(barAt, barAt + 200).includes('TripTypeControl'), 'the bar itself holds no trip-type control');
  assert.ok(css.includes('.sw-bar .sw-field{flex:1 1 150px;min-width:150px'), 'bar fields are 150px minimum');
  assert.ok(css.includes('.sw-bar .sw-field--narrow{flex:1 1 120px;min-width:120px}'), 'time fields are 120px');
  assert.ok(css.includes('.sw-suggestions{position:absolute;left:0;right:auto;'), 'the dropdown is not pinned to its narrow field');
  assert.ok(css.includes('min-width:320px;max-width:min(420px,calc(100vw - 32px));width:max-content'), 'the dropdown is at least 320px with full names');
  assert.ok(css.includes('@media (max-width:1100px){'), 'the bar wraps below 1100px');
  assert.ok(css.includes('.sw-bar{flex-wrap:wrap;border-radius:24px}'), 'the wrapped bar keeps a sane radius');
  assert.ok(!/\.results-bar\{[^}]*position:sticky/.test(css), 'the results bar is static, not sticky');
  assert.ok(css.includes('.results-filters{position:sticky;top:76px}'), 'the filter rail sits 76px down');
  assert.ok(css.includes('#results{scroll-margin-top:76px}'), 'the scroll target clears the sticky header');
});

// --- P0-6: content defects --------------------------------------------------

test('round 2 P0-6a: every plan day reads differently — the preview days and the long trips', () => {
  const plan = buildPlan('Thailand', 2, 9);
  assert.equal(new Set(plan.days.map((d) => d.morning)).size, plan.days.length, 'all nine mornings differ');
  assert.equal(new Set(plan.days.map((d) => d.afternoon)).size, plan.days.length, 'all nine afternoons differ');
  const preview = plan.days.slice(0, 3);
  assert.ok(preview[0].morning.includes('Bangkok'), 'day 1 names Bangkok');
  assert.ok(preview[2].morning.includes('Chiang Mai'), 'day 3 names the next stop, Chiang Mai');
  const kyoto = buildPlan('Kyoto', 2, 14);
  assert.equal(new Set(kyoto.days.map((d) => d.morning)).size, kyoto.days.length, 'a 14-night single place still reads differently every day');
});

test('round 2 P0-6b: one photo per destination — Tokyo and Spain have their own photos now', () => {
  const data = readFileSync(join(root, 'lib/data.ts'), 'utf8');
  assert.ok(data.includes("Madrid: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Plaza_Mayor_de_Madrid_-_01.jpg/960px-Plaza_Mayor_de_Madrid_-_01.jpg'"), 'Madrid is in the pool (verified Nov 21: HTTP 200, JPEG)');
  assert.ok(data.includes("Tokyo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c5/Tokyo_Shibuya_Scramble_Crossing_2018-10-09.jpg/960px-Tokyo_Shibuya_Scramble_Crossing_2018-10-09.jpg'"), 'the Shibuya second photo is in the pool (verified Nov 21: HTTP 200, JPEG)');
  assert.ok(css.includes('.img-fallback{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--brand),#123a7d);color:#fff'), 'a fallback tile is a designed navy gradient, never a blank grey box');
  assert.ok(css.includes('.pkg-photo-fallback{display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;background:linear-gradient(135deg,var(--brand),#123a7d);color:#fff'), 'package fallbacks match');
});

test('round 2 P0-6c: per-destination best month — Kyoto and Tokyo bloom in April, Barcelona in May', () => {
  assert.equal(bestTimeFor('Kyoto').bestMonth, 4, 'Kyoto’s best month is April');
  assert.equal(bestTimeFor('Tokyo').bestMonth, 4, 'Tokyo’s best month is April');
  assert.equal(bestTimeFor('Barcelona').bestMonth, 5, 'Barcelona’s best month is May');
  assert.ok(bestTimeLine('Kyoto').includes('cherry blossom'), 'Kyoto names cherry blossom season');
  assert.ok(bestTimeLine('Barcelona').includes('warm and dry'), 'Barcelona names its own season');
  assert.notEqual(bestTimeLine('Kyoto'), bestTimeLine('Barcelona'), 'two destinations never share the same best-month line');
});

test('round 2 P0-6d: the community reel renders deterministically from the checked-in seed', () => {
  assert.equal(REELS_SEED.length, 1, 'one seed post');
  const seed = REELS_SEED[0];
  assert.equal(seed.author, 'Mina', 'the seed is Mina’s Kyoto note');
  assert.equal(seed.destination, 'Kyoto', 'the seed is about Kyoto');
  assert.equal(seed.moderation, 'published', 'the seed is published');
  assert.equal(seed.verified, true, 'the seed is verified');
  assert.equal(seed.media[0].storage, 'seed', 'the seed media is marked as seed storage');
  assert.equal(seed.media[0].url, 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e', 'the seed media is the verified Kyoto pool photo');
  assert.ok(readFileSync(join(root, 'components/ReelsFeed.tsx'), 'utf8').includes('showTripPrice'), 'the feed still passes the price line to the cards');
  // The store returns the seed only when no data file exists at all
  // — a deleted post never resurrects. The repo HAS a data file, so
  // the in-process store returns the file (local-dev media), not the
  // seed; the no-file path is checked in a clean directory below.
  assert.ok(readFileSync(join(root, 'lib/reelsStore.ts'), 'utf8').includes('fs.existsSync(POSTS_FILE)'), 'the seed gate is an exists check on the file');
});

test('round 2 P0-6d: no data file → the seed; a data file → the file wins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fujin-reels-'));
  try {
    const { stdout } = await execFileAsync('node', [
      '--no-warnings', '--import', join(root, 'tests/register-loader.mjs'),
      '--input-type=module', '-e',
      `import { listPosts } from '${join(root, 'lib/reelsStore.ts')}'; console.log(JSON.stringify((await listPosts()).map((p) => p.id)))`,
    ], { cwd: dir });
    assert.deepEqual(JSON.parse(stdout), ['reel_mwd0vb6yfe42c28c'], 'no data file → the checked-in seed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const filed = await listPosts();
  const mina = filed.find((p) => p.id === 'reel_mwd0vb6yfe42c28c');
  assert.ok(mina, 'the local file still carries Mina’s post');
  assert.equal(mina.media[0].storage, 'local-dev', 'with a data file, the file wins — the seed never overwrites it');
});

test('round 2 P1-3: Bali no longer shares Thailand’s total', () => {
  assert.equal(priceFor('Bali'), 1900, 'Bali is $1,900 for 2 travelers ($950 each)');
  assert.equal(priceFor('Thailand'), 2500, 'Thailand stays $2,500 for 2 travelers');
  assert.notEqual(priceFor('Bali'), priceFor('Thailand'), 'a 2-night single place and a 9-night route never share a total');
});

// --- P0-7: one price per flight card ----------------------------------------

test('round 2 P0-7: the headline carries one dollar amount; the per-traveler figure and the fee live on the breakdown line', () => {
  assert.ok(searchResultsSrc.includes('function TripPriceHeader({ total, prefix }'), 'the price header takes only the total and its prefix');
  assert.ok(!searchResultsSrc.includes('TripPriceHeader total={total} travelers='), 'no card passes travelers to the header anymore');
  assert.ok(searchResultsSrc.includes('function FlightPriceBreakdown'), 'the breakdown line exists');
  assert.ok(searchResultsSrc.includes('<FlightPriceBreakdown total={total} travelers={travelers} fee={fee} />'), 'Duffel pairs break down per-traveler + fee');
  assert.ok(searchResultsSrc.includes('<FlightPriceBreakdown total={offer.price} travelers={travelers} fee={fee} />'), 'Duffel one-ways break down per-traveler + fee');
  assert.ok(searchResultsSrc.includes('<FlightPriceBreakdown total={itinerary.price} travelers={travelers} />'), 'Ignav and LetsFG groups break down per-traveler');
  // The fee is never hidden and never removed: the exact tiered-fee
  // expressions still feed the breakdown, and the fee line itself
  // lives in the shared flightBreakdownParts helper (rendered-check
  // fix, Nov 21 2026) that every card renders through.
  assert.ok(searchResultsSrc.includes('const fee = serviceFee(total);'), 'the pair fee is still computed from the tiered rule');
  assert.ok(searchResultsSrc.includes('const fee = serviceFee(offer.price);'), 'the one-way fee is still computed from the tiered rule');
  assert.ok(searchResultsSrc.includes('flightBreakdownParts(total, travelers, fee)'), 'the pair breakdown carries the fee');
  assert.ok(searchResultsSrc.includes('flightBreakdownParts(offer.price, travelers)'), 'standalone fare cards break down per-traveler too');
  assert.ok(duffelSrc.includes('`+ $${fee.toLocaleString()} service fee per flight order`'), 'the fee still reads separately on the card');
  assert.ok(searchResultsSrc.includes('className="fare-card-breakdown"'), 'standalone fare cards break down per-traveler below the price');
  assert.ok(css.includes('.flight-option-breakdown{color:var(--muted);font-size:13px;margin:0 0 12px}'), 'the group breakdown line is styled');
  assert.ok(css.includes('.fare-card-breakdown{color:var(--muted);font-size:13px;margin:8px 0 0}'), 'the fare-card breakdown line is styled');
});

// --- P1: 390px acceptance gate (CSS/dev-server checks) -----------------------

test('round 2 P1: 390px — grids stack, the bar stacks, inputs stay 16px, no horizontal overflow', () => {
  const mobile = css.slice(css.indexOf('Mobile layout (Nov 15'));
  assert.ok(mobile.includes('input,select,textarea{font-size:16px}'), '16px form fields at phone width — iOS never zooms');
  assert.ok(mobile.includes('body{overflow-x:clip}'), 'no horizontal scroll on a phone');
  assert.ok(css.includes('.sw-bar{flex-direction:column'), 'the pill bar stacks on a phone');
  assert.ok(css.includes('.sw-suggestions{left:0;right:0;width:auto;min-width:0}'), 'the dropdown goes full-width on a phone');
  assert.ok(css.includes('.grid>.card{grid-column:span 12}'), 'destination cards are full-width at ≤640px');
  assert.ok(css.includes('.pkg-card{grid-column:span 12}'), 'package cards are full-width at ≤640px');
  assert.ok(css.includes('.feature-photo{grid-column:span 12;min-height:240px}'), 'the feature photo stacks above its body');
  assert.ok(css.includes('.hero-photo .hero-booking-inner{padding:36px 16px 32px}'), 'the photo hero stays tight on a phone');
});
