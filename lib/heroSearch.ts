// Hero search suggestions (TripAdvisor homepage build): the matcher
// over the places FujinTrip already knows — the 21 discovery routes
// plus the six global destinations. Never invents a place: a query
// with no match returns no suggestions, and the chat still takes the
// typed text as a pending message. A suggestion carries the route's
// ordered cities, so picking one seeds the chat with the trip.
import { discoveryDestinations } from './discovery';
import { GLOBAL_DESTINATIONS } from './data';
import { buildTripCard } from './tripCard';

export interface HeroSuggestion {
  name: string;
  detail: string; // route stops, or the country for a single city
  cities: string[];
}

export function heroSuggestions(query: string, limit = 6): HeroSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pool: HeroSuggestion[] = [];
  for (const d of discoveryDestinations()) {
    const cities = d.stops.map((s) => s.city);
    pool.push({ name: d.destination, detail: cities.join(' · '), cities });
  }
  for (const g of GLOBAL_DESTINATIONS) {
    if (pool.some((p) => p.name.toLowerCase() === g.name.toLowerCase())) continue;
    pool.push({ name: g.name, detail: g.country, cities: [g.name] });
  }
  const scored: { s: HeroSuggestion; score: number }[] = [];
  for (const s of pool) {
    const name = s.name.toLowerCase();
    const detail = s.detail.toLowerCase();
    const cities = s.cities.map((c) => c.toLowerCase());
    let score: number | null = null;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (cities.some((c) => c.startsWith(q))) score = 2;
    else if (cities.some((c) => c.includes(q))) score = 3;
    else if (detail.includes(q)) score = 4;
    if (score !== null) scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

// The seed for a picked suggestion — the same route stops the
// template cards seed with (cardInfo), via buildTripCard directly.
// An unknown name seeds as a bare destination (buildTripCard's own
// fallback); null only if the card comes back with no stops at all.
export function seedForDestination(name: string): { destination: string; cities: string[] } | null {
  try {
    const c = buildTripCard({ destination: name, travelers: 2, days: 3, month: 0, origin: '' });
    if (!c || !Array.isArray(c.stops) || !c.stops.length) return null;
    const cities = c.stops.map((s) => s.city).filter((city): city is string => typeof city === 'string' && city.trim().length > 0).slice(0, 8);
    return cities.length ? { destination: name, cities } : null;
  } catch {
    return null;
  }
}
