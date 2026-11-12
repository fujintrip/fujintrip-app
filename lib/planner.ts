export type PlanOption = { name: string; total: number; flight: number; hotel: number; car: number; activities: number; note: string };
export type DayPlan = { day: number; title: string; morning: string; afternoon: string; evening: string; transport: string; stay: string };
export type Plan = { destination: string; travelers: number; options: PlanOption[]; days: DayPlan[]; tips: string[]; liked: string[]; notLiked: string[] };

const BASE: Record<string, number> = { Kyoto: 1950, Bali: 1250, Santorini: 2100, 'St. George': 780, Tacoma: 920, Hilo: 1450 };

// Destinations the planner has real tier totals for (used by the live AI
// route to build its price table — single source of truth, no invented prices).
export const KNOWN_DESTINATIONS = Object.keys(BASE);

// Each option's legs are rounded independently, so their sum can drift a
// few dollars from the total. Nudge the largest leg so legs always add up
// exactly — the plan cards, the comparison section and the AI price table
// must never disagree.
function fixLegs(o: PlanOption): PlanOption {
  const sum = o.flight + o.hotel + o.car + o.activities;
  const diff = o.total - sum;
  if (diff === 0) return o;
  const keys: Array<'flight' | 'hotel' | 'car' | 'activities'> = ['flight', 'hotel', 'car', 'activities'];
  keys.sort((a, b) => o[b] - o[a]);
  return { ...o, [keys[0]]: o[keys[0]] + diff };
}

export function buildPlan(destination: string, travelers: number, days = 3): Plan {
  const base = BASE[destination] ?? 1500;
  const per = (f: number) => Math.round(base * f * travelers);
  const options: PlanOption[] = [
    { name: 'Cheapest', total: per(0.64), flight: per(0.28), hotel: per(0.22), car: per(0.05), activities: per(0.09), note: 'Budget stays, off-peak flights, free activities first.' },
    { name: 'Best value', total: per(1), flight: per(0.42), hotel: per(0.33), car: per(0.08), activities: per(0.17), note: 'Our pick — comfort where it matters, savings where it doesn’t.' },
    { name: 'Premium', total: per(1.64), flight: per(0.6), hotel: per(0.62), car: per(0.14), activities: per(0.28), note: 'Top stays, direct flights, private guides.' },
  ].map(fixLegs);
  const dayTitles = ['Arrive & settle in', 'The big day', 'Slow morning, local flavour'];
  const planDays: DayPlan[] = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    title: dayTitles[i] ?? `Explore ${destination}`,
    morning: `Easy start in ${destination} — a local café, then the main sight before the crowds.`,
    afternoon: `Guided walk or activity, with time to wander and a rest at your stay.`,
    evening: `Dinner at a well-reviewed local spot, then a quiet evening walk.`,
    transport: i === 0 ? 'Airport transfer included in the plan' : 'Local bus / rental car — cheapest option shown first.',
    stay: 'Stay picked for location and reviews, not just price.',
  }));
  return {
    destination, travelers, options, days: planDays,
    tips: ['Book the flight + hotel together — that’s where most of the saving comes from.', 'Travel midweek when you can; weekend flights cost more for the same seat.', 'Check the hotel’s own website before booking — sometimes it’s cheaper, and we link it.'],
    liked: ['One plan, not seven tabs', 'Clear Cheapest / Best value / Premium choices', 'One booking with FujinTrip — no bouncing between sites'],
    notLiked: ['Live prices need a connected supplier — these are planning estimates for now'],
  };
}

export type TripComparison = {
  destination: string;
  travelers: number;
  best: PlanOption;
  separate: { total: number; flight: number; hotel: number; car: number; activities: number };
  save: number;
  savePercent: number;
};

// Price comparison from the planner — single source of truth for the
// homepage section, the plan cards and the live AI price table.
// "Booking each leg separately" costs about 13% more than the FujinTrip
// Best value plan: each separate leg is the Best value leg / 0.87,
// rounded, then adjusted so the legs sum exactly to the separate total.
// No numbers are invented — everything derives from buildPlan().
// Kyoto, 2 travelers: Best value $3,900 vs separately $4,483, save $583 (~13%).
export function comparisonFor(destination: string, travelers: number): TripComparison {
  const best = buildPlan(destination, travelers, 3).options[1];
  const separateTotal = Math.round(best.total / 0.87);
  const legs = [
    { key: 'flight' as const, value: Math.round(best.flight / 0.87) },
    { key: 'hotel' as const, value: Math.round(best.hotel / 0.87) },
    { key: 'car' as const, value: Math.round(best.car / 0.87) },
    { key: 'activities' as const, value: Math.round(best.activities / 0.87) },
  ];
  const diff = separateTotal - legs.reduce((s, l) => s + l.value, 0);
  if (diff !== 0) {
    const biggest = legs.reduce((a, b) => (b.value > a.value ? b : a));
    biggest.value += diff;
  }
  const separate = {
    total: separateTotal,
    flight: legs[0].value,
    hotel: legs[1].value,
    car: legs[2].value,
    activities: legs[3].value,
  };
  const save = separateTotal - best.total;
  return {
    destination,
    travelers,
    best,
    separate,
    save,
    savePercent: Math.round((save / separateTotal) * 100),
  };
}

// Duffel flight service fee — DECIDED by the user Nov 11, 2026 (tiered
// flat fee, option C of the margin model). Charged per flight ORDER (not
// per passenger) on top of the airline fare, and must always be shown
// separately at checkout ("Fare $300 at cost + service $35"), never
// hidden inside the fare — that is what keeps the site's promise honest.
// Duffel itself pays no percentage: FujinTrip pays Duffel $3 per
// confirmed order + 1% Managed Content in live mode + ~2.9% card
// processing, so a % markup alone loses money (3% on $300 = $9 fee vs
// ~$15 costs). The checkout flow (not built yet) calls this to price the
// fee; the planner's trip totals stay fare-only.
export function serviceFee(orderFareTotal: number): number {
  if (orderFareTotal < 250) return 19;
  if (orderFareTotal <= 800) return 35;
  return 49;
}

// Travel-only guardrail (same limit as the live AI system prompt).
// Fujin AI answers only about travel and trip planning. Anything with no
// travel signal gets a short decline and a redirect, never a plan.
const TRAVEL_WORDS = [
  'travel', 'trip', 'flight', 'fly', 'hotel', 'stay', 'holiday', 'vacation',
  'tour', 'cruise', 'car', 'rental', 'bus', 'taxi', 'transfer', 'sightsee',
  'beach', 'island', 'mountain', 'hike', 'surf', 'culture', 'visit', 'plan',
  'book', 'booking', 'destination', 'airport', 'passport', 'visa', 'itinerary',
  'resort', 'getaway', 'honeymoon', 'adventure', 'relax', 'explore', 'food',
  'go to', 'going to',
  // "Go to" is how travelers most often name a destination ("i want to
  // go to zanzibar") — without it, an unknown place gets declined as
  // off-topic instead of asked about honestly (Nov 11).
  // Food questions are travel (same scope as the live AI prompt) — this
  // matters for on-trip mode, where "where should I eat tonight?" must
  // reach the plan, not a decline.
  'eat', 'eating', 'restaurant', 'dinner', 'lunch', 'cuisine', 'dish',
  'traveler', 'travelers', 'traveller', 'travellers', 'adult', 'adults',
  'person', 'people', 'family', 'kid', 'kids', 'child', 'children',
  'weekend', 'road trip', 'staycation',
];

