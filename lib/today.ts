// Portable plan / on-trip "Today" view (community round, design §7).
//
// The plan in the traveler's pocket while they execute the trip. This
// module is pure derivation from the trip card — no network, no storage —
// so the Today view works offline from the saved plan alone.
//
// Honesty rules that shape every function here:
//  - Times are SUGGESTED, never booked. The trip card's days carry real
//    sight titles (from CITY_INFO) but no clock times, so the day is
//    divided into morning / afternoon / evening blocks with suggested
//    windows, labeled as such in the UI. Nothing here invents a booking,
//    a hotel name, an address or a check-in time.
//  - The afternoon block is honest free time ("wander, café, rest") —
//    generic guidance, not an invented activity.
//  - The evening block points at the real /api/food "tonight, near you,
//    open now" feature (round 2 #4); it never names a restaurant itself.
//  - "Trip total remaining" is not computed: a daily spend split would
//    invent numbers. The essentials strip shows the trip total and the
//    days left instead.

import { cityCoords, type TripCard, type TripCardDay, type TripCardStop } from './tripCard';

export type DayPhase = 'morning' | 'afternoon' | 'evening' | 'night';
export type TripStatus = 'before' | 'during' | 'after';

export type DayBlockKind = 'travel' | 'activity' | 'free' | 'dinner';
export type DayBlock = {
  id: string;
  kind: DayBlockKind;
  // Suggested window, e.g. "09:00–12:00". Suggested, never booked.
  time: string;
  label: string;
  title: string;
  detail: string;
  city: string;
  lat: number | null;
  lng: number | null;
};

export type TodaySummary = {
  status: TripStatus;
  dayIndex: number; // 0-based day of the trip the traveler is on (clamped)
  day: TripCardDay | null;
  stop: TripCardStop | null;
  phase: DayPhase;
  blocks: DayBlock[];
  nowBlock: DayBlock | null;
  nextBlock: DayBlock | null;
  nextDayTitle: string | null;
  startDate: Date;
  endDate: Date;
};

export type Essentials = {
  tonightCity: string;
  tonightNights: number;
  tonightStayLine: string;
  nextFlight: { label: string; price: number; date: Date } | null;
  nextFlightLine: string | null;
  tripTotal: number;
  daysLeft: number;
  datesLine: string;
};

// Suggested windows for the day's blocks. The morning block is the
// day's real activity (the trip card's sight title); the afternoon is
// free time; the evening is dinner near the traveler.
export const BLOCK_WINDOWS = {
  travel: '06:00–09:00',
  activity: '09:00–12:00',
  free: '13:00–17:00',
  dinner: '18:00–21:00',
} as const;

// 0-based day of the trip for a moment: -1 before the trip starts,
// card.days once it has ended, otherwise the day the traveler is on.
export function dayIndexFor(card: TripCard, now: Date): number {
  const start = new Date(card.startDate);
  start.setHours(0, 0, 0, 0);
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const diff = Math.floor((day.getTime() - start.getTime()) / 86400000);
  if (diff < 0) return -1;
  if (diff >= card.days) return card.days;
  return diff;
}

