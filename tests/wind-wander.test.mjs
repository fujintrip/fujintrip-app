// Wind & wander (Nov 24, 2026): the user rejected Clean &
// trusted (Nov 22) as "silly and boring" and asked for images
// and an out-of-the-box modern travel design — "surprise me".
// Editorial and photo-led: a full-bleed photo hero with the search
// floating over it, name + price overlaid on the photo's scrim,
// horizontal-scroll destination rows, warm paper surfaces, one
// trustworthy blue (#0066cc) kept as the primary-action anchor.
// This replaces tests/clean-trusted.test.mjs with the same
// coverage areas — hero, search, cards, tokens, dark mode —
// updated to the new direction. The palette lives in CSS
// variables (one source of truth); this file pins the token
// values and the translated components, so a future restyle
// cannot silently drift the tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../components/FujinApp.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../components/HomeSections.tsx', import.meta.url), 'utf8');
const pkgs = readFileSync(new URL('../components/PackagesSection.tsx', import.meta.url), 'utf8');
const results = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../components/SearchWidget.tsx', import.meta.url), 'utf8');

test('wind palette: warm paper surfaces, navy ink, one blue primary', () => {
  // Light theme — the palette block.
  assert.ok(css.includes('--brand:#0066cc'), 'the primary is the trustworthy blue');
  assert.ok(css.includes('--brand-hover:#0052a3'), 'brand hover is the darker blue');
  assert.ok(css.includes('--brand-active:#00438a'), 'brand active is the darkest blue');
  assert.ok(css.includes('--ink:#191e3b'), 'ink is the dark navy text');
  assert.ok(css.includes('--muted:#5a6478'), 'muted is the blue-grey');
  assert.ok(css.includes('--surface:#f7f3ec'), 'the page is warm paper, not cool grey');
  assert.ok(css.includes('--line:#e4ded2'), 'hairlines are warm');
  assert.ok(css.includes('--card:#ffffff'), 'cards are white');
  assert.ok(css.includes('--accent:#0066cc'), 'accent is the same blue');
  assert.ok(css.includes('--accent-soft:#e8f0fb'), 'soft accent is the pale blue');
  assert.ok(css.includes('--accent-text:#0052a3'), 'small-text blue');
  assert.ok(css.includes('--accent-ink:#003d7a'), 'deep blue for AAA text');
  assert.ok(css.includes('--link:#0066cc'), 'links are the blue');
  assert.ok(css.includes('body{margin:0;background:var(--surface)'), 'the page sits on the warm paper');
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
  // Dark theme — warm charcoals, blue primary, light link blue.
  assert.ok(css.includes('--card:#221d15'), 'dark cards are warm charcoal');
  assert.ok(css.includes('--surface:#1b1712'), 'dark page is the warm charcoal');
  assert.ok(css.includes('--ink:#f2ede4'), 'dark ink is warm white');
  assert.ok(css.includes('--muted:#a89f8c'), 'dark muted is warm grey');
  assert.ok(css.includes('--link:#7db8ff'), 'dark links are the light blue');
  assert.ok(css.includes('[data-theme="dark"] body{background:#1b1712}'), 'the dark page is warm charcoal');
  assert.ok(!css.includes('--card:#0f1726'), 'no navy dark card remains');
  assert.ok(!css.includes('--brand:#6b5b6d'), 'no dark plum brand remains');
});

test('wind radii: 10px inputs, 16px panels, 20px cards, pills stay pills', () => {
  assert.ok(css.includes('--r-sm:10px'), 'small radius is 10px');
  assert.ok(css.includes('--r-md:16px'), 'medium radius is 16px');
  assert.ok(css.includes('--r-lg:20px'), 'large radius is 20px');
  assert.ok(css.includes('.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg)'), 'cards use the large radius');
  assert.ok(!css.includes('--r-lg:12px'), 'no 12px card radius remains');
  assert.ok(!css.includes('--r-lg:16px'), 'no 16px card radius remains');
});

