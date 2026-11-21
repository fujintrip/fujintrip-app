// Saved trips & fares — the wishlist (roadmap, Nov 21 2026 — F1).
//
// What it is: the traveler saves a fare, a package or a trip, and sees
// it again in My Trips (/account). It builds on the My Trips pattern
// that already exists — the same localStorage trips list
// ('fujintrip-trips'), the same Trip record — with one addition: a
// saved entry carries its structured detail (source, price kind,
// totals, route, dates, when it was checked) instead of a bare label
// string, so "see them again" means seeing what was actually saved.
//
// The three price kinds, never mixed:
//  - 'live' — a live fare from a supplier, checked at checkedAt.
//  - 'test' — a Duffel test fare: not bookable, not a real price.
//  - 'estimate' — the planner's planning estimate, not a live quote.
// A saved entry is honest about which one it is wherever it renders
// (My Trips shows the kind line; a test fare keeps its warning).
//
// The key is stable and derived from the saved content, so the same
// fare cannot be saved twice — saving an already-saved fare is a
// no-op, and a card whose key is already in My Trips renders
// "Saved ✓" on every load, not just after the click that saved it.
//
// Pure functions only (no localStorage here — the components own the
// read/write, like the rest of the app's device-local state).

export type SavedPriceKind = 'live' | 'test' | 'estimate';
export type SavedKind = 'fare' | 'package' | 'trip';

export type SavedDetail = {
  // Stable key, derived from the saved content (see the key helpers
  // below) — the dedupe identity.
  key: string;
  kind: SavedKind;
  destination: string;
  // Who quoted the price: 'Ignav' | 'LetsFG' | 'Duffel' | 'FujinTrip planner'.
  source: string;
  priceKind: SavedPriceKind;
  // Party total in USD, and the per-traveler figure next to it.
  total: number;
  perTraveler: number;
  travelers: number;
  // 'New York → London' for a fare; the route line for a trip.
  route?: string;
  // 'Dec 10 – Dec 17, 2026' for a fare; undefined for a package/trip
  // (the planner's estimate does not depend on dates).
  dates?: string;
  // ISO timestamp of when the price was seen — a saved live fare is a
  // snapshot, and the traveler is told when it was checked.
  checkedAt: string;
};

// The key for a saved fare: source + route + dates + travelers +
// total + airline. Two different totals are two different fares; the
// same fare saved twice is the same key. The airline is in the key
// because two airlines can quote the same total on the same route
// on the same dates — without it, saving the second would silently
// dedupe against the first.
export function fareSavedKey(args: {
  source: string;
  from: string;
  to: string;
  depart: string;
  ret: string;
  travelers: number;
  total: number;
  airline?: string;
}): string {
  const parts = [
    'fare',
    args.source.toLowerCase(),
    args.from.toLowerCase(),
    args.to.toLowerCase(),
    args.depart,
    args.ret,
    String(args.travelers),
    String(args.total),
    ...(args.airline ? [args.airline.toLowerCase()] : []),
  ];
  return parts.join('|');
}

// The key for a saved package or trip: kind + destination +
// per-traveler price. The planner's estimate is date-independent, so
// the key carries no dates — the same trip at the same price is the
// same save, whatever week the traveler looks at it.
export function packageSavedKey(destination: string, perTraveler: number): string {
  return ['package', destination.toLowerCase(), String(perTraveler)].join('|');
}

export function tripSavedKey(destination: string, perTraveler: number): string {
  return ['trip', destination.toLowerCase(), String(perTraveler)].join('|');
}

// The price-kind line, in the traveler's words — the same honesty
// labels the cards use. A test fare never reads as a live one.
export function savedPriceKindLabel(kind: SavedPriceKind): string {
  if (kind === 'live') return 'Live fare';
  if (kind === 'test') return 'Test fare — not bookable, not a real price';
  return 'Planning estimate';
}

// The one-line detail My Trips shows under a saved entry:
// "Ignav · Live fare · $1,857 total · $929 per traveler · checked Nov 21, 2026".
export function savedDetailLine(detail: SavedDetail): string {
  const checked = new Date(detail.checkedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const bits = [
    detail.source,
    savedPriceKindLabel(detail.priceKind),
    `$${detail.total.toLocaleString()} total`,
    `$${detail.perTraveler.toLocaleString()} per traveler`,
    `checked ${checked}`,
  ];
  if (detail.dates) bits.push(detail.dates);
  return bits.join(' · ');
}

// The label a saved entry is stored under in My Trips — the human
// line, with the price kind in it so a saved test fare never reads
// as a saved deal.
export function savedLabel(detail: SavedDetail): string {
  if (detail.kind === 'fare') {
    return `${detail.route ?? detail.destination} · $${detail.total.toLocaleString()} · ${savedPriceKindLabel(detail.priceKind)}`;
  }
  return `${detail.destination} · from $${detail.perTraveler.toLocaleString()} per traveler · ${savedPriceKindLabel(detail.priceKind)}`;
}

// Validate a saved detail read back from localStorage (a corrupt or
// foreign value is dropped, never rendered) — the same shape the
// writers produce, nothing else.
export function isSavedDetail(value: unknown): value is SavedDetail {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.key === 'string' &&
    d.key.length > 0 &&
    (d.kind === 'fare' || d.kind === 'package' || d.kind === 'trip') &&
    typeof d.destination === 'string' &&
    d.destination.length > 0 &&
    typeof d.source === 'string' &&
    d.source.length > 0 &&
    (d.priceKind === 'live' || d.priceKind === 'test' || d.priceKind === 'estimate') &&
    typeof d.total === 'number' &&
    Number.isFinite(d.total) &&
    d.total > 0 &&
    typeof d.perTraveler === 'number' &&
    Number.isFinite(d.perTraveler) &&
    d.perTraveler > 0 &&
    typeof d.travelers === 'number' &&
    Number.isInteger(d.travelers) &&
    d.travelers >= 1 &&
    typeof d.checkedAt === 'string' &&
    !Number.isNaN(Date.parse(d.checkedAt)) &&
    (d.route === undefined || typeof d.route === 'string') &&
    (d.dates === undefined || typeof d.dates === 'string')
  );
}