// Country route map — the fallback's recommend rule. When the traveler
// names a country (or the conversation history names one), propose a
// concrete route through it instead of asking "which city?" again.
// Each route is 1–3 warm sentences with real places and transport/stay
// guidance. Prices come from the planner (Other-destinations row, base
// 1500) via optionsLine() — never invented here. A proposal is a
// suggestion the traveler can change, never a silent default.
const COUNTRY_ROUTES: Record<string, { display: string; route: string }> = {
  europe: {
    display: 'Europe',
    route:
      'Lisbon (Portugal) → Madrid → Barcelona (Spain) → Paris (France) → Rome (Italy) → Athens (Greece): five countries, great food at every stop. Fly between cities on low-cost carriers (Ryanair, easyJet, Wizz Air) — that’s where the budget wins. Stay in hostels and family guesthouses, and get around by metro, tram and bus — a day pass beats taxis every time.',
  },
  egypt: {
    display: 'Egypt',
    route:
      'Cairo (Pyramids of Giza, the Egyptian Museum) → Luxor (Valley of the Kings, Karnak Temple) → Aswan (Philae Temple, a felucca ride on the Nile) → Sharm El Sheikh (Red Sea snorkeling). Travel between cities by overnight sleeper train or a short domestic flight, and stay in family-run guesthouses and mid-range hotels near the sights.',
  },
  japan: {
    display: 'Japan',
    route:
      'Tokyo (Shibuya, Tsukiji outer market) → Kyoto (Fushimi Inari shrine, Arashiyama bamboo grove) → Osaka (Dotonbori street food, the castle). Take the bullet train between cities with a JR Pass, use metro day passes inside them, and stay in business hotels and ryokan guesthouses.',
  },
  italy: {
    display: 'Italy',
    route:
      'Rome (Colosseum, Trastevere trattorias) → Florence (Uffizi, a Tuscan day trip) → Venice (canals, cicchetti bars). High-speed trains link the cities, buses and the metro cover Rome, and family-run B&Bs and small hotels keep it affordable.',
  },
  france: {
    display: 'France',
    route:
      'Paris (Eiffel Tower, the Marais, morning markets) → the Loire Valley châteaux → Nice and the Côte d’Azur. TGV trains between cities, a Métro day pass in Paris, and small hotels and guesthouses instead of big chains.',
  },
  spain: {
    display: 'Spain',
    route:
      'Barcelona (Sagrada Família, Gothic Quarter tapas) → Seville (Alcázar, flamenco) → Madrid (Prado, Retiro Park). AVE high-speed trains between cities, metro and bus day passes inside them, and hostels and family guesthouses to stay in.',
  },
  greece: {
    display: 'Greece',
    route:
      'Athens (Acropolis, Plaka tavernas) → Santorini (Oia sunset, the caldera) → Crete (Knossos, the beaches). Ferries link the islands, the metro covers Athens, and family-run pensions and small hotels keep the stay affordable.',
  },
  thailand: {
    display: 'Thailand',
    route:
      'Bangkok (Grand Palace, floating markets, street food) → Chiang Mai (temples, night bazaar) → Krabi (islands, long-tail boats). Take the overnight sleeper train to Chiang Mai, tuk-tuks and the metro in Bangkok, and stay in guesthouses and small hotels.',
  },
  southeastasia: {
    display: 'Southeast Asia',
    route:
      'Bangkok (Grand Palace, floating markets, street food) → Siem Reap (Angkor Wat sunrise, the temples) → Hanoi (Old Quarter, pho, Hoan Kiem Lake). Fly between cities on short domestic flights, and stay in social hostels and guesthouses — the best value and the most local way to travel.',
  },
  turkey: {
    display: 'Turkey',
    route:
      'Istanbul (Hagia Sophia, Grand Bazaar) → Cappadocia (hot-air balloons, cave hotels) → Antalya (the Turquoise Coast). Domestic flights between cities, the tram in Istanbul, and cave hotels and family pensions to stay in.',
  },
  morocco: {
    display: 'Morocco',
    route:
      'Marrakech (Jemaa el-Fnaa, the souks) → the Atlas Mountains → Fes (the medina, the tanneries) → Chefchaouen (the blue city). Trains and shared taxis between cities, and riads and guesthouses — the best value and the most local way to stay.',
  },
  india: {
    display: 'India',
    route:
      'Delhi (Old Delhi food walk, Red Fort) → Agra (Taj Mahal at sunrise) → Jaipur (the Pink City, Amber Fort) — the Golden Triangle. Trains and private drivers between cities, the metro in Delhi, and heritage guesthouses and family hotels to stay in.',
  },
  portugal: {
    display: 'Portugal',
    route:
      'Lisbon (Alfama, tram 28, pastéis de nata) → Porto (Douro wine, the riverside) → Sintra (fairytale palaces). Trains between cities, metro and tram day passes inside them, and hostels and family guesthouses to stay in.',
  },
  uk: {
    display: 'UK',
    route:
      'London (the Tower, Borough Market, the West End) → Bath (Roman Baths, Georgian streets) → Edinburgh (the Castle, the Royal Mile). Trains between cities, a Tube day pass in London, and hostels and small hotels to stay in.',
  },
  mexico: {
    display: 'Mexico',
    route:
      'Mexico City (Zócalo, Frida Kahlo Museum, street tacos) → Oaxaca (markets, mezcal) → Tulum (Mayan ruins, cenotes). Domestic flights or ADO buses between cities, the metro in Mexico City, and guesthouses and boutique hotels to stay in.',
  },
  usa: {
    display: 'USA',
    route:
      'New York (Central Park, food from every corner of the world) → San Francisco (the Bay, cable cars) → Los Angeles (beaches, studios). Domestic flights between cities, the subway in New York, and motels and budget hotels to keep the stay affordable.',
  },
  centraleurope: {
    display: 'Central Europe',
    route:
      'Prague (Old Town, Prague Castle) → Vienna (Schönbrunn Palace, coffee houses) → Budapest (thermal baths, ruin bars, the Danube). Trains between cities (Prague → Vienna about 4 hours, Vienna → Budapest about 2.5), metro and tram day passes inside them, and social hostels and family guesthouses to stay in.',
  },
};

