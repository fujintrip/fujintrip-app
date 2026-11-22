// Clean & trusted (Nov 22, 2026): the user chose this direction
// after calling the interface "very ugly and bad" and asking to
// start over — Expedia / Booking.com design language, design
// language only, never their text, photos, logo or brand. White
// canvas, one trustworthy blue, search first. This replaces the
// Nov 21 Dribbble dark-plum makeover (superseded, never deployed).
// The palette lives in CSS variables (one source of truth); this
// file pins the token values and the translated components, so a
// future restyle cannot silently drift the tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../components/HomeSections.tsx', import.meta.url), 'utf8');
const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');

test('clean palette: white canvas, dark navy ink, one blue primary', () => {
  // Light theme — the palette block.
  assert.ok(css.includes('--brand:#0066cc'), 'the primary is the trustworthy blue');
  assert.ok(css.includes('--brand-hover:#0052a3'), 'brand hover is the darker blue');
  assert.ok(css.includes('--brand-active:#00438a'), 'brand active is the darkest blue');
  assert.ok(css.includes('--ink:#191e3b'), 'ink is the dark navy text');
  assert.ok(css.includes('--muted:#5a6478'), 'muted is the blue-grey');
  assert.ok(css.includes('--line:#dfe0e4'), 'hairlines are the cool grey');
  assert.ok(css.includes('--card:#ffffff'), 'cards are white');
  assert.ok(css.includes('--surface:#f5f7fa'), 'surface is the pale blue-grey');
  assert.ok(css.includes('--accent:#0066cc'), 'accent is the same blue');
  assert.ok(css.includes('--accent-soft:#e8f0fb'), 'soft accent is the pale blue');
  assert.ok(css.includes('--accent-text:#0052a3'), 'small-text blue');
  assert.ok(css.includes('--accent-ink:#003d7a'), 'deep blue for AAA text');
  assert.ok(css.includes('--link:#0066cc'), 'links are the blue');
  // The Dribbble palette is gone from the stylesheet.
  assert.ok(!css.includes('#4a3f4b'), 'no plum remains');
  assert.ok(!css.includes('#060609'), 'no near-black remains');
  assert.ok(!css.includes('#c3603e'), 'no terracotta remains');
  assert.ok(!css.includes('#f09357'), 'no peach remains');
  assert.ok(!css.includes('#4f6c91'), 'no dusty blue remains');
  assert.ok(!css.includes('--plum'), 'no plum token remains');
  assert.ok(!css.includes('--terra'), 'no terracotta token remains');
  assert.ok(!css.includes('--peach'), 'no peach token remains');
  assert.ok(!css.includes('--glass-bg'), 'no frosted-glass token remains');
  assert.ok(!css.includes('backdrop-filter'), 'no frosted glass anywhere');
  // Dark theme — navy darks, blue primary, light link blue.
  assert.ok(css.includes('--brand:#0066cc'), 'dark brand is the same blue fill');
  assert.ok(css.includes('--link:#7db8ff'), 'dark links are the light blue');
  assert.ok(css.includes('--card:#0f1726'), 'dark cards are navy dark');
  assert.ok(!css.includes('--brand:#6b5b6d'), 'no dark plum brand remains');
});

test('clean radii: 8px inputs, 12px cards, pills stay pills', () => {
  assert.ok(css.includes('--r-sm:8px'), 'small radius is 8px');
  assert.ok(css.includes('--r-md:12px'), 'medium radius is 12px');
  assert.ok(css.includes('--r-lg:12px'), 'large radius is 12px');
  assert.ok(css.includes('.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg)'), 'cards use the large radius');
  assert.ok(!css.includes('--r-lg:24px'), 'no 24px card radius remains');
});

test('clean hero: white canvas, one question, no photo, no pills, no cycler', () => {
  assert.ok(css.includes('.hero-booking{background:var(--card)}'), 'the hero is the white canvas');
  assert.ok(css.includes('.hero-booking-inner h1{color:var(--ink);font-size:40px;font-weight:700'), 'the hero headline is 40px at weight 700');
  assert.ok(!css.includes('.hero-photo'), 'no photo-hero style remains');
  assert.ok(!css.includes('.hero-pill'), 'no frosted destination pills remain');
  assert.ok(!css.includes('.hero-arrow'), 'no circular photo controls remain');
  assert.ok(!css.includes('hero-photo-label'), 'no photo caption remains');
  assert.ok(!app.includes('hero-pills'), 'the hero renders no pill row');
  assert.ok(!app.includes('hero-arrow'), 'the hero renders no photo controls');
  assert.ok(!app.includes('currentHeroPhoto'), 'no hero photo cycler state remains');
  assert.ok(!app.includes('heroPillDestinations'), 'no hero pill destinations remain');
  assert.ok(app.includes('className="hero-booking"'), 'the hero is the plain white section');
  assert.ok(app.includes('Not sure yet? <a href="/chat">Ask Fujin AI →</a>'), 'AI is a quiet text link, not a button');
});

