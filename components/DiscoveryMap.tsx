// "Where to go" discovery map (design #15): a world map with a price
// bubble on every destination FujinTrip can plan — the Google Flights
// Explore pattern, seeded with the planner's prices. Tapping a bubble
// selects that trip; the essentials live in the panel beside the map
// (and in the chip list below it, for keyboard users and small screens).
// Client-only — Leaflet needs window, so page.tsx imports this with
// next/dynamic ssr:false. Tiles are OpenStreetMap (free, no API key).
// Bubbles are 44px touch targets (design #8); the selected bubble gets
// the warm accent border. Prices are planning estimates — the panel says
// so, and the bubble shows only the price, never a live claim.
'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DiscoveryEntry } from '../lib/discovery';

function FitBounds({ pins }: { pins: DiscoveryEntry[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length > 1) {
      map.fitBounds(
        L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])),
        { padding: [24, 24] },
      );
    }
  }, [map, pins]);
  return null;
}

// Price bubble: the total on top, the destination under it — at a world
// zoom the traveler reads where the price is, not just that it exists.
// Same-city pins are already spread in the data layer, so two bubbles
// starting in one city sit side by side instead of stacking.
function bubbleIcon(entry: DiscoveryEntry, selected: boolean) {
  const price =
    entry.price === null ? '—' : `$${entry.price.toLocaleString()}`;
  return L.divIcon({
    className: 'fujin-discovery-bubble',
    html: `<div style="background:#111;color:#fff;border:2px solid ${
      selected ? '#c2410c' : '#fff'
    };border-radius:12px;padding:6px 10px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.4);cursor:pointer"><span style="font-weight:700;font-size:13px">${price}</span><span style="font-size:11px;opacity:.85">${entry.destination}</span></div>`,
    iconSize: [0, 0],
    iconAnchor: [60, 22],
  });
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
  // Dark mode (§6): CARTO dark_matter tiles, like the trip map.
  dark?: boolean;
}) {
  if (!pins.length) return null;
  return (
    <div style={{ height: '100%', minHeight: 320, borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <MapContainer center={[20, 0]} zoom={2} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} zoomControl={false}>
        <ZoomControl position="topright" />
        <TileLayer
          attribution={
            dark
              ? 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
          url={
            dark
              // Esri World Dark Gray canvas — no API key needed (verified
              // live Nov 13 2026: HTTP 200, real map data). CARTO's
              // no-key endpoint now serves an identical "API KEY
              // REQUIRED" tile for every coordinate, so it is gone.
              // Note the {z}/{y}/{x} order: Esri's REST tile path.
              ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
              : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          }
        />
        {pins.map((p) => (
          <Marker
            key={p.key}
            position={[p.lat, p.lng]}
            icon={bubbleIcon(p, selectedKey === p.key)}
            eventHandlers={{ click: () => onSelect(p) }}
          />
        ))}
        <FitBounds pins={pins} />
      </MapContainer>
    </div>
  );
}
