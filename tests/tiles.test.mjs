// Map tile layers — the configured tile URLs must return real map data,
// not a placeholder. CARTO's no-key endpoint (basemaps.cartocdn.com and
// the legacy cartodb-basemaps Fastly mirror) now serves one identical
// "API KEY REQUIRED" tile for every coordinate (verified Nov 13 2026:
// Prague, Paris and open ocean all returned the same 2,513-byte PNG),
// which is what the live site showed as a watermark. This test fetches
// two different coordinates per layer and asserts the bytes differ — a
// placeholder is identical everywhere, real map data is not.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/tiles.test.mjs
// (Needs network access to the tile providers; the fetch sends a browser
// User-Agent AND a Referer because OSM blocks bare clients with a 403
// placeholder tile (verified Nov 13 2026: UA alone got the 6,725-byte
// "Access blocked" image, UA + Referer got the real 43 KB tile).
// Real browsers always send a Referer when loading tiles from a page,
// which is why light mode works for real users.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REFERER = 'https://fujintrip.com/';

const LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DARK =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';

function tileUrl(template, x, y, z = 10) {
  return template
    .replace('{s}', 'a')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}

async function fetchTile(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: REFERER },
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.status, 200, `tile ${url} should return 200, got ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  assert.ok(ct.startsWith('image/'), `tile ${url} should be an image, got ${ct}`);
  return Buffer.from(await r.arrayBuffer());
}

test('tile layers return real map data, not placeholders', async () => {
  const trip = readFileSync('components/TripMap.tsx', 'utf8');
  const disc = readFileSync('components/DiscoveryMap.tsx', 'utf8');
  for (const [name, src] of [
    ['TripMap', trip],
    ['DiscoveryMap', disc],
  ]) {
    assert.ok(src.includes(LIGHT), `${name} must use the OSM light tiles`);
    assert.ok(src.includes(DARK), `${name} must use the Esri dark tiles`);
    assert.ok(
      !src.includes('basemaps.cartocdn.com') && !src.includes('cartodb-basemaps'),
      `${name} must not use CARTO (needs an API key now)`,
    );
  }
  // Prague (553, 346) vs Paris (518, 352) at z10 — real tiles differ by
  // location; the CARTO placeholder was byte-identical everywhere.
  const osmPrague = await fetchTile(tileUrl(LIGHT, 553, 346));
  const osmParis = await fetchTile(tileUrl(LIGHT, 518, 352));
  assert.notDeepEqual(osmPrague, osmParis, 'OSM light tiles must differ by location');
  const esriPrague = await fetchTile(tileUrl(DARK, 553, 346));
  const esriParis = await fetchTile(tileUrl(DARK, 518, 352));
  assert.notDeepEqual(esriPrague, esriParis, 'Esri dark tiles must differ by location');
});
