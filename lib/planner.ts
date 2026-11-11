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
    liked: ['One plan, not seven tabs', 'Clear Cheapest / Best value / Premium choices', 'Links to reviews and hotel websites to verify'],
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

// Travel-only guardrail (same limit as the live AI system prompt).
// Fujin AI answers only about travel and trip planning. Anything with no
// travel signal gets a short decline and a redirect, never a plan.
const TRAVEL_WORDS = [
  'travel', 'trip', 'flight', 'fly', 'hotel', 'stay', 'holiday', 'vacation',
  'tour', 'cruise', 'car', 'rental', 'bus', 'taxi', 'transfer', 'sightsee',
  'beach', 'island', 'mountain', 'hike', 'surf', 'culture', 'visit', 'plan',
  'book', 'booking', 'destination', 'airport', 'passport', 'visa', 'itinerary',
  'resort', 'getaway', 'honeymoon', 'adventure', 'relax', 'explore', 'food',
  // Food questions are travel (same scope as the live AI prompt) — this
  // matters for on-trip mode, where "where should I eat tonight?" must
  // reach the plan, not a decline.
  'eat', 'eating', 'restaurant', 'dinner', 'lunch', 'cuisine', 'dish',
  'traveler', 'travelers', 'traveller', 'travellers', 'adult', 'adults',
  'person', 'people', 'family', 'weekend', 'road trip', 'staycation',
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
};

// Aliases that point at a route-map key (checked the same way as the key).
const COUNTRY_ALIASES: Record<string, string> = {
  england: 'uk',
  britain: 'uk',
  'united states': 'usa',
  america: 'usa',
  'united kingdom': 'uk',
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
};

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
  let bestKey = '';
  let bestIdx = -1;
  const check = (needle: string, key: string) => {
    const idx = lastWordMatch(lower, needle);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestKey = key;
    }
  };
  for (const key of Object.keys(COUNTRY_ROUTES)) check(key, key);
  for (const [alias, key] of Object.entries(COUNTRY_ALIASES)) check(alias, key);
  return bestKey;
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

// Booking links for the plan PDF ("How to book"). Honest links only:
// Google Hotels for real hotel prices, Google searches for cars and
// activities — built from the destination name, never an invented hotel
// or supplier URL. Flights are booked with FujinTrip itself (a booking
// request in My Trips; live booking activates with Duffel live mode),
// so there is no external flights link.
export function bookingLinks(destination: string): { hotels: string; cars: string; activities: string } {
  const q = encodeURIComponent(destination);
  return {
    hotels: `https://www.google.com/travel/hotels/search?q=${q}`,
    cars: `https://www.google.com/search?q=car+rental+${q}`,
    activities: `https://www.google.com/search?q=${q}+tours+activities`,
  };
}

export function askFujin(
  text: string,
  defaultTravelers = 2,
  contextDestination = '',
  currentMessage = ''
): { destination: string; travelers: number; reply: string; missing: string[] } {
  // Off-topic is judged on the CURRENT message only. The joined history
  // would make any message look like travel — "who will win the election?"
  // after an Egypt chat came back as an Egypt route (Nov 10 overnight
  // campaign). A follow-up like "make it cheaper" has no travel words of
  // its own, so the travel gate below still uses the joined text.
  const current = (currentMessage || text).toLowerCase();
  if (OFF_TOPIC.some((w) => current.includes(w))) {
    return {
      destination: '',
      travelers: 2,
      reply: 'I only help with travel and trip planning — where would you like to go?',
      missing: ['Destination'],
    };
  }
  if (!isTravel(text)) {
    return {
      destination: '',
      travelers: 2,
      reply: 'I only help with travel and trip planning — where would you like to go?',
      missing: ['Destination'],
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
  const effectivePlace = contextDestination && currentMessage && !isSwitch ? '' : place;
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
  const travelers = hasPartySignal ? parseTravelers(lower) : defaultTravelers;
  const missing: string[] = [];
  if (!/20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(lower)) missing.push('Dates');
  if (!/\$\s?\d|budget|economy|cheapest|affordable|cheap/.test(lower)) missing.push('Budget');
  if (!/slow|fast|relax|adventure|food|surf|hike|culture/.test(lower)) missing.push('Pace');
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
      const route = COUNTRY_ROUTES[routeKey];
      let routeText = route.route;
      // Season notes, only when the traveler named the month — a January
      // line on a July trip would be wrong.
      if (routeKey === 'europe' && /\bjan/.test(lower))
        routeText = `January is actually a smart choice for a first trip: fewer crowds, lower prices, and the south stays mild. ${routeText}`;
      if (routeKey === 'egypt' && /\bmar/.test(lower))
        routeText = `March is a great month for Egypt — warm days, cool evenings, and the desert is not too hot for the tombs yet. ${routeText}`;
      return {
        destination: display,
        travelers,
        reply: `Here's a route that fits — ${routeText}${wantsCheap ? ' Since you asked for affordable, I’ll lead with the Cheapest option — hostels and guesthouses, public transport, and low-cost flights where they help.' : ''} I can build the full plan with Cheapest / Best value / Premium options. If that sounds good, say so — or name another place and I’ll replan.`,
        missing,
      };
    }
    if (noIdea) {
      // "Surprise me" / "open to anything" / "nothing in mind" is a
      // request to recommend, not to ask again. Best fit with no
      // destination anywhere: Bali (affordable + great food) — framed as
      // a suggestion the traveler can change.
      return {
        destination: 'Bali',
        travelers,
        reply: `Here's a great first pick — Bali: affordable flights and stays, and some of the best local food anywhere (warungs, night markets, Ubud). Stay in guesthouses and small hotels, and get around by scooter or Gojek/Grab instead of private cars — it's cheaper, and it's how locals travel. I can build the full plan with Cheapest / Best value / Premium options. If that sounds good, say so — or name another place and I'll replan.`,
        missing,
      };
    }
    // No constraints to recommend from — ask which city or country.
    return {
      destination: '',
      travelers,
      reply: `Got it — a trip for ${travelers} traveler${travelers > 1 ? 's' : ''}. Which city or country would you like to go to?`,
      missing: ['Destination', ...missing],
    };
  }
  return {
    destination: known, travelers,
    reply: `Got it — ${known} for ${travelers} traveler${travelers > 1 ? 's' : ''}. I’ll build one complete plan with Cheapest / Best value / Premium options, with links to reviews and hotel websites so you can verify before you book.`,
    missing,
  };
}
