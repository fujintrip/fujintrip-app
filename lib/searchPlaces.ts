// Search widget + results (direction v3, Nov 14, 2026): the place
// autocomplete source, the search query (URL params in, results out),
// and the honest row sorting. Every place here comes from data the app
// already has — the 21 discovery destinations + their stop cities, the
// 6 global destinations, the hidden gems, and the ~51 CITY_INFO
// cities. A place the app does not know never appears as a suggestion;
// a typed place it does not know is handled honestly by the results
// (empty state / no live fare), never invented.
import { CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from './data';
import { discoveryDestinations, routeLineFor } from './discovery';
import { addDays, CITY_INFO, suggestedStart } from './tripCard';
import { bestTimeFor } from './bestTime';
import { MONTH_NAMES, buildPlan } from './planner';
import { HOME_TABS, homeTabIdFromQuery, type HomeTabId, type TabRow } from './homeTabs';
import { cabinClassFor, type DuffelCabinClass, type DuffelFareOffer } from './duffel';

let placeCache: string[] | null = null;

export function knownPlaceNames(): string[] {
  if (placeCache) return placeCache;
  const names = new Set<string>();
  for (const d of discoveryDestinations()) {
    names.add(d.destination);
    for (const s of d.stops) names.add(s.city);
  }
  for (const d of GLOBAL_DESTINATIONS) names.add(d.name);
  for (const d of HIDDEN_GEMS) names.add(d.name);
  for (const c of Object.keys(CITY_INFO)) names.add(c);
  placeCache = [...names].sort((a, b) => a.localeCompare(b));
  return placeCache;
}

export function isKnownPlace(place: string): boolean {
  if (!place) return false;
  const lower = place.toLowerCase();
  return knownPlaceNames().some((n) => n.toLowerCase() === lower);
}

// The photo for a destination's result card — the same image map the
// template library uses (the destination's own photo, else its stops'
// photos, else the per-city photos). Null when no photo exists on
// file — the card then renders without a photo, never a placeholder.
export function destinationPhoto(destination: string): string | null {
  const byName = new Map<string, string>([
    ...GLOBAL_DESTINATIONS.map((d) => [d.name, d.image] as const),
    ...HIDDEN_GEMS.map((d) => [d.name, d.image] as const),
    ...Object.entries(CITY_PHOTOS),
  ]);
  const own = byName.get(destination);
  if (own) return own;
  const entry = discoveryDestinations().find((e) => e.destination === destination);
  if (!entry) return null;
  for (const s of entry.stops) {
    const p = byName.get(s.city);
    if (p) return p;
  }
  return null;
}

// Does this destination's route include the place the traveler
// searched for — the row itself, or one of its stops? Used to
// highlight the matching row in the 21-row estimate lists.
export function rowIncludesPlace(destination: string, place: string): boolean {
  if (!place) return false;
  if (destination.toLowerCase() === place.toLowerCase()) return true;
  const entry = discoveryDestinations().find((e) => e.destination === destination);
  return entry?.stops.some((s) => s.city.toLowerCase() === place.toLowerCase()) ?? false;
}

// Flights trip types (Nov 15, 2026 — the airline interface the user
// asked for): one-way, round-trip, multi-city. A multi-city leg is one
// hop: from → to on a date. Legs are 2–4, never fewer — a single hop is
// a one-way search, not a multi-city one.
export type FlightTripType = 'roundtrip' | 'oneway' | 'multicity';
export type FlightLeg = { from: string; to: string; depart: string };

// Stays tiers (Nov 15, 2026 — the Stays section, same standard as
// the Flights section): the three planner tiers, priced from the
// planner's own hotel legs — never a named property, never a live
// quote. The tier is part of the search (a ?tier= URL param, like
// the Flights cabin), so a tiered search is shareable and renders
// its tier on first paint.
export type StayTier = 'cheapest' | 'best' | 'premium';

export const STAY_TIERS: { id: StayTier; label: string }[] = [
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'best', label: 'Best value' },
  { id: 'premium', label: 'Premium' },
];

export function stayTierFromValue(v: unknown): StayTier {
  return v === 'cheapest' || v === 'premium' ? v : 'best';
}

export function stayTierLabel(tier: StayTier): string {
  return STAY_TIERS.find((t) => t.id === tier)?.label ?? 'Best value';
}

// One tier's stay figures for a destination — the planner's hotel
// leg for the whole party (buildPlan's hotel leg is a party total
// for the trip) plus the per-traveler share. The figures never
// depend on the searched dates: the planner prices the trip, not
// the night, so the total stays the planner's figure whatever dates
// the traveler picked — scaling it by nights would invent a pricing
// model the planner does not have.
export type StayTierOption = { tier: StayTier; label: string; hotel: number; perTraveler: number };

