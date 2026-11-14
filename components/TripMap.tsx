// Trip map — MapLibre GL JS + OpenFreeMap (modern-map build, Nov 13 2026).
// Vector map, no API key: the light "liberty" and dark styles from
// OpenFreeMap, switched at runtime with setStyle when the theme
// toggles. Numbered stops, a solid brand-warm route line, and white
// price-tag pills (HTML markers) with the same click → leg card
// interaction as the old Leaflet map. The map is full-bleed
// edge-to-edge in its column (no more 16px boxed panel), with a
// floating glass day-by-day itinerary rail over it (desktop only).
// If WebGL is unavailable or the style fails to load, the old Leaflet
// map renders instead (TripMapLeaflet) — the Leaflet code path is kept
// for that fallback, never deleted. Client-only — MapLibre needs
// window, so FujinChat imports this with next/dynamic ssr:false.
'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, LineString } from 'geojson';
import type { TripLeg } from '../lib/tripCard';
import { mapStopsKey, priceTagAnchorY, tagStaggerDelay } from '../lib/tripCard';
import type { MapRail } from '../lib/mapRail';
import { styleForTheme } from '../lib/mapStyles';
import LeafletTripMap from './TripMapLeaflet';

export type MapStop = { city: string; lat: number; lng: number };

const ROUTE_SOURCE = 'fujin-route';
const ROUTE_LAYER = 'fujin-route-line';
// Solid brand-warm route line (was a dashed dark line on Leaflet).
// The dark theme's lighter accent keeps it readable on the dark style.
const ROUTE_COLOR_LIGHT = '#c2410c';
const ROUTE_COLOR_DARK = '#fb923c';
// The style gets 8 seconds to load before the map gives up and shows
// the Leaflet fallback — a stalled network should not leave a blank
// box, and a failed style should not leave the traveler waiting.
const STYLE_LOAD_TIMEOUT_MS = 8000;

const LEG_COLOR: Record<TripLeg['kind'], string> = {
  flight: '#111',
  transport: '#111',
  stay: '#c2410c',
  car: '#6b7280',
};

function numberedEl(n: number): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fujin-map-marker';
  el.innerHTML = `<div style="background:#111;color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;box-shadow:0 1px 5px rgba(0,0,0,.4)">${n}</div>`;
  return el;
}

// Price tag for a bookable leg: a WHITE pill (same look as the Leaflet
// map — a dark tag half-hidden behind its own marker was unreadable
// where several piled on one city). Kind shows as the border color:
// dark for flights, warm accent for stays, gray for cars. Selected
// tags get a thicker dark border; legs already added to the plan get
// a green border and a check. The pill is a 44px touch target.
// anchorY is the per-leg stack offset (legs sharing a city stack
// upward, 46px apart) — the marker's anchor sits that far above the
// city, so the pill stack reads top-down over its stop. animate is
// mount-only (interface round M5): the tag enters with a 200ms
// scale-from-0.9 + fade, delayed by its stagger; tags that already
// existed get animate=false and never re-animate on later renders.
function priceTagEl(
  leg: TripLeg,
  selected: boolean,
  added: boolean,
  anchorY: number,
  animate = false,
  delayMs = 0,
  onSelect: (leg: TripLeg) => void,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fujin-price-tag';
  const color = LEG_COLOR[leg.kind];
  const border = added ? '#1f7a4d' : selected ? '#111' : color;
  const width = selected ? 3 : 2;
  const check = added ? '✓ ' : '';
  const entrance = animate
    ? `animation:tag-in 200ms var(--ease) both;animation-delay:${delayMs}ms;`
    : '';
  el.innerHTML = `<div style="background:#fff;color:#111;border:${width}px solid ${border};border-radius:22px;padding:10px 14px;min-height:44px;display:flex;align-items:center;font-weight:700;font-size:13px;line-height:1.2;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.4);cursor:pointer;${entrance}">${check}${leg.icon} $${leg.price.toLocaleString()}</div>`;
  el.addEventListener('click', () => onSelect(leg));
  return el;
}

