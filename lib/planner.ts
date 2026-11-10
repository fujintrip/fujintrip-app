export type PlanOption = { name: string; total: number; flight: number; hotel: number; car: number; activities: number; note: string };
export type DayPlan = { day: number; title: string; morning: string; afternoon: string; evening: string; transport: string; stay: string };
export type Plan = { destination: string; travelers: number; options: PlanOption[]; days: DayPlan[]; tips: string[]; liked: string[]; notLiked: string[] };

const BASE: Record<string, number> = { Kyoto: 1950, Bali: 1250, Santorini: 2100, 'St. George': 780, Tacoma: 920, Hilo: 1450 };

export function buildPlan(destination: string, travelers: number, days = 3): Plan {
  const base = BASE[destination] ?? 1500;
  const per = (f: number) => Math.round(base * f * travelers);
  const options: PlanOption[] = [
    { name: 'Cheapest', total: per(0.64), flight: per(0.28), hotel: per(0.22), car: per(0.05), activities: per(0.09), note: 'Budget stays, off-peak flights, free activities first.' },
    { name: 'Best value', total: per(1), flight: per(0.42), hotel: per(0.33), car: per(0.08), activities: per(0.17), note: 'Our pick — comfort where it matters, savings where it doesn’t.' },
    { name: 'Premium', total: per(1.64), flight: per(0.6), hotel: per(0.62), car: per(0.14), activities: per(0.28), note: 'Top stays, direct flights, private guides.' },
  ];
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

export function askFujin(text: string): { destination: string; travelers: number; reply: string; missing: string[] } {
  const lower = text.toLowerCase();
  const dest = Object.keys(BASE).find((d) => lower.includes(d.toLowerCase())) ?? 'Kyoto';
  const m = lower.match(/(\d+)\s*(people|travelers|traveler|adults|person)/);
  const travelers = m ? parseInt(m[1], 10) : 2;
  const missing: string[] = [];
  if (!/20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(lower)) missing.push('Dates');
  if (!/\$\s?\d|budget/.test(lower)) missing.push('Budget');
  if (!/slow|fast|relax|adventure|food|surf|hike|culture/.test(lower)) missing.push('Pace');
  return {
    destination: dest, travelers,
    reply: `Got it — ${dest} for ${travelers} traveler${travelers > 1 ? 's' : ''}. I’ll build one complete plan with Cheapest / Best value / Premium options, with links to reviews and hotel websites so you can verify before you book.`,
    missing,
  };
}