export function stayTierOptions(destination: string, guests: number): StayTierOption[] {
  const party = Math.min(9, Math.max(1, Math.floor(guests) || 2));
  const options = buildPlan(destination, party, 3).options;
  return STAY_TIERS.map((t) => {
    const hotel = options.find((o) => o.name === t.label)?.hotel ?? 0;
    return { tier: t.id, label: t.label, hotel, perTraveler: Math.round(hotel / party) };
  });
}

// One row per discovery destination in a tier — the stay list the
// Stays results show. The shape is TabRow plus the party total, so
// the shared sortTabRows re-orders it and the card can print the
// total without re-deriving it from a rounded per-traveler figure
// (perTraveler × guests would drift from the leg by rounding).
export type StayTierRow = TabRow & { total: number };

export function stayTierRows(tier: StayTier, guests: number): StayTierRow[] {
  const party = Math.min(9, Math.max(1, Math.floor(guests) || 2));
  return discoveryDestinations()
    .map((e) => {
      const opt = stayTierOptions(e.destination, party).find((o) => o.tier === tier);
      return {
        destination: e.destination,
        routeLine: routeLineFor(e.stops),
        pricePerTraveler: opt?.perTraveler ?? 0,
        kind: 'leg' as const,
        total: opt?.hotel ?? 0,
      };
    })
    .filter((r) => Number.isFinite(r.pricePerTraveler) && r.pricePerTraveler > 0);
}

// The nights a stay covers: the searched dates when both are given
// and the check-out is after the check-in, else the route's own
// nights from the discovery entry. A check-out on the check-in day
// is not a night — the entry's nights stand in instead of a zero.
export function stayNightsFor(
  query: Pick<SearchQuery, 'depart' | 'ret' | 'dest'>,
  destination?: string
): number | null {
  if (query.depart && query.ret && query.ret > query.depart) {
    const days = Math.round(
      (new Date(`${query.ret}T00:00:00Z`).getTime() - new Date(`${query.depart}T00:00:00Z`).getTime()) / 86400000
    );
    if (Number.isFinite(days) && days >= 1) return days;
  }
  const dest = destination ?? query.dest;
  const entry = dest ? discoveryDestinations().find((e) => e.destination === dest) : undefined;
  return entry ? entry.nights : null;
}

// Car rental tiers (Nov 15, 2026 — the Car rental section, same
// standard as the Stays section): the three planner tiers, priced
// from the planner's own car legs — never a named company, model,
// or live quote. The tier is part of the search (a ?tier= URL
// param, like the Stays tier), so a tiered search is shareable and
// renders its tier on first paint.
export type CarTier = 'cheapest' | 'best' | 'premium';

export const CAR_TIERS: { id: CarTier; label: string }[] = [
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'best', label: 'Best value' },
  { id: 'premium', label: 'Premium' },
];

export function carTierFromValue(v: unknown): CarTier {
  return v === 'cheapest' || v === 'premium' ? v : 'best';
}

export function carTierLabel(tier: CarTier): string {
  return CAR_TIERS.find((t) => t.id === tier)?.label ?? 'Best value';
}

// One tier's car figures for a destination — the planner's car leg
// for the whole party (buildPlan's car leg is a party total for the
// trip) plus the per-traveler share. The figures never depend on
// the searched dates: the planner prices the trip, not the rental
// day, so the total stays the planner's figure whatever dates the
// traveler picked — scaling it by days would invent a pricing
// model the planner does not have.
export type CarTierOption = { tier: CarTier; label: string; car: number; perTraveler: number };

export function carTierOptions(destination: string, travelers: number): CarTierOption[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  const options = buildPlan(destination, party, 3).options;
  return CAR_TIERS.map((t) => {
    const car = options.find((o) => o.name === t.label)?.car ?? 0;
    return { tier: t.id, label: t.label, car, perTraveler: Math.round(car / party) };
  });
}

// One row per discovery destination in a tier — the car list the
// Car rental results show. The shape is TabRow plus the party
// total, so the shared sortTabRows re-orders it and the card can
// print the total without re-deriving it from a rounded
// per-traveler figure (perTraveler × travelers would drift from
// the leg by rounding).
export type CarTierRow = TabRow & { total: number };

export function carTierRows(tier: CarTier, travelers: number): CarTierRow[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  return discoveryDestinations()
    .map((e) => {
      const opt = carTierOptions(e.destination, party).find((o) => o.tier === tier);
      return {
        destination: e.destination,
        routeLine: routeLineFor(e.stops),
        pricePerTraveler: opt?.perTraveler ?? 0,
        kind: 'leg' as const,
        total: opt?.car ?? 0,
      };
    })
    .filter((r) => Number.isFinite(r.pricePerTraveler) && r.pricePerTraveler > 0);
}

