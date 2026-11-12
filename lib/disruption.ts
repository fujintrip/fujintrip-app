// Disruption reply template + Go Now (competitor learning round 2 #9 —
// TripIt Pro / Romie / Layla).
//
// A disruption reply has one shape, every time:
//   what changed → why → 3 ranked options (Fastest / Cheapest / Most
//   reliable) → refund right → one next action.
// Every fact comes from a live source: the checked flight status (the
// "Check my flight" box) and the live Duffel fares. With no live status
// the template says so plainly and points at the box; with no live
// fares it says so and offers the My Trips booking request. A status is
// never invented, a cause is never guessed, an alternate flight is
// never made up.
import type { DuffelFareOffer } from './duffel';
import { CITY_INFO } from './tripCard';
import { ROUTE_STOPS } from './planner';

// The checked status, as the "Check my flight" box returns it (and as
// the chat sends it with the disruption report). Every field is
// optional — the template says honestly what it does not know.
export type DisruptionStatus = {
  flight?: string;
  date?: string;
  status?: string;
  cancellationConfirmed?: boolean;
  cancellationUnconfirmed?: boolean;
  delayedMinutes?: number;
  diverted?: boolean;
  origin?: { city?: string; iata?: string };
  destination?: { city?: string; iata?: string };
  scheduledDeparture?: string | null;
  estimatedDeparture?: string | null;
  scheduledArrival?: string | null;
  estimatedArrival?: string | null;
};

