// Trip map (Layla-style "earth with the locations on it" + inventory):
// an interactive Leaflet map with numbered markers on each stop, a route
// line between them, and price-tag markers for every bookable leg —
// flights, stays, car rental. The traveler clicks a price tag to read
// more, then Add to plan. Client-only — Leaflet needs window, so
// page.tsx imports this with next/dynamic ssr:false. Tiles are
// OpenStreetMap (free, no API key).
'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TripLeg } from '../lib/tripCard';
import { priceTagAnchorY } from '../lib/tripCard';

export type MapStop = { city: string; lat: number; lng: number };

function FitBounds({ stops }: { stops: MapStop[] }) {
  const map = useMap();
  useEffect(() => {
    if (stops.length > 1) {
      // Top padding is generous (210px): the price tags stack upward
      // from each city (up to ~200px above the northernmost stop), so
      // the route must sit low enough that no tag is clipped.
      map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number])), { paddingTopLeft: [48, 210], paddingBottomRight: [48, 48] });
    } else if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 5);
    }
  }, [map, stops]);
  return null;
}

function numberedIcon(n: number) {
  return L.divIcon({
    className: 'fujin-map-marker',
    html: `<div style="background:#111;color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;box-shadow:0 1px 5px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Price tag for a bookable leg: a WHITE pill (Nov 12 layout rebuild —
// the old dark pills were unreadable where several piled on one city:
// a dark tag half-hidden behind its own marker, "$6…" fragments
// overlapping the city label). Kind shows as the border color: dark
// for flights, warm accent for stays, gray for cars. Selected tags get
// a thicker dark border; legs already added to the plan get a green
// border and a check. The pill is a 44px touch target (Apple HIG
// 44x44pt / Material 48dp) — the map is the product's most-tapped
// surface and its tags were ~24px tall.
const LEG_COLOR: Record<TripLeg['kind'], string> = {
  flight: '#111',
  transport: '#111',
  stay: '#c2410c',
  car: '#6b7280',
};

// anchorY is the per-leg stack offset from priceTagAnchorY (legs sharing
// a city stack upward, 46px apart, so none overlap each other or the
// city marker). iconAnchor [40, anchorY] puts the pill above its city.
function priceTagIcon(leg: TripLeg, selected: boolean, added: boolean, anchorY: number) {
  const color = LEG_COLOR[leg.kind];
  const border = added ? '#1f7a4d' : selected ? '#111' : color;
  const width = selected ? 3 : 2;
  const check = added ? '✓ ' : '';
  return L.divIcon({
    className: 'fujin-price-tag',
    html: `<div style="background:#fff;color:#111;border:${width}px solid ${border};border-radius:22px;padding:10px 14px;min-height:44px;display:flex;align-items:center;font-weight:700;font-size:13px;line-height:1.2;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.4);cursor:pointer">${check}${leg.icon} $${leg.price.toLocaleString()}</div>`,
    iconSize: [0, 0],
    iconAnchor: [40, anchorY],
  });
}

export default function TripMap({
  stops,
  legs = [],
  selectedLegId = null,
  onSelectLeg,
  addedLegIds = [],
}: {
  stops: MapStop[];
  legs?: TripLeg[];
  selectedLegId?: string | null;
  onSelectLeg?: (leg: TripLeg) => void;
  addedLegIds?: string[];
}) {
  if (!stops.length) return null;
  const positions: Array<[number, number]> = stops.map((s) => [s.lat, s.lng]);
  const center: [number, number] = stops.length === 1 ? positions[0] : [0, 0];
  // Per-city stack offsets: legs sharing a city render as a vertical
  // stack of readable pills instead of one overlapping pile.
  const anchors = priceTagAnchorY(legs);
  return (
    <div style={{ height: '100%', minHeight: 320, borderRadius: 16, overflow: 'hidden', border: '1px solid #e8e8e6' }}>
      <MapContainer center={center} zoom={3} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} zoomControl={false}>
        {/* Zoom buttons (design #8): scroll-wheel zoom is off so the page
            scrolls; the +/- sits top-right, and the leg card docks
            below it (see .legcard in globals.css). */}
        <ZoomControl position="topright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {stops.length > 1 && <Polyline positions={positions} color="#111" weight={3} dashArray="6 6" />}
        {stops.map((s, i) => (
          <Marker key={s.city} position={[s.lat, s.lng]} icon={numberedIcon(i + 1)} />
        ))}
        {legs.map((leg) => (
          <Marker
            key={leg.id}
            position={[leg.lat, leg.lng]}
            icon={priceTagIcon(leg, selectedLegId === leg.id, addedLegIds.includes(leg.id), anchors.get(leg.id) ?? 62)}
            eventHandlers={{ click: () => onSelectLeg?.(leg) }}
          />
        ))}
        <FitBounds stops={stops} />
      </MapContainer>
    </div>
  );
}