// The days a rental covers: the searched dates when both are given
// and the drop-off is on or after the pick-up (a same-day pick-up
// and drop-off is one rental day), else the route's own days from
// the discovery entry. A drop-off before the pick-up is not a
// rental — the entry's days stand in instead of a zero or negative.
export function carDaysFor(
  query: Pick<SearchQuery, 'depart' | 'ret' | 'dest'>,
  destination?: string
): number | null {
  if (query.depart && query.ret && query.ret >= query.depart) {
    const days = Math.round(
      (new Date(`${query.ret}T00:00:00Z`).getTime() - new Date(`${query.depart}T00:00:00Z`).getTime()) / 86400000
    );
    if (Number.isFinite(days) && days >= 0) return Math.max(1, days);
  }
  const dest = destination ?? query.dest;
  const entry = dest ? discoveryDestinations().find((e) => e.destination === dest) : undefined;
  return entry ? entry.days : null;
}

// Attraction tiers (Nov 15, 2026 — the Attractions section, same
// standard as the Stays and Car rental sections): the three planner
// tiers, priced from the planner's own activities legs — never a
// named attraction, tour, operator, rating, or live quote. The tier
// is part of the search (a ?tier= URL param, like the Stays and Car
// tiers), so a tiered search is shareable and renders its tier on
// first paint.
export type TourTier = 'cheapest' | 'best' | 'premium';

export const TOUR_TIERS: { id: TourTier; label: string }[] = [
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'best', label: 'Best value' },
  { id: 'premium', label: 'Premium' },
];

export function tourTierFromValue(v: unknown): TourTier {
  return v === 'cheapest' || v === 'premium' ? v : 'best';
}

export function tourTierLabel(tier: TourTier): string {
  return TOUR_TIERS.find((t) => t.id === tier)?.label ?? 'Best value';
}

// One tier's attraction figures for a destination — the planner's
// activities leg for the whole party (buildPlan's activities leg is
// a party total for the trip) plus the per-traveler share. The
// figures never depend on the searched dates: the planner prices
// the trip, not the day, so the total stays the planner's figure
// whatever dates the traveler picked — scaling it by days would
// invent a pricing model the planner does not have.
export type TourTierOption = { tier: TourTier; label: string; activities: number; perTraveler: number };

export function tourTierOptions(destination: string, travelers: number): TourTierOption[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  const options = buildPlan(destination, party, 3).options;
  return TOUR_TIERS.map((t) => {
    const activities = options.find((o) => o.name === t.label)?.activities ?? 0;
    return { tier: t.id, label: t.label, activities, perTraveler: Math.round(activities / party) };
  });
}

// One row per discovery destination in a tier — the attraction list
// the Attractions results show. The shape is TabRow plus the party
// total, so the shared sortTabRows re-orders it and the card can
// print the total without re-deriving it from a rounded per-traveler
// figure (perTraveler × travelers would drift from the leg by
// rounding).
export type TourTierRow = TabRow & { total: number };

export function tourTierRows(tier: TourTier, travelers: number): TourTierRow[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  return discoveryDestinations()
    .map((e) => {
      const opt = tourTierOptions(e.destination, party).find((o) => o.tier === tier);
      return {
        destination: e.destination,
        routeLine: routeLineFor(e.stops),
        pricePerTraveler: opt?.perTraveler ?? 0,
        kind: 'leg' as const,
        total: opt?.activities ?? 0,
      };
    })
    .filter((r) => Number.isFinite(r.pricePerTraveler) && r.pricePerTraveler > 0);
}

// The days a visit covers: the searched dates when both are given
// and the end is after the start, else the route's own days from
// the discovery entry. An end on the start day is not a visit
// window — the entry's days stand in instead of a zero, and the
// form validation names it before the search runs.
export function tourDaysFor(
  query: Pick<SearchQuery, 'depart' | 'ret' | 'dest'>,
  destination?: string
): number | null {
  if (query.depart && query.ret && query.ret > query.depart) {
    const days = Math.round(
      (new Date(`${query.ret}T00:00:00Z`).getTime() - new Date(`${query.depart}T00:00:00Z`).getTime()) / 86400000
    );
    if (Number.isFinite(days) && days >= 1) return days;
  }
  const dest = destination ?? query.dest;
  const entry = dest ? discoveryDestinations().find((e) => e.destination === dest) : undefined;
  return entry ? entry.days : null;
}

// Cruise tiers (Nov 15, 2026 — the Cruises section, same standard
// as the Stays, Car rental and Attractions sections): the three
// planner tiers, priced from the planner's own per-tier totals —
// never a named line, ship, sailing, rating, or live quote. The
// planner breaks out no cruise leg (see noLegNote in lib/homeTabs:
// cruise prices are not broken out yet), so the tier figures are
// the per-tier FULL-TRIP totals — the same figures the old cruise
// rows showed for Best value — and the results label them as
// full-trip planning estimates, never as cruise prices. Inventing
// a cruise leg from the trip total would break that rule. The tier
// is part of the search (a ?tier= URL param, like the Stays, Car
// and Attractions tiers), so a tiered search is shareable and
// renders its tier on first paint.
export type CruiseTier = 'cheapest' | 'best' | 'premium';