// Aliases that point at a route-map key (checked the same way as the key).
const COUNTRY_ALIASES: Record<string, string> = {
  england: 'uk',
  britain: 'uk',
  'united states': 'usa',
  america: 'usa',
  'united kingdom': 'uk',
  'central europe': 'centraleurope',
  'eastern europe': 'centraleurope',
  'southeast asia': 'southeastasia',
  'south east asia': 'southeastasia',
};

// Well-known cities — the traveler names a city, not a country, and the
// fallback must not ask "which city?" when one was already given (Nov 10
// overnight campaign: "book a flight to paris" looped on the ask). Each
// city maps to its country's route; the destination stays the city the
// traveler named.
const CITY_TO_COUNTRY: Record<string, { country: string; display: string }> = {
  paris: { country: 'france', display: 'Paris' },
  rome: { country: 'italy', display: 'Rome' },
  london: { country: 'uk', display: 'London' },
  tokyo: { country: 'japan', display: 'Tokyo' },
  bangkok: { country: 'thailand', display: 'Bangkok' },
  cairo: { country: 'egypt', display: 'Cairo' },
  barcelona: { country: 'spain', display: 'Barcelona' },
  madrid: { country: 'spain', display: 'Madrid' },
  athens: { country: 'greece', display: 'Athens' },
  lisbon: { country: 'portugal', display: 'Lisbon' },
  istanbul: { country: 'turkey', display: 'Istanbul' },
  marrakech: { country: 'morocco', display: 'Marrakech' },
  delhi: { country: 'india', display: 'Delhi' },
  mumbai: { country: 'india', display: 'Mumbai' },
  'mexico city': { country: 'mexico', display: 'Mexico City' },
  'new york': { country: 'usa', display: 'New York' },
  'los angeles': { country: 'usa', display: 'Los Angeles' },
  'san francisco': { country: 'usa', display: 'San Francisco' },
  venice: { country: 'italy', display: 'Venice' },
  florence: { country: 'italy', display: 'Florence' },
  seville: { country: 'spain', display: 'Seville' },
  osaka: { country: 'japan', display: 'Osaka' },
  luxor: { country: 'egypt', display: 'Luxor' },
  aswan: { country: 'egypt', display: 'Aswan' },
  'sharm el sheikh': { country: 'egypt', display: 'Sharm El Sheikh' },
  prague: { country: 'centraleurope', display: 'Prague' },
  vienna: { country: 'centraleurope', display: 'Vienna' },
  budapest: { country: 'centraleurope', display: 'Budapest' },
  porto: { country: 'portugal', display: 'Porto' },
  sintra: { country: 'portugal', display: 'Sintra' },
};

// Route stops for the trip card (Layla-style): the cities of each route in
// order, with a weight that sets how the nights are shared. The weights
// are the trip card's shape — e.g. Central Europe 4/3/6 nights over
// 13 nights matches the 14-day Layla-style flow exactly. Nights are
// distributed from the trip length (see distributeNights), never invented
// per city. A route key with no stops here renders as a single-city card.
export const ROUTE_STOPS: Record<string, Array<{ city: string; country: string; weight: number }>> = {
  europe: [
    { city: 'Lisbon', country: 'Portugal', weight: 3 },
    { city: 'Madrid', country: 'Spain', weight: 2 },
    { city: 'Barcelona', country: 'Spain', weight: 2 },
    { city: 'Paris', country: 'France', weight: 3 },
    { city: 'Rome', country: 'Italy', weight: 3 },
    { city: 'Athens', country: 'Greece', weight: 2 },
  ],
  centraleurope: [
    { city: 'Prague', country: 'Czech Republic', weight: 4 },
    { city: 'Vienna', country: 'Austria', weight: 3 },
    { city: 'Budapest', country: 'Hungary', weight: 6 },
  ],
  portugal: [
    { city: 'Lisbon', country: 'Portugal', weight: 4 },
    { city: 'Porto', country: 'Portugal', weight: 3 },
    { city: 'Sintra', country: 'Portugal', weight: 2 },
  ],
  egypt: [
    { city: 'Cairo', country: 'Egypt', weight: 3 },
    { city: 'Luxor', country: 'Egypt', weight: 3 },
    { city: 'Aswan', country: 'Egypt', weight: 2 },
    { city: 'Sharm El Sheikh', country: 'Egypt', weight: 3 },
  ],
  japan: [
    { city: 'Tokyo', country: 'Japan', weight: 3 },
    { city: 'Kyoto', country: 'Japan', weight: 4 },
    { city: 'Osaka', country: 'Japan', weight: 2 },
  ],
  italy: [
    { city: 'Rome', country: 'Italy', weight: 4 },
    { city: 'Florence', country: 'Italy', weight: 3 },
    { city: 'Venice', country: 'Italy', weight: 3 },
  ],
  france: [
    { city: 'Paris', country: 'France', weight: 4 },
    { city: 'Loire Valley', country: 'France', weight: 2 },
    { city: 'Nice', country: 'France', weight: 3 },
  ],
  spain: [
    { city: 'Barcelona', country: 'Spain', weight: 3 },
    { city: 'Seville', country: 'Spain', weight: 3 },
    { city: 'Madrid', country: 'Spain', weight: 3 },
  ],
  greece: [
    { city: 'Athens', country: 'Greece', weight: 3 },
    { city: 'Santorini', country: 'Greece', weight: 3 },
    { city: 'Crete', country: 'Greece', weight: 3 },
  ],
  thailand: [
    { city: 'Bangkok', country: 'Thailand', weight: 3 },
    { city: 'Chiang Mai', country: 'Thailand', weight: 3 },
    { city: 'Krabi', country: 'Thailand', weight: 3 },
  ],
  // Warm winter escape (Nov 11): the route the AI recommends for "warm,
  // culture, safe, food, surprise me" — Bangkok 4 / Siem Reap 3 / Hanoi
  // 7 nights over a 15-day trip, matching the sketch the AI gives.
  southeastasia: [
    { city: 'Bangkok', country: 'Thailand', weight: 4 },
    { city: 'Siem Reap', country: 'Cambodia', weight: 3 },
    { city: 'Hanoi', country: 'Vietnam', weight: 8 },
  ],
  turkey: [
    { city: 'Istanbul', country: 'Turkey', weight: 4 },
    { city: 'Cappadocia', country: 'Turkey', weight: 3 },
    { city: 'Antalya', country: 'Turkey', weight: 3 },
  ],
  morocco: [
    { city: 'Marrakech', country: 'Morocco', weight: 3 },
    { city: 'Fes', country: 'Morocco', weight: 3 },
    { city: 'Chefchaouen', country: 'Morocco', weight: 2 },
  ],
  india: [
    { city: 'Delhi', country: 'India', weight: 3 },
    { city: 'Agra', country: 'India', weight: 2 },
    { city: 'Jaipur', country: 'India', weight: 3 },
  ],
  uk: [
    { city: 'London', country: 'United Kingdom', weight: 4 },
    { city: 'Bath', country: 'United Kingdom', weight: 2 },
    { city: 'Edinburgh', country: 'United Kingdom', weight: 3 },
  ],
  mexico: [
    { city: 'Mexico City', country: 'Mexico', weight: 4 },
    { city: 'Oaxaca', country: 'Mexico', weight: 3 },
    { city: 'Tulum', country: 'Mexico', weight: 3 },
  ],
  usa: [
    { city: 'New York', country: 'USA', weight: 3 },
    { city: 'San Francisco', country: 'USA', weight: 3 },
    { city: 'Los Angeles', country: 'USA', weight: 3 },
  ],
};

