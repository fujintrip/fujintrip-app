// Homepage tabs (direction v2, Nov 13, 2026): the seven things you can
// book, each with results underneath — no AI, no sign-up. Every number
// here comes from an existing source and is labeled as what it is:
//
// - Flights: live Duffel test fares (via POST /api/price-check) +
//   the cached competitor fare (GET /api/competitor-fares), both
//   labeled; the per-route flight legs below are planner estimates.
// - Hotels / cars / tours: the planner's own Best value leg for the
//   route (comparisonFor), per traveler, labeled planning estimate.
// - Cruises / buses / taxis: the planner breaks out no leg for these,
//   so the rows show the FULL TRIP total per traveler and say so —
//   never a cruise/bus/taxi price invented from a trip total, and a
//   note that live comparison arrives as suppliers connect.
//
// No numbers are invented anywhere in this file: every row derives
// from comparisonFor / discoveryDestinations, and a destination the
// planner cannot price never gets a row (discovery only lists priced
// trips — see lib/discovery.ts).

import { comparisonFor } from './planner';
import { discoveryDestinations, routeLineFor } from './discovery';
import { bestTimeFor } from './bestTime';
import type { Tab } from './data';

export type HomeTabId = 'tours' | 'flights' | 'hotels' | 'cars' | 'cruises' | 'buses' | 'taxis';

export const HOME_TABS: { id: HomeTabId; label: string; icon: string; tab: Tab }[] = [
  { id: 'tours', label: 'Tours & sightseeing', icon: '🎡', tab: 'Sightseeing' },
  { id: 'flights', label: 'Flights', icon: '✈️', tab: 'Flights' },
  { id: 'hotels', label: 'Hotels', icon: '🏨', tab: 'Hotels' },
  { id: 'cars', label: 'Car rental', icon: '🚗', tab: 'Car rental' },
  { id: 'cruises', label: 'Cruises', icon: '🚢', tab: 'Cruises' },
  { id: 'buses', label: 'Buses', icon: '🚌', tab: 'Buses' },
  { id: 'taxis', label: 'Taxis', icon: '🚕', tab: 'Taxis & transfers' },
];

export const DEFAULT_HOME_TAB: HomeTabId = 'flights';

// The ?tab= deep link: only a real tab id wins — anything else (or
// nothing) is the Flights default, so a bad link never renders an
// empty panel.
export function homeTabIdFromQuery(q: string | string[] | null | undefined): HomeTabId {
  const raw = Array.isArray(q) ? q[0] : q;
  const found = HOME_TABS.find((t) => t.id === raw);
  return found ? found.id : DEFAULT_HOME_TAB;
}

export type TabRow = {
  destination: string;
  routeLine: string;
  // Per traveler, for the party the planner priced (Best value).
  pricePerTraveler: number;
  // 'leg' = this category's own planner leg; 'full-trip' = the whole
  // trip total, shown only where the planner breaks out no leg.
  kind: 'leg' | 'full-trip';
};

const LEG_FOR_TAB: Partial<Record<HomeTabId, 'flight' | 'hotel' | 'car' | 'activities'>> = {
  flights: 'flight',
  hotels: 'hotel',
  cars: 'car',
  tours: 'activities',
};

// One result row per discovery destination — the price table the
// planner already publishes, per traveler, for this category. A
// destination with no planner price never reaches this list.
export function tabRowsFor(tab: HomeTabId, travelers: number): TabRow[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  const leg = LEG_FOR_TAB[tab];
  return discoveryDestinations()
    .map((e) => {
      const best = comparisonFor(e.destination, party).best;
      const amount = leg ? best[leg] : best.total;
      return {
        destination: e.destination,
        routeLine: routeLineFor(e.stops),
        pricePerTraveler: Math.round(amount / party),
        kind: leg ? ('leg' as const) : ('full-trip' as const),
      };
    })
    .filter((r) => Number.isFinite(r.pricePerTraveler) && r.pricePerTraveler > 0);
}

// The note above the rows for a tab with no planner leg: the honest
// gap, named, plus what the rows below actually are.
export function noLegNote(tab: HomeTabId): string | null {
  const name =
    tab === 'cruises' ? 'Cruise' : tab === 'buses' ? 'Bus' : tab === 'taxis' ? 'Taxi' : null;
  if (!name) return null;
  return (
    `${name} prices aren't broken out in the planner yet — live ${name.toLowerCase()} comparison arrives as suppliers connect. ` +
    `Below are the full-trip planning estimates for each route, so you can still compare trips; they are not ${name.toLowerCase()} prices.`
  );
}

export type FlightContext = {
  destination: string;
  travelers: number;
  origin: string;
  month: number;
  durationDays: number;
};

// The trip the Flights tab fetches live fares for: the traveler's own
// trip when one is persisted (destination, travelers, origin, month,
// length), else the sensible default — Central Europe from New York,
// in its best month, 14 days (the planner's default trip length).
export function flightContextFor(
  trip: { destination?: unknown; travelers?: unknown; origin?: unknown; month?: unknown; durationDays?: unknown } | null
): FlightContext {
  const destination =
    trip && typeof trip.destination === 'string' && trip.destination.trim()
      ? trip.destination.trim()
      : 'Central Europe';
  const travelers =
    trip && typeof trip.travelers === 'number' && trip.travelers >= 1 && trip.travelers <= 9
      ? Math.floor(trip.travelers)
      : 2;
  const origin =
    trip && typeof trip.origin === 'string' && trip.origin.trim() ? trip.origin.trim() : 'New York';
  const month =
    trip && typeof trip.month === 'number' && trip.month >= 1 && trip.month <= 12
      ? Math.floor(trip.month)
      : bestTimeFor(destination).bestMonth;
  const durationDays =
    trip && typeof trip.durationDays === 'number' && trip.durationDays >= 2
      ? Math.floor(trip.durationDays)
      : 14;
  return { destination, travelers, origin, month, durationDays };
}

// The one label every Duffel fare in the tabs carries — test mode,
// never a live bookable quote.
export const DUFFEL_TEST_LABEL =
  'Duffel test fare — test mode, not a live bookable quote. Real bookable fares need Duffel live mode.';

// The honest line when /api/price-check has no live fare: the reason
// is named, the plan's own flight budget stands in — never a fake fare.
export function noFareMessage(reason: string | undefined, plannerFlight: number): string {
  const budget =
    plannerFlight > 0
      ? ` The plan's flight budget for this trip is $${plannerFlight.toLocaleString()} (planning estimate).`
      : '';
  if (reason === 'no_airport_code')
    return `No live fare was looked up — the departure city or the destination has no airport code on file (codes are never guessed).${budget}`;
  if (reason === 'no_offers')
    return `Duffel returned no fares for these dates.${budget}`;
  if (reason === 'missing_slots')
    return `Live fares need a departure city, a destination and trip dates.${budget}`;
  return `Live fares aren't available right now.${budget}`;
}
