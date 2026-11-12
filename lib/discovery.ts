// "Where to go" discovery map (design report #15, Nov 11, 2026): the
// destinations FujinTrip already knows, as map pins with a price bubble.
// A pin is a TRIP the planner can build — one of the planner's routes, or
// a single place with a real planner base price (Bali, St. George,
// Tacoma, Hilo). A lone city is not a trip, so it gets no pin and no
// price: the planner's price table is per destination/route, and selling
// a city at the table's default base would be inventing a price.
//
// Prices come ONLY from the planner's real price table — the Best value
// total for 2 travelers (comparisonFor / buildPlan). The price does not
// depend on the trip length in the planner, so the pin shows the same
// total the destination cards and the AI quote. Every price is labeled
// "planning estimate" in the UI; a destination the planner has no price
// for (no route, no base price) gets `price: null` — never a guess.
// Routes all sit on the planner's default base today ($3,000 for 2
// travelers), because the planner has no per-route base — that is the
// table's honest answer, and the UI must not dress it up as variety.

import {
  comparisonFor,
  COUNTRY_ROUTES,
  distributeNights,
  KNOWN_DESTINATIONS,
  ROUTE_STOPS,
  routeKeyForDestination,
} from './planner';
import { buildTripCard, CITY_INFO } from './tripCard';
import { bestTimeFor } from './bestTime';

export type DiscoveryStop = { city: string; country: string; nights: number };

export type DiscoveryEntry = {
  key: string;
  // The name the chat seeds with — the route's display name, or the
  // place name. planThisTrip(destination) must seed exactly this.
  destination: string;
  kind: 'route' | 'place' | 'city';
  tag: string;
  // The city the pin sits on, and its (possibly offset) coordinates.
  // Two trips can start in the same city (Europe and Portugal both
  // start in Lisbon; Thailand and Southeast Asia both in Bangkok), so
  // same-city pins are spread a little in longitude — see below.
  pinCity: string;
  lat: number;
  lng: number;
  stops: DiscoveryStop[];
  days: number;
  nights: number;
  experiences: number;
  stays: number;
  transports: number;
  // Best value total for 2 travelers, or null when the planner has no
  // price for this destination.
  price: number | null;
  bestMonth: number;
  bestNote: string;
};

// The planner prices a destination only when it knows it as a route or
// as a base-price place. Anything else — a lone city, an unknown name —
// has no price, even though buildPlan would silently fall back to the
// default base: that fallback is a guess dressed as a table lookup, and
// the discovery map must never show it.
export function priceFor(destination: string): number | null {
  if (routeKeyForDestination(destination) === '' && !KNOWN_DESTINATIONS.includes(destination)) return null;
  return comparisonFor(destination, 2).best.total;
}

// "Prague (4 nights) → Vienna (3 nights) → Budapest (6 nights)".
export function routeLineFor(stops: DiscoveryStop[]): string {
  return stops.map((s) => `${s.city} (${s.nights} night${s.nights > 1 ? 's' : ''})`).join(' → ');
}

function countsFor(destination: string, days: number, month: number) {
  const card = buildTripCard({ destination, travelers: 2, days, month, origin: '' });
  // buildTripCard is typed nullable, but it always builds a card for a
  // known destination — and every caller here passes a known one.
  if (!card) throw new Error(`no trip card for ${destination}`);
  return {
    stops: card.stops.map((s) => ({ city: s.city, country: s.country, nights: s.nights })),
    experiences: card.experiences,
    stays: card.hotels,
    transports: card.transports,
  };
}

function routeEntry(routeKey: string): DiscoveryEntry | null {
  const display = COUNTRY_ROUTES[routeKey]?.display ?? routeKey;
  const stops = ROUTE_STOPS[routeKey];
  if (!stops?.length) return null;
  const pinCity = stops[0].city;
  const info = CITY_INFO[pinCity];
  if (!info) return null;
  const days = stops.reduce((s, x) => s + x.weight, 0) + 1;
  const best = bestTimeFor(display);
  const counts = countsFor(display, days, best.bestMonth);
  return {
    key: routeKey,
    destination: display,
    kind: 'route',
    tag: `Route · ${stops.length} stops`,
    pinCity,
    lat: info.lat,
    lng: info.lng,
    stops: distributeNights(routeKey, days),
    days,
    nights: days - 1,
    experiences: counts.experiences,
    stays: counts.stays,
    transports: counts.transports,
    price: priceFor(display),
    bestMonth: best.bestMonth,
    bestNote: best.bestNote,
  };
}

function singleEntry(name: string, kind: 'place' | 'city'): DiscoveryEntry | null {
  const info = CITY_INFO[name];
  if (!info) return null;
  const days = 3;
  const best = bestTimeFor(name);
  const counts = countsFor(name, days, best.bestMonth);
  return {
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    destination: name,
    kind,
    tag: kind === 'place' ? 'Single place' : 'City',
    pinCity: name,
    lat: info.lat,
    lng: info.lng,
    stops: counts.stops,
    days,
    nights: days - 1,
    experiences: counts.experiences,
    stays: counts.stays,
    transports: counts.transports,
    price: priceFor(name),
    bestMonth: best.bestMonth,
    bestNote: best.bestNote,
  };
}

// One entry for any destination the planner knows: a route, a
// base-price place, or a lone city (price null — the planner prices
// trips, not cities). Returns null for a name the planner does not
// know at all — no pin, no price, no guess.
export function discoveryEntry(destination: string): DiscoveryEntry | null {
  const routeKey = routeKeyForDestination(destination);
  if (routeKey) return routeEntry(routeKey);
  if (KNOWN_DESTINATIONS.includes(destination)) return singleEntry(destination, 'place');
  if (CITY_INFO[destination]) return singleEntry(destination, 'city');
  return null;
}

// The pin list: every route, then the base-price places that are not
// already a stop on a route (Kyoto is in Japan, Santorini is in Greece
// — they get no second pin). Same-city pins are spread in longitude so
// each bubble stays individually clickable.
export function discoveryDestinations(): DiscoveryEntry[] {
  const entries: DiscoveryEntry[] = [];
  for (const routeKey of Object.keys(ROUTE_STOPS)) {
    const e = routeEntry(routeKey);
    if (e) entries.push(e);
  }
  const routeCities = new Set(Object.values(ROUTE_STOPS).flat().map((s) => s.city));
  for (const name of KNOWN_DESTINATIONS) {
    if (routeCities.has(name)) continue;
    const e = singleEntry(name, 'place');
    if (e) entries.push(e);
  }
  const byCity = new Map<string, DiscoveryEntry[]>();
  for (const e of entries) {
    const group = byCity.get(e.pinCity) ?? [];
    group.push(e);
    byCity.set(e.pinCity, group);
  }
  for (const group of byCity.values()) {
    if (group.length < 2) continue;
    // Spread ±0.6° of longitude per step around the city — enough to
    // click each bubble when zoomed in, small enough that the pin still
    // reads as the city it starts in.
    group.forEach((e, i) => {
      e.lng = e.lng + (i - (group.length - 1) / 2) * 1.2;
    });
  }
  return entries;
}

// The standard trip behind a pin, for the price label next to it:
// Best value, 2 travelers — the same basis as the destination cards.
export function discoveryPriceLabel(entry: DiscoveryEntry): string {
  return entry.price === null
    ? 'No planning estimate for this one yet'
    : `from $${entry.price.toLocaleString()} total`;
}

// Touch target for a price bubble — the design system's 44px minimum.
export const DISCOVERY_BUBBLE_MIN_HEIGHT = 44;
