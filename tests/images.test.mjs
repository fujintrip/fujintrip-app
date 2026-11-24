// Site photos — every photo URL the site renders must return real
// image bytes, not a placeholder or an error.
// (Defect, Nov 14 2026: the Kyoto hero and the package cards showed
// flat gradients with no photos — 0 decoded images — while the chat
// page's photos decoded fine. The URLs themselves were fine; the
// cause was SafeImg/PhotoCarousel hiding lazy images with
// display:none, which never fetches. This test pins the URLs so a
// dead photo cannot hide behind that fix.)
// The Kyoto photo is the /chat S0 canvas photo — the homepage hero
// went white on Nov 15, 2026 — but the same photo ID also backs the
// Kyoto destination card, so it still renders on both pages and stays
// in this list. Chat rebuild (Nov 24, 2026): the photo comes from the
// verified pool in lib/data.ts — the chat no longer defines its own
// hardcoded HERO_PHOTO const (the old S0 hero's Unsplash URL must not
// survive).
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/images.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from '../lib/data.ts';
import { discoveryDestinations } from '../lib/discovery.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// The S0 canvas photo is the Kyoto pool photo — the chat reads it from
// GLOBAL_DESTINATIONS, never from its own hardcoded URL.
function chatPhotoUrl() {
  const kyoto = GLOBAL_DESTINATIONS.find((d) => d.name === 'Kyoto');
  assert.ok(kyoto?.image, 'the Kyoto pool photo exists in lib/data.ts');
  const src = readFileSync(new URL('../components/FujinChat.tsx', import.meta.url), 'utf8');
  assert.ok(!src.includes('HERO_PHOTO'), 'the chat no longer defines a hardcoded HERO_PHOTO');
  assert.ok(src.includes("GLOBAL_DESTINATIONS.find((d) => d.name === 'Kyoto')"), 'the S0 canvas photo comes from the verified pool');
  return kyoto.image;
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

test('site photos: chat S0 canvas photo + every destination card image returns real image bytes', async () => {
  // The chat canvas photo IS the Kyoto pool photo, so it appears twice
  // in the list — dedupe before fetching, or the distinct-bytes check
  // below would flag the same photo fetched twice as a placeholder.
  const urls = [
    ...new Set([
      chatPhotoUrl(),
      ...GLOBAL_DESTINATIONS.map((d) => d.image),
      ...HIDDEN_GEMS.map((d) => d.image),
      ...Object.values(CITY_PHOTOS),
    ]),
  ];
  assert.ok(urls.length >= 21, `expected the chat canvas photo + destination + city photos, got ${urls.length}`);
  const bufs = [];
  for (const url of urls) bufs.push(await fetchImage(url));
  // No two photos are byte-identical — a placeholder or error image
  // would repeat across URLs, real photos never do.
  const sizes = new Set(bufs.map((b) => b.length));
  assert.equal(sizes.size, bufs.length, 'every photo has distinct bytes (no placeholder repeats)');
});

// Every Popular destinations entry has at least one photo (defect,
// Nov 14 2026: 11 of 26 entries had photos: [] — the image map only
// covered the 6 global destinations + 3 hidden gems — so their cards
// rendered the grey fallback with no <img> ever in the DOM). This
// mirrors the libraryEntries photo computation in FujinApp exactly.
test('popular destinations: every library entry has at least one photo', () => {
  const imageByName = new Map([
    ...GLOBAL_DESTINATIONS.map((d) => [d.name, d.image]),
    ...HIDDEN_GEMS.map((d) => [d.name, d.image]),
    ...Object.entries(CITY_PHOTOS),
  ]);
  const discovery = discoveryDestinations();
  const missing = [];
  for (const e of discovery) {
    const stopPhotos = [...new Set(e.stops.map((s) => s.city).map((c) => imageByName.get(c)).filter(Boolean))];
    const own = imageByName.get(e.destination);
    if (!(own ? [own] : stopPhotos).length) missing.push(e.destination);
  }
  for (const d of GLOBAL_DESTINATIONS) {
    if (discovery.some((e) => e.destination === d.name)) continue;
    if (!imageByName.get(d.name)) missing.push(d.name);
  }
  assert.deepEqual(missing, [], `entries without a photo: ${missing.join(', ')}`);
});
