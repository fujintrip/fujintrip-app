// /chat 50/50 split (Nov 25, 2026): user feedback after the rebuilt
// chat went live — "the column are not equal" — half chat, half the
// trip program built during the chat, clean and nice. The split is
// an exact 1fr 1fr grid at desktop, stacking below 900px. These pins
// guard the equality and the clean fit of both halves so a later
// restyle cannot silently unbalance them again.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/chat-half-split-2026-11-25.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../components/FujinChat.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
// Comments mention old class names and widths (the fix notes);
// strip them before asserting a selector or value is really gone.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('50/50 split: the grid is exactly two equal halves at desktop', () => {
  // 1fr 1fr — no minmax, no px, no percentage — so the halves are
  // equal at 1919px, at ~1280px, and at every desktop width between.
  assert.ok(css.includes('.chat-split{position:relative;display:grid;grid-template-columns:1fr 1fr;'), 'the split grid is 1fr 1fr');
  assert.ok(!css.includes('grid-template-columns:minmax(360px,420px)'), 'the old 420px chat track is gone');
  // Neither half can push the other narrower: both grid children
  // have min-width:0.
  assert.ok(css.includes('.chat-split .chatcol{display:flex;flex-direction:column;width:auto;min-width:0;'), 'the chat half is pinned to its track');
  assert.ok(css.includes('.chat-split .canvas{overflow-y:auto;min-height:0;min-width:0;'), 'the program half is pinned to its track');
  // No other rule overrides the desktop grid: the only
  // .chat-split grid-template-columns rules are the 1fr 1fr desktop
  // one and the 1fr stacking one inside the ≤900px media query.
  const gridRules = [...cssNoComments.matchAll(/\.chat-split\{[^}]*grid-template-columns:[^;}]+/g)].map((m) => m[0]);
  assert.deepEqual(
    gridRules,
    ['.chat-split{position:relative;display:grid;grid-template-columns:1fr 1fr', '.chat-split{grid-template-columns:1fr'],
    'only the 50/50 desktop rule and the 1fr mobile rule set the split columns',
  );
});

test('50/50 split: the chat half fits cleanly — one chip row, one visible input', () => {
  // The chip row wraps inside the half and chips can shrink to it.
  assert.ok(css.includes('.chat-split .chips{display:flex;flex-wrap:wrap;'), 'the chip row wraps');
  assert.ok(css.includes('.chat-split .chips .chip{flex:0 1 auto;min-width:0;max-width:100%;'), 'chips shrink to the half');
  // The input row is a single flex row at desktop: the input takes
  // the remaining width, the button keeps its own — nothing covers it.
  assert.ok(css.includes('.chat-split .hero-input{display:flex;gap:8px;align-items:stretch;'), 'the input row is a flex row');
  assert.ok(css.includes('.chat-split .hero-input input{flex:1 1 auto;min-width:0;'), 'the input flexes to the remaining row width');
  assert.ok(!cssNoComments.includes('.chat-split .hero-input .primary{position:absolute'), 'the button never covers the input');
});

test('50/50 split: wide-half readability — bubbles cap, own messages sit right', () => {
  // At 1919px the chat half is ~927px; a full-width bubble would be
  // a ~890px line of text. Bubbles cap at 720px instead.
  assert.ok(css.includes('.chat-split .bubble{border-radius:var(--r-md);padding:10px 14px;line-height:1.55;max-width:720px}'), 'bubbles cap at 720px in the wide half');
  // Own messages are real chat bubbles: sized to content, right-aligned.
  assert.ok(css.includes('.chat-split .bubble.user{background:var(--accent-soft);width:fit-content;margin-left:auto}'), 'own messages sit right, sized to content');
});

test('50/50 split: the program half carries the whole trip, in order', () => {
  // The canvas renders the welcome, then — once the trip is known —
  // summary, confirm, map, and the plan artefact, each in its own card.
  assert.ok(chat.includes('className="canvas-welcome"'), 'the welcome renders in the program half');
  assert.ok(chat.includes('className="canvas-card summary-card'), 'the Trip Summary card renders');
  assert.ok(chat.includes('className="canvas-card confirm-card'), 'the confirm card renders');
  assert.ok(chat.includes('className="canvas-card map-card'), 'the map card renders');
  assert.ok(chat.includes('className="canvas-card plan-card'), 'the plan artefact renders');
  // The plan artefact is complete: tiers, route timeline, day strip
  // with detail, flights, stays, getting around, one Book action.
  assert.ok(chat.includes('className="compare"'), 'the tier selector renders');
  assert.ok(chat.includes('className="timeline"'), 'the route timeline renders');
  assert.ok(chat.includes('className="day-strip"'), 'the day strip renders');
  assert.ok(chat.includes('className="day-detail"'), 'the selected day detail renders');
  assert.ok(chat.includes('className="flight-block"'), 'the flight block renders');
  assert.ok(chat.includes('className="stay-cards"'), 'the stay cards render');
  assert.ok(chat.includes('className="move-list"'), 'the getting-around legs render');
  assert.ok(chat.includes('className="plan-actions'), 'the plan actions render');
  assert.ok(chat.includes('Book — '), 'one Book action');
  // The program half scrolls on its own — nothing is cut off at the
  // bottom of the viewport.
  assert.ok(css.includes('.chat-split .canvas{overflow-y:auto;'), 'the program half scrolls independently');
});

test('50/50 split: mobile stacks — chat on top, program below, nothing hidden', () => {
  assert.ok(css.includes('@media(max-width:900px)') && css.includes('.chat-split{grid-template-columns:1fr'), 'the halves stack to one column on a phone');
  assert.ok(css.includes('.chat-split .canvas{overflow:visible}'), 'the stacked program half is fully visible');
  assert.ok(css.includes('.chat-split .chatcol{min-height:70dvh}'), 'the stacked chat half keeps a usable height');
});