function parseDurationToMinutes(iso: string): number | null {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

function shortDuration(iso: string): string {
  const mins = parseDurationToMinutes(iso);
  if (mins === null) return iso;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// One alternate per rank. A fare that wins two ranks carries both
// labels instead of appearing twice — the traveler sees three options,
// not three copies of one flight.
export type RankedAlternate = { labels: string[]; fare: DuffelFareOffer; why: string };

export function rankAlternates(fares: DuffelFareOffer[]): RankedAlternate[] {
  const list = (fares ?? []).filter((f) => f && typeof f.price === 'number' && f.price > 0);
  if (!list.length) return [];
  const cheapest = [...list].sort((a, b) => a.price - b.price)[0];
  const withDuration = list
    .map((f) => ({ f, mins: parseDurationToMinutes(f.duration) }))
    .filter((x): x is { f: DuffelFareOffer; mins: number } => x.mins !== null);
  const fastest = withDuration.length ? [...withDuration].sort((a, b) => a.mins - b.mins)[0].f : null;
  const reliable = [...list].sort((a, b) => a.stops - b.stops || a.price - b.price)[0];
  const byKey = new Map<string, RankedAlternate>();
  const keyOf = (f: DuffelFareOffer) => `${f.airline}|${f.price}|${f.duration}|${f.stops}`;
  const add = (label: string, fare: DuffelFareOffer | null, why: string) => {
    if (!fare) return;
    const existing = byKey.get(keyOf(fare));
    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
      return;
    }
    byKey.set(keyOf(fare), { labels: [label], fare, why });
  };
  add('Cheapest', cheapest, `lowest fare at $${cheapest.price.toLocaleString()}`);
  if (fastest) add('Fastest', fastest, `shortest trip at ${shortDuration(fastest.duration)}`);
  add('Most reliable', reliable, reliable.stops === 0 ? 'nonstop — no connection to miss' : `${reliable.stops} stop${reliable.stops > 1 ? 's' : ''} — the fewest connections`);
  // Fastest first, then Cheapest, then Most reliable.
  const order = ['Fastest', 'Cheapest', 'Most reliable'];
  return [...byKey.values()].sort((a, b) => order.indexOf(a.labels[0]) - order.indexOf(b.labels[0]));
}

// The refund right for the trip (DOT / EU261 / UK261, current rules):
// a US-touching flight gets the DOT automatic cash refund; a European
// route gets EU261 compensation for a 3h+ delay or cancellation; the
// UK gets its own version (UK261). A flight touching the US and Europe
// gets both lines. Anything else gets the honest generic line — rules
// depend on the route and the airline, so nothing is promised that the
// route does not support.
const EU_ROUTE_KEYS = new Set(['europe', 'centraleurope', 'portugal', 'italy', 'france', 'spain', 'greece']);

export function refundLine(routeKey: string, origin: string): string {
  const parts: string[] = [];
  const firstCity = ROUTE_STOPS[routeKey]?.[0]?.city ?? '';
  const isUS = (city: string) => city !== '' && ['USA', 'United States'].includes(CITY_INFO[city]?.country ?? '');
  const touchesUS = routeKey === 'usa' || isUS(origin) || isUS(firstCity);
  if (touchesUS) {
    parts.push('US rules (DOT): if the airline cancels your flight, you get an automatic cash refund to your original payment method within 7 business days — you do not have to accept a voucher or rebooking.');
  }
  if (EU_ROUTE_KEYS.has(routeKey)) {
    parts.push('EU rules (EU261): for a cancellation or a delay of 3 hours or more at arrival, compensation is €250 for flights up to 1,500 km, €400 up to 3,500 km, €600 beyond that — plus a refund or rebooking. Ask the airline, and keep every receipt.');
  }
  if (routeKey === 'uk') {
    parts.push('UK rules (UK261): for a cancellation or a delay of 3 hours or more at arrival, compensation is £220 for flights up to 1,500 km, £350 up to 3,500 km, £520 beyond that — plus a refund or rebooking. Ask the airline, and keep every receipt.');
  }
  if (!parts.length) {
    parts.push('Refund and compensation rules depend on where the flight starts and the airline — ask for a cash refund to your original payment method, not a voucher, and keep every receipt.');
  }
  return `Your refund right: ${parts.join(' ')}`;
}

// The full template: what changed → why → 3 ranked options → refund
// right → one next action. Works with the graceful state too (no live
// status, no live fares) — the gaps are stated, never filled in.
export function disruptionTemplate(opts: { status?: DisruptionStatus | null; fares?: DuffelFareOffer[]; routeKey?: string; origin?: string }): string {
  const { status, fares = [], routeKey = '', origin = '' } = opts;
  const lines: string[] = [];
  // What changed — from the checked status, or the honest gap.
  if (status?.flight && status?.status) {
    const route = [status.origin?.city ?? status.origin?.iata, status.destination?.city ?? status.destination?.iata].filter(Boolean).join(' → ');
    const where = route ? ` ${route}` : '';
    let changed: string;
    if (status.cancellationConfirmed) {
      changed = `${status.flight}${where} is cancelled — confirmed by the airline's status.`;
    } else if (status.cancellationUnconfirmed) {
      changed = `${status.flight} is reported cancelled in one place, but the airline has not confirmed it — do not treat it as cancelled yet.`;
    } else if (status.diverted) {
      changed = `${status.flight}${where} is diverted.`;
    } else if (typeof status.delayedMinutes === 'number' && status.delayedMinutes > 0) {
      changed = `${status.flight}${where} is delayed ${status.delayedMinutes} minutes.`;
    } else {
      changed = `${status.flight}${where} — status: ${status.status}.`;
    }
    lines.push(`What changed: ${changed}`);
  } else {
    lines.push(`What changed: I don't have a live status for your flight — check it in the "Check my flight" box below the chat, and it will show the confirmed status, the new times, the gate and the baggage claim.`);
  }
  // Why — only what the status itself says. The status text is the
  // only reason on record; a cause (weather, mechanical) is never
  // guessed from it.
  if (status?.status) {
    lines.push(`Why: the airline's status is "${status.status}" — no reason is given in the status I can see, so I won't guess one.`);
  } else {
    lines.push('Why: no live status to quote yet — the cause is not known.');
  }
  // 3 ranked options, from the live fares only.
  const ranked = rankAlternates(fares);
  if (ranked.length) {
    lines.push('Your options from the live fares:');
    for (const r of ranked) {
      const f = r.fare;
      lines.push(`- ${r.labels.join(' · ')}: ${f.airline} $${f.price.toLocaleString()}${f.stops === 0 ? ', nonstop' : `, ${f.stops} stop${f.stops > 1 ? 's' : ''}`}${f.bags ? `, ${f.bags.toLowerCase()}` : ''} — ${r.why}.`);
    }
  } else {
    lines.push('Your options: no live fares are available for this route right now — save a booking request in My Trips and the FujinTrip team will look into the next available flight.');
  }
  lines.push(refundLine(routeKey, origin));
  // One next action.
  lines.push(
    ranked.length
      ? 'Next: tell me which of these works for you and I will save it in My Trips as a booking request for the FujinTrip team.'
      : 'Next: check the live status in the "Check my flight" box, then tell me what it says — I will look for the next available flight from there.'
  );
  return lines.join('\n');
}

// Go Now: a pure "leave now" line for a flight that is still on the
// ground and departs within 4 hours. The caller keeps the guards
// (live status, not cancelled, not already departed); this only does
// the clock math, so it can be tested without a status object.
export function goNowLine(estimatedDeparture: string | null | undefined, now: number = Date.now()): string | null {
  if (!estimatedDeparture) return null;
  const mins = Math.round((new Date(estimatedDeparture).getTime() - now) / 60000);
  if (!Number.isFinite(mins) || mins < 0 || mins > 240) return null;
  return `Departs in ${mins < 60 ? `${mins} minutes` : `${Math.floor(mins / 60)}h ${mins % 60}m`} — if you're not at the airport yet, leave now: most airlines close check-in an hour before departure.`;
}