export default function TripMap({
  stops,
  legs = [],
  selectedLegId = null,
  onSelectLeg,
  addedLegIds = [],
  dark = false,
  rail,
}: {
  stops: MapStop[];
  legs?: TripLeg[];
  selectedLegId?: string | null;
  onSelectLeg?: (leg: TripLeg) => void;
  addedLegIds?: string[];
  // Dark mode: the OpenFreeMap dark style + a lighter route line, so
  // the map stays readable when the page goes dark. The white price
  // pills stay white in both themes — they are tags on the map, and
  // white-on-dark is the highest-contrast read there.
  dark?: boolean;
  // Floating itinerary rail (nights + date range per stop), built by
  // the parent from the trip card's own stops. Plain React DOM over
  // the canvas — it renders on the MapLibre path and on the Leaflet
  // fallback alike, and the dialog instance gets it too.
  rail?: MapRail;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const routeRef = useRef<Feature<LineString> | null>(null);
  const stopsRef = useRef<MapStop[]>(stops);
  stopsRef.current = stops;
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const [fallback, setFallback] = useState(false);
  // Mount-only entrance (interface round M5): the stagger runs when
  // this map first mounts and never again for this instance — a flag
  // cleared in an effect after the first paint, so later renders
  // (keystrokes, selection, legs added) re-create the markers without
  // the entrance and nothing re-animates. Hooks sit above the early
  // return, so the hook order never changes.
  const firstMountRef = useRef(true);
  useEffect(() => {
    firstMountRef.current = false;
  }, []);
  const animateTags = firstMountRef.current;
  const key = mapStopsKey(stops);
  const anchors = priceTagAnchorY(legs);

  // (Re)adds the route source + line layer when the map can take it.
  // setStyle drops custom sources, so this runs on every style load —
  // the route survives a theme toggle. Guarded on isStyleLoaded:
  // adding a source while the style is still loading throws.
  function ensureRoute() {
    const map = mapRef.current;
    const route = routeRef.current;
    if (!map || !route || !map.isStyleLoaded()) return;
    const src = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(route);
      return;
    }
    map.addSource(ROUTE_SOURCE, { type: 'geojson', data: route });
    map.addLayer({
      id: ROUTE_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      paint: {
        'line-color': darkRef.current ? ROUTE_COLOR_DARK : ROUTE_COLOR_LIGHT,
        'line-width': 3,
      },
    });
  }

  // Fits the whole route in view — only when the route itself changes
  // (mapStopsKey): the parent re-renders on every keystroke, and
  // refitting on every render made the map jump while the traveler
  // typed. The move is animated (flyTo/fitBounds with a duration) so
  // a revised route glides into view instead of snapping;
  // reduced-motion gets an instant fit instead. Top padding is
  // generous (210px): the price tags stack upward from each city (up
  // to ~200px above the northernmost stop), so the route must sit low
  // enough that no tag is clipped. Left padding widens when the rail
  // is on, so the westernmost stop never hides under it.
  function fitToRoute() {
    const map = mapRef.current;
    const current = stopsRef.current;
    if (!map || !current.length) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (current.length > 1) {
      const bounds = new maplibregl.LngLatBounds(
        [current[0].lng, current[0].lat],
        [current[0].lng, current[0].lat],
      );
      for (const s of current) bounds.extend([s.lng, s.lat]);
      map.fitBounds(bounds, {
        padding: { top: 210, bottom: 48, left: rail ? 248 : 48, right: 48 },
        duration: reduced ? 0 : 800,
      });
    } else {
      map.flyTo({
        center: [current[0].lng, current[0].lat],
        zoom: 5,
        duration: reduced ? 0 : 800,
      });
    }
  }

  // Init once, on mount. The container is the MapLibre canvas; the
  // rail and markers are DOM above it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setFallback(true);
      return;
    }
    if (mapRef.current) return;
    // No WebGL (very old device) makes the constructor throw — that
    // is the fallback, same as a style that never loads.
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: styleForTheme(darkRef.current),
        center: stopsRef.current.length === 1
          ? [stopsRef.current[0].lng, stopsRef.current[0].lat]
          : [0, 0],
        zoom: 3,
        // Scroll-wheel zoom is off so the page scrolls; the +/- sits
        // top-right, and the leg card docks below it.
        scrollZoom: false,
        dragRotate: false,
        touchPitch: false,
      });
    } catch {
      setFallback(true);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      'top-right',
    );
    let loaded = false;
    const loadTimer = window.setTimeout(() => {
      if (!loaded) setFallback(true);
    }, STYLE_LOAD_TIMEOUT_MS);
    map.on('load', () => {
      loaded = true;
      window.clearTimeout(loadTimer);
      ensureRoute();
      fitToRoute();
    });
    // A theme toggle reloads the style — the route layer is re-added
    // here, never lost.
    map.on('style.load', () => ensureRoute());
    // A style that errors before load (bad URL, offline) falls back;
    // a tile that errors after load does not — one bad tile is not a
    // broken map.
    map.on('error', () => {
      if (!loaded) setFallback(true);
    });
    return () => {
      window.clearTimeout(loadTimer);
      // The fallback effect may already have removed this map (style
      // timeout / error) — remove is guarded so a double remove is a
      // no-op, and the ref is only ours while it still points here.
      if (mapRef.current === map) {
        map.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route data follows the stops; the layer is (re)added by
  // ensureRoute on load / style load.
  useEffect(() => {
    routeRef.current =
      stops.length > 1
        ? {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: stops.map((s) => [s.lng, s.lat] as [number, number]),
            },
          }
        : null;
    ensureRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Refit when the route changes (not on every render).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fallback) return;
    if (map.loaded()) fitToRoute();
    else map.once('load', fitToRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fallback]);

  // Theme toggle: swap the style in place — markers (DOM) survive,
  // the route layer is re-added on style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fallback) return;
    map.setStyle(styleForTheme(dark));
  }, [dark, fallback]);

  // Markers follow stops / legs / selection. They are rebuilt (not
  // diffed) — the old Leaflet map re-created its icons every render
  // too, and the mount-only entrance flag keeps the stagger from
  // replaying.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fallback) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    const add = (
      el: HTMLElement,
      lngLat: [number, number],
      opts?: maplibregl.MarkerOptions,
    ) => {
      const marker = new maplibregl.Marker({ element: el, ...opts })
        .setLngLat(lngLat)
        .addTo(map);
      markersRef.current.push(marker);
    };
    stops.forEach((s, i) => add(numberedEl(i + 1), [s.lng, s.lat]));
    legs.forEach((leg, i) => {
      const anchorY = anchors.get(leg.id) ?? 62;
      add(
        priceTagEl(
          leg,
          selectedLegId === leg.id,
          addedLegIds.includes(leg.id),
          anchorY,
          animateTags,
          tagStaggerDelay(i),
          (l) => onSelectLeg?.(l),
        ),
        [leg.lng, leg.lat],
        // Top-left anchor + offset puts the pill's top-left 40px left
        // and anchorY above its city — the same stack the Leaflet
        // iconAnchor [40, anchorY] produced.
        { anchor: 'top-left', offset: [-40, -anchorY] },
      );
    });
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, legs, selectedLegId, addedLegIds, fallback]);

  // If the style gave up (timeout / error), the MapLibre map is
  // removed and the Leaflet fallback takes its place. One-way: the
  // fallback never flips back.
  useEffect(() => {
    if (fallback && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, [fallback]);

  if (!stops.length) return null;
  return (
    <div className="map-fullbleed">
      {fallback ? (
        <LeafletTripMap
          stops={stops}
          legs={legs}
          selectedLegId={selectedLegId}
          onSelectLeg={onSelectLeg}
          addedLegIds={addedLegIds}
          dark={dark}
        />
      ) : (
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-label="Trip map" />
      )}
      {rail && (
        <div className="map-rail" aria-label="Your route">
          <div className="map-rail-head">{rail.summary}</div>
          <ol className="map-rail-list">
            {rail.stops.map((s, i) => (
              <li key={s.city}>
                <span className="map-rail-num">{i + 1}</span>
                <span className="map-rail-city">{s.city}</span>
                <span className="map-rail-nights">
                  {s.nights}n · {s.range}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