export const CRUISE_TIERS: { id: CruiseTier; label: string }[] = [
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'best', label: 'Best value' },
  { id: 'premium', label: 'Premium' },
];

export function cruiseTierFromValue(v: unknown): CruiseTier {
  return v === 'cheapest' || v === 'premium' ? v : 'best';
}

export function cruiseTierLabel(tier: CruiseTier): string {
  return CRUISE_TIERS.find((t) => t.id === tier)?.label ?? 'Best value';
}

// One tier's cruise figures for a destination — the planner's
// per-tier full-trip total for the whole party (buildPlan's total
// is a party total for the trip) plus the per-traveler share. The
// figures never depend on the searched month: the planner prices
// the trip, not the sailing, so the total stays the planner's
// figure whatever month the traveler picked — scaling it by a
// sailing length would invent a pricing model the planner does
// not have.
export type CruiseTierOption = { tier: CruiseTier; label: string; total: number; perTraveler: number };

export function cruiseTierOptions(destination: string, travelers: number): CruiseTierOption[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  const options = buildPlan(destination, party, 3).options;
  return CRUISE_TIERS.map((t) => {
    const total = options.find((o) => o.name === t.label)?.total ?? 0;
    return { tier: t.id, label: t.label, total, perTraveler: Math.round(total / party) };
  });
}

// One row per discovery destination in a tier — the cruise list
// the Cruises results show. The shape is TabRow plus the party
// total, so the shared sortTabRows re-orders it and the card can
// print the total without re-deriving it from a rounded per-traveler
// figure (perTraveler × travelers would drift from the total by
// rounding). kind is 'full-trip': these are full-trip totals, not
// cruise prices.
export type CruiseTierRow = TabRow & { total: number };

export function cruiseTierRows(tier: CruiseTier, travelers: number): CruiseTierRow[] {
  const party = Math.min(9, Math.max(1, Math.floor(travelers) || 2));
  return discoveryDestinations()
    .map((e) => {
      const opt = cruiseTierOptions(e.destination, party).find((o) => o.tier === tier);
      return {
        destination: e.destination,
        routeLine: routeLineFor(e.stops),
        pricePerTraveler: opt?.perTraveler ?? 0,
        kind: 'full-trip' as const,
        total: opt?.total ?? 0,
      };
    })
    .filter((r) => Number.isFinite(r.pricePerTraveler) && r.pricePerTraveler > 0);
}

export const FLIGHT_TRIP_TYPES: { id: FlightTripType; label: string }[] = [
  { id: 'roundtrip', label: 'Round-trip' },
  { id: 'oneway', label: 'One-way' },
  { id: 'multicity', label: 'Multi-city' },
];

export function flightTripTypeFromValue(v: unknown): FlightTripType {
  return v === 'oneway' || v === 'multicity' ? v : 'roundtrip';
}

export const MAX_FLIGHT_LEGS = 4;
export const MIN_FLIGHT_LEGS = 2;

// One leg's shape, validated — a leg with an empty end or a bad date
// is not a leg, never a guessed one. Used by the deep-link parser and
// the widget, so both agree on what counts.
export function cleanFlightLeg(raw: unknown): FlightLeg | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const from = cleanPlace(r.from);
  const to = cleanPlace(r.to);
  const depart = cleanDate(r.depart);
  if (!from || !to || !depart) return null;
  return { from, to, depart };
}

// The legs a multi-city search carries: 2–4 clean legs, in order.
// Fewer than 2 is not a multi-city search (the caller falls back);
// more than 4 is capped at 4. Past dates drop when a today is given
// — a shared link from last month is stale, never a trip.
export function cleanFlightLegs(raw: unknown, todayIso?: string): FlightLeg[] {
  if (!Array.isArray(raw)) return [];
  const legs = raw
    .map(cleanFlightLeg)
    .filter((l): l is FlightLeg => !!l)
    .filter((l) => !todayIso || l.depart >= todayIso)
    .slice(0, MAX_FLIGHT_LEGS);
  return legs.length >= MIN_FLIGHT_LEGS ? legs : [];
}

// The deep-link encoding for legs: from|to|date, legs joined by ','.
// City names carry no '|' or ',' in the app's data, so the scheme is
// unambiguous; URLSearchParams percent-encodes the separators on the
// way out and decodes them on the way in.
export function flightLegsToParam(legs: FlightLeg[]): string {
  return legs.map((l) => `${l.from}|${l.to}|${l.depart}`).join(',');
}

export function flightLegsFromParam(v: unknown, todayIso?: string): FlightLeg[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  const raw = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split('|');
      return parts.length === 3 ? { from: parts[0], to: parts[1], depart: parts[2] } : null;
    });
  return cleanFlightLegs(raw, todayIso);
}

