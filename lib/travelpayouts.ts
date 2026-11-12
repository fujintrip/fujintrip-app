// Travelpayouts cached comparison for the "Other sites" column.
// Built Nov 12, 2026 (user chose "Travelpayouts now — cached, labelled").
//
// What this is: the cheapest round-trip Aviasales fare for the traveler's
// exact trip (origin city → route's first city, trip start → trip end),
// from the Travelpayouts Data API cache. The fares are CACHED, never
// live: the cheapest tickets Aviasales users found in the last 48h,
// cache kept up to 7 days (verified against the official docs Nov 12,
// 2026 — see fetchCachedFares in lib/booking.ts). Every result carries
// its check date and the label says so in the UI and in the API reply.
//
// Honesty rules (non-negotiable):
// - A city with no IATA code in CITY_IATA gets no competitor fare —
//   codes are never guessed, and a missing code is an honest empty
//   column, not a fallback to another city.
// - No token, timeout, API error, or empty cache → available:false with
//   a label that says why. Never an invented price, never a stale price
//   shown without its check date.
// - The FujinTrip column is untouched (planner totals; Duffel test fares
//   stay in the chat). These fares cover FLIGHTS only — hotels, cars and
//   activities have no competitor feed yet, and the UI says so.
// - The token never leaves the server; the response carries prices,
//   airline and stops only.

import { fetchCachedFares } from './booking';
import { CITY_IATA } from './duffel';
import { ROUTE_STOPS, routeKeyForDestination } from './planner';

export type CompetitorFares = {
  available: boolean;
  configured: boolean;
  origin: string;
  destination: string;
  originIata: string | null;
  destIata: string | null;
  departDate: string;
  returnDate: string;
  travelers: number;
  // Cheapest round-trip fare for ONE traveler (the API's price with
  // one_way=false is the round-trip ticket, not one leg).
  farePerTraveler: number | null;
  total: number | null;
  currency: string;
  airline?: string;
  stops?: number;
  returnStops?: number;
  checkedAt: string;
  label: string;
  reason?: 'not-configured' | 'no-airport-code' | 'no-cached-fare' | 'lookup-failed';
};

// "YYYY-MM-DD" for a Date (local parts — a UTC toISOString would shift
// the day for evening trips in the Americas) or a string already in
// that shape; '' for anything else.
export function isoDate(d: Date | string): string {
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return '';
}

// The label every competitor fare carries, in the UI and in the API
// response — the check date is part of the price, not a footnote.
export function cachedLabel(checkedAt: string): string {
  return `Cached / indicative — checked ${checkedAt}. Cheapest round-trip fare Aviasales users found in the last 48 hours (cache kept up to 7 days). Not a live quote — the price can change, and bags may cost extra.`;
}

const EMPTY_LABEL =
  'Competitor fares are not connected yet — add the free Travelpayouts token (TRAVELPAYOUTS_TOKEN) and cached fares will appear here, labeled cached. Nothing invented in the meantime.';

// Origin city → IATA, destination (route display name or city) → the
// IATA of the route's FIRST city (the fare destination — the trip's
// first stop, the same city the Duffel live fares use). Returns nulls
// when a city has no code; the caller then shows an honest empty column.
export function resolveTripAirports(
  origin: string,
  destination: string
): { originIata: string | null; destIata: string | null; destCity: string } {
  const routeKey = destination ? routeKeyForDestination(destination) : '';
  const destCity = routeKey ? ROUTE_STOPS[routeKey][0].city : destination;
  return {
    originIata: CITY_IATA[origin] ?? null,
    destIata: destCity ? (CITY_IATA[destCity] ?? null) : null,
    destCity,
  };
}

// The Data API docs recommend caching results onsite for 24h; the fares
// themselves are a 48h–7d cache, so a 6h server cache keeps us far under
// the 600 req/min limit and still re-checks several times a day.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: CompetitorFares }>();

// Tests only — clears the server cache between cases.
export function __clearCompetitorCache(): void {
  cache.clear();
}

export async function fetchCompetitorFares(opts: {
  origin: string;
  destination: string;
  departDate: string | Date;
  returnDate: string | Date;
  travelers?: number;
}): Promise<CompetitorFares> {
  const travelers = Math.min(9, Math.max(1, Math.floor(opts.travelers ?? 2) || 2));
  const departDate = isoDate(opts.departDate);
  const returnDate = isoDate(opts.returnDate);
  const checkedAt = new Date().toISOString().slice(0, 10);
  const base: Omit<CompetitorFares, 'available' | 'label' | 'reason'> = {
    configured: Boolean(process.env.TRAVELPAYOUTS_TOKEN),
    origin: opts.origin,
    destination: opts.destination,
    originIata: null,
    destIata: null,
    departDate,
    returnDate,
    travelers,
    farePerTraveler: null,
    total: null,
    currency: 'USD',
    checkedAt,
  };

  if (!departDate || !returnDate) {
    return { ...base, available: false, label: 'No trip dates yet — competitor fares need the trip’s start and end dates.', reason: 'no-cached-fare' };
  }
  const { originIata, destIata, destCity } = resolveTripAirports(opts.origin, opts.destination);
  if (!originIata || !destIata) {
    const missing = [!originIata ? opts.origin : '', !destIata ? destCity : ''].filter(Boolean).join(' / ');
    return {
      ...base,
      originIata,
      destIata,
      available: false,
      label: `No cached fare for this trip — ${missing} has no airport code on file, so no competitor fare was looked up (codes are never guessed).`,
      reason: 'no-airport-code',
    };
  }
  if (!base.configured) {
    return { ...base, originIata, destIata, available: false, label: EMPTY_LABEL, reason: 'not-configured' };
  }

  const key = `${originIata}|${destIata}|${departDate}|${returnDate}|${travelers}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const res = await fetchCachedFares({
    origin: originIata,
    destination: destIata,
    month: departDate.slice(0, 7),
    departDate,
    returnDate,
    currency: 'USD',
  });
  const checked = res.checkedAt || checkedAt;
  let result: CompetitorFares;
  if (!res.configured) {
    // Token vanished mid-flight — report it, don't cache it.
    result = { ...base, originIata, destIata, available: false, label: res.label, checkedAt: checked, reason: 'not-configured' };
    return result;
  }
  const cheapest = [...res.fares].sort((a, b) => a.price - b.price)[0];
  if (!res.ok) {
    result = {
      ...base,
      originIata,
      destIata,
      available: false,
      checkedAt: checked,
      label: res.label,
      reason: 'lookup-failed',
    };
  } else if (!cheapest) {
    result = {
      ...base,
      originIata,
      destIata,
      available: false,
      checkedAt: checked,
      label: `No cached Aviasales fare was found for ${originIata} → ${destIata} on ${departDate}–${returnDate} (checked ${checked}). Nothing invented — the FujinTrip column still stands on its own.`,
      reason: 'no-cached-fare',
    };
  } else {
    result = {
      ...base,
      originIata,
      destIata,
      available: true,
      farePerTraveler: cheapest.price,
      total: cheapest.price * travelers,
      currency: cheapest.currency || 'USD',
      airline: cheapest.airline,
      stops: cheapest.stops,
      returnStops: cheapest.returnStops,
      checkedAt: checked,
      label: cachedLabel(checked),
    };
  }
  // A failed lookup is never cached — a 500 or a timeout should not
  // block the next check for 6 hours. Empty-cache and priced results are
  // cached (the fares themselves are a 48h–7d cache).
  if (res.ok) cache.set(key, { at: Date.now(), result });
  return result;
}