export function phaseFor(now: Date): DayPhase {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

// The stop and day a 0-based day index falls on (days run in order
// across the stops; TripCardDay.day is 1-based). The card's day entries
// cover the trip's NIGHTS, so the last calendar day — the departure day
// — has no day entry: it returns { stop: last stop, day: null } so the
// Today view can show the flight home instead of inventing an activity.
export function stopAndDayFor(
  card: TripCard,
  dayIndex: number
): { stop: TripCardStop; day: TripCardDay | null } | null {
  const clamped = Math.max(0, Math.min(card.days - 1, dayIndex));
  for (const stop of card.stops) {
    const found = stop.days.find((d) => d.day - 1 === clamped);
    if (found) return { stop, day: found };
  }
  if (clamped === card.days - 1) {
    return { stop: card.stops[card.stops.length - 1], day: null };
  }
  return null;
}

// Google Maps directions link to a city center (from the trip card's
// own coordinates — the same ones the map pins use).
export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// The day's blocks, in order. The travel block appears on the first day
// of a stop (the flight/train in, or the flight out on day 0); the
// morning block is the day's real sight title; the afternoon is free
// time; the evening is dinner near the traveler.
export function dayBlocks(card: TripCard, dayIndex: number): DayBlock[] {
  const found = stopAndDayFor(card, dayIndex);
  if (!found) return [];
  const { stop, day } = found;
  const coords = cityCoords(stop.city);
  // Departure day: no day entry — the flight home and check-out, not an
  // invented activity. The last day ends at the airport (round 4 #3):
  // the leave-by time rides on the flight block when it is known.
  if (!day) {
    const back = card.legs.find((l) => l.id === 'flight-back');
    return [
      {
        id: `${dayIndex}:travel`,
        kind: 'travel',
        time: BLOCK_WINDOWS.travel,
        label: 'Travel',
        title: back ? `${back.label}` : `Flight ${stop.city} → ${card.origin || 'your city'}`,
        detail: back
          ? `from $${back.price.toLocaleString()} (estimate)${card.departure?.leaveBy ? ` · leave for the airport by ${card.departure.leaveBy}` : ''}`
          : 'Flight home',
        city: stop.city,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      },
      {
        id: `${dayIndex}:checkout`,
        kind: 'free',
        time: BLOCK_WINDOWS.activity,
        label: 'Morning',
        title: `Check out & head to the airport`,
        detail: `Last morning in ${stop.city} — pack up, check out, and head to the airport.`,
        city: stop.city,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      },
    ];
  }
  const stopIdx = card.stops.indexOf(stop);
  const isFirstDayOfStop = day.day === stop.days[0].day;
  const blocks: DayBlock[] = [];
  // Arrival-time anchoring (round 4 #3): Day 1 starts from the landing
  // time — the travel block runs landing → hotel, and the activity
  // block starts after the transfer + buffer, not at a generic 09:00.
  // Without a landing time the day keeps the suggested windows.
  const isDayOne = dayIndex === 0 && stopIdx === 0;
  // A snapshot saved before this round has no arrival block — the
  // optional chain keeps it on the suggested windows, never a crash.
  const anchored = isDayOne && card.arrival?.anchored && card.arrival.landingTime && card.arrival.atHotel && card.arrival.firstActivityFrom;
  if (isFirstDayOfStop) {
    blocks.push({
      id: `${dayIndex}:travel`,
      kind: 'travel',
      time: anchored ? `${card.arrival.landingTime}–${card.arrival.atHotel}` : BLOCK_WINDOWS.travel,
      label: 'Travel',
      title: anchored
        ? `Land in ${stop.city} — ${card.arrival.landingTime}`
        : stopIdx === 0 ? `Arrive — ${stop.transportIn.mode} ${stop.transportIn.from} → ${stop.city}` : `${stop.transportIn.mode} ${stop.transportIn.from} → ${stop.city}`,
      detail: anchored
        ? `about an hour to the hotel (a typical transfer — confirm with your transfer) · from $${stop.transportIn.price.toLocaleString()} (estimate)`
        : `from $${stop.transportIn.price.toLocaleString()} (estimate)`,
      city: stop.city,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    });
  }
  const beforeCheckIn = anchored && card.arrival.firstActivityFrom! < '15:00';
  blocks.push({
    id: `${dayIndex}:activity`,
    kind: 'activity',
    time: anchored ? `${card.arrival.firstActivityFrom}–12:00` : BLOCK_WINDOWS.activity,
    label: 'Morning',
    title: day.title,
    detail: `${day.experiences} experiences · ${day.weatherF ? `${day.weatherF}°F typical` : 'weather not shown'}${beforeCheckIn ? ' · Check-in is typically 3pm — explore first, your room isn\'t ready yet' : ''}`,
    city: stop.city,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });
  blocks.push({
    id: `${dayIndex}:free`,
    kind: 'free',
    time: BLOCK_WINDOWS.free,
    label: 'Afternoon',
    title: `Free time in ${stop.city}`,
    detail: 'Wander, café, rest — no booking needed.',
    city: stop.city,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });
  blocks.push({
    id: `${dayIndex}:dinner`,
    kind: 'dinner',
    time: BLOCK_WINDOWS.dinner,
    label: 'Evening',
    title: 'Dinner near you',
    detail: `Places open tonight in ${stop.city} — checked live when you tap.`,
    city: stop.city,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  });
  return blocks;
}

function blockEndMinutes(block: DayBlock): number {
  const end = block.time.split('–')[1] ?? '21:00';
  const [h, m] = end.split(':').map(Number);
  return h * 60 + m;
}

// Now / Next for a moment: the first block whose suggested window has
// not ended yet is "now"; the one after it is "next". At night, "now"
// is rest and "next" is tomorrow's first block. Before the trip, the
// first block of day 0 is "next" (the trip has not started).
export function todaySummary(card: TripCard, now: Date): TodaySummary {
  const rawIndex = dayIndexFor(card, now);
  const status: TripStatus = rawIndex < 0 ? 'before' : rawIndex >= card.days ? 'after' : 'during';
  const dayIndex = Math.max(0, Math.min(card.days - 1, rawIndex));
  const found = stopAndDayFor(card, dayIndex);
  const blocks = dayBlocks(card, dayIndex);
  const phase = phaseFor(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let nowBlock: DayBlock | null = null;
  let nextBlock: DayBlock | null = null;
  let nextDayTitle: string | null = null;
  if (status === 'before') {
    nextBlock = blocks[0] ?? null;
  } else if (status === 'after') {
    nowBlock = null;
    nextBlock = null;
  } else if (phase === 'night') {
    const tomorrow = stopAndDayFor(card, dayIndex + 1);
    nextDayTitle = tomorrow?.day ? tomorrow.day.title : null;
    nextBlock = tomorrow ? dayBlocks(card, dayIndex + 1)[0] ?? null : null;
  } else {
    const idx = blocks.findIndex((b) => blockEndMinutes(b) > nowMinutes);
    if (idx === -1) {
      const tomorrow = stopAndDayFor(card, dayIndex + 1);
      nextDayTitle = tomorrow?.day ? tomorrow.day.title : null;
      nextBlock = tomorrow ? dayBlocks(card, dayIndex + 1)[0] ?? null : null;
    } else {
      nowBlock = blocks[idx];
      nextBlock = blocks[idx + 1] ?? null;
      if (!nextBlock) {
        const tomorrow = stopAndDayFor(card, dayIndex + 1);
        nextDayTitle = tomorrow?.day ? tomorrow.day.title : null;
        nextBlock = tomorrow ? dayBlocks(card, dayIndex + 1)[0] ?? null : null;
      }
    }
  }
  return {
    status,
    dayIndex,
    day: found?.day ?? null,
    stop: found?.stop ?? null,
    phase,
    blocks,
    nowBlock,
    nextBlock,
    nextDayTitle,
    startDate: card.startDate,
    endDate: card.endDate,
  };
}

// The essentials strip: tonight's stay (city + nights — never a hotel
// name or address, because the plan has none until a hotel supplier
// connects), the next flight leg by date, the trip total (the legs sum
// exactly to the chosen tier's total) and the days left.
export function essentialsFor(card: TripCard, dayIndex: number, now: Date): Essentials {
  const found = stopAndDayFor(card, dayIndex);
  const stop = found?.stop ?? card.stops[card.stops.length - 1];
  const tripTotal = card.legs.reduce((s, l) => s + l.price, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const flights = card.legs
    .filter((l) => l.kind === 'flight')
    .map((l) => ({ label: l.label, price: l.price, date: l.startDate }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextFlight = flights.find((f) => {
    const d = new Date(f.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() >= today.getTime();
  }) ?? null;
  const rawIndex = dayIndexFor(card, now);
  const daysLeft = rawIndex < 0 ? card.days : rawIndex >= card.days ? 0 : card.days - rawIndex;
  return {
    tonightCity: stop.city,
    tonightNights: stop.nights,
    tonightStayLine: `Stay in ${stop.city} · ${stop.nights} night${stop.nights > 1 ? 's' : ''} · hostel / guesthouse estimate — details at booking`,
    nextFlight,
    nextFlightLine: nextFlight
      ? `${nextFlight.label} · from $${nextFlight.price.toLocaleString()} · ${nextFlight.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
      : null,
    tripTotal,
    daysLeft,
    datesLine: `${card.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${card.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
  };
}

// --- Offline snapshot -----------------------------------------------------
// The plan as JSON, so it can live in localStorage (offline on this
// device) and travel in a share link (another device). Dates round-trip
// through ISO strings; the reviver restores them on the known fields.
export type OfflineSnapshot = {
  v: 1;
  savedAt: string;
  destination: string;
  travelers: number;
  days: number;
  month: number;
  origin: string;
  choice: number;
  card: unknown;
};

const DATE_KEYS = new Set(['date', 'startDate', 'endDate']);

function reviveDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : reviveDates(v);
    }
    return out;
  }
  return value;
}

export function serializeTripCard(card: TripCard): string {
  return JSON.stringify(card);
}

export function parseTripCard(json: string): TripCard | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { stops?: unknown }).stops)) return null;
    return reviveDates(parsed) as TripCard;
  } catch {
    return null;
  }
}

export function snapshotFor(card: TripCard, opts: { destination: string; travelers: number; days: number; month: number; origin: string; choice: number }): OfflineSnapshot {
  return {
    v: 1,
    savedAt: new Date().toISOString(),
    destination: opts.destination,
    travelers: opts.travelers,
    days: opts.days,
    month: opts.month,
    origin: opts.origin,
    choice: opts.choice,
    card: JSON.parse(serializeTripCard(card)),
  };
}

export function parseSnapshot(json: string): OfflineSnapshot | null {
  try {
    const parsed = JSON.parse(json) as OfflineSnapshot;
    if (!parsed || parsed.v !== 1 || typeof parsed.destination !== 'string' || !parsed.card) return null;
    parsed.card = reviveDates(parsed.card);
    return parsed;
  } catch {
    return null;
  }
}

export function offlineKeyFor(destination: string, travelers: number, days: number): string {
  return `fujintrip-offline-plan:${destination}:${travelers}:${days}`;
}

export function doneKeyFor(destination: string, travelers: number, days: number): string {
  return `fujintrip-today-done:${destination}:${travelers}:${days}`;
}