// Share the trip's nights across the route stops by weight, so the nights
// always add up exactly to days - 1 (a 14-day trip is 13 nights). The
// longest stay absorbs the rounding difference.
export function distributeNights(
  routeKey: string,
  days: number
): Array<{ city: string; country: string; nights: number }> {
  const stops = ROUTE_STOPS[routeKey];
  if (!stops || !stops.length) return [];
  const totalNights = Math.max(stops.length, days - 1);
  const totalW = stops.reduce((s, x) => s + x.weight, 0);
  const nights = stops.map((x) => Math.max(1, Math.round((totalNights * x.weight) / totalW)));
  let diff = totalNights - nights.reduce((s, n) => s + n, 0);
  while (diff > 0) {
    const i = nights.indexOf(Math.max(...nights));
    nights[i] += 1;
    diff -= 1;
  }
  while (diff < 0) {
    const candidates = nights.map((n, i) => (n > 1 ? i : -1)).filter((i) => i >= 0);
    if (!candidates.length) break;
    const i = candidates.reduce((a, b) => (nights[a] >= nights[b] ? a : b));
    nights[i] -= 1;
    diff += 1;
  }
  return stops.map((x, idx) => ({ city: x.city, country: x.country, nights: nights[idx] }));
}

// Route key for a destination display name ('Europe' → 'europe',
// 'Central Europe' → 'centraleurope', 'Kyoto' → '' — a single city has
// no multi-stop route). Used by the trip card and the Trip Summary.
export function routeKeyForDestination(destination: string): string {
  const lower = destination.toLowerCase();
  const match = Object.entries(COUNTRY_ROUTES).find(
    ([, v]) => v.display.toLowerCase() === lower
  );
  return match ? match[0] : '';
}

// Month names, for the guided flow and the trip card's suggested dates.
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Month of travel (1-12) from the conversation, or 0. Month names win
// over seasons ("this winter in january" is January, not winter);
// a bare season maps to its middle month (winter → January, spring →
// April, summer → July, autumn → October).
export function findMonth(text: string): number {
  const lower = text.toLowerCase();
  const patterns = [
    /\bjan(?:uary)?\b/, /\bfeb(?:ruary)?\b/, /\bmar(?:ch)?\b/, /\bapr(?:il)?\b/,
    /\bmay\b/, /\bjun(?:e)?\b/, /\bjul(?:y)?\b/, /\baug(?:ust)?\b/,
    /\bsep(?:t(?:ember)?)?\b/, /\boct(?:ober)?\b/, /\bnov(?:ember)?\b/, /\bdec(?:ember)?\b/,
  ];
  for (let i = 0; i < patterns.length; i++) if (patterns[i].test(lower)) return i + 1;
  if (/\bwinter\b/.test(lower)) return 1;
  if (/\bspring\b/.test(lower)) return 4;
  if (/\bsummer\b/.test(lower)) return 7;
  if (/\bautumn\b|\bfall\b/.test(lower)) return 10;
  return 0;
}

// Trip length in days, or 0. "14 days" → 14, "2 weeks" → 14, "a week" → 7.
export function parseDuration(text: string): number {
  const lower = text.toLowerCase();
  const m = lower.match(/(\d+)\s*(?:days?|nights?)\b/);
  if (m) return Math.min(30, Math.max(1, parseInt(m[1], 10)));
  const w = lower.match(/(\d+)\s*weeks?\b/);
  if (w) return Math.min(30, Math.max(1, parseInt(w[1], 10) * 7));
  if (/\btwo weeks\b/.test(lower)) return 14;
  if (/\ba week\b|\bone week\b/.test(lower)) return 7;
  return 0;
}

// Bare-city answer to "where are you flying from?" — the traveler
// answers "yes new york" or just "nyc" instead of "from New York".
// Only for short answers (the current message), never for the joined
// history: a city named anywhere else could be the destination.
const ORIGIN_CITIES = [
  'new york', 'nyc', 'london', 'paris', 'los angeles', 'chicago', 'boston',
  'toronto', 'san francisco', 'miami', 'atlanta', 'dallas', 'houston',
  'seattle', 'denver', 'washington', 'philadelphia', 'dubai', 'singapore',
  'sydney', 'tokyo', 'hong kong', 'amsterdam', 'berlin', 'rome', 'madrid',
];
export function findOriginAnswer(text: string): string {
  const t = text
    .toLowerCase()
    .trim()
    .replace(/^(yes|yeah|yep|sure|ok|okay|from),?\s+/, '');
  if (!t || t.split(/\s+/).length > 4) return '';
  for (const c of ORIGIN_CITIES) {
    if (new RegExp(`\\b${escapeRegExp(c)}\\b`).test(t)) {
      if (c === 'nyc') return 'NYC';
      return c
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return '';
}

// Word-boundary matching for place names: plain substring matching
// false-positives ("paris" inside "comparison", "uk" inside "souk").
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lastWordMatch(lower: string, needle: string): number {
  const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'g');
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) idx = m.index;
  return idx;
}

// The LAST place mentioned in the conversation wins — "Kyoto, actually
// let's do Thailand instead" means Thailand, not Kyoto. Returns the
// display name ('Egypt', 'Kyoto', 'Europe') or '' when nothing is named.
function lastIndexOfAny(lower: string, needles: string[]): number {
  let best = -1;
  for (const n of needles) {
    const idx = lastWordMatch(lower, n);
    if (idx > best) best = idx;
  }
  return best;
}

export function findCountry(lower: string): string {
  // Every candidate mention with its start and length. The last mention
  // wins — but a multi-word phrase that contains a later single-word
  // match ("central europe" contains "europe") is ONE mention, and the
  // longer phrase wins: without this, "14 days, central europe" resolved
  // to Europe, because the "europe" inside "central europe" starts later.
  type Cand = { key: string; start: number; len: number };
  const cands: Cand[] = [];
  const add = (needle: string, key: string) => {
    const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) cands.push({ key, start: m.index, len: needle.length });
  };
  for (const key of Object.keys(COUNTRY_ROUTES)) add(key, key);
  for (const [alias, key] of Object.entries(COUNTRY_ALIASES)) add(alias, key);
  if (!cands.length) return '';
  cands.sort((a, b) => b.start - a.start || b.len - a.len);
  const top = cands[0];
  const container = cands.find((c) => c.start < top.start && c.start + c.len >= top.start + top.len);
  return container ? container.key : top.key;
}

