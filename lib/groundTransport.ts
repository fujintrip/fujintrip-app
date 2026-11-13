// Ground-transport know-how (ground-transport-booking-plan.md §6–§7,
// Nov 12, 2026): what the traveler is told about booking each
// transport leg, until live booking exists. The strings below are
// copied VERBATIM from the plan file's §7 TRANSPORT_KNOW_HOW block —
// no URL, price, operator name or timetable is invented here; where a
// price appears it is the verified JR Pass official price or a
// 2026-guide range, labeled as such in the string itself.
//
// Two strings mention a "Book this train" / "Book transfer" button:
// that is the Phase 0 affiliate deep-link step (plan file §8.2), not
// built yet. Every entry's notIncluded footer says FujinTrip does not
// sell/book the ticket yet, so the block as a whole stays honest —
// but the deep links are the natural next step.
//
// Keys map to the trip card's LEG_MODE routes (lib/tripCard.ts).

export type TransportKnowHow = {
  key: string;
  title: string;
  lines: string[];
  notIncluded: string;
};

export const TRANSPORT_KNOW_HOW: Record<string, TransportKnowHow> = {
  'train-europe': {
    key: 'train-europe',
    title: 'How to book this train',
    lines: [
      'Book 60–90 days ahead for the cheapest advance fares — last-minute fares on the same train can be two or three times higher.',
      'Book through the national railway or an aggregator (Trainline, Omio). Use "Book this train" — the journey is pre-filled.',
      'Check the seat reservation: on TGV, Eurostar, Frecciarossa/Italo, AVE and night trains a reservation is mandatory — you cannot board without one, pass or no pass. On ICE and most regional trains it is optional.',
    ],
    notIncluded: 'FujinTrip does not sell this ticket yet — you book it on the operator or aggregator site. Prices and times change; check before you book.',
  },
  'train-europe-pass': {
    key: 'train-europe-pass',
    title: 'Rail pass or point-to-point?',
    lines: [
      'A Eurail pass (non-European residents) or Interrail pass (European residents) covers trains in 33 European countries — but not the mandatory seat reservations above, which you pay on top (typically €5–€35 per leg).',
      'A pass usually wins on a long, flexible, multi-country trip. A fixed itinerary booked early is usually cheaper as point-to-point tickets.',
    ],
    notIncluded: 'Pass prices change by season and age band — check the current price before you buy. This is guidance, not a ticket.',
  },
  'train-japan': {
    key: 'train-japan',
    title: 'How to book this bullet train',
    lines: [
      'The Japan Rail Pass gives unlimited JR travel — including most Shinkansen — for 7, 14 or 21 days. Official-site price (2026): 7 days ¥50,000, 14 days ¥80,000, 21 days ¥100,000, ordinary class. Only for foreign tourists on a Temporary Visitor stamp.',
      'Do the math first: after the 2023 price rise the pass is not automatically cheaper — add up your Shinkansen legs. Seat reservations are free and unlimited with the pass; reserve ahead in peak seasons (cherry blossom, Golden Week, Obon, New Year).',
      'Nozomi and Mizuho (the fastest Shinkansen) are not covered — use Hikari or Sakura instead. For local trains, tap in with an IC card (Suica/Pasmo).',
    ],
    notIncluded: 'FujinTrip does not sell the pass or the tickets yet — buy the pass on the official JR site (the only way to reserve seats before you arrive) or through an authorised agent. Prices change; check before you buy.',
  },
  'train-sleeper': {
    key: 'train-sleeper',
    title: 'How to book this sleeper train',
    lines: [
      'Book sleeper berths early — they sell out days ahead, and there are far fewer berths than seats.',
      'Book through the national railway or a reputable aggregator. Use "Book this train" for the best available channel for this route.',
      'Check what is included before you pay — bedding, meals and a private cabin vary by train — and arrive early: sleepers board before departure.',
    ],
    notIncluded: 'FujinTrip does not sell this ticket yet. Prices and times change; check before you book.',
  },
  'train-usa': {
    key: 'train-usa',
    title: 'How to book this train',
    lines: [
      'Amtrak is the intercity train in the US. Book on Amtrak or through an aggregator — advance fares are cheaper and the cheapest sell out first.',
      'Where Amtrak does not run, intercity buses (Greyhound, Megabus and others) cover the route — see the bus guidance on that leg.',
    ],
    notIncluded: 'FujinTrip does not sell this ticket yet. Prices and times change; check before you book.',
  },
  'bus-europe': {
    key: 'bus-europe',
    title: 'How to book this bus',
    lines: [
      'Coaches are slower than the train but often much cheaper — and on some routes the only public transport. FlixBus is the largest European coach network; tickets are e-tickets, cheapest booked ahead.',
      'Arrive 15–30 minutes before departure — coaches leave on time. One checked bag is usually included; extra or oversized bags can cost extra.',
    ],
    notIncluded: 'FujinTrip does not sell this ticket yet — you book it on the operator site. Prices and times change; check before you book.',
  },
  'bus-general': {
    key: 'bus-general',
    title: 'How to book this bus',
    lines: [
      'Book intercity buses online ahead of time — the cheapest fares sell first, and the ticket is an e-ticket on your phone.',
      'Arrive 15–30 minutes before departure. Check the luggage allowance before you travel — extra bags can cost extra.',
    ],
    notIncluded: 'FujinTrip does not sell this ticket yet. Prices and times change; check before you book.',
  },
  'taxi-airport': {
    key: 'taxi-airport',
    title: 'How to get to your hotel',
    lines: [
      'Pre-book the airport transfer: fixed price, named driver, meeting point — no queue, no meter surprise. Use "Book transfer" — airport, hotel, date and time are pre-filled.',
      'In the city, use the local ride-hailing app: Uber in most of Europe, the Americas and the UK; Lyft in the US and Canada; Bolt in much of Europe; Grab in Southeast Asia (Uber does not run rides there).',
    ],
    notIncluded: 'FujinTrip does not book the ride yet — the transfer is booked with the provider, the city ride in the app. Fares change with demand; check before you ride.',
  },
  'taxi-city': {
    key: 'taxi-city',
    title: 'How to get around',
    lines: [
      'Use the local ride-hailing app: Uber in most of Europe, the Americas and the UK; Lyft in the US and Canada; Bolt in much of Europe; Grab in Southeast Asia (Uber does not run rides there).',
      'Where there is no app, agree the fare — or confirm the meter is on — before the ride starts, and keep the receipt and the car’s plate number.',
    ],
    notIncluded: 'FujinTrip does not book the ride yet. Fares change with demand; check before you ride.',
  },
  'ferry-greece': {
    key: 'ferry-greece',
    title: 'How to book this ferry',
    lines: [
      'Book ferries in advance in summer — popular Greek island routes sell out in July and August. Arrive at the port 30–60 minutes before departure.',
      'E-tickets are standard; keep the mobile ticket with your ID. Times can change with weather — check the operator’s notice on the day.',
    ],
    notIncluded: 'FujinTrip does not sell this ticket yet. Prices and times change; check before you book.',
  },
};

