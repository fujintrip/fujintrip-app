// Weather / closure day-swap (competitor learning round 2 #10).
//
// When an attraction is closed on the day the plan visits it, or the
// weather turns on an outdoor day, the plan swaps that day's activity
// with another day in the same city — same trip, same days, no extra
// cost — and says what changed and why.
//
// Closure rules are a curated dataset, verified Nov 11–12, 2026
// (CLOSURES_LAST_CHECKED below). The weather comes from Open-Meteo
// (free, no key): daily precipitation probability for each stop city,
// only when the trip starts within 16 days — beyond that the forecast
// does not exist yet, and the route says so instead of inventing one.
import { cityCoords, type TripCard } from './tripCard';

export const CLOSURES_LAST_CHECKED = '2026-11-12';

// A closure rule: the attraction, the city it is in, the title words
// that mean the plan visits it that day (a Paris day is "Museums and
// the Left Bank" — the Louvre is the museum day), and whether it is
// closed on a given date.
export type ClosureRule = {
  city: string;
  attraction: string;
  match: string[]; // lowercase title words that mean this attraction
  closedOn: (d: Date) => boolean;
  note: string;
};

function isLastSunday(d: Date): boolean {
  if (d.getDay() !== 0) return false;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  return next.getMonth() !== d.getMonth();
}

// Easter Sunday (Anonymous Gregorian computus) — the Vatican Museums
// close on Easter Sunday and Easter Monday. Exported for tests.
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export const CLOSURES: ClosureRule[] = [
  {
    city: 'Paris',
    attraction: 'Louvre',
    match: ['louvre', 'museum'],
    closedOn: (d) => d.getDay() === 2, // Tuesdays
    note: 'The Louvre is closed on Tuesdays.',
  },
  {
    city: 'Florence',
    attraction: 'Uffizi Gallery',
    match: ['uffizi'],
    closedOn: (d) => d.getDay() === 1, // Mondays
    note: 'The Uffizi Gallery is closed every Monday.',
  },
  {
    city: 'Rome',
    attraction: 'Vatican Museums',
    match: ['vatican'],
    closedOn: (d) => {
      // Closed Sundays — except the last Sunday of the month, when
      // entry is free 9:00–14:00 (last entry 12:30). Also closed on
      // Easter Sunday and Monday, 29 June, 25–26 December and 31 December.
      const easter = easterSunday(d.getFullYear());
      const easterMonday = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1);
      const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      if (sameDay(d, easter) || sameDay(d, easterMonday)) return true;
      if (d.getMonth() === 5 && d.getDate() === 29) return true; // 29 June
      if (d.getMonth() === 11 && (d.getDate() === 25 || d.getDate() === 26 || d.getDate() === 31)) return true;
      return d.getDay() === 0 && !isLastSunday(d);
    },
    note: 'The Vatican Museums are closed on Sundays, except the last Sunday of the month — then entry is free 9:00–14:00 (last entry 12:30). Also closed Easter Sunday and Monday, 29 June, 25–26 December and 31 December.',
  },
];

// Indoor / outdoor day titles (for the rain swap): a day is outdoor
// when its title is dominated by outdoor words, indoor when dominated
// by indoor words, mixed otherwise — a mixed day never swaps (the
// conservative choice: only a clearly-outdoor day moves for rain).
const OUTDOOR_WORDS = [
  'park', 'garden', 'gardens', 'grove', 'beach', 'beaches', 'coast', 'gorge', 'desert',
  'hike', 'hiking', 'walk', 'viewpoint', 'viewpoints', 'panorama', 'panoramic', 'riverfront',
  'harbour', 'harbor', 'canal', 'canals', 'cruise', 'felucca', 'snorkeling', 'sunset',
  'caldera', 'market', 'markets', 'plaza', 'piazza', 'piazzas', 'square', 'street food',
  'promenade', 'old town', 'bridges', 'fortress', 'islands', 'island', 'valley', 'trip',
];
const INDOOR_WORDS = [
  'museum', 'museums', 'gallery', 'palace', 'palaces', 'cathedral', 'church', 'chapel',
  'exhibition', 'workshop', 'cooking', 'tasting', 'theatre', 'opera', 'concert', 'spa',
  'bath', 'baths', 'thermal', 'coffee', 'restaurant', 'bars', 'bar', 'flamenco', 'aquarium',
  'temple', 'temples', 'shrine', 'castle', 'duomo', 'mosque',
];

