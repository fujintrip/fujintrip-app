// Ready-made packages (homepage restructure, Nov 15, 2026): curated
// trips a traveler picks ready instead of building a plan. Every
// number comes from the planner's own math (buildPlan, same totals the
// destination cards and the AI price table quote) — a package and the
// plan for the same route can never disagree. Prices are planning
// estimates until a live supplier connects; nothing here is a live
// quote, and no price is ever invented.
//
// The shape is the live-fares seam: a package carries its planner
// totals today, and packagePrice() prefers a live fare for the same
// destination when one exists (see LivePackageFare below). When a
// supplier goes live, only the fare source changes — the card, the
// tiers and the actions stay exactly as they are.

import { buildPlan } from './planner';
import { discoveryDestinations, type DiscoveryEntry } from './discovery';
import { CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from './data';

export type PackageTier = { name: 'Cheapest' | 'Best value' | 'Premium'; perTraveler: number };

export type Package = {
  id: string;
  destination: string;
  tag: string;
  // The route's cities in order (one city for a single place).
  stops: string[];
  nights: number;
  days: number;
  photo: string | null;
  tiers: [PackageTier, PackageTier, PackageTier];
  best: PackageTier;
  // Best value legs, per traveler — what the price includes.
  includes: { flight: number; hotel: number; car: number; activities: number };
  bestMonth: number;
  bestNote: string;
};

export const PACKAGE_ESTIMATE_LABEL = 'planning estimate';

// The photo for a trip: the first stop's city photo, else the
// destination's own photo, else null (the card renders a labeled
// fallback, never a broken image). Same map the destination cards
// use, so a package and its destination card never disagree.
function photoFor(entry: DiscoveryEntry): string | null {
  const byName = new Map<string, string>([
    ...GLOBAL_DESTINATIONS.map((d) => [d.name, d.image] as const),
    ...HIDDEN_GEMS.map((d) => [d.name, d.image] as const),
    ...Object.entries(CITY_PHOTOS),
  ]);
  return byName.get(entry.stops[0]?.city ?? '') ?? byName.get(entry.destination) ?? null;
}

export function packageFor(destination: string): Package | null {
  const entry = discoveryDestinations().find((e) => e.destination === destination);
  if (!entry) return null;
  // One traveler: the planner's per-traveler totals are the base ×
  // tier factor (Cheapest 0.64, Best value 1.0, Premium 1.64), legs
  // exact, so the tiers and the inclusions always add up.
  const plan = buildPlan(destination, 1, entry.days);
  const [cheapest, best, premium] = plan.options;
  return {
    id: entry.key,
    destination,
    tag: entry.tag,
    stops: entry.stops.map((s) => s.city),
    nights: entry.nights,
    days: entry.days,
    photo: photoFor(entry),
    tiers: [
      { name: 'Cheapest', perTraveler: cheapest.total },
      { name: 'Best value', perTraveler: best.total },
      { name: 'Premium', perTraveler: premium.total },
    ],
    best: { name: 'Best value', perTraveler: best.total },
    includes: { flight: best.flight, hotel: best.hotel, car: best.car, activities: best.activities },
    bestMonth: entry.bestMonth,
    bestNote: entry.bestNote,
  };
}

// Every trip the planner can price — the 17 routes + the 4
// base-price places (Bali, St. George, Tacoma, Hilo). A destination
// the planner cannot price never becomes a package.
export function allPackages(): Package[] {
  return discoveryDestinations()
    .map((e) => packageFor(e.destination))
    .filter((p): p is Package => p !== null);
}

// The featured shelf: a curated mix of regions and budgets — one per
// region, spanning the price range. The curation IS this list (a
// shelf, like a bookshop's staff picks); every price on the shelf
// still comes from the planner, never from the list.
const FEATURED = ['Central Europe', 'Japan', 'Greece', 'Morocco', 'Thailand', 'Bali'];

export function featuredPackages(): Package[] {
  return FEATURED.map((d) => packageFor(d)).filter((p): p is Package => p !== null);
}

// Cheapest first by Best value per traveler, ties broken by name so
// the order is stable. The fares strip and the deals shelf both read
// this — the cheapest trips, not a hand-picked "deal" that would need
// a discount to be real.
export function cheapestPackages(n: number): Package[] {
  return [...allPackages()]
    .sort((a, b) => a.best.perTraveler - b.best.perTraveler || a.destination.localeCompare(b.destination))
    .slice(0, Math.max(0, n));
}

// --- Live-fare seam (no live source today) ---------------------------
// When a live supplier connects, its per-package fares arrive as
// LivePackageFare (source + when checked + per-traveler total) and
// packagePrice() prefers the live figure, labeled with its source and
// check time. Today the list is always empty, so every price is the
// planning estimate — the card never has to change shape when live
// fares land, and no test fare can ever leak in as a "cheapest fare"
// (Duffel test fares are fictional and stay out of this list).
export type LivePackageFare = { destination: string; source: string; checkedAt: string; perTraveler: number };

export function packagePrice(
  pkg: Package,
  liveFares: LivePackageFare[] | null | undefined
): { perTraveler: number; label: string; source: string | null } {
  // Test-mode fares are never live fares: a source whose name says
  // "test" is skipped, so a Duffel test fare can never be shown as a
  // market price.
  const live = (liveFares ?? []).find((f) => f.destination === pkg.destination && !/test/i.test(f.source));
  if (live) {
    return { perTraveler: live.perTraveler, label: 'Live fare', source: `${live.source} · checked ${live.checkedAt.slice(0, 10)}` };
  }
  return { perTraveler: pkg.best.perTraveler, label: PACKAGE_ESTIMATE_LABEL, source: null };
}
