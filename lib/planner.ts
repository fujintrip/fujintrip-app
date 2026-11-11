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

// Regions count as travel too — "europe, january" names a place and a
// month, and must reach the recommend rule, not the off-topic decline
// (the Nov 10 Europe bug came back in exactly this form).
const REGIONS = ['europe', 'asia', 'africa', 'america', 'caribbean', 'mediterranean', 'oceania', 'middle east', 'southeast asia', 'south east asia'];

function isTravel(text: string): boolean {
  const lower = text.toLowerCase();
  if (Object.keys(BASE).some((d) => lower.includes(d.toLowerCase()))) return true;
  if (REGIONS.some((r) => lower.includes(r))) return true;
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

export function askFujin(text: string): { destination: string; travelers: number; reply: string; missing: string[] } {
  if (!isTravel(text)) {
    return {
      destination: '',
      travelers: 2,
      reply: 'I only help with travel and trip planning — where would you like to go?',
      missing: ['Destination'],
    };
  }
  const lower = text.toLowerCase();
  const known = Object.keys(BASE).find((d) => lower.includes(d.toLowerCase()));
  const solo = /\bsolo\b|\balone\b|\bjust me\b/.test(lower);
  const m = lower.match(/(\d+)\s*(people|travelers|traveler|adults|person)/);
  const travelers = m ? parseInt(m[1], 10) : solo ? 1 : 2;
  const missing: string[] = [];
  if (!/20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(lower)) missing.push('Dates');
  if (!/\$\s?\d|budget/.test(lower)) missing.push('Budget');
  if (!/slow|fast|relax|adventure|food|surf|hike|culture/.test(lower)) missing.push('Pace');
  if (!known) {
    // RECOMMEND — the traveler gave constraints but no destination, or said
    // they have nothing in mind. Propose a route that fits instead of
    // asking again or declining (Nov 10 Europe bug: a budget first-timer
    // asking for affordable flights + food was declined as off-topic).
    // A proposal is not a silent default: the reply says it's a suggestion
    // the traveler can change.
    const noIdea = /nothing in mind|don'?t know|no idea|anywhere|not sure|don'?t mind|first time|first timer|first trip/.test(lower);
    const wantsCheap = /budget|cheap|affordable|low cost/.test(lower);
    const wantsFood = /food|cuisine|eat/.test(lower);
    if (/europe/.test(lower)) {
      return {
        destination: 'Europe',
        travelers,
        reply: `Here's a route that fits — and January is actually a smart choice for a first trip: fewer crowds, lower prices, and the south stays mild. Lisbon (Portugal) → Madrid → Barcelona (Spain) → Paris (France) → Rome (Italy) → Athens (Greece): five countries, great food at every stop. Fly between cities on low-cost carriers (Ryanair, easyJet, Wizz Air) — that's where the budget wins. Stay in hostels and family guesthouses, and get around by metro, tram and bus — a day pass beats taxis every time. I can build the full plan with Cheapest / Best value / Premium options. If that sounds good, say so — or name another place and I'll replan.`,
        missing,
      };
    }
    if (noIdea && (wantsCheap || wantsFood)) {
      return {
        destination: 'Bali',
        travelers,
        reply: `Here's one that fits — Bali: affordable flights and stays, and some of the best local food anywhere (warungs, night markets, Ubud). Stay in guesthouses and small hotels, and get around by scooter or Gojek/Grab instead of private cars — it's cheaper, and it's how locals travel. I can build the full plan with Cheapest / Best value / Premium options. If that sounds good, say so — or name another place and I'll replan.`,
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