export function findCity(lower: string): string {
  let bestKey = '';
  let bestIdx = -1;
  for (const key of Object.keys(CITY_TO_COUNTRY)) {
    const idx = lastWordMatch(lower, key);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestKey = key;
    }
  }
  return bestKey;
}

// Last place mentioned overall: a known planner destination, a country
// from the route map, or a well-known city — or '' — used by the route
// for the voices fetch and the durable trip memory. Bare regions (Asia,
// Africa…) are deliberately NOT returned: they are too vague to plan or
// fetch voices for.
export function lastPlaceMentioned(text: string): string {
  const lower = text.toLowerCase();
  const knownIdx = lastIndexOfAny(lower, Object.keys(BASE).map((d) => d.toLowerCase()));
  const countryKey = findCountry(lower);
  const countryIdx = countryKey
    ? lastIndexOfAny(lower, [countryKey, ...Object.entries(COUNTRY_ALIASES).filter(([, k]) => k === countryKey).map(([a]) => a)])
    : -1;
  const cityKey = findCity(lower);
  const cityIdx = cityKey ? lastWordMatch(lower, cityKey) : -1;
  if (knownIdx === -1 && countryIdx === -1 && cityIdx === -1) return '';
  if (knownIdx >= countryIdx && knownIdx >= cityIdx) {
    return Object.keys(BASE).find((d) => lastWordMatch(lower, d.toLowerCase()) === knownIdx) ?? '';
  }
  // On a tie (e.g. "mexico city": country 'mexico' and city 'mexico city'
  // both start at index 0) the more specific match wins — the city.
  if (countryIdx > cityIdx) return COUNTRY_ROUTES[countryKey].display;
  return CITY_TO_COUNTRY[cityKey].display;
}

// Party size: the LAST signal in the conversation wins — "it's just me"
// then "now we're 4" means 4, not 1. Bare numbers count when they are
// clearly a party size ("we're 4", "party of 4", "4 of us").
function parseTravelers(lower: string): number {
  const signals: Array<{ index: number; value: number }> = [];
  const numRe = /(\d+)\s*(people|travelers|traveler|adults|person|of us)/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(lower))) signals.push({ index: m.index, value: parseInt(m[1], 10) });
  const bareRe = /\b(?:we'?re|we are)\s+(\d+)\b|\bparty of\s+(\d+)\b/g;
  while ((m = bareRe.exec(lower))) signals.push({ index: m.index, value: parseInt(m[1] ?? m[2], 10) });
  const wordRes: Array<[RegExp, number]> = [
    [/\bsolo\b|\balone\b|\bjust me\b/g, 1],
    [/\bcouple\b/g, 2],
  ];
  for (const [re, value] of wordRes) {
    const r = new RegExp(re.source, 'g');
    let mm: RegExpExecArray | null;
    while ((mm = r.exec(lower))) signals.push({ index: mm.index, value });
  }
  if (!signals.length) return 2;
  signals.sort((a, b) => a.index - b.index);
  return Math.min(9, Math.max(1, signals[signals.length - 1].value));
}

// --- Family / kids (competitor learning, Nov 11: Yopki) ----------------
// Kids' ages from the conversation: "kids ages 4, 7, 11", "aged 5 and 8",
// "a 4-year-old", "kids 4 and 7". Returns the ages in order, 0–17 only,
// max 6 — never more than a family can plausibly name.
export function parseKidAges(text: string): number[] {
  const lower = text.toLowerCase();
  const ages: number[] = [];
  const push = (n: number) => {
    if (Number.isInteger(n) && n >= 0 && n <= 17 && ages.length < 6 && !ages.includes(n)) ages.push(n);
  };
  const listRe = /\bages?\s*(?:of\s*)?(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)/g;
  let m: RegExpExecArray | null;
  while ((m = listRe.exec(lower))) {
    for (const part of m[1].split(/,|and|&/)) push(parseInt(part.trim(), 10));
  }
  const yearOldRe = /(\d{1,2})\s*(?:-|–)?\s*year[ -]?olds?\b/g;
  while ((m = yearOldRe.exec(lower))) push(parseInt(m[1], 10));
  const kidsListRe = /\bkids?\s+(?:aged\s+)?(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)/g;
  while ((m = kidsListRe.exec(lower))) {
    for (const part of m[1].split(/,|and|&/)) push(parseInt(part.trim(), 10));
  }
  return ages.sort((a, b) => a - b);
}

// Party composition: adults + kids. "2 adults, 3 kids" is 5 travelers,
// not 2 — parseTravelers alone only sees the "2 adults" signal. Ages win
// when given ("kids ages 4, 7, 11" is 3 kids); a bare count ("3 kids")
// gives the count with ages unknown (the chat then asks for the ages).
// "family of 5" with no breakdown is 5. Everything else falls back to
// parseTravelers, so solo/couple/bare-number behavior is unchanged.
export function parseParty(text: string): { adults: number; kids: number; kidAges: number[] } {
  const lower = text.toLowerCase();
  const kidAges = parseKidAges(lower);
  const kidCountM = lower.match(/(\d+)\s*(?:kids?|children)\b/);
  const kids = kidAges.length > 0 ? kidAges.length : kidCountM ? Math.min(6, parseInt(kidCountM[1], 10)) : 0;
  const adultM = lower.match(/(\d+)\s*adults?\b/);
  const adults = adultM ? Math.min(9, parseInt(adultM[1], 10)) : 0;
  const familyOfM = lower.match(/\bfamily of\s+(\d+)\b/);
  return {
    adults,
    kids,
    kidAges,
    ...(familyOfM && !adults && !kids ? { familyOf: Math.min(9, parseInt(familyOfM[1], 10)) } : {}),
  } as { adults: number; kids: number; kidAges: number[]; familyOf?: number };
}

// Travelers from the party composition. Explicit adults + kids sum;
// otherwise the existing parseTravelers result. A kids-only mention
// ("3 kids") assumes the usual 2 adults + kids unless the traveler says
// solo — the Trip Summary shows the count, so the traveler can correct it.
export function travelersFromParty(text: string): number {
  const party = parseParty(text);
  if (party.adults > 0 && party.kids > 0) return Math.min(9, party.adults + party.kids);
  if (party.familyOf) return party.familyOf;
  if (party.kids > 0) {
    return /\bsolo\b|\balone\b|\bjust me\b/.test(text.toLowerCase())
      ? Math.min(9, 1 + party.kids)
      : Math.min(9, Math.max(parseTravelers(text.toLowerCase()), party.kids + 2));
  }
  return parseTravelers(text.toLowerCase());
}