export type DayKind = 'indoor' | 'outdoor' | 'mixed';

export function classifyDay(title: string): DayKind {
  const lower = ` ${title.toLowerCase()} `;
  // Word-boundary-ish matching: the padded string keeps "park" from
  // matching "parking", and the plural/& forms cover "gardens" and
  // "Parks & Gardens".
  const count = (words: string[]) =>
    words.filter((w) => lower.includes(` ${w} `) || lower.endsWith(` ${w}`) || lower.includes(` ${w},`) || lower.includes(` ${w} &`)).length;
  const out = count(OUTDOOR_WORDS);
  const inn = count(INDOOR_WORDS);
  if (out > inn) return 'outdoor';
  if (inn > out) return 'indoor';
  return 'mixed';
}

export type ClosureHit = {
  city: string;
  day: number;
  date: Date;
  attraction: string;
  note: string;
};

// Every day in the card whose titled attraction is closed on that date.
export function checkClosures(card: TripCard): ClosureHit[] {
  const hits: ClosureHit[] = [];
  for (const stop of card.stops) {
    for (const day of stop.days) {
      const title = day.title.toLowerCase();
      for (const rule of CLOSURES) {
        if (rule.city !== stop.city) continue;
        if (!rule.match.some((m) => title.includes(m))) continue;
        if (!rule.closedOn(day.date)) continue;
        hits.push({ city: stop.city, day: day.day, date: day.date, attraction: rule.attraction, note: rule.note });
      }
    }
  }
  return hits;
}

// Open-Meteo daily forecast for one city: date -> rain chance (%) and
// the weather code. One request covers all stop cities (comma-separated
// coordinates). Free, no key. A 6s budget: a slow forecast never stalls
// the chat or the plan.
export type CityForecast = { date: string; precip: number | null; code: number | null };
export type ForecastByCity = Record<string, CityForecast[]>;

const OPEN_METEO_TIMEOUT_MS = 6000;

export async function fetchForecast(cities: string[]): Promise<{ byCity: ForecastByCity; available: boolean; reason?: string }> {
  const coords = cities.map((c) => ({ city: c, coords: cityCoords(c) })).filter((x): x is { city: string; coords: { lat: number; lng: number } } => x.coords !== null);
  if (!coords.length) return { byCity: {}, available: false, reason: 'no_coords' };
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    coords.map((c) => c.coords.lat).join(',') +
    '&longitude=' +
    coords.map((c) => c.coords.lng).join(',') +
    '&daily=precipitation_probability_max,weathercode&timezone=auto&forecast_days=16';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPEN_METEO_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { byCity: {}, available: false, reason: 'fetch_failed' };
    const j = (await res.json()) as { daily?: { time?: string[]; precipitation_probability_max?: (number | null)[]; weathercode?: (number | null)[] } } | { daily?: { time?: string[]; precipitation_probability_max?: (number | null)[]; weathercode?: (number | null)[] } }[];
    const blocks = Array.isArray(j) ? j : [j];
    const byCity: ForecastByCity = {};
    blocks.forEach((block, i) => {
      const city = coords[i]?.city;
      if (!city || !block.daily?.time) return;
      byCity[city] = block.daily.time.map((t, k) => ({
        date: t,
        precip: block.daily?.precipitation_probability_max?.[k] ?? null,
        code: block.daily?.weathercode?.[k] ?? null,
      }));
    });
    return { byCity, available: true };
  } catch {
    return { byCity: {}, available: false, reason: 'fetch_failed' };
  }
}

export type DaySwap = {
  type: 'closure' | 'weather';
  city: string;
  fromDay: number;
  toDay: number;
  fromTitle: string;
  toTitle: string;
  reason: string;
};

