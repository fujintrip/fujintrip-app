import { NextRequest, NextResponse } from 'next/server';
import { buildTripCard, CITY_INFO, type TripCard } from '../../../lib/tripCard';
import { routeKeyForDestination } from '../../../lib/planner';
import { checkTripWeather, CLOSURES_LAST_CHECKED, type WeatherCheck } from '../../../lib/daySwap';

/**
 * POST /api/weather — Weather / closure day-swap (competitor learning
 * round 2 #10).
 *
 * Body: { destination, travelers, days, month, origin?, kids?,
 * routeOverride? } — the trip the plan view shows. Returns the
 * closures on the trip's dates, the rain forecast (only when the trip
 * starts within 16 days — beyond that Open-Meteo has no forecast yet),
 * and the day swaps they imply, with the dates the rules were checked.
 *
 * The plan view calls this on demand ("Check weather & closures") and
 * renders the swaps in its Plan updates box; the swaps never change
 * the saved plan — the page applies them to the displayed card only.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = body as Record<string, unknown>;
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  const travelers = typeof raw.travelers === 'number' && raw.travelers >= 1 ? Math.min(9, Math.floor(raw.travelers)) : 2;
  const days = typeof raw.days === 'number' ? Math.floor(raw.days) : 0;
  const month = typeof raw.month === 'number' ? Math.floor(raw.month) : 0;
  const origin = typeof raw.origin === 'string' ? raw.origin : '';
  const kids = Array.isArray(raw.kids)
    ? (raw.kids as unknown[]).filter((k): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6)
    : [];
  const routeOverride =
    raw.routeOverride && typeof raw.routeOverride === 'object' && !Array.isArray(raw.routeOverride)
      ? (() => {
          const o = raw.routeOverride as Record<string, unknown>;
          if (!Array.isArray(o.cities)) return undefined;
          const cities = (o.cities as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 8);
          if (!cities.length) return undefined;
          return { cities };
        })()
      : undefined;
  if (!destination || days < 2 || month < 1 || month > 12) {
    return NextResponse.json({
      destination,
      swaps: [],
      closures: [],
      forecastAvailable: false,
      forecastReason: 'no_trip',
      forecastByCity: {},
      startDate: '',
      closuresCheckedAt: CLOSURES_LAST_CHECKED,
      checkedAt: new Date().toISOString(),
    });
  }
  // A destination the trip system does not know — no route and no city
  // in the 52-city guide — has no plan to check. The generic
  // single-city card buildTripCard would build for it is not a plan,
  // so answer honestly instead of reporting closures for a trip that
  // does not exist.
  if (!routeKeyForDestination(destination) && !CITY_INFO[destination]) {
    return NextResponse.json({
      destination,
      swaps: [],
      closures: [],
      forecastAvailable: false,
      forecastReason: 'unknown_destination',
      forecastByCity: {},
      startDate: '',
      closuresCheckedAt: CLOSURES_LAST_CHECKED,
      checkedAt: new Date().toISOString(),
    });
  }
  const card = buildTripCard({
    destination,
    travelers,
    days,
    month,
    origin,
    kids,
    ...(routeOverride ? { routeOverride } : {}),
  });
  if (!card) {
    // buildTripCard returns null for a destination it does not know —
    // an honest empty result, never a swapped plan for a trip that
    // does not exist.
    return NextResponse.json({
      destination,
      swaps: [],
      closures: [],
      forecastAvailable: false,
      forecastReason: 'unknown_destination',
      forecastByCity: {},
      startDate: '',
      closuresCheckedAt: CLOSURES_LAST_CHECKED,
      checkedAt: new Date().toISOString(),
    });
  }
  const check: WeatherCheck = await checkTripWeather(card);
  return NextResponse.json({
    destination,
    startDate: check.startDate,
    endDate: card.endDate.toISOString().slice(0, 10),
    swaps: check.swaps,
    closures: check.closures,
    forecastAvailable: check.forecastAvailable,
    ...(check.forecastAvailable ? {} : { forecastReason: check.forecastReason ?? 'fetch_failed' }),
    forecastByCity: check.forecastByCity,
    closuresCheckedAt: CLOSURES_LAST_CHECKED,
    checkedAt: new Date().toISOString(),
  });
}
