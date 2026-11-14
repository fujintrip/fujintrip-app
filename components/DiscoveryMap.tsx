// "Where to go" discovery map — MapLibre GL JS + OpenFreeMap
// (modern-map build, Nov 13 2026). Vector map, no API key: the light
// "liberty" and dark styles, switched at runtime with setStyle when
// the theme toggles. A world map with a price bubble on every
// destination FujinTrip can plan — the Google Flights Explore
// pattern, seeded with the planner's prices. Tapping a bubble selects
// that trip; the essentials live in the panel beside the map (and in
// the chip list below it, for keyboard users and small screens). The
// map is full-bleed edge-to-edge in its box (no more 16px boxed
// panel). Bubbles are 44px touch targets (design #8); the selected
// bubble gets the warm accent border. Prices are planning estimates
// — the panel says so, and the bubble shows only the price, never a
// live claim. If WebGL is unavailable or the style fails to load, the
// old Leaflet map renders instead (DiscoveryMapLeaflet) — the Leaflet
// code path is kept for that fallback, never deleted. Client-only —
// MapLibre needs window, so FujinApp imports this with next/dynamic
// ssr:false.
'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DiscoveryEntry } from '../lib/discovery';
import { styleForTheme } from '../lib/mapStyles';
import LeafletDiscoveryMap from './DiscoveryMapLeaflet';

// Same 8-second style-load grace as the trip map (see TripMap).
const STYLE_LOAD_TIMEOUT_MS = 8000;

// Price bubble: the total on top, the destination under it — at a world
// zoom the traveler reads where the price is, not just that it exists.
// Same-city pins are already spread in the data layer, so two bubbles
// starting in one city sit side by side instead of stacking.
function bubbleEl(entry: DiscoveryEntry, selected: boolean, onSelect: (entry: DiscoveryEntry) => void): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fujin-discovery-bubble';
  const price = entry.price === null ? '—' : `$${entry.price.toLocaleString()}`;
  el.innerHTML = `<div style="background:#111;color:#fff;border:2px solid ${
    selected ? '#c2410c' : '#fff'
  };border-radius:12px;padding:6px 10px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.4);cursor:pointer"><span style="font-weight:700;font-size:13px">${price}</span><span style="font-size:11px;opacity:.85">${entry.destination}</span></div>`;
  el.addEventListener('click', () => onSelect(entry));
  return el;
}

export default function DiscoveryMap({
  pins,
  selectedKey,
  onSelect,
  dark = false,
}: {
  pins: DiscoveryEntry[];
  selectedKey: string | null;
  onSelect: (entry: DiscoveryEntry) => void;
  // Dark mode: the OpenFreeMap dark style, so the map stays readable
  // when the page goes dark. The bubbles stay dark in both themes —
  // they are tags on the map, and the selected one keeps its warm
  // accent border.
  dark?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [fallback, setFallback] = useState(false);
  const pinsKey = pins.map((p) => p.key).join('|');

  // Init once, on mount.
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
        style: styleForTheme(dark),
        center: [20, 0],
        zoom: 2,
        // Scroll-wheel zoom is off so the page scrolls; the +/- sits
        // top-right.
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
      fitToPins();
    });
    map.on('error', () => {
      if (!loaded) setFallback(true);
    });
    return () => {
      window.clearTimeout(loadTimer);
      if (mapRef.current === map) {
        map.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fits all pins in view. Runs on load and when the pin set changes.
  function fitToPins() {
    const map = mapRef.current;
    if (!map || pins.length <= 1) return;
    const bounds = new maplibregl.LngLatBounds(
      [pins[0].lng, pins[0].lat],
      [pins[0].lng, pins[0].lat],
    );
    for (const p of pins) bounds.extend([p.lng, p.lat]);
    if (map.loaded()) map.fitBounds(bounds, { padding: 24 });
    else map.once('load', () => map.fitBounds(bounds, { padding: 24 }));
  }
  useEffect(() => {
    fitToPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, fallback]);

  // Theme toggle: swap the style in place — markers (DOM) survive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fallback) return;
    map.setStyle(styleForTheme(dark));
  }, [dark, fallback]);

  // Bubbles follow the pins / selection. They are rebuilt (not
  // diffed) — the old Leaflet map re-created its icons every render
  // too.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fallback) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const p of pins) {
      const marker = new maplibregl.Marker({
        element: bubbleEl(p, selectedKey === p.key, onSelect),
        // Top-left anchor + offset puts the bubble's top-left 60px
        // left and 22px above its city — the same placement the
        // Leaflet iconAnchor [60, 22] produced.
        anchor: 'top-left',
        offset: [-60, -22],
      })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, selectedKey, fallback]);

  // If the style gave up (timeout / error), the MapLibre map is
  // removed and the Leaflet fallback takes its place. One-way: the
  // fallback never flips back.
  useEffect(() => {
    if (fallback && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, [fallback]);

  if (!pins.length) return null;
  return (
    <div className="map-fullbleed">
      {fallback ? (
        <LeafletDiscoveryMap
          pins={pins}
          selectedKey={selectedKey}
          onSelect={onSelect}
          dark={dark}
        />
      ) : (
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-label="Where to go map" />
      )}
    </div>
  );
}
