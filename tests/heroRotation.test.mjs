// Rotating hero background — the slide list is only photos already in
// the codebase and verified; the rotation timing and the
// reduced-motion / hidden-tab gates are pinned here.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/heroRotation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITY_PHOTOS, HIDDEN_GEMS } from '../lib/data.ts';
import {
  HERO_FADE_MS,
  HERO_ROTATE_MS,
  HERO_SLIDES,
  nextSlideIndex,
  rotationEnabled,
} from '../lib/heroRotation.ts';

// HERO_PHOTO lives in components/FujinChat.tsx — read it from source
// (same pattern as tests/images.test.mjs) so the test checks the exact
// URL the chat hero renders without importing the whole component.
function heroPhotoUrl() {
  const src = readFileSync(new URL('../components/FujinChat.tsx', import.meta.url), 'utf8');
  const m = src.match(/HERO_PHOTO = '(https:\/\/[^']+)'/);
  assert.ok(m, 'HERO_PHOTO is defined in FujinChat.tsx');
  return m[1];
}

test('hero rotation: slides are only verified photos already in the codebase', () => {
  const verified = new Set([
    heroPhotoUrl(),
    ...Object.values(CITY_PHOTOS),
    ...HIDDEN_GEMS.map((d) => d.image),
  ]);
  assert.ok(HERO_SLIDES.length >= 10, `rotation has ${HERO_SLIDES.length} slides`);
  const seen = new Set();
  for (const s of HERO_SLIDES) {
    assert.ok(verified.has(s.src), `slide ${s.label} uses a verified photo URL`);
    assert.ok(!seen.has(s.src), `no duplicate slide photo: ${s.src}`);
    seen.add(s.src);
    assert.ok(s.alt.length > 0, `slide ${s.label} has alt text`);
    assert.ok(s.label.length > 0, 'slide has a label');
  }
});

test('hero rotation: first slide is the Kyoto Yasaka pagoda hero', () => {
  assert.equal(HERO_SLIDES[0].src, heroPhotoUrl(), 'first slide is HERO_PHOTO');
  assert.equal(HERO_SLIDES[0].label, 'Kyoto');
  // Same photo ID as the Kyoto template photo in GLOBAL_DESTINATIONS,
  // portrait crop (w=900&h=1200) rather than its landscape crop.
  assert.ok(HERO_SLIDES[0].src.includes('photo-1493976040374-85c8e12f0c0e'), 'first slide is the Yasaka pagoda photo');
  // The photo is the Yasaka pagoda street at sunset — the old alt said
  // "Torii gates at Fushimi Inari", the wrong subject (defect, Nov 14
  // 2026). The alt must describe the actual photo, never the torii.
  assert.equal(HERO_SLIDES[0].alt, 'Yasaka pagoda street at sunset, Kyoto');
  assert.ok(!/torii/i.test(HERO_SLIDES[0].alt), 'hero alt never mentions torii gates');
});

test('hero rotation: every CITY_PHOTOS city and every hidden gem is in the rotation', () => {
  const srcs = new Set(HERO_SLIDES.map((s) => s.src));
  for (const [city, src] of Object.entries(CITY_PHOTOS)) {
    assert.ok(srcs.has(src), `${city} photo is in the rotation`);
  }
  for (const d of HIDDEN_GEMS) {
    assert.ok(srcs.has(d.image), `${d.name} photo is in the rotation`);
  }
});

test('hero rotation: timing constants — new photo every ~7s, crossfade ~1s', () => {
  assert.equal(HERO_ROTATE_MS, 7000);
  assert.equal(HERO_FADE_MS, 1000);
});

test('hero rotation: nextSlideIndex wraps around', () => {
  assert.equal(nextSlideIndex(0, 16), 1);
  assert.equal(nextSlideIndex(15, 16), 0);
  assert.equal(nextSlideIndex(0, 0), 0);
});

test('hero rotation: reduced motion or a hidden tab disables auto-rotation', () => {
  assert.equal(rotationEnabled(false, false), true, 'visible tab, no reduced motion: rotates');
  assert.equal(rotationEnabled(true, false), false, 'reduced motion: no auto-rotation');
  assert.equal(rotationEnabled(false, true), false, 'hidden tab: paused');
  assert.equal(rotationEnabled(true, true), false, 'both: no auto-rotation');
});

test('hero rotation: CSS fades the incoming slide and drops the fade under reduced motion', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.hero-slide-current{animation:hero-fade-in 1s ease}'), 'incoming slide fades in over ~1s');
  assert.ok(css.includes('@keyframes hero-fade-in'), 'fade keyframes exist');
  assert.ok(css.includes('.hero-dots{position:absolute'), 'dot indicators sit on the photo');
  assert.ok(css.includes('.hero-dot.active{background:#fff}'), 'active dot is visible');
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\{[^}]*\.hero-slide-current\{animation:none\}[^}]*\}/);
  assert.ok(reduced, 'reduced motion disables the hero fade');
});
