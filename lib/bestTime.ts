/**
 * Best Time to Travel (competitor learning round 2 #5, Kayak).
 *
 * Per route: price + crowds + weather for every month, from three
 * honest inputs —
 *  - SEASONS: curated peak / shoulder / low months per route (typical
 *    travel-season knowledge, not live data — the panel says so).
 *  - Weather: typicalTemp() from the trip card's own CITY_INFO data
 *    (January / July daytime highs, interpolated) — a range across
 *    the route's stops, so a multi-city route shows the spread.
 *  - Price: a band relative to the route's typical price (peak =
 *    higher than typical, shoulder = typical, low = lower than
 *    typical) — a season band, never a live price.
 *
 * Everything is labeled "typical season — not live prices". The panel
 * never forecasts weather or prices; it states the typical season.
 */

import { MONTH_NAMES, ROUTE_STOPS, routeKeyForDestination } from './planner';
import { typicalTemp } from './tripCard';

export type Season = 'peak' | 'shoulder' | 'low';

export type BestMonth = {
  month: number;
  season: Season;
  // Typical daytime high range across the route's stops (°F — the
  // temperatures in CITY_INFO are Fahrenheit), or null when the trip
  // card has no temperature data for this route.
  tempLow: number | null;
  tempHigh: number | null;
  price: 'higher than typical' | 'typical' | 'lower than typical';
  crowds: 'busiest' | 'moderate' | 'quietest';
};

export type BestTime = {
  routeKey: string;
  destination: string;
  cities: string[];
  bestMonth: number;
  bestNote: string;
  months: BestMonth[];
};

// Curated seasons per route key (months 1–12). The `best` month is the
// explicit pick; `note` is the one-line why. Peak is the busiest and
// priciest time; low is the quietest and cheapest — both are typical
// seasons, not live prices.
const SEASONS: Record<string, { peak: number[]; shoulder: number[]; low: number[]; best: number; note: string }> = {
  europe: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'warm days, long evenings, before the summer crowds' },
  centraleurope: { peak: [6, 7, 8, 12], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11], best: 5, note: 'warm days, beer gardens open, before the summer crowds (December is best for Christmas markets)' },
  portugal: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'mild and sunny, before the summer crowds' },
  egypt: { peak: [10, 11, 12, 1, 2, 3, 4], shoulder: [5, 9], low: [6, 7, 8], best: 11, note: 'cool enough for the temples, warm days on the Nile' },
  japan: { peak: [3, 4, 10, 11], shoulder: [5, 9], low: [1, 2, 6, 7, 8, 12], best: 4, note: 'cherry blossom season, mild weather' },
  italy: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'warm days, long evenings, before the summer crowds' },
  france: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'mild and sunny, before the summer crowds' },
  spain: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'warm and dry, before the summer heat' },
  greece: { peak: [6, 7, 8], shoulder: [5, 9, 10], low: [1, 2, 3, 4, 11, 12], best: 6, note: 'warm sea, long days, before the July crowds' },
  thailand: { peak: [11, 12, 1, 2], shoulder: [3, 10], low: [4, 5, 6, 7, 8, 9], best: 1, note: 'cool and dry, the best beach weather of the year' },
  southeastasia: { peak: [12, 1, 2], shoulder: [3, 4, 10, 11], low: [5, 6, 7, 8, 9], best: 1, note: 'cool and dry across Bangkok, Siem Reap and Hanoi' },
  turkey: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'warm days, clear skies over Cappadocia, before the summer heat' },
  morocco: { peak: [3, 4, 5, 9, 10, 11], shoulder: [2, 6, 12], low: [1, 7, 8], best: 4, note: 'mild days in the medinas and the desert, before the summer heat' },
  india: { peak: [10, 11, 12, 1, 2, 3], shoulder: [4, 9], low: [5, 6, 7, 8], best: 11, note: 'cool and dry, the best light for the Taj Mahal at sunrise' },
  uk: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 6, note: 'longest days, warmest weather, gardens in full bloom' },
  mexico: { peak: [11, 12, 1, 2, 3, 4], shoulder: [5, 10], low: [6, 7, 8, 9], best: 2, note: 'dry season, warm days, clear skies' },
  usa: { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'mild across New York, San Francisco and Los Angeles, before the summer crowds' },
  bali: { peak: [7, 8, 12, 1], shoulder: [4, 5, 6, 9, 10, 11], low: [2, 3], best: 5, note: 'dry season, green rice fields, before the July crowds' },
};

