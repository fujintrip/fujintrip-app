// Map styles — MapLibre GL JS + OpenFreeMap (modern-map build, Nov 13 2026).
// Vector tiles, no API key, no account, no env vars. The code uses the
// STYLE URLs, never raw tile URLs: the TileJSON template behind the
// style carries a dated build path (e.g. /planet/20261101_080013_pt/),
// so a hardcoded tile URL would rot. Verified live Nov 13 2026:
// both styles return HTTP 200, style version 8; vector tiles for
// Prague (183 KB) and Paris (275 KB) at z10 differ per location.
// The fallback layers (Leaflet, Esri dark / OSM light) are kept for
// the no-WebGL / style-failed path — see TripMapLeaflet.tsx.
export const MAP_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

// The style for the current theme — switched at runtime with
// map.setStyle, so the theme toggle never rebuilds the map.
export function styleForTheme(dark: boolean): string {
  return dark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

// Fallback tile layers (Leaflet path only — no API key on either).
// Esri World Dark Gray Canvas uses the {z}/{y}/{x} REST order.
export const FALLBACK_TILE_LIGHT =
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const FALLBACK_TILE_DARK =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
