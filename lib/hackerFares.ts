// Hacker Fares (roadmap, Nov 21 2026 — F13, Kayak's model):
// sometimes two one-way tickets cost less than the round trip for
// the same journey. This module is the comparison — pure logic, no
// fetching: given the cheapest live Ignav round-trip itinerary and
// the cheapest live Ignav one-way itinerary in each direction, it
// says whether the two one-ways win, and by how much.
//
// Only LIVE Ignav fares go in. A Duffel test fare, a LetsFG fare
// or a planning estimate is never a leg of a hacker fare — the
// caller only passes Ignav itineraries, and the comparison never
// invents a price: a missing leg, or two one-ways that cost the
// same or more than the round trip, is no hacker fare at all (null),
// not a zero-saving card.
//
// Labelling: each leg keeps its own source + checked time (the
// Ignav source tag for that one-way search), and the card states
// the saving against the cheapest round trip it was compared with.
// The Cheapest tier may use it — in the flight panel the hacker
// combo ranks with the other live fares by its combined total, so
// when it wins it is the cheapest live option on screen. The
// planner's estimate tiers are untouched: live fares are never fed
// into estimate math.
import type { IgnavItinerary } from './ignav';

export type HackerFareComparison = {
  out: IgnavItinerary;
  back: IgnavItinerary;
  // Party totals, USD.
  combinedTotal: number;
  roundTripTotal: number;
  savings: number;
  savingsPercent: number;
  // When each search was checked (Ignav observed_at, may be null —
  // no time is claimed when there is none).
  outCheckedAt: string | null;
  backCheckedAt: string | null;
  roundTripCheckedAt: string | null;
};

// The comparison: strictly cheaper wins. Equal or more expensive is
// not a hacker fare — there is no saving to show, so the card does
// not exist. A missing leg is the same: no comparison, no card.
export function compareHackerFare(args: {
  roundTrip: IgnavItinerary | null;
  outOneWay: IgnavItinerary | null;
  backOneWay: IgnavItinerary | null;
  roundTripCheckedAt?: string | null;
  outCheckedAt?: string | null;
  backCheckedAt?: string | null;
}): HackerFareComparison | null {
  const { roundTrip, outOneWay, backOneWay } = args;
  if (!roundTrip || !outOneWay || !backOneWay) return null;
  if (!Number.isFinite(roundTrip.price) || roundTrip.price <= 0) return null;
  if (!Number.isFinite(outOneWay.price) || outOneWay.price <= 0) return null;
  if (!Number.isFinite(backOneWay.price) || backOneWay.price <= 0) return null;
  const combinedTotal = outOneWay.price + backOneWay.price;
  if (combinedTotal >= roundTrip.price) return null;
  const savings = roundTrip.price - combinedTotal;
  return {
    out: outOneWay,
    back: backOneWay,
    combinedTotal,
    roundTripTotal: roundTrip.price,
    savings,
    savingsPercent: (savings / roundTrip.price) * 100,
    outCheckedAt: args.outCheckedAt ?? null,
    backCheckedAt: args.backCheckedAt ?? null,
    roundTripCheckedAt: args.roundTripCheckedAt ?? null,
  };
}

// The card's source line: two one-way fares, live, from Ignav —
// never a round-trip price in disguise.
export function hackerFareLabel(): string {
  return 'Two one-way fares · Ignav · live';
}

// The saving, in the traveler's words, against the round trip it
// was compared with — the round-trip total is named so the saving
// is checkable, never a bare "you save $X".
export function hackerFareSavingsLine(c: HackerFareComparison): string {
  return `$${c.savings.toLocaleString()} less than the cheapest round trip ($${c.roundTripTotal.toLocaleString()})`;
}