// Family pace: one honest line for the reply and the trip card, derived
// from the YOUNGEST kid's age — never invented venue names, just the pace
// the plan should keep (activities per day, downtime, walking distance).
export function familyPaceLine(kids: number[]): string {
  if (!kids?.length) return '';
  const youngest = Math.min(...kids);
  const ages = kids.map((a) => String(a)).join(', ');
  if (youngest < 5)
    return `Family pace for kids ages ${ages}: slow days, 2 major activities a day, a nap or downtime after lunch, and kid-friendly restaurants near each stop — stroller-friendly where it matters.`;
  if (youngest <= 11)
    return `Family pace for kids ages ${ages}: 2–3 activities a day with buffers between them, kid-friendly restaurants near each stop, and realistic walking distances.`;
  return `Teen pace for kids ages ${ages}: full days are fine, with a mix of sights and something active.`;
}

// Regions count as travel too — "europe, january" names a place and a
// month, and must reach the recommend rule, not the off-topic decline
// (the Nov 10 Europe bug came back in exactly this form). Bare regions
// are travel signals, but they are NOT destinations: lastPlaceMentioned
// deliberately leaves them out (too vague to plan or fetch voices for).
const REGIONS = ['europe', 'asia', 'africa', 'america', 'caribbean', 'mediterranean', 'oceania', 'middle east', 'southeast asia', 'south east asia'];

// "Open to anything" phrases are travel intent in this chat — the whole
// UI is a travel planner, so "surprise me" means "surprise me with a
// trip". They must pass the travel gate, or the recommend branch below
// can never be reached (Nov 10: "surprise me" was declined as off-topic).
const OPEN_PHRASES =
  /surprise me|whatever you (suggest|recommend)|i'?m open|open to (do )?anything|open to everything|up for anything|anything works/;

// Off-topic is judged on the CURRENT message only (see askFujin). These
// are unambiguous non-travel topics — a bare word like "news" is left out
// ("any news on my flight?" is travel).
const OFF_TOPIC = [
  'election',
  'who will win',
  'homework',
  'coding',
  'python',
  'javascript',
  'politics',
  'president',
  'news today',
  "what's the news",
  'stock market',
  'crypto',
  'bitcoin',
  'write code',
];

// True when a message is unambiguously off-topic — used by the route so
// a decline is never undone by the context-destination override below.
export function isOffTopicMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return OFF_TOPIC.some((w) => lower.includes(w));
}

function isTravel(text: string): boolean {
  const lower = text.toLowerCase();
  if (Object.keys(BASE).some((d) => lower.includes(d.toLowerCase()))) return true;
  if (REGIONS.some((r) => lower.includes(r))) return true;
  if (findCountry(lower)) return true;
  if (findCity(lower)) return true;
  if (OPEN_PHRASES.test(lower)) return true;
  return TRAVEL_WORDS.some((w) => lower.includes(w));
}

// --- Plan PDF helpers -----------------------------------------------------
// Options line: the chat reply must carry real value — the 3 tier prices
// with a clear pick — so the traveler can choose before asking for the
// plan. Used by the built-in fallback (route + page local fallback); the
// live model already quotes the Best value total from its prompt.
export function optionsLine(destination: string, travelers: number): string {
  const opts = buildPlan(destination, travelers, 3).options;
  return `Your options for ${destination} (${travelers} traveler${travelers > 1 ? 's' : ''}): Cheapest $${opts[0].total.toLocaleString()} · Best value $${opts[1].total.toLocaleString()} ★ our pick · Premium $${opts[2].total.toLocaleString()}. Tap Build my plan to pick one.`;
}

// Departure city (origin): the flight fare depends on where the traveler
// flies from, so the AI must ask for it when it is missing (Nov 11 review:
// a Europe plan was priced without ever asking where the traveler flies
// from). Matches "from NYC", "from New York", "flying out of London",
// "departing from Paris". Returns '' when nothing was said.
const ORIGIN_STOPWORDS = new Set(['me', 'us', 'there', 'home', 'here', 'scratch', 'now', 'today', 'tomorrow']);
const ORIGIN_TRAILING = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'next', 'this', 'in', 'on', 'at',
]);

