// Price alerts on live fares (roadmap, Nov 21 2026 — F5, Kayak
// Alerts / Skyscanner DROPS model, FujinTrip's own shape).
//
// What it is: the traveler sees a LIVE Ignav fare and taps "Set
// price alert". The alert stores the fare's price as its baseline
// (route + dates + travelers + cabin + when it was checked) and
// lives on this device only (localStorage, My Trips). When the
// traveler opens My Trips, each alert is re-checked once against a
// fresh live Ignav search for the same trip — no background cron,
// no email, no account. A drop of 20% or more against the baseline
// is flagged as a drop (the DROPS threshold).
//
// What it is not: a forecast (there is no historical fare data to
// forecast from — that part of F5 is deliberately NOT built), and
// never a tool on a planning estimate or a Duffel test fare. An
// alert can only be created from a live Ignav fare; the creator
// refuses anything else. A saved estimate or test fare has no
// "Set price alert" button at all.
//
// Pure functions only (no localStorage, no fetch here — the
// components own the read/write and the re-check, like the rest of
// the app's device-local state).

export const PRICE_DROP_THRESHOLD = 0.2; // 20% — DROPS-style.
export const PRICE_ALERTS_STORAGE_KEY = 'fujintrip-price-alerts';

// An alert watches ONE live Ignav fare: a round-trip itinerary or a
// one-way itinerary, for the searched party. `return` is '' for a
// one-way alert. The baseline is the party total the traveler saw
// when they set the alert; `lastPrice` is the cheapest live Ignav
// itinerary for the same trip at the last check (it starts at the
// baseline — the fare was just seen). `lastCheckOk` is false when
// the last re-check found no live fare at all: the price is then
// left as it was, and the line says so instead of claiming a check
// that never happened.
export type PriceAlert = {
  key: string;
  source: 'Ignav';
  tripType: 'oneway' | 'roundtrip';
  from: string;
  to: string;
  depart: string;
  return: string;
  travelers: number;
  cabin: string;
  baselineTotal: number;
  baselineCheckedAt: string;
  createdAt: string;
  lastPrice: number;
  lastCheckedAt: string;
  lastCheckOk: boolean;
};

// The key: source + route + dates + party + cabin. One alert per
// trip — setting the same alert twice keeps the first baseline, so
// a drop is always measured against the price the traveler first
// saw, not a re-set one.
export function priceAlertKey(args: {
  from: string;
  to: string;
  depart: string;
  ret: string;
  travelers: number;
  cabin: string;
}): string {
  return [
    'alert',
    'ignav',
    args.from.toLowerCase(),
    args.to.toLowerCase(),
    args.depart,
    args.ret,
    String(args.travelers),
    args.cabin.toLowerCase(),
  ].join('|');
}

// How far a price has fallen from the baseline, in percent (0 when
// it has not fallen, or when the baseline is not a real price).
export function priceDropPercent(baseline: number, current: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(current) || current <= 0) return 0;
  if (current >= baseline) return 0;
  return ((baseline - current) / baseline) * 100;
}

// A drop is 20% or more below the baseline — exactly 20% counts.
// A price that rose, stayed, or is not a real price is never a drop.
export function isPriceDrop(baseline: number, current: number): boolean {
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(current) || current <= 0) return false;
  return current <= baseline * (1 - PRICE_DROP_THRESHOLD);
}

// The guard: an alert may only be created from a LIVE Ignav fare.
// Anything else — a planning estimate, a Duffel test fare, a
// LetsFG fare — returns null, so no price tool ever attaches to
// it. The caller checks the return, never the fare's label.
export function createPriceAlert(args: {
  source: string;
  priceKind: 'live' | 'test' | 'estimate';
  tripType: 'oneway' | 'roundtrip';
  from: string;
  to: string;
  depart: string;
  ret: string;
  travelers: number;
  cabin: string;
  total: number;
  checkedAt: string;
}): PriceAlert | null {
  if (args.source !== 'Ignav' || args.priceKind !== 'live') return null;
  if (!Number.isFinite(args.total) || args.total <= 0) return null;
  if (!Number.isInteger(args.travelers) || args.travelers < 1) return null;
  if (Number.isNaN(Date.parse(args.checkedAt))) return null;
  const now = new Date().toISOString();
  return {
    key: priceAlertKey({ from: args.from, to: args.to, depart: args.depart, ret: args.ret, travelers: args.travelers, cabin: args.cabin }),
    source: 'Ignav',
    tripType: args.tripType,
    from: args.from,
    to: args.to,
    depart: args.depart,
    return: args.ret,
    travelers: args.travelers,
    cabin: args.cabin,
    baselineTotal: Math.round(args.total),
    baselineCheckedAt: args.checkedAt,
    createdAt: now,
    lastPrice: Math.round(args.total),
    lastCheckedAt: now,
    lastCheckOk: true,
  };
}

