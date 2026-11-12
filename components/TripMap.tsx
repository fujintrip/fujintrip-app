// Trip map (Layla-style "earth with the locations on it" + inventory):
// an interactive Leaflet map with numbered markers on each stop, a route
// line between them, and price-tag markers for every bookable leg —
// flights, stays, car rental. The traveler clicks a price tag to read
// more, then Add to plan. Client-only — Leaflet needs window, so
// page.tsx imports this with next/dynamic ssr:false. Tiles are
// OpenStreetMap (free, no API key).
'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TripLeg } from '../lib/tripCard';

export type MapStop = { city: string; lat: number; lng: number };

function FitBounds({ stops }: { stops: MapStop[] }) {
  const map = useMap();
  useEffect(() => {
    if (stops.length > 1) {
      map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number])), { padding: [30, 30] });
    } else if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 5);
    }
  }, [map, stops]);
  return null;
}

function numberedIcon(n: number) {
  return L.divIcon({
    className: 'fujin-map-marker',
    html: `<div style="background:#b98a1d;color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;box-shadow:0 1px 5px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Price tag for a bookable leg: colored by kind (flight gold, stay jade,
// car slate), with the price on it. Selected tags get a dark border;
// legs already added to the plan get a green border and a check.
const LEG_COLOR: Record<TripLeg['kind'], string> = {
  flight: '#b98a1d',
  transport: '#b98a1d',
  stay: '#1f5c4d',
  car: '#5b6b7a',
};

function priceTagIcon(leg: TripLeg, selected: boolean, added: boolean) {
  const color = LEG_COLOR[leg.kind];
  const border = added ? '#1f7a4d' : selected ? '#333' : '#fff';
  const check = added ? '✓ ' : '';
  return L.divIcon({
    className: 'fujin-price-tag',
    html: `<div style="background:${color};color:#fff;border:2px solid ${border};border-radius:20px;padding:3px 9px;font-weight:700;font-size:12px;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.4);cursor:pointer">${check}${leg.icon} $${leg.price.toLocaleString()}</div>`,
    iconSize: [0, 0],
    iconAnchor: [40, 12],
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
  return (
    <div style={{ height: '100%', minHeight: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid #e8e0c8' }}>
      <MapContainer center={center} zoom={3} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {stops.length > 1 && <Polyline positions={positions} color="#b98a1d" weight={3} dashArray="6 6" />}
        {stops.map((s, i) => (
          <Marker key={s.city} position={[s.lat, s.lng]} icon={numberedIcon(i + 1)} />
        ))}
        {legs.map((leg) => (
          <Marker
            key={leg.id}
            position={[leg.lat, leg.lng]}
            icon={priceTagIcon(leg, selectedLegId === leg.id, addedLegIds.includes(leg.id))}
            eventHandlers={{ click: () => onSelectLeg?.(leg) }}
          />
        ))}
        <FitBounds stops={stops} />
      </MapContainer>
    </div>
  );
}
