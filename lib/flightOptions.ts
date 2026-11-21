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
import { canonicalAirlineName, perTravelerPrice, timeBucketFor } from './duffel';
import type { IgnavItinerary } from './ignav';
import { ignavItineraryStops } from './ignav';
import type { HackerFareComparison } from './hackerFares';
import { letsfgItineraryDuration, letsfgItineraryStops, type LetsfgItinerary } from './letsfg';
import { LIVE_PRICE_BANDS, type LiveFilterOptions, type RowSort } from './searchPlaces';

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
    }
  | {
      // Hacker Fare (roadmap, Nov 21 2026 — F13): two live Ignav
      // one-way itineraries that together cost less than the
      // cheapest Ignav round trip. A live option like any other —
      // it ranks by its combined total and is never a test fare.
      kind: 'hacker';
      comparison: HackerFareComparison;
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
  // Hacker Fare comparison (roadmap, Nov 21 2026 — F13): the
  // winning two-one-ways combo, already compared — the merge only
  // places it. Absent, no hacker card exists.
  hackerComparison?: HackerFareComparison | null;
  sort: RowSort;
  // Duffel test fares (UX direction, Nov 19 2026 — P0-4): when the
  // Duffel options are test fares, they sort AFTER every live fare
  // in every sort mode, so a test fare can never be the cheapest
  // shown while a live fare exists. Test fares still show (with the
  // unmissable warning) when they are the only fares.
  duffelTest?: boolean;
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
  // Hacker Fare (roadmap, Nov 21 2026 — F13): the two one-ways
  // already won the comparison before they reach the merge — the
  // merge only places the combo, by its combined total, among the
  // other live fares. It is a live Ignav option, so the Duffel
  // test-fare rank never touches it.
  if (args.hackerComparison) {
    const c = args.hackerComparison;
    options.push({
      kind: 'hacker',
      comparison: c,
      total: c.combinedTotal,
      durationMinutes: ignavItineraryDuration(c.out) + ignavItineraryDuration(c.back),
      departMinutes: c.out.legs[0]?.departMinutes ?? Infinity,
      key: `hacker:${c.out.ignavId ?? c.out.price}:${c.back.ignavId ?? c.back.price}`,
    });
  }
  const byTotal = (a: FlightOption, b: FlightOption) => a.total - b.total;
  const byDuration = (a: FlightOption, b: FlightOption) => a.durationMinutes - b.durationMinutes || byTotal(a, b);
  const byDeparture = (a: FlightOption, b: FlightOption) => a.departMinutes - b.departMinutes || byTotal(a, b);
  // Test fares sort last (P0-4): a Duffel option ranks behind every
  // live option, then the requested sort orders within each rank.
  const testRank = (o: FlightOption) => (args.duffelTest && (o.kind === 'duffel-pair' || o.kind === 'duffel-oneway') ? 1 : 0);
  const byRankThen = (cmp: (a: FlightOption, b: FlightOption) => number) => (a: FlightOption, b: FlightOption) =>
    testRank(a) - testRank(b) || cmp(a, b);
  if (args.sort === 'duration') return options.sort(byRankThen(byDuration));
  if (args.sort === 'departure') return options.sort(byRankThen(byDeparture));
  // 'cheapest' and 'best' both order live fares by trip total — the
  // planner's best-value order applies to estimate rows, not fares.
  return options.sort(byRankThen((a, b) => byTotal(a, b) || byDuration(a, b) || byDeparture(a, b)));
}

// Facet counts for the merged card grid (audit round, Nov 17, 2026):
// the counts count CARDS, not legs. The old leg-based counts read
// "Under $1,000 (23)" next to 6 cards, because a round-trip pair is
// two legs and every itinerary is one or two legs — the counts came
// from another dataset than the list on screen. The caller passes
// the FILTERED merge, so the counts match what is actually shown:
// "Nonstop (3)" means 3 of the visible cards are nonstop.
//   stops — a Duffel pair counts under the most stops on either leg
//     (the pair survives only when both legs match the filter, so
//     the worst leg is the honest value); an Ignav/LetsFG trip uses
//     the outbound-first rule, the same as its filter.
//   airlines — every airline on the card, so a mixed-airline trip
//     counts for each carrier it includes.
//   time — the outbound departure bucket, the same as the filter.
//   price — the trip total per traveler against each band.
export function countFlightCards(options: FlightOption[], travelers: number): LiveFilterOptions['counts'] {
  const counts: LiveFilterOptions['counts'] = { airlines: {}, stops: {}, times: {}, prices: {} };
  for (const band of LIVE_PRICE_BANDS) counts.prices[band] = 0;
  for (const opt of options) {
    const stops =
      opt.kind === 'duffel-pair'
        ? Math.max(opt.out.stops, opt.back.stops)
        : opt.kind === 'duffel-oneway'
          ? opt.offer.stops
          : opt.kind === 'ignav'
            ? ignavItineraryStops(opt.itinerary)
            : opt.kind === 'hacker'
              ? ignavItineraryStops(opt.comparison.out)
              : letsfgItineraryStops(opt.itinerary);
    counts.stops[stops] = (counts.stops[stops] ?? 0) + 1;
    // Airlines are canonical before the dedup (rendered-check fix,
    // Nov 21 2026): a pair flown by "ITA" out and "ITA Airways"
    // back is one carrier, so it counts once, not twice.
    const airlines =
      opt.kind === 'duffel-pair'
        ? [...new Set([canonicalAirlineName(opt.out.airline), canonicalAirlineName(opt.back.airline)])]
        : opt.kind === 'duffel-oneway'
          ? [canonicalAirlineName(opt.offer.airline)]
          : opt.kind === 'hacker'
            ? [...new Set([...opt.comparison.out.legs, ...opt.comparison.back.legs].map((l) => canonicalAirlineName(l.airline)))]
            : [...new Set(opt.itinerary.legs.map((l) => canonicalAirlineName(l.airline)))];
    for (const a of airlines) counts.airlines[a] = (counts.airlines[a] ?? 0) + 1;
    const bucket = timeBucketFor(opt.departMinutes);
    if (bucket) counts.times[bucket] = (counts.times[bucket] ?? 0) + 1;
    const perTraveler = perTravelerPrice(opt.total, travelers);
    for (const band of LIVE_PRICE_BANDS) if (perTraveler <= band) counts.prices[band] += 1;
  }
  return counts;
}