test('clean search: a white pill bar with a blue circular action', () => {
  assert.ok(css.includes('.sw-bar{display:flex;align-items:stretch;background:var(--card);border:1px solid var(--line);border-radius:999px'), 'the bar is white, not plum');
  assert.ok(css.includes('.sw-bar button.primary.sw-search{background:var(--brand);color:#fff}'), 'the bar action is a blue circle with a white magnifier');
  assert.ok(css.includes('.sw-bar .sw-field input,.sw-bar .sw-field select{border:none;padding:0;background:transparent;font-size:15px;color:var(--ink)}'), 'bar fields read ink on white');
  assert.ok(css.includes('.sw-bar .sw-field>span:first-child{text-transform:uppercase;font-size:11px;letter-spacing:.05em;font-weight:700;color:var(--muted)}'), 'bar labels are muted');
  assert.ok(css.includes('.sw-bar .sw-field:focus-within{background:var(--accent-soft);border-radius:var(--r-sm);outline:2px solid var(--brand);outline-offset:2px}'), 'a focused field gets a blue outline on pale blue');
});

test('clean destination cards: 4:3 photos, name + price in the white body', () => {
  assert.ok(!css.includes('.dest-overlay'), 'no overlay style remains');
  assert.ok(!css.includes('.dest-name'), 'no overlay name style remains');
  assert.ok(!css.includes('aspect-ratio:3/4'), 'no tall portrait photos remain');
  assert.ok(!app.includes('dest-overlay'), 'no overlay in the destination cards');
  assert.ok(!home.includes('dest-overlay'), 'no overlay in the voice cards');
  assert.ok(app.includes('<h3><Icon name="pin" size={18} /> {e.name}'), 'the name sits in the card body');
  assert.ok(app.includes('<p className="result-price">from $'), 'the from-price sits in the card body');
  assert.ok(home.includes('<h3><Icon name="pin" size={18} /> {p}</h3>'), 'the voice card name sits in the body');
});

test('clean flight rows: the dotted line stays, the plane circle is blue now', () => {
  assert.ok(css.includes('.fare-card-line{display:block;height:0;border-top:2px dotted var(--line);margin:16px 0 12px;position:relative}'), 'the route line is dotted');
  assert.ok(css.includes('.fare-card-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;'), 'the plane sits in a circle on the line');
  assert.ok(results.includes('<span className="fare-card-plane">'), 'the fare card renders the plane');
  assert.ok(results.includes('<Icon name="plane" size={14} />'), 'the plane is the Lucide icon, not an emoji');
});

test('clean trip overview: a white budget card with a simple progress bar', () => {
  assert.ok(css.includes('.budget-card{background:var(--card);color:var(--ink);'), 'the budget card is white');
  assert.ok(css.includes('.budget-total{font-family:var(--font-display);font-size:32px;font-weight:700;'), 'the budget total is bold, not thin');
  assert.ok(css.includes('.progress{height:8px;background:var(--surface);border:1px solid var(--line);border-radius:999px;overflow:hidden}'), 'the progress bar is one simple track');
  assert.ok(css.includes('.progress-fill{height:100%;background:var(--brand);border-radius:999px}'), 'the fill is the brand blue');
  assert.ok(!css.includes('.barcode'), 'no barcode bar remains');
  assert.ok(!css.includes('.barcode-seg'), 'no barcode segments remain');
  assert.ok(css.includes('.overview-num{font-family:var(--font-display);font-size:32px;font-weight:700;'), 'overview numbers are bold');
  assert.ok(app.includes('trip-overview'), 'My Trips renders the overview');
  assert.ok(app.includes('Planned total'), 'the budget card totals the saved trips');
  assert.ok(app.includes('bookedPct'), 'the bar fills with the share of trips booked');
  assert.ok(app.includes('progress-fill'), 'the bar renders the blue fill');
});

test('clean type: restrained sizes, bold totals, no thin light headlines', () => {
  assert.ok(!css.includes('font-weight:300'), 'no thin 300-weight type remains');
  assert.ok(!css.includes('clamp(48px,6vw,84px)'), 'no 48–84px hero headline remains');
  assert.ok(css.includes('.chatmap-s0 .msg .bubble.greeting{font-size:clamp(32px,4vw,40px)'), 'the S0 greeting is restrained at 32–40px');
  assert.ok(css.includes('.trippanel-total strong{display:block;'), 'the trip panel total exists');
  assert.ok(css.includes('font-size:28px;font-weight:700'), 'running totals are bold');
});
