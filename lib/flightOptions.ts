// The merged flight-option list (Nov 16, 2026): one card grid, one
// sort, sources interleaved — Duffel, Ignav and LetsFG options never
// grouped by source. Every option is a COMPLETE trip for the searched
// party, so the prices on screen are comparable: a Duffel round-trip
// option is an outbound + return leg pair (cheapest out + back total,
// the service fee shown separately on the card, never folded into the
// total); an Ignav or LetsFG option is a whole-trip itinerary as
// priced. A one-way leg price is never placed next to a round-trip
// total as if they were comparable — one-way merges one-way legs
// with one-way itineraries only. Multi-city has no merged view: its
// legs are per-leg lists, and this module is not used for it.
//
// The lists arrive already filtered + sorted by the caller's sort
// (visibleLive); the merge re-sorts the combined list by the same
// sort so a Duffel pair, an Ignav trip and a LetsFG trip order
// against each other: cheapest/best = trip total ascending, shortest
// = total duration, earliest = outbound departure. A missing duration
// or departure sorts last, price breaking the tie — nothing is
// dropped for lacking a time.
import type { DuffelFareOffer } from './duffel';
import type { IgnavItinerary } from './ignav';
import { letsfgItineraryDuration, type LetsfgItinerary } from './letsfg';
import type { RowSort } from './searchPlaces';

export type FlightOption =
  | {
      kind: 'duffel-pair';
      out: DuffelFareOffer;
      back: DuffelFareOffer;
      total: number;
      durationMinutes: number;
      departMinutes: number;
      key: string;
    }
  | {
      kind: 'duffel-oneway';
      offer: DuffelFareOffer;
      total: number;
      durationMinutes: number;
      departMinutes: number;
      key: string;
    }
  | {
      kind: 'ignav';
      itinerary: IgnavItinerary;
      total: number;
      durationMinutes: number;
      departMinutes: number;
      key: string;
    }
  | {
      kind: 'letsfg';
      itinerary: LetsfgItinerary;
      total: number;
      durationMinutes: number;
      departMinutes: number;
      key: string;
    };

// An Ignav trip's total duration — the sum of its legs, mirroring
// sortIgnavItineraries. A leg with no duration makes the trip sort
// last on duration, never guessed.
export function ignavItineraryDuration(it: IgnavItinerary): number {
  return it.legs.reduce((sum, l) => sum + (l.durationMinutes ?? Infinity), 0);
}

export function mergeFlightOptions(args: {
  tripType: 'roundtrip' | 'oneway';
  out: DuffelFareOffer[];
  back: DuffelFareOffer[];
  ignavItineraries: IgnavItinerary[];
  // LetsFG trips (Nov 16, 2026): optional — older callers pass none
  // and the merge is Duffel + Ignav exactly as before.
  letsfgItineraries?: LetsfgItinerary[];
  sort: RowSort;
}): FlightOption[] {
  const options: FlightOption[] = [];
  if (args.tripType === 'roundtrip') {
    // Pairs are index-matched on the already-sorted lists: cheapest
    // out with cheapest back, second with second. A leg with no
    // partner on the other side is not a complete round-trip, so it
    // has no card — it is not shown as a one-way price next to
    // round-trip totals.
    const pairs = Math.min(args.out.length, args.back.length);
    for (let i = 0; i < pairs; i += 1) {
      const out = args.out[i];
      const back = args.back[i];
      options.push({
        kind: 'duffel-pair',
        out,
        back,
        total: out.price + back.price,
        durationMinutes: (out.durationMinutes ?? Infinity) + (back.durationMinutes ?? Infinity),
        departMinutes: out.departMinutes ?? Infinity,
        key: `duffel-pair:${out.airline}:${out.price}:${out.departTime ?? ''}:${back.airline}:${back.price}:${i}`,
      });
    }
  } else {
    for (let i = 0; i < args.out.length; i += 1) {
      const offer = args.out[i];
      options.push({
        kind: 'duffel-oneway',
        offer,
        total: offer.price,
        durationMinutes: offer.durationMinutes ?? Infinity,
        departMinutes: offer.departMinutes ?? Infinity,
        key: `duffel-oneway:${offer.airline}:${offer.price}:${offer.departTime ?? ''}:${i}`,
      });
    }
  }
  for (let i = 0; i < args.ignavItineraries.length; i += 1) {
    const itinerary = args.ignavItineraries[i];
    options.push({
      kind: 'ignav',
      itinerary,
      total: itinerary.price,
      durationMinutes: ignavItineraryDuration(itinerary),
      departMinutes: itinerary.legs[0]?.departMinutes ?? Infinity,
      key: `ignav:${itinerary.ignavId ?? `${itinerary.price}-${itinerary.legs[0]?.airline ?? ''}`}:${i}`,
    });
  }
  // LetsFG trips (Nov 16, 2026): whole-trip itineraries as priced,
  // interleaved with the rest by the same sort — never a separate
  // LetsFG section.
  for (let i = 0; i < (args.letsfgItineraries ?? []).length; i += 1) {
    const itinerary = (args.letsfgItineraries ?? [])[i];
    options.push({
      kind: 'letsfg',
      itinerary,
      total: itinerary.price,
      durationMinutes: letsfgItineraryDuration(itinerary),
      departMinutes: itinerary.legs[0]?.departMinutes ?? Infinity,
      key: `letsfg:${itinerary.letsfgId ?? `${itinerary.price}-${itinerary.legs[0]?.airline ?? ''}`}:${i}`,
    });
  }
  const byTotal = (a: FlightOption, b: FlightOption) => a.total - b.total;
  const byDuration = (a: FlightOption, b: FlightOption) => a.durationMinutes - b.durationMinutes || byTotal(a, b);
  const byDeparture = (a: FlightOption, b: FlightOption) => a.departMinutes - b.departMinutes || byTotal(a, b);
  if (args.sort === 'duration') return options.sort(byDuration);
  if (args.sort === 'departure') return options.sort(byDeparture);
  // 'cheapest' and 'best' both order live fares by trip total — the
  // planner's best-value order applies to estimate rows, not fares.
  return options.sort((a, b) => byTotal(a, b) || byDuration(a, b) || byDeparture(a, b));
}
