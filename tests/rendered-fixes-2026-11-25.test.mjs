// Rendered-check fixes (Nov 25, 2026): the Wind & wander design
// and rebuilt chat went live Nov 25, but the rendered check (1919px,
// light + dark) found the interface broken — a ~110px chat column,
// chips overflowing, the Start button covering the input, a cropped
// canvas photo, map pills over Germany/Denmark, an unreadable dark
// hero search, package names below their photos, a missing India
// photo, and a Morocco photo with a bank sign in its center. These
// pins guard each fix so a later restyle cannot silently re-break
// the live render.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/rendered-fixes-2026-11-25.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITY_INFO } from '../lib/tripCard.ts';
import { CITY_PHOTOS, ROUTE_PHOTO_CITY } from '../lib/data.ts';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
// Comments mention the old class names (the fix notes); strip them
// before asserting a selector is really gone.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
const pkgs = readFileSync(new URL('../components/PackagesSection.tsx', import.meta.url), 'utf8');
const leaflet = readFileSync(new URL('../components/TripMapLeaflet.tsx', import.meta.url), 'utf8');
const data = readFileSync(new URL('../lib/data.ts', import.meta.url), 'utf8');

test('defect 1: the chat column is an equal half of the 50/50 split, not a leaked width', () => {
  // User feedback Nov 25: the columns were not equal. The grid is
  // now an exact 50/50 split — 1fr 1fr, no minmax, no px — so both
  // halves are equal at every desktop width.
  assert.ok(css.includes('.chat-split{position:relative;display:grid;grid-template-columns:1fr 1fr;'), 'the split grid is an exact 50/50');
  assert.ok(!css.includes('grid-template-columns:minmax(360px,420px)'), 'no 420px chat track survives');
  // Both halves are pinned to their tracks — no outside rule can
  // shrink either one.
  assert.ok(css.includes('.chat-split .chatcol{display:flex;flex-direction:column;width:auto;min-width:0;'), 'the chat column has width:auto + min-width:0');
  assert.ok(css.includes('.chat-split .canvas{overflow-y:auto;min-height:0;min-width:0;'), 'the canvas has min-width:0');
  // The leak is gone: no bare .chatcol width rule anywhere (the old
  // rule set width:35% and matched the new chat's column).
  assert.ok(!/^\.chatcol\{[^}]*width:/m.test(cssNoComments), 'no bare .chatcol width rule survives');
  assert.ok(!cssNoComments.includes('.chatmap'), 'no .chatmap selector survives');
  assert.ok(!cssNoComments.includes('.zonebar'), 'no .zonebar selector survives');
  assert.ok(!cssNoComments.includes('width:min(500px,'), 'no min(500px, …) chat-column width survives');
});

test('defect 2: chips fit inside the chat column and wrap', () => {
  assert.ok(css.includes('.chat-split .chips .chip{flex:0 1 auto;min-width:0;max-width:100%;'), 'chips shrink to the column instead of sticking out');
  assert.ok(css.includes('.chat-split .chips{display:flex;flex-wrap:wrap;'), 'the chip row wraps');
});

test('defect 3: the Start button cannot cover the message input', () => {
  // The input takes the remaining width of the row and the button
  // keeps its own width — with the half at ~418px (the narrowest
  // desktop split, at a 901px viewport) both still fit.
  assert.ok(css.includes('.chat-split .hero-input input{flex:1 1 auto;min-width:0;min-height:56px;'), 'the input flexes to the remaining row width');
  assert.ok(css.includes('.chat-split .hero-input .primary{min-height:56px;padding:0 28px;'), 'the Start button keeps its own width');
  // No absolute positioning anywhere in the chat input area.
  assert.ok(!cssNoComments.includes('.chat-split .hero-input .primary{position:absolute'), 'the button is never absolutely positioned over the input');
});