const RAIN_THRESHOLD = 60; // precipitation probability (%) that swaps an outdoor day

// The swaps for a card: closure swaps first (a closed attraction always
// moves), then rain swaps (an outdoor day with >=60% rain swaps with an
// indoor day in the same city). A day swaps once — a day already moved
// for a closure is never moved again for rain. Same day, same city, no
// extra cost: the two days' activities exchange dates.
export function suggestSwaps(card: TripCard, forecast: ForecastByCity): { swaps: DaySwap[]; closures: ClosureHit[] } {
  const closures = checkClosures(card);
  const swaps: DaySwap[] = [];
  const swappedDays = new Set<string>(); // "city|day"
  const key = (city: string, day: number) => `${city}|${day}`;
  const dayTitle = (city: string, day: number): string => {
    const stop = card.stops.find((s) => s.city === city);
    return stop?.days.find((d) => d.day === day)?.title ?? '';
  };
  // Closure swaps: move the closed day to another day in the same stop
  // that is not itself a closure day for anything in its title.
  for (const hit of closures) {
    if (swappedDays.has(key(hit.city, hit.day))) continue;
    const stop = card.stops.find((s) => s.city === hit.city);
    if (!stop) continue;
    const partner = stop.days.find((d) => {
      if (d.day === hit.day || swappedDays.has(key(hit.city, d.day))) return false;
      const title = d.title.toLowerCase();
      return !CLOSURES.some((rule) => rule.city === hit.city && rule.match.some((m) => title.includes(m)) && rule.closedOn(d.date));
    });
    if (!partner) continue;
    swappedDays.add(key(hit.city, hit.day));
    swappedDays.add(key(hit.city, partner.day));
    swaps.push({
      type: 'closure',
      city: hit.city,
      fromDay: hit.day,
      toDay: partner.day,
      fromTitle: dayTitle(hit.city, hit.day),
      toTitle: dayTitle(hit.city, partner.day),
      reason: `${hit.attraction} is closed on ${hit.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${hit.note}`,
    });
  }
  // Rain swaps: an outdoor day with >=60% rain swaps with an indoor day
  // in the same stop whose own date is drier (<60% or no forecast).
  for (const stop of card.stops) {
    const cityForecast = forecast[stop.city] ?? [];
    const precipFor = (date: Date): number | null => {
      const iso = date.toISOString().slice(0, 10);
      return cityForecast.find((f) => f.date === iso)?.precip ?? null;
    };
    for (const day of stop.days) {
      if (swappedDays.has(key(stop.city, day.day))) continue;
      if (classifyDay(day.title) !== 'outdoor') continue;
      const precip = precipFor(day.date);
      if (precip === null || precip < RAIN_THRESHOLD) continue;
      const partner = stop.days.find((d) => {
        if (d.day === day.day || swappedDays.has(key(stop.city, d.day))) return false;
        if (classifyDay(d.title) !== 'indoor') return false;
        const p = precipFor(d.date);
        return p === null || p < RAIN_THRESHOLD;
      });
      if (!partner) continue;
      swappedDays.add(key(stop.city, day.day));
      swappedDays.add(key(stop.city, partner.day));
      swaps.push({
        type: 'weather',
        city: stop.city,
        fromDay: day.day,
        toDay: partner.day,
        fromTitle: day.title,
        toTitle: partner.title,
        reason: `${precip}% chance of rain in ${stop.city} on ${day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — the outdoor day moves to a drier one.`,
      });
    }
  }
  return { swaps, closures };
}

// Apply the swaps to a card: the two days' activities (title +
// experiences) exchange dates; the date, the weather and the day
// number stay where they are. The result is a new card — the original
// is untouched, so the map and the saved plan never change under the
// traveler.
export function applySwaps(card: TripCard, swaps: DaySwap[]): TripCard {
  if (!swaps.length) return card;
  const stops = card.stops.map((stop) => {
    const stopSwaps = swaps.filter((s) => s.city === stop.city);
    if (!stopSwaps.length) return stop;
    const days = stop.days.map((d) => ({ ...d }));
    for (const s of stopSwaps) {
      const a = days.find((d) => d.day === s.fromDay);
      const b = days.find((d) => d.day === s.toDay);
      if (!a || !b) continue;
      const title = a.title;
      const experiences = a.experiences;
      a.title = b.title;
      a.experiences = b.experiences;
      b.title = title;
      b.experiences = experiences;
    }
    return { ...stop, days };
  });
  return { ...card, stops };
}