export type SearchQuery = {
  tab: HomeTabId;
  from: string;
  to: string;
  dest: string;
  depart: string;
  ret: string;
  travelers: number;
  cabin: string;
  guests: number;
  rooms: number;
  pickupTime: string;
  dropoffTime: string;
  sameLocation: boolean;
  dropoff: string;
  month: string; // '' = any month, else '1'..'12'
  // Flights only: the trip type + the multi-city legs. For round-trip
  // and one-way the legs are empty and from/to/depart/ret carry the
  // trip; for multi-city legs[0] mirrors from/to/depart so every
  // existing consumer (summary, saved label, fare context) still
  // reads the first hop without knowing about legs.
  tripType: FlightTripType;
  legs: FlightLeg[];
  // Stays only: which planner tier the stay list prices in. 'best'
  // is the default; the widget carries it through submit and the
  // results read it back, so a tiered deep link renders its tier.
  stayTier: StayTier;
  // Car rental only: which planner tier the car list prices in.
  // Same three tiers, same ?tier= param, same Best value default.
  carTier: CarTier;
  // Attractions only: which planner tier the attraction list
  // prices in. Same three tiers, same ?tier= param, same Best
  // value default.
  tourTier: TourTier;
  // Cruises only: which planner tier the cruise list prices in.
  // Same three tiers, same ?tier= param, same Best value default.
  // The figures are the per-tier full-trip totals (the planner
  // breaks out no cruise leg), labeled as such in the results.
  cruiseTier: CruiseTier;
};

export const CABINS = ['Economy', 'Premium economy', 'Business', 'First'] as const;

// The planner's flight budget is built from economy fares, so on a
// non-economy search the figure must say so: a $630 economy budget
// printed next to $2,609 of Business fares reads as a contradiction
// (defect, Nov 15 2026). No cabin multiplier is invented here — the
// figure stays the economy estimate and the label says so.
export function flightBudgetCopy(cabin: string | undefined): { label: string; qualifier: string } {
  const economy = !cabin || cabin === 'Economy';
  return {
    label: economy ? 'Plan flight budget' : 'Plan flight budget (economy estimate)',
    qualifier: economy ? 'planning estimate' : 'economy planning estimate',
  };
}

// The search widget's field values for a query — the same mapping
// its useState initializers use, extracted so the widget can re-sync
// when a deep link changes under it (a shared link followed while
// already on the page, or Back) instead of showing stale values
// while the results show the new search. Pure, so tests can pin it.
export function formValuesFromQuery(q: SearchQuery | null): {
  place: string;
  from: string;
  depart: string;
  ret: string;
  travelers: number;
  cabin: string;
  guests: number;
  rooms: number;
  pickupTime: string;
  dropoffTime: string;
  sameLocation: boolean;
  dropoff: string;
  month: string;
  tripType: FlightTripType;
  legs: FlightLeg[];
  stayTier: StayTier;
  carTier: CarTier;
  tourTier: TourTier;
  cruiseTier: CruiseTier;
} {
  return {
    place: q?.dest || q?.to || '',
    from: q?.from || '',
    depart: q?.depart || '',
    ret: q?.ret || '',
    travelers: q?.travelers ?? 2,
    cabin: q?.cabin || 'Economy',
    guests: q?.guests ?? 2,
    rooms: q?.rooms ?? 1,
    pickupTime: q?.pickupTime || '',
    dropoffTime: q?.dropoffTime || '',
    sameLocation: q?.sameLocation ?? true,
    dropoff: q?.dropoff || '',
    month: q?.month || '',
    tripType: q?.tripType ?? 'roundtrip',
    legs: q?.legs ?? [],
    stayTier: q?.stayTier ?? 'best',
    carTier: q?.carTier ?? 'best',
    tourTier: q?.tourTier ?? 'best',
    cruiseTier: q?.cruiseTier ?? 'best',
  };
}

export function emptySearchQuery(tab: HomeTabId): SearchQuery {
  return {
    tab,
    from: '',
    to: '',
    dest: '',
    depart: '',
    ret: '',
    travelers: 2,
    cabin: 'Economy',
    guests: 2,
    rooms: 1,
    pickupTime: '',
    dropoffTime: '',
    sameLocation: true,
    dropoff: '',
    month: '',
    tripType: 'roundtrip',
    legs: [],
    stayTier: 'best',
    carTier: 'best',
    tourTier: 'best',
    cruiseTier: 'best',
  };
}

function cleanPlace(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 80) : '';
}

function cleanDate(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function cleanInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && Math.floor(n) >= min && Math.floor(n) <= max ? Math.floor(n) : fallback;
}

// Today's date, local calendar (YYYY-MM-DD). The form validation
// and the deep-link parser share it — a date before today is a stale
// link or a mistyped date, never a trip.
export function todayIsoLocal(today: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
}

