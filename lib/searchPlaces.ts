// Search widget + results (direction v3, Nov 14, 2026): the place
// autocomplete source, the search query (URL params in, results out),
// and the honest row sorting. Every place here comes from data the app
// already has — the 21 discovery destinations + their stop cities, the
// 6 global destinations, the hidden gems, and the ~51 CITY_INFO
// cities. A place the app does not know never appears as a suggestion;
// a typed place it does not know is handled honestly by the results
// (empty state / no live fare), never invented.
import { CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from './data';
import { discoveryDestinations } from './discovery';
import { CITY_INFO } from './tripCard';
import { bestTimeFor } from './bestTime';
import { MONTH_NAMES } from './planner';
import { HOME_TABS, homeTabIdFromQuery, type HomeTabId, type TabRow } from './homeTabs';

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
};

export const CABINS = ['Economy', 'Premium economy', 'Business', 'First'] as const;

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

// Parse URL params into a search query. Nothing is invented: an
// unknown place stays as typed (the results handle it honestly), a
// bad date is dropped, a bad number falls back to the default.
export function searchQueryFromParams(
  params: Record<string, string | string[] | undefined>
): SearchQuery | null {
  const tab = homeTabIdFromQuery(params.tab ?? null);
  const q = emptySearchQuery(tab);
  q.from = cleanPlace(params.from);
  q.to = cleanPlace(params.to);
  q.dest = cleanPlace(params.dest);
  q.depart = cleanDate(params.depart);
  q.ret = cleanDate(params.return);
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
// default 14 days stand in. The response carries the actual checked
// dates — the UI shows those, never the traveler's dates as checked.
export function flightContextFromSearch(q: SearchQuery): {
  origin: string;
  destination: string;
  month: number;
  durationDays: number;
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
  return { origin, destination, month, durationDays };
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

export type RowSort = 'best' | 'cheapest';

// Best value first = the planner's own order (the discovery order);
// cheapest first = per-traveler price ascending. Never a second
// price table — the same rows, reordered.
export function sortTabRows(rows: TabRow[], sort: RowSort): TabRow[] {
  if (sort === 'cheapest') return [...rows].sort((a, b) => a.pricePerTraveler - b.pricePerTraveler);
  return rows;
}

// The saved-request label for My Trips — the same shape the old
// SearchForm wrote, so saved requests read the same everywhere.
export function searchRequestLabel(q: SearchQuery, rowDestination?: string): string {
  const travelers = `${q.travelers} traveler${q.travelers > 1 ? 's' : ''}`;
  const dest = rowDestination ?? q.to ?? q.dest ?? '';
  switch (q.tab) {
    case 'flights':
      return `Flights: ${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${q.depart || 'Flexible'}${
        q.ret ? ` – ${q.ret}` : ''
      } · ${travelers} · ${q.cabin}`;
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