test('defect 4: canvas photos use object-fit:cover and show their subject', () => {
  // The old bare rule hid the S0 photo entirely, at every width.
  assert.ok(!cssNoComments.includes('.s0-photo{display:none}'), 'no rule hides the S0 photo');
  // The .safeimg wrapper is pinned to the aspect-ratio box, so the
  // height:100% chain works and cover engages (before, the image
  // rendered top-aligned at its intrinsic ratio, subject cut off).
  assert.ok(css.includes('.chat-split .s0-photo{position:relative;'), 'the S0 photo box is positioned');
  assert.ok(css.includes('.chat-split .s0-photo .safeimg{position:absolute;inset:0}'), 'the S0 photo wrapper fills its box');
  assert.ok(css.includes('.chat-split .summary-photo{position:relative;'), 'the summary photo box is positioned');
  assert.ok(css.includes('.chat-split .summary-photo .safeimg{position:absolute;inset:0}'), 'the summary photo wrapper fills its box');
  // Skyline photos bias toward the lower subject (Prague spires,
  // Vienna's Gloriette sit low under a sky-heavy top). Second fix
  // round (Nov 25, 2026): the 16/9 box was nearly the same aspect
  // as the Prague photo (16/10), so a 65% bias could only ever crop
  // ~56px of sky away. The header is now a 21/9 strip pinned to
  // the bottom of the photo.
  assert.ok(css.includes('.chat-split .summary-photo img,.chat-split .summary-photo .img-fallback,.chat-split .summary-photo .img-loading{width:100%;height:100%;object-fit:cover;object-position:center 100%}'), 'the summary photo crops to the bottom of the photo');
});

test('defect 5: the map is tall enough for the pill stacks, and the cities are where they belong', () => {
  // The coordinates were verified correct — no lat/lng swap. The
  // defect was geometry: a 320px map with 210px of top padding
  // squeezed the route into a ~62px band.
  assert.equal(CITY_INFO.Prague.lat, 50.08, 'Prague latitude');
  assert.equal(CITY_INFO.Prague.lng, 14.44, 'Prague longitude');
  assert.equal(CITY_INFO.Vienna.lat, 48.21, 'Vienna latitude');
  assert.equal(CITY_INFO.Vienna.lng, 16.37, 'Vienna longitude');
  assert.equal(CITY_INFO.Budapest.lat, 47.5, 'Budapest latitude');
  assert.equal(CITY_INFO.Budapest.lng, 19.04, 'Budapest longitude');
  // 480px gives the fitted zoom room: the cities sit ~166px apart,
  // so the ~110px pills clear each other.
  assert.ok(css.includes('.chat-split .map-card{min-height:480px}'), 'the chat map card is 480px tall');
  assert.ok(css.includes('.chat-split .map-card .map-skeleton{height:480px}'), 'the chat map skeleton is 480px tall');
  assert.ok(css.includes('.map-fullbleed{position:relative;height:100%;min-height:480px;'), 'the full-bleed map is 480px tall');
  assert.ok(leaflet.includes('minHeight: 480'), 'the Leaflet wrapper is 480px tall');
  assert.ok(leaflet.includes('paddingTopLeft: [48, 210]'), 'the pill-stack top padding is unchanged');
});

test('defect 6: the hero search is a white pill card with readable options in both themes', () => {
  // The bar uses fixed light values — the photo is the same in dark
  // mode, so theme tokens (dark card, near-white ink) must not apply.
  assert.ok(css.includes('.hero-booking .sw-bar{background:#fff;color:#191e3b;border-color:transparent}'), 'the bar is white with dark ink in both themes');
  assert.ok(css.includes('.hero-booking .sw-trip-type button{color:#191e3b}'), 'the trip-type options are dark ink on the white pill');
  assert.ok(css.includes('.hero-booking .sw-bar .sw-field input,.hero-booking .sw-bar .sw-field select{color:#191e3b}'), 'the bar fields are dark ink');
  assert.ok(css.includes('.hero-booking .sw-bar .sw-field>span:first-child{color:#5a6478}'), 'the bar field labels are readable grey');
  assert.ok(css.includes('.hero-booking .sw-bar .sw-stepper button{background:#fff;border-color:#d8d2c4;color:#191e3b}'), 'the steppers are light with dark ink');
});