// Parse URL params into a search query. Nothing is invented: an
// unknown place stays as typed (the results handle it honestly), a
// bad date is dropped, a bad number falls back to the default. A date
// before today is dropped too — a shared link from last month is a
// stale link, and the search falls back to flexible dates instead of
// showing fares for dates that have already passed. `todayIso` is
// injectable so tests can pin it; it defaults to the local today.
export function searchQueryFromParams(
  params: Record<string, string | string[] | undefined>,
  todayIso: string = todayIsoLocal()
): SearchQuery | null {
  const tab = homeTabIdFromQuery(params.tab ?? null);
  const q = emptySearchQuery(tab);
  q.from = cleanPlace(params.from);
  q.to = cleanPlace(params.to);
  q.dest = cleanPlace(params.dest);
  q.depart = cleanDate(params.depart);
  q.ret = cleanDate(params.return);
  if (q.depart && q.depart < todayIso) q.depart = '';
  if (q.ret && q.ret < todayIso) q.ret = '';
  if (q.depart && q.ret && q.ret < q.depart) q.ret = '';
  q.travelers = cleanInt(params.travelers, 1, 9, 2);
  const cabin = cleanPlace(params.cabin);
  q.cabin = (CABINS as readonly string[]).includes(cabin) ? cabin : 'Economy';
  q.guests = cleanInt(params.guests, 1, 9, 2);
  q.rooms = cleanInt(params.rooms, 1, 5, 1);
  q.pickupTime =
    typeof params.time === 'string' && /^\d{2}:\d{2}$/.test(params.time) ? params.time : '';
  q.dropoffTime =
    typeof params.time2 === 'string' && /^\d{2}:\d{2}$/.test(params.time2) ? params.time2 : '';
  q.sameLocation = params.same !== '0';
  q.dropoff = cleanPlace(params.dropoff);
  const month = cleanInt(params.month, 1, 12, 0);
  q.month = month ? String(month) : '';
  // A month number is this year's month — a link naming a month
  // that already passed is stale, so it drops and the search falls
  // back to a flexible month instead of showing results for a
  // month that has already gone. The current month itself stays:
  // a cruise this month is still a trip.
  if (q.month && Number(q.month) < Number(todayIso.slice(5, 7))) q.month = '';
  // Flights trip type + multi-city legs (Nov 15, 2026): ?type=oneway
  // | roundtrip | multicity, and ?legs=from|to|date,from|to|date.
  // Junk type falls back to round-trip; fewer than 2 clean legs is
  // not a multi-city search — it falls back to the round-trip (or
  // one-way) the link's from/to/depart describe, never a guessed
  // second leg. A one-way link drops any return it carries.
  if (tab === 'flights') {
    const type = flightTripTypeFromValue(params.type);
    if (type === 'multicity') {
      const legs = flightLegsFromParam(params.legs, todayIso);
      if (legs.length >= MIN_FLIGHT_LEGS) {
        q.tripType = 'multicity';
        q.legs = legs;
        q.from = legs[0].from;
        q.to = legs[0].to;
        q.depart = legs[0].depart;
        q.ret = '';
      } else {
        q.tripType = 'roundtrip';
        q.legs = [];
      }
    } else if (type === 'oneway') {
      q.tripType = 'oneway';
      q.legs = [];
      q.ret = '';
    } else {
      q.tripType = 'roundtrip';
      q.legs = [];
    }
  }
  // Stays tier (Nov 15, 2026): ?tier=cheapest | best | premium.
  // Junk falls back to Best value; other tabs ignore it.
  if (tab === 'hotels') {
    q.stayTier = stayTierFromValue(params.tier);
  }
  // Car rental tier (Nov 15, 2026): the same ?tier= param, the
  // same fallback — a tiered car search is shareable too.
  if (tab === 'cars') {
    q.carTier = carTierFromValue(params.tier);
  }
  // Attractions tier (Nov 15, 2026): the same ?tier= param, the
  // same fallback — a tiered attractions search is shareable too.
  if (tab === 'tours') {
    q.tourTier = tourTierFromValue(params.tier);
  }
  // Cruises tier (Nov 15, 2026): the same ?tier= param, the
  // same fallback — a tiered cruise search is shareable too.
  if (tab === 'cruises') {
    q.cruiseTier = cruiseTierFromValue(params.tier);
  }
  // A deep link only counts as a search when it carries something to
  // search for — a bare ?tab= is just a tab, not a search.
  const hasSearch = Boolean(q.from || q.to || q.dest || q.depart || q.month);
  return hasSearch ? q : null;
}

