// Floating itinerary rail over the map (modern-map build, Nov 13 2026).
// Pure data: the rail lists each stop with its nights and date range,
// built from the trip card's own stops — no new data, no new prices.
// The rail renders as plain React DOM over the MapLibre canvas (and
// over the Leaflet fallback too, since it lives in TripMap's container,
// not in the map engine), so it works on both paths.
import type { TripCardStop } from './tripCard';

export type MapRailStop = { city: string; nights: number; range: string };
export type MapRail = { summary: string; stops: MapRailStop[] };

// Short range, e.g. "Jan 4 – Jan 8" — the rail is a glance, not a
// timetable, so no year and no weekday.
export function formatRailRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function buildMapRail(stops: TripCardStop[]): MapRail {
  const nights = stops.reduce((n, s) => n + s.nights, 0);
  return {
    summary: `${stops.length} stop${stops.length !== 1 ? 's' : ''} · ${nights} night${nights !== 1 ? 's' : ''}`,
    stops: stops.map((s) => ({
      city: s.city,
      nights: s.nights,
      range: formatRailRange(s.startDate, s.endDate),
    })),
  };
}
