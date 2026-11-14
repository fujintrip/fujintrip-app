// Homepage photos — every photo URL the homepage renders must return
// real image bytes, not a placeholder or an error.
// (Defect, Nov 14 2026: the Kyoto hero and the package cards showed
// flat gradients with no photos — 0 decoded images — while the chat
// page's photos decoded fine. The URLs themselves were fine; the
// cause was SafeImg/PhotoCarousel hiding lazy images with
// display:none, which never fetches. This test pins the URLs so a
// dead photo cannot hide behind that fix.)
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/images.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS } from '../lib/data.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// The hero photo lives in components/FujinChat.tsx (HERO_PHOTO) — read
// it from source so the test checks the exact URL the page renders
// without importing the whole Chat component.
function heroPhotoUrl() {
  const src = readFileSync(new URL('../components/FujinChat.tsx', import.meta.url), 'utf8');
  const m = src.match(/HERO_PHOTO = '(https:\/\/[^']+)'/);
  assert.ok(m, 'HERO_PHOTO is defined in FujinChat.tsx');
  return m[1];
}

async function fetchImage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, 200, `${url} should return 200, got ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  assert.ok(ct.startsWith('image/'), `${url} should be an image, got ${ct}`);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(buf.length > 5000, `${url} should be real image bytes, got ${buf.length}B`);
  return buf;
}

test('homepage photos: hero + every destination card image returns real image bytes', async () => {
  const urls = [
    heroPhotoUrl(),
    ...GLOBAL_DESTINATIONS.map((d) => d.image),
    ...HIDDEN_GEMS.map((d) => d.image),
  ];
  assert.ok(urls.length >= 9, `expected the hero + destination photos, got ${urls.length}`);
  const bufs = [];
  for (const url of urls) bufs.push(await fetchImage(url));
  // No two photos are byte-identical — a placeholder or error image
  // would repeat across URLs, real photos never do.
  const sizes = new Set(bufs.map((b) => b.length));
  assert.equal(sizes.size, bufs.length, 'every photo has distinct bytes (no placeholder repeats)');
});
