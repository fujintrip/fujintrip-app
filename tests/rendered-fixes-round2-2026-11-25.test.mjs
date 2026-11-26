// Rendered-check fixes, second round (Nov 25, 2026): the evening
// Deploy went live and a second rendered check (1919px, light +
// dark) verified most earlier fixes, but found 6 remaining defects
// — two of them claimed fixed in earlier rounds that did NOT hold
// in the rendered page. These pins guard the real causes, not the
// earlier changes.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/rendered-fixes-round2-2026-11-25.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITY_INFO, buildTripCard, priceTagAnchorY, TAG_ANCHOR_X, TAG_STACK_BASE, TAG_STACK_STEP } from '../lib/tripCard.ts';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../components/FujinChat.tsx', import.meta.url), 'utf8');
const mapLibre = readFileSync(new URL('../components/TripMap.tsx', import.meta.url), 'utf8');
const leaflet = readFileSync(new URL('../components/TripMapLeaflet.tsx', import.meta.url), 'utf8');

test('defect 1: the Trip of the Week photo box has a fixed aspect, so a portrait photo cannot stretch the row', () => {
  // Real cause: this week's Bali photo is PORTRAIT (900×1194), and
  // the feature photo's height came from its image's intrinsic
  // aspect — at ~693px wide the photo column grew to ~924px while
  // the text column is ~370px, leaving a ~230px blank under the
  // buttons. The earlier margin-top:0 change only moved the buttons
  // inside the too-tall row. The box now has a fixed 16/10 aspect,
  // so the row is sized by the text and the image cover-crops.
  const m = /\.feature-photo\{[^}]*\}/.exec(css);
  assert.ok(m, 'a .feature-photo rule exists');
  assert.ok(m[0].includes('aspect-ratio:16/10'), 'the photo box has a fixed 16/10 aspect');
  assert.ok(m[0].includes('min-height:420px'), 'the 420px minimum is kept');
});

test('defect 2: canvas cards keep their natural height — the Trip Summary cannot be flex-squeezed away', () => {
  // Real cause: the canvas is a fixed-height flex column (100dvh −
  // 84px) whose cards total more than the viewport once the map
  // mounts. Flex-shrink squeezed the summary card down to its
  // photo's height and overflow:hidden clipped the heading and
  // rows, so only a sky photo strip showed above the map — visible
  // briefly during load, gone once the map mounted. The cards now
  // keep their height and the canvas scrolls instead.
  assert.ok(css.includes('.chat-split .canvas>*{flex-shrink:0}'), 'canvas children never shrink');
  assert.ok(css.includes('.chat-split .canvas{overflow-y:auto;'), 'the canvas still scrolls');
});

test('defect 3: the confirm card renders once a destination is known', () => {
  // Real cause: the gate required every slot filled
  // (slotsFilled && !plan && !confirmDismissed), so with the
  // departure city and length still missing the card never
  // rendered — the 50/50 report's "present" claim was a code read,
  // not a render. The gate is now the destination alone; building
  // from here uses the same defaults the summary shows.
  assert.ok(chat.includes('Does this look right?'), 'the confirm card copy is present');
  assert.ok(chat.includes('{lastParsed?.destination && !plan && !confirmDismissed && ('), 'the confirm card gates on the destination, not on all slots');
  assert.ok(!chat.includes('{slotsFilled && !plan && !confirmDismissed && ('), 'no slots-filled gate on the confirm card survives');
});