export function searchQueryToParams(q: SearchQuery): string {
  const p = new URLSearchParams();
  p.set('tab', q.tab);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.dest) p.set('dest', q.dest);
  if (q.depart) p.set('depart', q.depart);
  if (q.ret) p.set('return', q.ret);
  if (q.tab === 'flights' && q.tripType !== 'roundtrip') p.set('type', q.tripType);
  if (q.tab === 'flights' && q.tripType === 'multicity' && q.legs.length) {
    p.set('legs', flightLegsToParam(q.legs));
  }
  if (q.tab === 'hotels' && q.stayTier !== 'best') p.set('tier', q.stayTier);
  if (q.tab === 'cars' && q.carTier !== 'best') p.set('tier', q.carTier);
  if (q.tab === 'tours' && q.tourTier !== 'best') p.set('tier', q.tourTier);
  if (q.tab === 'cruises' && q.cruiseTier !== 'best') p.set('tier', q.cruiseTier);
  if (q.travelers !== 2) p.set('travelers', String(q.travelers));
  if (q.cabin !== 'Economy') p.set('cabin', q.cabin);
  if (q.guests !== 2) p.set('guests', String(q.guests));
  if (q.rooms !== 1) p.set('rooms', String(q.rooms));
  if (q.pickupTime) p.set('time', q.pickupTime);
  if (q.dropoffTime) p.set('time2', q.dropoffTime);
  if (!q.sameLocation) p.set('same', '0');
  if (q.dropoff) p.set('dropoff', q.dropoff);
  if (q.month) p.set('month', q.month);
  return p.toString();
}

// The flight context POST /api/price-check needs: the departure city,
// the destination, the month and the length. The traveler's dates map
// to those (depart month, return − depart + 1 days, clamped to the
// planner's 2–30 window); with no dates the planner's best month and
// default 14 days stand in. The context ALSO carries the checked
// dates themselves — the searched dates when the traveler gave them,
// else the planner's suggested start + length (defect, Nov 14 2026:
// results showed the planner's suggested dates — Jan 4–11 — for a
// Jan 15–22 search, because the UI derived its heading from
// suggestedStart instead of the search). The response carries the
// actual checked dates — the UI shows those, and after this fix the
// checked dates are the searched dates whenever the traveler gave
// them, never the planner's suggestion standing in for them.
export function flightContextFromSearch(q: SearchQuery): {
  origin: string;
  destination: string;
  month: number;
  durationDays: number;
  depart: string;
  return: string;
  cabin: DuffelCabinClass;
} {
  const destination = q.to || q.dest || 'Central Europe';
  const origin = q.from || 'New York';
  let month = 0;
  let durationDays = 14;
  if (q.depart) {
    month = Number(q.depart.slice(5, 7));
    if (q.ret) {
      const days =
        Math.round(
          (new Date(`${q.ret}T00:00:00Z`).getTime() - new Date(`${q.depart}T00:00:00Z`).getTime()) /
            86400000
        ) + 1;
      if (Number.isFinite(days)) durationDays = Math.min(30, Math.max(2, days));
    }
  }
  if (!month) month = bestTimeFor(destination).bestMonth;
  const depart = q.depart || isoDate(suggestedStart(month));
  // A return only counts when a departure anchors it — a lone return
  // with no departure is dropped, never trusted as the trip's end.
  // The fallback builds from the depart string as a LOCAL date: parsing
  // it as UTC midnight and then adding days with local getters loses a
  // day in any timezone behind UTC (the fallback return came back 13
  // days out instead of 14 under America/New_York).
  const ret =
    q.depart && q.ret && q.ret >= depart
      ? q.ret
      : isoDate(addDays(parseLocalDate(depart), durationDays - 1));
  // The cabin the traveler picked, in Duffel's vocabulary — the
  // Offer Request is asked for this cabin, never silently economy.
  return { origin, destination, month, durationDays, depart, return: ret, cabin: cabinClassFor(q.cabin) };
}

// Parse a YYYY-MM-DD string as a local-midnight Date, matching the
// local getters isoDate() reads. (A UTC-midnight parse is a different
// calendar day in western timezones.)
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The search button's verb, per category (spec §1b).
export function searchButtonLabel(tab: HomeTabId): string {
  switch (tab) {
    case 'hotels':
      return 'Search stays';
    case 'flights':
      return 'Search flights';
    case 'cars':
      return 'Search cars';
    case 'tours':
      return 'Search attractions';
    case 'cruises':
      return 'Search cruises';
    case 'buses':
      return 'Search buses';
    case 'taxis':
      return 'Search taxis';
  }
}

export type RowSort = 'best' | 'cheapest' | 'duration' | 'departure';

// Best value first = the planner's own order (the discovery order);
// cheapest first = per-traveler price ascending. Never a second
// price table — the same rows, reordered. Estimate rows carry no
// duration or departure time, so 'duration' / 'departure' leave them
// in best-value order — those sorts re-order the live fare lists
// (sortFareOffers), not the estimates.
export function sortTabRows<T extends TabRow>(rows: T[], sort: RowSort): T[] {
  if (sort === 'cheapest') return [...rows].sort((a, b) => a.pricePerTraveler - b.pricePerTraveler);
  return rows;
}

