// Map styles — MapLibre GL JS + OpenFreeMap (modern-map build, Nov 13 2026).
// The configured style URLs must return real map data, not a placeholder.
// The style JSONs are fetched and the vector tiles are fetched through
// the style's own TileJSON template — the template carries a dated
// build path (e.g. /planet/20261101_080013_pt/), so the test reads it
// dynamically instead of hardcoding a tile URL that would rot.
// Two different coordinates per layer must return different bytes —
// a placeholder is identical everywhere, real map data is not.
// The Leaflet fallback layers (Esri dark / OSM light) are checked the
// same way: a fallback that serves placeholders would be no fallback.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/tiles.test.mjs
// (The OSM fetch sends a browser User-Agent AND a Referer because OSM
// blocks bare clients with a 403 placeholder tile — verified Nov 13
// 2026: UA alone got the 6,725-byte "Access blocked" image, UA +
// Referer got the real 43 KB tile. Real browsers always send a
// Referer when loading tiles from a page, which is why light mode
// works for real users.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAP_STYLE_LIGHT,
  MAP_STYLE_DARK,
  FALLBACK_TILE_LIGHT,
  FALLBACK_TILE_DARK,
} from '../lib/mapStyles.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REFERER = 'https://fujintrip.com/';

function rasterUrl(template, x, y, z = 10) {
  return template
    .replace('{s}', 'a')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}

async function fetchOk(url, headers = {}) {
  const r = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.status, 200, `${url} should return 200, got ${r.status}`);
  return r;
}

async function fetchJson(url) {
  const r = await fetchOk(url);
  const ct = r.headers.get('content-type') || '';
  assert.ok(ct.includes('json'), `${url} should be JSON, got ${ct}`);
  return r.json();
}

async function fetchTile(url, headers = {}) {
  const r = await fetchOk(url, headers);
  const ct = r.headers.get('content-type') || '';
  assert.ok(ct.startsWith('image/'), `${url} should be an image, got ${ct}`);
  return Buffer.from(await r.arrayBuffer());
}

async function fetchVectorTile(url) {
  const r = await fetchOk(url);
  const ct = r.headers.get('content-type') || '';
  assert.ok(
    ct.includes('mapbox-vector-tile') || ct.includes('protobuf'),
    `${url} should be a vector tile, got ${ct}`,
  );
  return Buffer.from(await r.arrayBuffer());
}

test('map styles: components use OpenFreeMap styles, fallback keeps Esri/OSM', () => {
  const styles = readFileSync('lib/mapStyles.ts', 'utf8');
  assert.ok(styles.includes(MAP_STYLE_LIGHT), 'mapStyles must define the liberty style URL');
  assert.ok(styles.includes(MAP_STYLE_DARK), 'mapStyles must define the dark style URL');
  assert.ok(!styles.includes('api_key') && !styles.includes('apikey'), 'style URLs must not need an API key');
  for (const [name, file] of [
    ['TripMap', 'components/TripMap.tsx'],
    ['DiscoveryMap', 'components/DiscoveryMap.tsx'],
  ]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes('styleForTheme'), `${name} must switch styles with styleForTheme`);
    assert.ok(src.includes('maplibre-gl'), `${name} must use MapLibre GL JS`);
    assert.ok(
      !src.includes('basemaps.cartocdn.com') &&
        !src.includes('cartodb-basemaps') &&
        !src.includes('arcgisonline') &&
        !src.includes('tile.openstreetmap.org'),
      `${name} must not carry raster tile URLs — those live in the Leaflet fallback only`,
    );
  }
  for (const [name, file] of [
    ['TripMapLeaflet', 'components/TripMapLeaflet.tsx'],
    ['DiscoveryMapLeaflet', 'components/DiscoveryMapLeaflet.tsx'],
  ]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes(FALLBACK_TILE_LIGHT), `${name} fallback must use the OSM light tiles`);
    assert.ok(src.includes(FALLBACK_TILE_DARK), `${name} fallback must use the Esri dark tiles`);
    assert.ok(
      !src.includes('basemaps.cartocdn.com') && !src.includes('cartodb-basemaps'),
      `${name} must not use CARTO (needs an API key now)`,
    );
  }
});

test('OpenFreeMap styles return style JSON and real vector tiles', async () => {
  for (const styleUrl of [MAP_STYLE_LIGHT, MAP_STYLE_DARK]) {
    const style = await fetchJson(styleUrl);
    assert.equal(style.version, 8, `${styleUrl} must be a style v8 document`);
    const tileJsonUrl = style.sources?.openmaptiles?.url;
    assert.ok(
      typeof tileJsonUrl === 'string' && tileJsonUrl.startsWith('https://tiles.openfreemap.org/'),
      `${styleUrl} must point its vector source at an OpenFreeMap TileJSON`,
    );
    const tileJson = await fetchJson(tileJsonUrl);
    const template = tileJson.tiles?.[0];
    assert.ok(
      typeof template === 'string' && template.includes('{z}/{x}/{y}'),
      `TileJSON for ${styleUrl} must carry a tile URL template`,
    );
    // Prague (553, 346) vs Paris (518, 352) at z10 — real tiles differ
    // by location; a placeholder would be byte-identical everywhere.
    const prague = await fetchVectorTile(
      template.replace('{z}', '10').replace('{x}', '553').replace('{y}', '346'),
    );
    const paris = await fetchVectorTile(
      template.replace('{z}', '10').replace('{x}', '518').replace('{y}', '352'),
    );
    assert.ok(prague.length > 1000, `Prague vector tile for ${styleUrl} must hold real map data`);
    assert.notDeepEqual(prague, paris, `vector tiles for ${styleUrl} must differ by location`);
  }
});

test('fallback tile layers return real map data, not placeholders', async () => {
  // Prague (553, 346) vs Paris (518, 352) at z10 — real tiles differ by
  // location; the CARTO placeholder was byte-identical everywhere.
  const headers = { 'User-Agent': UA, Referer: REFERER };
  const osmPrague = await fetchTile(rasterUrl(FALLBACK_TILE_LIGHT, 553, 346), headers);
  const osmParis = await fetchTile(rasterUrl(FALLBACK_TILE_LIGHT, 518, 352), headers);
  assert.notDeepEqual(osmPrague, osmParis, 'OSM light tiles must differ by location');
  const esriPrague = await fetchTile(rasterUrl(FALLBACK_TILE_DARK, 553, 346), headers);
  const esriParis = await fetchTile(rasterUrl(FALLBACK_TILE_DARK, 518, 352), headers);
  assert.notDeepEqual(esriPrague, esriParis, 'Esri dark tiles must differ by location');
});