// The general rule (plan file §6 footer, on every leg's know-how):
// the fallback when a mode/region has no string above. Never invented.
export const GENERAL_KNOW_HOW_FOOTER =
  'Prices and times change — check before you book. This is guidance, not a ticket.';

// Route → know-how key (plan file §7, "Route → know-how key").
// Note the usa entry: the plan file maps usa → train-usa, but the trip
// card's LEG_MODE for the USA route is a domestic flight, so no USA leg
// ever reaches the train-usa string through the mode guard in
// knowHowForLeg below — train guidance is never shown on a flight leg.
// The string stays in the record for when a rail leg exists.
const ROUTE_KNOW_HOW: Record<string, string> = {
  europe: 'train-europe',
  centraleurope: 'train-europe',
  portugal: 'train-europe',
  morocco: 'train-europe',
  india: 'train-europe',
  uk: 'train-europe',
  france: 'train-europe',
  italy: 'train-europe',
  spain: 'train-europe',
  egypt: 'train-sleeper',
  thailand: 'train-sleeper',
  japan: 'train-japan',
  usa: 'train-usa',
  greece: 'ferry-greece',
};

// Routes where a rail pass is a real alternative: the multi-country
// Europe trips get the pass card as a second know-how block.
const PASS_ROUTES = new Set(['europe', 'centraleurope']);

// Geographically European routes, for the bus-europe vs bus-general
// split (bus-europe names FlixBus, the European coach network).
const EUROPE_ROUTES = new Set([
  'europe', 'centraleurope', 'portugal', 'france', 'italy', 'spain', 'uk', 'greece',
]);

const TRAIN_MODE = /train|tgv|ave|bullet|sleeper|high-speed/i;
const FERRY_MODE = /ferry/i;
const BUS_MODE = /bus|coach/i;

/** The plan file's route → key mapping, mode-agnostic (for lookups). */
export function knowHowKeyForRoute(routeKey: string): string | null {
  return ROUTE_KNOW_HOW[routeKey] ?? null;
}

/** The rail-pass card for multi-country Europe trips, else null. */
export function passKnowHowForRoute(routeKey: string): TransportKnowHow | null {
  return PASS_ROUTES.has(routeKey) ? TRANSPORT_KNOW_HOW['train-europe-pass'] : null;
}

export type GroundLegKind = 'flight' | 'transport' | 'stay' | 'car';

/**
 * The know-how for one leg, keyed to the leg's actual mode and region.
 * - flight legs (arrival / departure): the airport-transfer guidance —
 *   the transfer is what the traveler needs at the start and end.
 * - transport legs: rail / ferry / bus by mode; domestic-flight legs
 *   are out of scope in the plan file (null → the UI shows the
 *   general footer instead of inventing guidance).
 * - stay / car legs: no transport know-how.
 * The mode guard is what keeps train guidance off flight legs even
 * where the route map names a train key (usa).
 */
export function knowHowForLeg(
  routeKey: string,
  kind: GroundLegKind,
  mode: string
): TransportKnowHow | null {
  if (kind === 'flight') return TRANSPORT_KNOW_HOW['taxi-airport'];
  if (kind !== 'transport') return null;
  if (FERRY_MODE.test(mode)) return TRANSPORT_KNOW_HOW['ferry-greece'];
  if (BUS_MODE.test(mode)) {
    return EUROPE_ROUTES.has(routeKey)
      ? TRANSPORT_KNOW_HOW['bus-europe']
      : TRANSPORT_KNOW_HOW['bus-general'];
  }
  if (TRAIN_MODE.test(mode)) {
    const key = knowHowKeyForRoute(routeKey);
    return key ? TRANSPORT_KNOW_HOW[key] ?? null : null;
  }
  return null;
}