test('defect 7: the pricing note reads on the photo in both themes', () => {
  assert.ok(css.includes('.hero-booking .sw-honest{color:rgba(255,255,255,.92);text-shadow:0 1px 8px rgba(0,0,0,.45)}'), 'the honesty line is white on the photo with a text shadow');
  assert.ok(css.includes('.hero-booking .sw-honest a{color:#fff;text-decoration:underline}'), 'its link is white and underlined');
});

test('defect 8: ready-made cards overlay name + price on the photo', () => {
  assert.ok(css.includes('.pkg-overlay{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:56px 20px 16px;background:linear-gradient(180deg,rgba(8,12,22,0),rgba(8,12,22,.78));color:#fff}'), 'the overlay is a real bottom gradient, not text straight on the photo');
  assert.ok(css.includes('.pkg-overlay h3{color:#fff;font-size:20px'), 'the overlaid name is white');
  assert.ok(css.includes('.pkg-overlay .pkg-price{color:#fff;font-size:24px}'), 'the overlaid price is white and 24px — the largest type on the card');
  assert.ok(pkgs.includes('className="pkg-overlay"'), 'the overlay renders on the package cards');
  assert.ok(pkgs.includes('className="pkg-photo-wrap"'), 'the photo carries the overlay wrapper');
  // The body keeps name + price only when there is no photo at all.
  assert.ok(pkgs.includes('{!shownPhoto && <h3>'), 'the body name renders only without a photo');
  assert.ok(pkgs.includes('{!shownPhoto && ('), 'the body price renders only without a photo');
});

test('defect 9: every ready-made card — including the filler — gets a photo', () => {
  // The filler (this week: India) is not a featured package, so it
  // never got a photo assignment and rendered the blank fallback.
  assert.ok(app.includes('readyMadePackages()'), 'the claim list includes the ready-made band');
  assert.ok(app.includes('shelfPackages'), 'featured + filler are claimed together, deduped by id');
  assert.ok(data.includes("Delhi: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/India_Gate_-_Delhi_%2837282946605%29.jpg/960px-India_Gate_-_Delhi_%2837282946605%29.jpg'"), 'the India Gate photo is in the pool');
});

test('defect 10: Morocco shows a clean Chefchaouen photo, no watermarked stock', () => {
  assert.ok(!data.toLowerCase().includes('dreamstime'), 'no Dreamstime URL survives in the photo pool');
  assert.ok(!pkgs.toLowerCase().includes('dreamstime'), 'no Dreamstime URL survives in the package cards');
  assert.ok(CITY_PHOTOS.Chefchaouen === 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Chefchaouen_%28Blue_City%29.jpg/960px-Chefchaouen_%28Blue_City%29.jpg', 'the Chefchaouen photo is the verified Commons URL');
  assert.equal(ROUTE_PHOTO_CITY.Morocco, 'Chefchaouen', 'Morocco leads with Chefchaouen, not the Koutoubia bank-sign photo');
});

test('minor: Trip of the Week actions follow the preview, and the map skeleton has padding', () => {
  assert.ok(css.includes('.feature-body .pkg-actions{margin-top:0}'), 'the feature actions no longer pin to the bottom of a 420px column');
  assert.ok(css.includes('.map-skeleton{height:100%;min-height:320px;display:flex;flex-direction:column;gap:12px;padding:16px}'), 'the map skeleton has padding so its text is not clipped at the edge');
  assert.ok(css.includes('[data-theme="dark"] .map-fullbleed{background:#221d15}'), 'the map loading base is warm charcoal in dark mode');
});