// The temperate default for a route with no curated seasons: peak
// summer, low winter, best May.
const DEFAULT_SEASON = { peak: [6, 7, 8], shoulder: [4, 5, 9, 10], low: [1, 2, 3, 11, 12], best: 5, note: 'mild weather, before the summer crowds' };

export function seasonFor(routeKey: string, month: number): Season {
  const s = SEASONS[routeKey] ?? DEFAULT_SEASON;
  if (s.peak.includes(month)) return 'peak';
  if (s.shoulder.includes(month)) return 'shoulder';
  return 'low';
}

function tempRange(cities: string[], month: number): { low: number | null; high: number | null } {
  const temps = cities.map((c) => typicalTemp(c, month)).filter((t) => t !== 0);
  if (!temps.length) return { low: null, high: null };
  return { low: Math.min(...temps), high: Math.max(...temps) };
}

export function bestTimeFor(destination: string): BestTime {
  const routeKey = routeKeyForDestination(destination);
  // A destination with no route (Bali) falls back to its own seasons
  // entry, then to the temperate default.
  const destKey = destination.toLowerCase();
  const key = SEASONS[routeKey] ? routeKey : SEASONS[destKey] ? destKey : routeKey;
  const s = SEASONS[key] ?? DEFAULT_SEASON;
  const stops = ROUTE_STOPS[routeKey] ?? [];
  const cities = stops.length ? stops.map((st) => st.city) : [destination];
  const months: BestMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const season = seasonFor(key, m);
    const t = tempRange(cities, m);
    months.push({
      month: m,
      season,
      tempLow: t.low,
      tempHigh: t.high,
      price: season === 'peak' ? 'higher than typical' : season === 'shoulder' ? 'typical' : 'lower than typical',
      crowds: season === 'peak' ? 'busiest' : season === 'shoulder' ? 'moderate' : 'quietest',
    });
  }
  return { routeKey: key, destination, cities, bestMonth: s.best, bestNote: s.note, months };
}

// The temperature label for a month's range. The numbers are
// Fahrenheit (CITY_INFO jan/jul are °F), so the unit is °F — the
// strip used to print °C next to Fahrenheit numbers (defect, Nov 14
// 2026: "typically 37–37°C" for January, while the checklist on the
// same page correctly said 37°F). When every stop shares one
// temperature the range is a single value — "37–37°F" is a degenerate
// range, never show it. Returns '' when there is no temperature data.
export function tempRangeLabel(low: number | null, high: number | null): string {
  if (low === null || high === null) return '';
  if (low === high) return `, typically ${low}°F`;
  return `, typically ${low}–${high}°F`;
}

// The best month's temperature line for the plan view: the range plus
// the cities it spans, or '' when there is no temperature data.
export function bestMonthTempLabel(bt: BestTime): string {
  const m = bt.months[bt.bestMonth - 1];
  const range = tempRangeLabel(m.tempLow, m.tempHigh);
  return range ? `${range} across ${bt.cities.join(', ')}` : '';
}

// The one-line read for the chat reply and the plan view: the best
// month and why, plus the season for the trip's own month when known.
export function bestTimeLine(destination: string, tripMonth = 0): string {
  const bt = bestTimeFor(destination);
  const best = bt.months[bt.bestMonth - 1];
  const bestTemp = tempRangeLabel(best.tempLow, best.tempHigh);
  let line = `Best month to go: ${MONTH_NAMES[bt.bestMonth - 1]} — ${bt.bestNote}; ${best.crowds} crowds, ${best.price} prices${bestTemp ? `${bestTemp} across ${bt.cities.join(', ')}` : ''}. Typical season, not live prices.`;
  if (tripMonth >= 1 && tripMonth <= 12 && tripMonth !== bt.bestMonth) {
    const cur = bt.months[tripMonth - 1];
    line += ` Your month (${MONTH_NAMES[tripMonth - 1]}) is ${cur.season} season — ${cur.crowds} crowds, ${cur.price} prices${tempRangeLabel(cur.tempLow, cur.tempHigh)}.`;
  }
  return line;
}