export function findOrigin(text: string): string {
  const lower = text.toLowerCase();
  const m = lower.match(/\b(?:from|out of|depart(?:ing|s)? from|leav(?:e|ing) from)\s+([a-z]+(?:\s+[a-z]+)?)/);
  if (!m) return '';
  const words = m[1].trim().split(/\s+/);
  while (words.length > 1 && ORIGIN_TRAILING.has(words[words.length - 1])) words.pop();
  if (words.length === 0 || ORIGIN_STOPWORDS.has(words[0])) return '';
  if (words.length === 1 && /^[a-z]{2,4}$/.test(words[0])) return words[0].toUpperCase();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function askFujin(
  text: string,
  defaultTravelers = 2,
  contextDestination = '',
  currentMessage = '',
  contextOrigin = ''
): { destination: string; travelers: number; reply: string; missing: string[]; needsMore: boolean; kids?: number[] } {
  // Off-topic is judged on the CURRENT message only. The joined history
  // would make any message look like travel — "who will win the election?"
  // after an Egypt chat came back as an Egypt route (Nov 10 overnight
  // campaign). A follow-up like "make it cheaper" has no travel words of
  // its own, so the travel gate below still uses the joined text.
  const current = (currentMessage || text).toLowerCase();
  // A greeting is not off-topic — it is how a new visitor starts. Answer
  // warmly and ask where they want to go, instead of the cold travel-only
  // decline (Nov 11: a pasted live chat opened with "hello" and got told
  // off). No trip yet, so the destination stays empty.
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|yo)\b/.test(current.trim()) && !contextDestination) {
    return {
      destination: '',
      travelers: 2,
      reply: "Hi there! I'm Fujin AI, your travel planner. Where are you dreaming of going next?",
      missing: ['Destination'],
      needsMore: true,
    };
  }
  if (OFF_TOPIC.some((w) => current.includes(w))) {
    return {
      destination: '',
      travelers: 2,
      reply: 'I only help with travel and trip planning — where would you like to go?',
      missing: ['Destination'],
      needsMore: false,
    };
  }
  if (!isTravel(text)) {
    return {
      destination: '',
      travelers: 2,
      reply: 'I only help with travel and trip planning — where would you like to go?',
      missing: ['Destination'],
      needsMore: false,
    };
  }
  const lower = text.toLowerCase();
  // The LAST place mentioned wins — "Egypt, actually let's do Thailand"
  // means Thailand. contextDestination is the trip already established
  // (from tripState): it fills in only when this message and the visible
  // history name nothing, so a 10+ turn conversation never loses the trip.
  // Trip stickiness: an established trip does NOT flip because a follow-up
  // mentions a city inside it ("hotels in Lisbon?" on a Europe trip stays
  // Europe). Only an explicit switch ("actually let's do Thailand
  // instead") changes the destination.
  const currentLower = (currentMessage || text).toLowerCase();
  const isSwitch =
    /\bactually\b|\binstead\b|\bchange\b|\bswitch\b|\blet'?s do\b|\brather\b/.test(currentLower);
  const place = lastPlaceMentioned(lower);
  // Answering the region question ("Central Europe or Portugal?") with
  // "central europe" is not a trip switch — but it IS the answer, so it
  // must win over the bare "Europe" the context holds. A city follow-up
  // ("hotels in Lisbon?") must not: only a region-level answer (a
  // country/region display name) overrides the context.
  const currentPlace = currentMessage ? lastPlaceMentioned(currentMessage.toLowerCase()) : '';
  const isRegionAnswer =
    contextDestination === 'Europe' &&
    currentPlace !== '' &&
    Object.values(COUNTRY_ROUTES).some((v) => v.display === currentPlace);
  const effectivePlace = contextDestination && currentMessage && !isSwitch && !isRegionAnswer ? '' : place;
  let known = effectivePlace && Object.keys(BASE).includes(effectivePlace) ? effectivePlace : '';
  let routeKey = '';
  let display = '';
  const resolvePlace = (p: string) => {
    if (!p || known || routeKey) return;
    const ck = Object.keys(COUNTRY_ROUTES).find((k) => COUNTRY_ROUTES[k].display === p);
    if (ck) {
      routeKey = ck;
      display = p;
      return;
    }
    const cityK = Object.keys(CITY_TO_COUNTRY).find((k) => CITY_TO_COUNTRY[k].display === p);
    if (cityK) {
      routeKey = CITY_TO_COUNTRY[cityK].country;
      display = p;
    }
  };
  resolvePlace(effectivePlace);
  if (!effectivePlace && contextDestination) {
    const ctxPlace = lastPlaceMentioned(contextDestination.toLowerCase());
    if (ctxPlace && Object.keys(BASE).includes(ctxPlace)) known = ctxPlace;
    else resolvePlace(ctxPlace);
  }
  const hasPartySignal =
    /(\d+)\s*(people|travelers|traveler|adults|person|of us)|\b(?:we'?re|we are)\s+\d+\b|\bparty of\s+\d+\b|\bsolo\b|\balone\b|\bjust me\b|\bcouple\b/.test(
      lower
    );
  // Family: adults + kids sum ("2 adults, 3 kids" is 5 travelers), ages
  // set the pace. travelersFromParty falls back to the existing parser,
  // so solo/couple/bare-number behavior is unchanged.
  const party = parseParty(lower);
  const kidAges = party.kidAges;
  const kidCount = party.kids;
  const hasKids = kidCount > 0;
  const travelers = hasPartySignal || hasKids ? travelersFromParty(lower) : defaultTravelers;
  const familyNote = familyPaceLine(kidAges);
  // Guided slots (Layla-style, Nov 11): the month, the trip length and
  // the departure city are what the trip card is built from, so the
  // conversation collects them one question at a time instead of dumping
  // a full plan over a half-known trip.
  const month = findMonth(lower);
  const duration = parseDuration(lower);
  // Origin: from the conversation ("from NYC"), from a bare-city answer
  // ("yes new york"), or from the trip state the page/server already
  // collected. The origin is passed as context, never appended to the
  // text: appending "(flying from New York)" put New York at the END of
  // the text, so lastPlaceMentioned made it the DESTINATION (Nov 11).
  const origin =
    findOrigin(text) ||
    (currentMessage ? findOriginAnswer(currentMessage) : '') ||
    (contextOrigin || '');
  const hasBudget = /\$\s?\d|budget|economy|cheapest|affordable|cheap/.test(lower);
  // Europe with no scope ("5 countries", "central europe", "portugal")
  // still needs a choice: Central Europe or Portugal. A scoped request
  // ("5 main countries") already has its route — don't narrow it.
  const regionQuestion =
    display === 'Europe' &&
    !/\b\d+\s*(countries|stops|cities)\b/.test(lower) &&
    !/central europe|eastern europe|portugal|lisbon|porto|sintra/.test(lower);
  const missing: string[] = [];
  if (!month) missing.push('Dates');
  if (!hasBudget) missing.push('Budget');
  if (!/slow|fast|relax|adventure|food|surf|hike|culture/.test(lower)) missing.push('Pace');
  // Kids' ages: the ages set the pace (nap times for under-5s, 2–3
  // activities a day for older kids), so ask them once the party has
  // kids but no ages were given.
  if (hasKids && kidAges.length === 0) missing.push("Kids' ages");
  // Departure city: the flight fare depends on where the traveler flies
  // from, so ask for it when planning a trip and it was never said
  // (Nov 11 review: a Europe plan was priced without ever asking).
  // Not for on-trip questions ("where should I eat tonight?") — those
  // need no departure city.
  const planningTrip = /plan|trip|flight|fly to|go to|travel to|visit|book|itinerary|holiday|vacation/.test(lower);
  const onTripNow = /tonight|right now|open now|where should (i|we) eat/.test(lower);
  if (planningTrip && !onTripNow && !origin) missing.push('Departure city');
  // Duration gates the trip card (nights per city), so it is a real
  // missing item when planning — but never for a food/on-trip question.
  const needsDuration = planningTrip && !onTripNow && (known || routeKey) && !duration;
  if (needsDuration) missing.push('Duration');
  // One question at a time, in Layla's order: region (Europe only),
  // when + how long, flying from, budget when unknown. Never a wall of
  // text or a full plan before the details exist. Kids' ages come right
  // after the region choice — the pace depends on them.
  const nextQuestion = (): string => {
    if (regionQuestion)
      return `Europe on a solo budget? Absolutely — we can stretch those dollars and still hit incredible historic sights, buzzing hostels, and top-tier street food. Which vibe sounds better for you — Central Europe (Prague, Vienna, Budapest: winter wonderland, thermal baths, dirt-cheap beer and food) or sunny Portugal (Lisbon & Porto: mild winter, great food, coastal viewpoints)?`;
    if (hasKids && kidAges.length === 0)
      return `How old are the kids? (For example: 4, 7 and 11 — the ages set the pace: nap times and downtime for the little ones, 2–3 activities a day for older kids.)`;
    if (!month && !duration)
      return `When are you thinking of going, and for how long? (For example: January, 14 days.)`;
    if (!month) return `When are you thinking of going? (For example: January, or next spring.)`;
    if (!duration) return `How many days would you like your trip to be? (For example: 7, 10, or 14 days?)`;
    if (!origin) return `Where will you be flying out from?`;
    if (!hasBudget) return `Roughly what budget do you have in mind for the trip?`;
    return '';
  };
  // Trip Summary (Layla's "Does this sound like the dream winter
  // route?"): route, dates, style, travelers — then the traveler confirms
  // and taps Build my plan. Nights come from distributeNights, so the
  // summary and the trip card always agree. The separator between cities
  // is the way you travel between them (trains in Europe, flights in
  // Southeast Asia) — the trip card's LEG_MODE says the same, mirrored
  // here because planner.ts must not import tripCard.ts (circular).
  const ROUTE_SEPARATOR: Record<string, string> = {
    southeastasia: '✈️',
    turkey: '✈️',
    mexico: '✈️',
    greece: '⛴️',
  };
  const tripSummary = (dest: string, route: string): string => {
    const legs = route ? distributeNights(route, duration || 14) : [];
    const sep = (ROUTE_SEPARATOR[route] ?? '🚆');
    const routeLine =
      legs.length > 1
        ? `${origin ? `${origin} ✈️ ` : ''}${legs.map((l) => `${l.city} (${l.nights} nights)`).join(` ${sep} `)}${origin ? ` ✈️ ${origin}` : ''}`
        : legs.length === 1
          ? `${origin ? `${origin} ✈️ ` : ''}${legs[0].city}`
          : dest;
    const monthName = month ? MONTH_NAMES[month - 1] : '';
    return `Here is your trip — ${routeLine}\n${monthName ? `${monthName} · ` : ''}${duration || 14} days · ${travelers} traveler${travelers > 1 ? 's' : ''}${origin ? ` · flying from ${origin}` : ''} · budget style, hostels and guesthouses, public transport.${familyNote ? ` ${familyNote}` : ''} Does this sound right? Tap Build my plan to generate the full trip card — then pick your flights and stays on the map next to the chat.`;
  };
  const isConfirmation = /^(yes|yeah|yep|sure|ok|okay|looks great|looks good|perfect|sounds good|sounds great|build it|let'?s build|go ahead|do it|great|love it)\b/.test(
    currentLower.trim()
  );
  if (!known) {
    // RECOMMEND — the traveler gave constraints but no destination, or said
    // they have nothing in mind / are open to anything. Propose a route
    // that fits instead of asking again or declining (Nov 10 Europe bug,
    // Nov 10 Egypt bug: both were declined or asked in a loop).
    // A proposal is not a silent default: the reply says it's a suggestion
    // the traveler can change.
    const noIdea =
      /nothing in mind|don'?t know|no idea|anywhere|not sure|don'?t mind|first time|first timer|first trip|open to (do )?anything|open to everything|whatever you (suggest|recommend)|surprise me|i'?m open|up for anything|anything works/.test(
        lower
      );
    const wantsCheap = /budget|cheap|affordable|low cost|economy|cheapest/.test(lower);
    if (routeKey) {
      // Bare "Europe" still needs the region choice before any route is
      // proposed — proposing the 5-country loop AND asking Central vs
      // Portugal in the same breath would contradict itself.
      if (regionQuestion) {
        return { destination: display, travelers, reply: nextQuestion(), missing, needsMore: true, kids: kidAges };
      }
      const route = COUNTRY_ROUTES[routeKey];
      let routeText = route.route;
      // Season notes, only when the traveler named the month — a January
      // line on a July trip would be wrong.
      if (routeKey === 'europe' && /\bjan/.test(lower))
        routeText = `January is actually a smart choice for a first trip: fewer crowds, lower prices, and the south stays mild. ${routeText}`;
      if (routeKey === 'egypt' && /\bmar/.test(lower))
        routeText = `March is a great month for Egypt — warm days, cool evenings, and the desert is not too hot for the tombs yet. ${routeText}`;
      const q = nextQuestion();
      if (q) {
        return {
          destination: display,
          travelers,
          reply: `Here's a route that fits — ${routeText}${wantsCheap ? ' Since you asked for affordable, I’ll lead with the Cheapest option — hostels and guesthouses, public transport, and low-cost flights where they help.' : ''}${familyNote ? ` ${familyNote}` : ''} ${q}`,
          missing,
          needsMore: true,
          kids: kidAges,
        };
      }
      return {
        destination: display,
        travelers,
        reply: tripSummary(display, routeKey),
        missing,
        needsMore: false,
        kids: kidAges,
      };
    }
    if (noIdea) {
      // "Surprise me" / "open to anything" / "nothing in mind" is a
      // request to recommend, not to ask again. Best fit with no
      // destination anywhere: Bali (affordable + great food) — framed as
      // a suggestion the traveler can change. Except when the traveler
      // asked for WARMTH (Nov 11: "warm place... surprise me" got Bali,
      // which is fine, but the live model picked the warmer, more
      // cultural Southeast Asia route — the fallback should match it):
      // Bangkok → Siem Reap → Hanoi, warm in winter, rich culture, safe,
      // great food.
      const wantsWarm = /warm|warmth|winter sun|escape (the )?cold|sunny|hot weather|tropical/.test(lower);
      const q = nextQuestion();
      if (wantsWarm) {
        const proposal = `Here's a great first pick for warmth and culture — Southeast Asia: Bangkok (Grand Palace, floating markets, street food) → Siem Reap (Angkor Wat sunrise) → Hanoi (Old Quarter, pho). Warm in winter, safe to travel, and some of the best local food anywhere. Stay in social hostels and guesthouses, and get around by metro, tuk-tuk and short domestic flights.`;
        if (q) {
          return { destination: 'Southeast Asia', travelers, reply: `${proposal}${familyNote ? ` ${familyNote}` : ''} ${q}`, missing, needsMore: true, kids: kidAges };
        }
        return { destination: 'Southeast Asia', travelers, reply: tripSummary('Southeast Asia', 'southeastasia'), missing, needsMore: false, kids: kidAges };
      }
      const proposal = `Here's a great first pick — Bali: affordable flights and stays, and some of the best local food anywhere (warungs, night markets, Ubud). Stay in guesthouses and small hotels, and get around by scooter or Gojek/Grab instead of private cars — it's cheaper, and it's how locals travel.`;
      if (q) {
        return { destination: 'Bali', travelers, reply: `${proposal}${familyNote ? ` ${familyNote}` : ''} ${q}`, missing, needsMore: true, kids: kidAges };
      }
      return { destination: 'Bali', travelers, reply: tripSummary('Bali', ''), missing, needsMore: false, kids: kidAges };
    }
    // No constraints to recommend from — ask which city or country.
    return {
      destination: '',
      travelers,
      reply: `Got it — a trip for ${travelers} traveler${travelers > 1 ? 's' : ''}. Which city or country would you like to go to?`,
      missing: ['Destination', ...missing],
      needsMore: true,
    };
  }
  // Known destination (Kyoto, Bali, Paris...): still guided — ask the one
  // missing slot instead of dumping the plan over a half-known trip.
  const q = nextQuestion();
  if (q) {
    return {
      destination: known,
      travelers,
      reply: `Got it — ${known} for ${travelers} traveler${travelers > 1 ? 's' : ''}. ${q}`,
      missing,
      needsMore: true,
      kids: kidAges,
    };
  }
  if (isConfirmation) {
    return {
      destination: known,
      travelers,
      reply: `Great — your trip is set. Tap Build my plan below to generate the full trip card, then pick your flights and stays on the map next to the chat.`,
      missing,
      needsMore: false,
      kids: kidAges,
    };
  }
  return {
    destination: known,
    travelers,
    reply: tripSummary(known, ''),
    missing,
    needsMore: false,
    kids: kidAges,
  };
}