// The multi-city legs a search carries — the query's own legs when
// the trip type is multi-city, empty otherwise. A multi-city query
// whose legs were dropped (fewer than 2 clean legs) carries none.
export function flightLegsFromSearch(q: SearchQuery): FlightLeg[] {
  if (q.tab !== 'flights' || q.tripType !== 'multicity') return [];
  return cleanFlightLegs(q.legs);
}

// The cheapest one-way total for the fares actually shown — the
// cheapest visible outbound fare. Zero when the list is empty.
export function cheapestOneWayTotal(out: DuffelFareOffer[]): number {
  if (!out.length) return 0;
  return Math.min(...out.map((o) => o.price));
}

// The cheapest multi-city total for the fares actually shown — the
// cheapest visible fare of each leg, summed. Zero when any leg has
// no visible fare (there is no complete trip to total).
export function cheapestMultiCityTotal(legs: { out: DuffelFareOffer[] }[]): number {
  if (!legs.length) return 0;
  let total = 0;
  for (const leg of legs) {
    if (!leg.out.length) return 0;
    total += Math.min(...leg.out.map((o) => o.price));
  }
  return total;
}

// The cheapest out + back total for the fares actually shown —
// cheapest visible outbound + cheapest visible return. When filters
// hide the cheapest fare, the total follows the visible list instead
// of quoting a fare the traveler can't see. Zero when either
// direction is empty (no round trip to total).
export function cheapestOutBackTotal(out: DuffelFareOffer[], back: DuffelFareOffer[]): number {
  if (!out.length || !back.length) return 0;
  return Math.min(...out.map((o) => o.price)) + Math.min(...back.map((o) => o.price));
}

// The live fare lists, re-ordered by the same sort the sidebar
// offers: cheapest = price ascending (Duffel's own order, made
// explicit); shortest = duration ascending; earliest = departure
// time ascending. An offer missing the sorted value sorts last,
// price breaking the tie — nothing is dropped for lacking a time.
export function sortFareOffers(offers: DuffelFareOffer[], sort: RowSort): DuffelFareOffer[] {
  if (sort === 'duration') {
    return [...offers].sort(
      (a, b) => (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity) || a.price - b.price
    );
  }
  if (sort === 'departure') {
    return [...offers].sort(
      (a, b) => (a.departMinutes ?? Infinity) - (b.departMinutes ?? Infinity) || a.price - b.price
    );
  }
  return [...offers].sort((a, b) => a.price - b.price);
}

// The saved-request label for My Trips — the same shape the old
// SearchForm wrote, so saved requests read the same everywhere.
export function searchRequestLabel(q: SearchQuery, rowDestination?: string): string {
  const travelers = `${q.travelers} traveler${q.travelers > 1 ? 's' : ''}`;
  const dest = rowDestination ?? q.to ?? q.dest ?? '';
  switch (q.tab) {
    case 'flights': {
      if (q.tripType === 'multicity' && q.legs.length >= 2) {
        const hops = q.legs.map((l) => `${l.from} → ${l.to}`).join(' · ');
        const dates = q.legs.map((l) => l.depart).join(', ');
        return `Flights: ${hops} · ${dates} · ${travelers} · ${q.cabin}`;
      }
      return `Flights: ${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${q.depart || 'Flexible'}${
        q.ret ? ` – ${q.ret}` : ''
      } · ${travelers} · ${q.cabin}`;
    }
    case 'hotels':
      return `Stays: ${dest || 'Anywhere'} · ${q.depart || 'Flexible'}${
        q.ret ? ` – ${q.ret}` : ''
      } · ${q.guests} guest${q.guests > 1 ? 's' : ''} · ${q.rooms} room${q.rooms > 1 ? 's' : ''}`;
    case 'cars':
      return `Car rental: ${q.dest || 'Anywhere'} · ${q.depart || 'Flexible'}${
        q.pickupTime ? ` ${q.pickupTime}` : ''
      } · ${travelers}`;
    case 'tours':
      return `Attractions: ${dest || 'Anywhere'} · ${q.depart || 'Flexible'} · ${travelers}`;
    case 'cruises':
      return `Cruises: ${dest || 'Anywhere'} · ${
        q.month ? MONTH_NAMES[Number(q.month) - 1] : 'Flexible month'
      } · ${travelers}`;
    case 'buses':
      return `Buses: ${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${
        q.depart || 'Flexible'
      } · ${travelers}`;
    case 'taxis':
      return `Taxis: ${q.from || 'Anywhere'} → ${q.dropoff || 'Anywhere'} · ${
        q.depart || 'Flexible'
      }${q.pickupTime ? ` ${q.pickupTime}` : ''} · ${travelers}`;
  }
}
