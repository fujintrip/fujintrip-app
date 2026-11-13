/**
 * Feasibility guardrail (round 4 #5, UGC learning §3 — FlyerTalk's
 * 55-minute LAX connection ("55 minutes is simply not enough time to
 * transit terminals and re-check bags"), the Doha separate-tickets
 * thread ("On separate tickets there is no protection from the
 * airline"), and Layla's impossible 7:35 AM Bergamo flight + a day
 * in Bellagio + four more experiences).
 *
 * Missed flights and lost onward tickets are the most expensive
 * failures in travel, and they happen before the trip starts — exactly
 * where a planner should catch them. This is the S half: a rule layer
 * on every leg that needs no live data.
 *
 *  - Connection time: <90 min international / <60 min domestic = flag.
 *  - Any terminal change or separate ticket = "no protection" label.
 *  - Departure-day guard: no day trip on a flight day, and the
 *    departure day has no day entry by construction.
 *  - Chat-vs-card consistency audit: legs sum to the total minus
 *    activities, nights and dates line up, airports agree everywhere.
 *
 * The M half is deliberately NOT built here: MCT (minimum connection
 * time) data per airport and leg, and the transit-visa check per
 * layover — both need a live data source. Flagged as the follow-up in
 * the report.
 */

import type { TripCard } from './tripCard';

// Minimum connection time, in minutes, by connection kind — the rule
// version of MCT. Real MCT data per airport and leg is the M half.
export const MIN_CONNECTION_MINUTES = { international: 90, domestic: 60 } as const;

export type ConnectionInput = {
  minutes: number;
  international: boolean;
  terminalChange?: boolean;
  separateTicket?: boolean;
};

export function checkConnection(input: ConnectionInput): { ok: boolean; flags: string[] } {
  const min = input.international ? MIN_CONNECTION_MINUTES.international : MIN_CONNECTION_MINUTES.domestic;
  const flags: string[] = [];
  if (input.minutes < min) {
    flags.push(
      `Tight connection — ${input.minutes} minutes is under the ${min}-minute minimum for ${input.international ? 'international' : 'domestic'} connections.`
    );
  }
  if (input.terminalChange) {
    flags.push('Terminal change — allow extra time to move terminals and re-clear security if needed.');
  }
  if (input.separateTicket) {
    flags.push(
      'Separate tickets — no protection: if you miss the connection, you buy a new ticket. The airline owes you nothing on a separate ticket.'
    );
  }
  return { ok: flags.length === 0, flags };
}

// Departure-day guard: a day trip on a flight day leaves no buffer
// for a delay. Flight days are Day 1 (arrival) and every stop's first
// day (a travel day in) — and the departure day itself has no day
// entry by construction, so the last day ends at the airport. A day
// trip the day before an early flight home is flagged too, when the
// departure time is known.
export function departureDayFlags(card: TripCard, departureTime?: string | null): string[] {
  const flags: string[] = [];
  const isDayTrip = (title: string) => title.toLowerCase().includes('day trip');
  for (const stop of card.stops) {
    const firstDay = stop.days[0];
    if (firstDay && isDayTrip(firstDay.title)) {
      const isArrivalDay = stop === card.stops[0];
      flags.push(
        isArrivalDay
          ? `Day 1 is your arrival day, and it plans a day trip (${firstDay.title}) — a landing-day delay leaves no buffer. Move the day trip to a full day.`
          : `Day ${firstDay.day} is a travel day (${stop.transportIn.mode} into ${stop.city}) and plans a day trip (${firstDay.title}) — no buffer for a late arrival.`
      );
    }
  }
  // An early flight home after a day trip: the last full day is a day
  // trip and the flight leaves before noon.
  if (departureTime && departureTime < '12:00') {
    const lastDay = card.stops[card.stops.length - 1]?.days[card.stops[card.stops.length - 1].days.length - 1];
    if (lastDay && isDayTrip(lastDay.title)) {
      flags.push(
        `Day ${lastDay.day} plans a day trip (${lastDay.title}) and your flight home leaves at ${departureTime} the next morning — no buffer for a late return. Move the day trip earlier.`
      );
    }
  }
  return flags;
}