test('defect 4: every leg pill anchors at its own city coordinates, never a midpoint', () => {
  // Real cause, two parts. (a) The legs carried MIDPOINT
  // coordinates — flights halfway to the origin, between-city legs
  // halfway between their two cities — while priceTagAnchorY stacks
  // by leg.city. A pill's stack offset was computed for one city
  // and its position for another point entirely: the Prague→Vienna
  // train pill landed on Prague's stay pill and hid its last digit,
  // and the Budapest flight-back pill sat over southern Poland.
  // (b) The pills sat 40px left of their pin, so the stack leaned
  // off its city. Legs now anchor at their city; pills center on
  // the pin via the shared TAG_ANCHOR_X.
  for (const origin of ['', 'New York']) {
    const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 0, origin });
    assert.ok(card, `card builds with origin '${origin || '(unset)'}'`);
    for (const leg of card.legs) {
      const c = CITY_INFO[leg.city];
      assert.ok(c, `${leg.id} city ${leg.city} is known`);
      if (leg.kind === 'flight' || leg.kind === 'transport') {
        assert.equal(leg.lat, c.lat, `${leg.id} sits on ${leg.city} latitude (origin '${origin || '(unset)'}')`);
        assert.equal(leg.lng, c.lng, `${leg.id} sits on ${leg.city} longitude (origin '${origin || '(unset)'}')`);
      } else {
        // Stay/car legs nudge ±0.04° off the pin so the stack never
        // covers the numbered marker — close, never a midpoint.
        assert.ok(Math.abs(leg.lat - c.lat) <= 0.05, `${leg.id} stays within 0.05° of ${leg.city} latitude`);
        assert.ok(Math.abs(leg.lng - c.lng) <= 0.05, `${leg.id} stays within 0.05° of ${leg.city} longitude`);
      }
    }
  }
  // The stack itself is compact: 56px base, 40px steps, 36px pills —
  // the tallest stack (Budapest, 4 legs) tops out at 176px, inside
  // the 210px top padding the maps fit with.
  assert.equal(TAG_STACK_BASE, 56, 'stack base is 56px');
  assert.equal(TAG_STACK_STEP, 40, 'stack step is 40px');
  assert.equal(TAG_ANCHOR_X, 55, 'pills center on the pin (typical width ~110px)');
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 0, origin: '' });
  const anchors = priceTagAnchorY(card.legs);
  assert.equal(Math.max(...anchors.values()), 176, 'the tallest stack (Budapest, 4 legs) tops out at 176px');
  // Both maps use the shared centering constant and the compact pill.
  assert.ok(mapLibre.includes('offset: [-TAG_ANCHOR_X, -anchorY]'), 'MapLibre centers pills on the pin');
  assert.ok(mapLibre.includes('padding:7px 10px;min-height:36px'), 'MapLibre pills are 36px tall');
  assert.ok(leaflet.includes('iconAnchor: [TAG_ANCHOR_X, anchorY]'), 'Leaflet centers pills on the pin');
  assert.ok(leaflet.includes('padding:7px 10px;min-height:36px'), 'Leaflet pills are 36px tall');
  assert.ok(!mapLibre.includes('offset: [-40, -anchorY]'), 'no fixed 40px-left offset survives in MapLibre');
  assert.ok(!leaflet.includes('iconAnchor: [40, anchorY]'), 'no fixed 40px-left anchor survives in Leaflet');
});

test('defect 5: the summary header is a bottom-pinned 21/9 strip, not a sky-filled 16/9 box', () => {
  // Real cause: a 16/9 box is nearly the same aspect as the Prague
  // photo (16/10), so only ~56px of sky could ever crop away — and
  // the flex-squeezed card showed only the photo's top ~150px. The
  // header is now a 21/9 strip pinned to the bottom of the photo,
  // so the Old Town Square and spires show and the sky is cut.
  const m = /\.summary-photo\{[^}]*\}/.exec(css);
  assert.ok(m, 'a .summary-photo rule exists');
  assert.ok(m[0].includes('aspect-ratio:21/9'), 'the header is a 21/9 strip');
  assert.ok(css.includes('object-position:center 100%'), 'the header crops to the bottom of the photo');
  assert.ok(!css.includes('.summary-photo{position:relative;aspect-ratio:16/9;'), 'no 16/9 summary header survives');
});

test('defect 6: the selected day pill reads in dark mode', () => {
  // Real cause: --on-ink is white in BOTH themes, but --ink flips
  // to near-white in dark mode — white text on a near-white pill.
  // The chosen pill now takes its text color from --card, which is
  // always the opposite of --ink (white in light mode, dark in
  // dark mode). The token itself is untouched: --on-ink stays white
  // because the brand-background buttons still need it.
  assert.ok(
    css.includes('.chat-split .day-btn.chosen{background:var(--ink);color:var(--card);border-color:var(--ink)}'),
    'the chosen day pill uses --card text, not --on-ink',
  );
  assert.ok(!css.includes('.chat-split .day-btn.chosen{background:var(--ink);color:var(--on-ink);'), 'no white-on-white day pill survives');
});

test('S0 observation: the greeting centers in the empty state without ever clipping a conversation', () => {
  // The greeting centers only while it is the ONLY message
  // (:only-child + margin:auto on a flex column). Once a second
  // message arrives the rule stops matching and the flow is
  // top-aligned; auto margins collapse to 0 on overflow, so a long
  // conversation can never be clipped at the top.
  assert.ok(css.includes('.chat-s0 .chat{display:flex;flex-direction:column}'), 'the S0 chat is a flex column');
  assert.ok(css.includes('.chat-s0 .chat>*{flex-shrink:0}'), 'S0 messages never shrink');
  assert.ok(css.includes('.chat-s0 .chat .msg:only-child{margin-top:auto;margin-bottom:auto}'), 'a lone greeting centers via auto margins');
});