test('wind hero: full-bleed photo, real scrim, big brand headline, search floats', () => {
  assert.ok(css.includes('.hero-booking{position:relative;overflow:hidden;background:#0e1622}'), 'the hero is a photo stage, not a white canvas');
  assert.ok(css.includes('.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}'), 'the photo fills the hero');
  assert.ok(css.includes('.hero-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,12,22,.62) 0%,rgba(8,12,22,.30) 42%,rgba(8,12,22,.60) 100%)}'), 'a real gradient scrim carries the white text');
  assert.ok(css.includes('.hero-booking-inner{position:relative;z-index:1;padding:72px 24px 56px}'), 'the content floats above the photo');
  assert.ok(css.includes('.hero-booking-inner h1{color:#fff;font-size:clamp(38px,8.5vw,72px);font-weight:800'), 'the headline is big white display type');
  assert.ok(css.includes('.hero-booking-sub{color:rgba(255,255,255,.92);font-size:18px;margin:14px 0 28px;max-width:640px}'), 'the sub is white on the scrim');
  assert.ok(css.includes('.hero-booking .sw-tab{color:#fff}'), 'the tabs read white on the photo');
  assert.ok(css.includes('.hero-booking .sw-tab.selected{box-shadow:inset 0 -2px 0 #fff}'), 'the selected tab underlines in white');
  assert.ok(!css.includes('.hero-booking{background:var(--card)}'), 'no white-canvas hero remains');
  assert.ok(app.includes('<img className="hero-photo" src={HERO_PHOTO} alt="Maldives — turquoise lagoon and white sand" />'), 'the hero renders the photo as an <img>');
  assert.ok(app.includes("const HERO_PHOTO = GLOBAL_DESTINATIONS.find((d) => d.name === 'Maldives')?.image ?? null;"), 'the hero photo comes from the verified pool in lib/data.ts');
  assert.ok(app.includes('<div className="hero-scrim" aria-hidden="true" />'), 'the scrim renders');
  assert.ok(app.includes('<h1>Travel globally.<br />Act locally.</h1>'), 'the headline is the brand line');
  assert.ok(app.includes('className="hero-booking"'), 'the hero section renders');
  assert.ok(!app.includes('hero-pills'), 'the hero renders no pill row');
  assert.ok(!app.includes('hero-arrow'), 'the hero renders no photo controls');
  assert.ok(!app.includes('currentHeroPhoto'), 'no hero photo cycler state remains');
  assert.ok(!app.includes('heroPillDestinations'), 'no hero pill destinations remain');
  assert.ok(app.includes('Not sure yet? <a href="/chat">Ask Fujin AI →</a>'), 'AI is a quiet text link, not a button');
  assert.ok(widget.includes('placeholder="Where to?"'), '"Where to?" lives on as the search field placeholder');
});

test('wind search: a white pill bar with a blue circular action, floating on the photo', () => {
  assert.ok(css.includes('.sw-bar{display:flex;align-items:stretch;background:var(--card);border:1px solid var(--line);border-radius:999px'), 'the bar is a white pill floating on the photo');
  assert.ok(css.includes('.sw-bar button.primary.sw-search{background:var(--brand);color:#fff}'), 'the bar action is a blue circle with a white magnifier');
  assert.ok(css.includes('.sw-bar .sw-field input,.sw-bar .sw-field select{border:none;padding:0;background:transparent;font-size:15px;color:var(--ink)}'), 'bar fields read ink on white');
  assert.ok(css.includes('.sw-bar .sw-field>span:first-child{text-transform:uppercase;font-size:11px;letter-spacing:.05em;font-weight:700;color:var(--muted)}'), 'bar labels are muted');
  assert.ok(css.includes('.sw-bar .sw-field:focus-within{background:var(--accent-soft);border-radius:var(--r-sm);outline:2px solid var(--brand);outline-offset:2px}'), 'a focused field gets a blue outline on pale blue');
});

