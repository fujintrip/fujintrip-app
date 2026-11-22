// Dribbble makeover (Nov 21, 2026): "Travel App — Explore the
// World" (dribbble.com/shots/27884909), translated to the desktop
// web app. Design language only — never the shot's text, photos,
// logo or brand. The palette lives in CSS variables (one source of
// truth); this file pins the token values and the translated
// components, so a future restyle cannot silently drift the tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');

test('dribbble palette: the exact palette hexes live in the CSS variables', () => {
  // Light theme — the palette block.
  assert.ok(css.includes('--brand:#4a3f4b'), 'plum is the primary dark');
  assert.ok(css.includes('--night:#060609'), 'near-black token');
  assert.ok(css.includes('--ink:#060609'), 'ink is the near-black');
  assert.ok(css.includes('--terra:#c3603e'), 'burnt terracotta accent');
  assert.ok(css.includes('--accent:#c3603e'), 'accent is the terracotta');
  assert.ok(css.includes('--peach:#f09357'), 'peach accent');
  assert.ok(css.includes('--dusty:#4f6c91'), 'dusty slate blue secondary');
  assert.ok(css.includes('--link:#4f6c91'), 'links are the dusty blue');
  assert.ok(css.includes('--greige:#afaaa5'), 'warm greige neutrals');
  assert.ok(css.includes('--muted:#6b6660'), 'muted is the warm greige-dark');
  assert.ok(css.includes('--offwhite:#fcfcfc'), 'off-white surfaces');
  assert.ok(css.includes('--card:#fcfcfc'), 'cards are off-white');
  assert.ok(css.includes('--accent-text:#9e4a2c'), 'small-text terracotta');
  assert.ok(css.includes('--accent-ink:#7e3b22'), 'deep terracotta for AAA text');
  // The old navy system is gone from the stylesheet.
  assert.ok(!css.includes('#00255d'), 'no navy brand remains');
  assert.ok(!css.includes('#ea580c'), 'no orange accent remains');
  assert.ok(!css.includes('#123a7d'), 'no navy gradient end-stop remains');
  assert.ok(!css.includes('#1668e3'), 'no navy link blue remains');
  // Dark theme — plum-tinted darks, peach accent, dusty link.
  assert.ok(css.includes('--brand:#6b5b6d'), 'dark brand is the lighter plum');
  assert.ok(css.includes('--accent:#f09357'), 'dark accent is the peach');
  assert.ok(css.includes('--link:#93a9c6'), 'dark links are the light dusty blue');
  assert.ok(css.includes('--card:#161214'), 'dark cards are plum-tinted');
});

test('dribbble radii: 12px fields, 16px panels, 24px cards, pills stay pills', () => {
  assert.ok(css.includes('--r-sm:12px'), 'small radius is 12px');
  assert.ok(css.includes('--r-md:16px'), 'medium radius is 16px');
  assert.ok(css.includes('--r-lg:24px'), 'large radius is 24px');
  assert.ok(!css.includes('border-radius:16px'), 'no literal 16px radius — the medium tier is the variable');
  assert.ok(!css.includes('border-radius:12px'), 'no literal 12px radius — the small tier is the variable');
  assert.ok(!css.includes('border-radius:8px'), 'no literal 8px radius remains');
  assert.ok(css.includes('.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg)'), 'cards use the large radius');
});

test('dribbble hero: large light headline, plum dusk scrim, frosted pills, circular arrows', () => {
  assert.ok(css.includes('.hero-booking-inner h1{color:var(--ink);font-size:clamp(48px,6vw,84px);font-weight:300'), 'the hero headline is large and light');
  assert.ok(css.includes('.hero-photo::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,6,9,.62),rgba(74,63,75,.30) 45%,rgba(6,6,9,.72))}'), 'the scrim is a plum dusk gradient');
  assert.ok(css.includes('.hero-pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.35);background:rgba(252,252,252,.16);backdrop-filter:blur(8px)'), 'destination pills are frosted glass');
  assert.ok(css.includes('.hero-arrow{width:56px;height:56px;border-radius:50%;background:#fcfcfc;color:var(--plum)'), 'photo controls are white circles');
  assert.ok(app.includes('hero-pills'), 'the hero renders the pill row');
  assert.ok(app.includes('hero-arrow'), 'the hero renders the circular photo controls');
  assert.ok(app.includes('Photo: {currentHeroPhoto.label}'), 'the cycled photo is named, never mistaken for the week’s trip');
  assert.ok(app.includes('heroPillDestinations'), 'the pills name real destinations');
});