// Is this alert showing a drop right now? Derived from the last
// checked price, never stored — one source of truth, so a re-check
// can never leave a stale flag behind.
export function alertIsDrop(alert: PriceAlert): boolean {
  return alert.lastCheckOk && isPriceDrop(alert.baselineTotal, alert.lastPrice);
}

// Apply one re-check result. A live price updates the last price
// and the checked time; a check that found no live fare (null)
// updates only the checked time and marks the check as failed —
// the last known price stays, and the line says the check found
// nothing instead of pretending the fare is unchanged.
export function evaluatePriceAlert(alert: PriceAlert, currentPrice: number | null, checkedAt: string): PriceAlert {
  if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { ...alert, lastCheckedAt: checkedAt, lastCheckOk: false };
  }
  return { ...alert, lastPrice: Math.round(currentPrice), lastCheckedAt: checkedAt, lastCheckOk: true };
}

function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function datesLine(alert: PriceAlert): string {
  if (alert.tripType === 'oneway' || !alert.return) return shortDate(alert.depart);
  const from = new Date(`${alert.depart}T00:00:00`);
  const to = new Date(`${alert.return}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${alert.depart} – ${alert.return}`;
  const sameYear = from.getFullYear() === to.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
  return `${fmt(from, false)} – ${fmt(to, sameYear)}`;
}

// The one-line status My Trips shows under an alert — always the
// baseline, the last checked price, whether it dropped, and when it
// was last checked. Nothing is ever presented as checked when it
// was not.
export function priceAlertLine(alert: PriceAlert): string {
  const checked = shortDate(alert.lastCheckedAt);
  const bits = [
    'Ignav',
    `${alert.from} → ${alert.to}`,
    datesLine(alert),
    `$${alert.baselineTotal.toLocaleString()} when set`,
  ];
  if (!alert.lastCheckOk) {
    bits.push('no live fare found on the last check');
  } else if (alertIsDrop(alert)) {
    bits.push(`now $${alert.lastPrice.toLocaleString()}`);
    bits.push(`↓ ${priceDropPercent(alert.baselineTotal, alert.lastPrice).toFixed(0)}% lower`);
  } else if (alert.lastPrice !== alert.baselineTotal) {
    bits.push(`now $${alert.lastPrice.toLocaleString()}`);
  }
  bits.push(`last checked ${checked}`);
  return bits.join(' · ');
}

// Validate an alert read back from localStorage (a corrupt or
// foreign value is dropped, never rendered) — the same shape the
// creator produces, nothing else.
export function isPriceAlert(value: unknown): value is PriceAlert {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.key === 'string' &&
    a.key.length > 0 &&
    a.source === 'Ignav' &&
    (a.tripType === 'oneway' || a.tripType === 'roundtrip') &&
    typeof a.from === 'string' &&
    a.from.length > 0 &&
    typeof a.to === 'string' &&
    a.to.length > 0 &&
    typeof a.depart === 'string' &&
    a.depart.length > 0 &&
    typeof a.return === 'string' &&
    (a.tripType === 'oneway' || a.return.length > 0) &&
    typeof a.travelers === 'number' &&
    Number.isInteger(a.travelers) &&
    a.travelers >= 1 &&
    typeof a.cabin === 'string' &&
    a.cabin.length > 0 &&
    typeof a.baselineTotal === 'number' &&
    Number.isFinite(a.baselineTotal) &&
    a.baselineTotal > 0 &&
    typeof a.baselineCheckedAt === 'string' &&
    !Number.isNaN(Date.parse(a.baselineCheckedAt)) &&
    typeof a.createdAt === 'string' &&
    !Number.isNaN(Date.parse(a.createdAt)) &&
    typeof a.lastPrice === 'number' &&
    Number.isFinite(a.lastPrice) &&
    a.lastPrice > 0 &&
    typeof a.lastCheckedAt === 'string' &&
    !Number.isNaN(Date.parse(a.lastCheckedAt)) &&
    typeof a.lastCheckOk === 'boolean'
  );
}
