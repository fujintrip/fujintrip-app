// Add-to-bundle-later (competitor learning round 2 #7 — Expedia One Key
// Nov 2026 pattern).
//
// The traveler does not have to book everything at once: once a flight
// is set, the hotel, car or activities can be added now or any time
// before the last day of the trip, at the same bundled price. The bundle
// is the set of legs the traveler picked from the map's price tags; the
// total is the exact sum of those legs (legs already sum exactly to the
// planner totals, so the bundle total never drifts), and the bundle
// stays open until the trip's last travel day.
//
// Nothing here books anything — it only records what the traveler
// picked, so the plan view and the chat always show the same bundle.
import type { TripLeg } from './tripCard';

// A leg as stored in the bundle: the fields the plan view shows. The
// id is the trip card's leg id, so the same leg can never be added
// twice; the price is the card's price for the picked tier.
export type BundleLeg = {
  id: string;
  kind: 'flight' | 'transport' | 'stay' | 'car';
  label: string;
  detail: string;
  price: number;
  city: string;
};

export type Bundle = { legs: BundleLeg[] };

export function emptyBundle(): Bundle {
  return { legs: [] };
}

function toBundleLeg(leg: TripLeg): BundleLeg {
  return { id: leg.id, kind: leg.kind, label: leg.label, detail: leg.detail, price: leg.price, city: leg.city };
}

// Build the bundle snapshot from a trip card's legs and the ids the
// traveler picked. A leg that is no longer on the card (the route
// changed) drops out on its own — the bundle never holds a leg the
// trip does not have.
export function bundleFromLegs(legs: TripLeg[], ids: Set<string> | string[]): Bundle {
  const wanted = new Set(ids);
  return { legs: legs.filter((l) => wanted.has(l.id)).map(toBundleLeg) };
}

// The exact sum of the bundle's legs — no rounding, no per-leg markup.
export function bundleTotal(bundle: Bundle): number {
  return bundle.legs.reduce((s, l) => s + l.price, 0);
}

// Add a leg; a leg already in the bundle is left alone (the same
// function returns the same bundle — the traveler tapping "Add to plan"
// twice cannot double-charge the bundle).
export function addLeg(bundle: Bundle, leg: TripLeg | BundleLeg): Bundle {
  if (bundle.legs.some((l) => l.id === leg.id)) return bundle;
  // A TripLeg carries startDate (and the map fields); a BundleLeg is
  // already the stored shape — only the first needs converting.
  const next: BundleLeg = 'startDate' in leg ? toBundleLeg(leg) : leg;
  return { legs: [...bundle.legs, next] };
}

export function removeLeg(bundle: Bundle, id: string): Bundle {
  if (!bundle.legs.some((l) => l.id === id)) return bundle;
  return { legs: bundle.legs.filter((l) => l.id !== id) };
}

export function hasLeg(bundle: Bundle, id: string): boolean {
  return bundle.legs.some((l) => l.id === id);
}

// The last day the bundle stays open for new legs: the trip's last
// travel day, formatted the way the plan view writes dates.
export function bundleLockedUntil(endDate: Date): string {
  return endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// One-line read of the bundle, for the chat after an add and for the
// plan view: the item count, the exact total, and the last day a leg
// can still be added at the same bundled price.
export function bundleLine(bundle: Bundle, lockedUntil: string): string {
  if (!bundle.legs.length) {
    return 'Your bundle is empty — add legs from the map price tags to start it.';
  }
  const n = bundle.legs.length;
  return `Your bundle is now ${n} item${n > 1 ? 's' : ''} — $${bundleTotal(bundle).toLocaleString()} total, locked until ${lockedUntil}. You can add your hotel, car or activities any time before then, at the same bundled price.`;
}

// The localStorage key for a trip's bundle: the destination, the party
// size and the trip length — a bundle from another trip never restores
// onto this one, and a new trip clears the old bundle.
export function bundleKey(destination: string, travelers: number, durationDays: number): string {
  return `${destination}|${travelers}|${durationDays}`;
}