test('dribbble search: a dark plum pill bar with a white circular action', () => {
  assert.ok(css.includes('.sw-bar{display:flex;align-items:stretch;background:var(--brand);border:1px solid rgba(255,255,255,.14);border-radius:999px'), 'the bar is plum, not white');
  assert.ok(css.includes('.sw-bar button.primary.sw-search{background:var(--offwhite);color:var(--plum)}'), 'the bar action is a white circle with a plum magnifier');
  assert.ok(css.includes('.sw-bar .sw-field input,.sw-bar .sw-field select{border:none;padding:0;background:transparent;font-size:15px;color:#fcfcfc}'), 'bar fields read white on plum');
  assert.ok(css.includes('.sw-bar .sw-field>span:first-child{text-transform:uppercase;font-size:11px;letter-spacing:.05em;font-weight:700;color:#d8d2cc}'), 'bar labels are pale greige');
});

test('dribbble destination cards: tall portrait photos, bottom gradient, white text + pin', () => {
  assert.ok(css.includes('.dest-card .photocarousel img{aspect-ratio:3/4}'), 'destination photos are portrait 3:4');
  assert.ok(css.includes('.dest-card .photocarousel-media::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,6,9,0) 45%,rgba(6,6,9,.72))'), 'the bottom gradient keeps the overlay readable');
  assert.ok(css.includes('.dest-name{display:flex;align-items:center;gap:6px;'), 'the name sits beside a pin icon');
  assert.ok(css.includes('.dest-overlay .result-price{flex:0 0 auto;background:rgba(252,252,252,.16);border:1px solid rgba(255,255,255,.35);backdrop-filter:blur(8px)'), 'the price is a frosted pill on the photo');
  assert.ok(app.includes('className="card dest-card"'), 'Popular and gem cards use the portrait card');
  assert.ok(app.includes('dest-overlay'), 'the overlay carries the name and price');
});

test('dribbble flight rows: a dotted line with a plane in a circle', () => {
  assert.ok(css.includes('.fare-card-line{display:block;height:0;border-top:2px dotted var(--line);margin:16px 0 12px;position:relative}'), 'the route line is dotted');
  assert.ok(css.includes('.fare-card-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;'), 'the plane sits in a circle on the line');
  assert.ok(results.includes('<span className="fare-card-plane">'), 'the fare card renders the plane');
  assert.ok(results.includes('<Icon name="plane" size={14} />'), 'the plane is the Lucide icon, not an emoji');
});

test('dribbble trip overview: a dark budget card with the barcode bar and 2×2 overview cards', () => {
  assert.ok(css.includes('.budget-card{background:var(--plum);color:#fcfcfc;'), 'the budget card is dark plum');
  assert.ok(css.includes('.budget-total{font-family:var(--font-display);font-size:40px;font-weight:300;'), 'the budget total is a large thin number');
  assert.ok(css.includes('.barcode-seg{flex:1;height:28px;border:1px solid rgba(255,255,255,.45);border-radius:2px}'), 'the barcode is thin vertical segments');
  assert.ok(css.includes('.barcode-seg.filled{background:#fcfcfc;border-color:#fcfcfc}'), 'a booked trip fills its segment');
  assert.ok(css.includes('.overview-num{font-family:var(--font-display);font-size:32px;font-weight:300;'), 'overview numbers are large and thin');
  assert.ok(css.includes('.overview-icon{position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);'), 'overview icons are thin circles');
  assert.ok(app.includes('trip-overview'), 'My Trips renders the overview');
  assert.ok(app.includes('Planned total'), 'the budget card totals the saved trips');
  assert.ok(app.includes('barcodeSegments'), 'the barcode comes from real saved trips');
});

test('dribbble type: large thin numbers on the running totals', () => {
  assert.ok(css.includes('.trippanel-total strong{display:block;'), 'the trip panel total exists');
  assert.ok(css.includes('font-size:28px;font-weight:300'), 'running totals are large and thin');
});