test('wind photo cards: name + price overlaid on the photo scrim, rows scroll sideways', () => {
  assert.ok(css.includes('.dest-overlay{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:56px 20px 16px;background:linear-gradient(180deg,rgba(8,12,22,0),rgba(8,12,22,.78));color:#fff}'), 'the overlay is a real bottom gradient, not text straight on the photo');
  assert.ok(css.includes('.dest-overlay h3{color:#fff'), 'the overlaid name is white');
  assert.ok(css.includes('.dest-overlay .result-price{color:#fff'), 'the overlaid price is white');
  assert.ok(css.includes('.row-scroll{display:flex;gap:var(--gap);overflow-x:auto;scroll-snap-type:x proximity'), 'destination rows scroll sideways with snap');
  assert.ok(css.includes('.row-scroll>.card{flex:0 0 min(340px,86vw);scroll-snap-align:start}'), 'scroll cards are 340px with snap');
  assert.ok(app.includes('className="dest-overlay"'), 'the overlay renders on the destination cards');
  assert.ok(app.includes('className="row-scroll"'), 'the destination rows scroll');
  assert.ok(app.includes('overlay={('), 'the destination cards pass the overlay into the photo carousel');
  assert.ok(app.includes('<p className="result-price">from $'), 'the from-price sits in the overlay');
  assert.ok(home.includes('className="dest-overlay"'), 'the overlay renders on the voice cards');
  assert.ok(home.includes('className="dest-photo"'), 'the voice photos carry the overlay wrapper');
  assert.ok(css.includes('.feature-overlay{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:64px 28px 24px;background:linear-gradient(180deg,rgba(8,12,22,0),rgba(8,12,22,.78));color:#fff}'), 'the Trip of the week rides on its photo too');
  assert.ok(css.includes('.feature-photo{grid-column:span 7;position:relative;border-radius:var(--r-lg);overflow:hidden;min-height:420px}'), 'the feature photo is taller');
  assert.ok(pkgs.includes('className="feature-overlay"'), 'the feature overlay renders');
  assert.ok(pkgs.includes('<p className="feature-eyebrow">Trip of the week</p>'), 'the week label sits on the photo');
});

test('wind flight rows: the dotted line stays, the plane circle is blue now', () => {
  assert.ok(css.includes('.fare-card-line{display:block;height:0;border-top:2px dotted var(--line);margin:16px 0 12px;position:relative}'), 'the route line is dotted');
  assert.ok(css.includes('.fare-card-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;'), 'the plane sits in a circle on the line');
  assert.ok(results.includes('<span className="fare-card-plane">'), 'the fare card renders the plane');
  assert.ok(results.includes('<Icon name="plane" size={14} />'), 'the plane is the Lucide icon, not an emoji');
});

test('wind trip overview: a white budget card with a simple progress bar', () => {
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

test('wind type: restrained sizes, bold totals, no thin light headlines', () => {
  assert.ok(!css.includes('font-weight:300'), 'no thin 300-weight type remains');
  assert.ok(css.includes('clamp(38px,8.5vw,72px)'), 'the hero headline scales 38–72px');
  assert.ok(css.includes('.chatmap-s0 .msg .bubble.greeting{font-size:clamp(32px,4vw,40px)'), 'the S0 greeting is restrained at 32–40px');
  assert.ok(css.includes('.trippanel-total strong{display:block;'), 'the trip panel total exists');
  assert.ok(css.includes('font-size:28px;font-weight:700'), 'running totals are bold');
});

test('wind mobile: the hero keeps air on a phone, the search stacks cleanly', () => {
  assert.ok(css.includes('.hero-booking-inner{padding:56px 16px 40px}'), 'the phone hero keeps its air');
  assert.ok(css.includes('.hero-booking-inner h1{color:#fff;font-size:clamp(38px,8.5vw,72px)'), 'the phone headline scales down from the same clamp');
  assert.ok(css.includes('.sw-bar{flex-direction:column;border-radius:var(--r-lg);padding:8px}'), 'the bar stacks on a phone');
  assert.ok(css.includes('.sw-bar .sw-search{width:100%;height:48px;min-height:48px;border-radius:999px;margin:8px 0 0}'), 'the phone search action is a full-width pill');
});