export type AuditIssue = {
  kind: 'price' | 'nights' | 'dates' | 'airport' | 'currency';
  message: string;
};

// Chat-vs-card consistency audit: the card's own numbers must agree
// with each other — legs sum to the total minus activities (activities
// have no leg), nights sum to days − 1, dates run in order with the
// departure day after the last stop, the airports agree everywhere,
// and every price is a finite non-negative USD number. The chat, the
// card, the header and the map all read from this one card, so an
// audit that passes here is the agreement the traveler sees.
export function auditTrip(card: TripCard): { ok: boolean; issues: AuditIssue[] } {
  const issues: AuditIssue[] = [];
  const legSum = card.legs.reduce((s, l) => s + l.price, 0);
  const hotel = card.legs.filter((l) => l.kind === 'stay').reduce((s, l) => s + l.price, 0);
  const car = card.legs.filter((l) => l.kind === 'car').reduce((s, l) => s + l.price, 0);
  const activities = card.plannerTotal - card.flight.plannerFlight - hotel - car;
  const expectedLegSum = card.total - activities;
  if (legSum !== expectedLegSum) {
    issues.push({
      kind: 'price',
      message: `Legs sum to $${legSum.toLocaleString()} but the total minus activities is $${expectedLegSum.toLocaleString()} — the card and the chat disagree on the price.`,
    });
  }
  const nights = card.stops.reduce((s, st) => s + st.nights, 0);
  if (nights !== card.nights) {
    issues.push({
      kind: 'nights',
      message: `Stops add up to ${nights} nights but the trip is ${card.nights} nights — the route and the totals disagree.`,
    });
  }
  const dayMs = 86400000;
  const firstStart = card.stops[0]?.startDate;
  if (firstStart && firstStart.getTime() !== new Date(card.startDate).getTime()) {
    issues.push({ kind: 'dates', message: 'The first stop does not start on the trip start date.' });
  }
  for (let i = 1; i < card.stops.length; i++) {
    const prevEnd = card.stops[i - 1].endDate;
    const thisStart = card.stops[i].startDate;
    if (thisStart.getTime() !== new Date(prevEnd).getTime() + dayMs) {
      issues.push({
        kind: 'dates',
        message: `${card.stops[i].city} starts a day after ${card.stops[i - 1].city} ends — the dates do not run in order.`,
      });
    }
  }
  const lastEnd = card.stops[card.stops.length - 1]?.endDate;
  if (lastEnd && new Date(lastEnd).getTime() + dayMs !== new Date(card.endDate).getTime()) {
    issues.push({ kind: 'dates', message: 'The last stop does not end the day before the trip ends.' });
  }
  if (card.origin) {
    const outLeg = card.legs.find((l) => l.id === 'flight-out');
    const backLeg = card.legs.find((l) => l.id === 'flight-back');
    if (outLeg && !outLeg.label.includes(card.origin)) {
      issues.push({ kind: 'airport', message: `The outbound flight does not start at ${card.origin}.` });
    }
    if (backLeg && !backLeg.label.includes(card.origin)) {
      issues.push({ kind: 'airport', message: `The return flight does not end at ${card.origin}.` });
    }
  }
  for (const leg of card.legs) {
    if (!Number.isFinite(leg.price) || leg.price < 0) {
      issues.push({ kind: 'currency', message: `The ${leg.label} leg has no valid USD price.` });
    }
  }
  return { ok: issues.length === 0, issues };
}

// The one-line summary for the chat reply — the flags, or the pass.
export function feasibilitySummary(flags: string[], audit: { ok: boolean; issues: AuditIssue[] }): string {
  if (!flags.length && audit.ok) {
    return 'Feasibility: no flags — no day trip on a flight day, and the audit passed (legs sum to the total, nights and dates line up, airports agree).';
  }
  const bits = [...flags, ...audit.issues.map((i) => i.message)];
  return `Feasibility — ${bits.length} flag${bits.length === 1 ? '' : 's'}: ${bits.join(' ')}`;
}