// One check for a whole trip: the closures (no network) plus the rain
// forecast (gated to 16 days out), with the swaps they imply. Used by
// POST /api/weather and by the Fujin AI route — one place, one answer.
export type WeatherCheck = {
  swaps: DaySwap[];
  closures: ClosureHit[];
  forecastAvailable: boolean;
  forecastReason?: string; // 'past' | 'too_far' | 'fetch_failed' | 'no_coords'
  forecastByCity: ForecastByCity;
  startDate: string; // ISO date of the trip's first day
};

export async function checkTripWeather(card: TripCard): Promise<WeatherCheck> {
  const closures = checkClosures(card);
  const startDate = card.startDate.toISOString().slice(0, 10);
  // The gate distinguishes a trip that already started ('past') from
  // one more than 16 days out ('too_far') — the honest message differs.
  const startDay = new Date(card.startDate.getFullYear(), card.startDate.getMonth(), card.startDate.getDate());
  const now = new Date();
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysOut = Math.round((startDay.getTime() - todayDay.getTime()) / 86400000);
  let forecast: { byCity: ForecastByCity; available: boolean; reason?: string } = {
    byCity: {},
    available: false,
    reason: daysOut < 0 ? 'past' : 'too_far',
  };
  if (forecastAvailableFor(card.startDate)) {
    forecast = await fetchForecast(card.stops.map((s) => s.city));
  }
  const { swaps } = suggestSwaps(card, forecast.byCity);
  return {
    swaps,
    closures,
    forecastAvailable: forecast.available,
    ...(forecast.available ? {} : { forecastReason: forecast.reason ?? 'fetch_failed' }),
    forecastByCity: forecast.byCity,
    startDate,
  };
}

// The WEATHER block for the AI prompt: the closures on this trip's
// dates, the swaps they imply, and the rain chances for the trip days
// (a forecast, never a promise) — or the honest gap when no forecast
// exists yet.
export function weatherBlock(check: WeatherCheck): string {
  const lines: string[] = [];
  if (check.closures.length) {
    lines.push(
      `Closures on this trip (rules checked ${CLOSURES_LAST_CHECKED}): ` +
        check.closures.map((c) => `${c.attraction} in ${c.city} is closed on day ${c.day} (${c.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})`).join('; ') +
        '.'
    );
  }
  if (check.swaps.length) {
    lines.push(`Day swaps for this trip: ${check.swaps.map(swapLine).join(' ')}`);
  }
  if (!check.forecastAvailable) {
    lines.push(
      check.forecastReason === 'too_far'
        ? `The trip starts ${check.startDate}, more than 16 days out — no weather forecast exists yet, so say so and do not guess the weather.`
        : check.forecastReason === 'past'
          ? `The trip starts ${check.startDate}, which has already passed — the forecast only covers trips starting in the next 16 days, so say so and do not guess the weather.`
          : 'The weather forecast could not be loaded — say so, and do not guess the weather.'
    );
  }
  return lines.join(' ');
}

// One line per swap, for the Plan updates box and the chat.
export function swapLine(s: DaySwap): string {
  const kind = s.type === 'closure' ? 'Closed' : 'Rain';
  return `${kind} — Day ${s.fromDay} ("${s.fromTitle}") swaps with Day ${s.toDay} ("${s.toTitle}") in ${s.city}: ${s.reason}`;
}

// The forecast only exists 16 days out (Open-Meteo forecast_days=16
// covers today + 15 days). Beyond that the honest answer is "not
// available yet", never a made-up forecast.
export function forecastAvailableFor(startDate: Date, now: Date = new Date()): boolean {
  const daysOut = Math.round((new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  return daysOut >= 0 && daysOut <= 15;
}
