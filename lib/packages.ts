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
import { HIDDEN_GEMS, leadPhotoFor } from './data';

export type PackageTier = { name: 'Cheapest' | 'Best value' | 'Premium'; perTraveler: number };

export type Package = {
  id: string;
  destination: string;
  tag: string;
  // The route's cities in order (one city for a single place).
  stops: string[];
  nights: number;
  days: number;
  // What the trip IS (UX direction, Nov 19 2026 — P1-8): the card
  // names the trip — nights, cities, experiences — and the per-leg
  // dollar breakdown stays on the detail page only.
  experiences: number;
  photo: string | null;
  tiers: [PackageTier, PackageTier, PackageTier];
  best: PackageTier;
  // Best value legs, per traveler — what the price includes.
  includes: { flight: number; hotel: number; car: number; activities: number };
  bestMonth: number;
  bestNote: string;
};

export const PACKAGE_ESTIMATE_LABEL = 'planning estimate';

// The photo for a trip: one shared rule (lib/data.ts leadPhotoFor)
// — the route override, then the first stop with a photo, then the
// destination's own photo, else null (the card renders a labeled
// fallback, never a broken image). A package and its destination
// card never disagree.
function photoFor(entry: DiscoveryEntry): string | null {
  return leadPhotoFor(entry.destination, entry.stops.map((s) => s.city));
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
    experiences: entry.experiences,
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
// the order is stable. The deals shelf reads this — the cheapest
// trips, not a hand-picked "deal" that would need a discount to be
// real. `exclude` names destinations that already have a homepage
// band of their own (the hidden gems, Europe, the featured shelf) —
// the deals band is the cheapest of the REST, so no trip appears in
// two bands (UX direction, Nov 19 2026 — P0-7).
export function cheapestPackages(n: number, exclude: string[] = []): Package[] {
  const excluded = new Set(exclude);
  return [...allPackages()]
    .filter((p) => !excluded.has(p.destination))
    .sort((a, b) => a.best.perTraveler - b.best.perTraveler || a.destination.localeCompare(b.destination))
    .slice(0, Math.max(0, n));
}

// The deals band (UX direction, Nov 19 2026 — P0-7): the three
// cheapest trips that have NO other homepage band. The exclusion
// list is the single source of truth — DealsSection reads this
// function, and FujinApp's Popular band excludes the same names,
// so a destination can never appear in two bands by drift.
export function dealsPackages(): Package[] {
  return cheapestPackages(3, [
    ...featuredPackages().map((p) => p.destination),
    ...HIDDEN_GEMS.map((g) => g.name),
    'Europe',
  ]);
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

// --- The packages API seam (GET /api/packages) ----------------------
// collectLivePackageFares(): the ONE place live package fares enter
// the API. Today it returns [] — TourRadar, Intrepid and Viator are
// all awaiting replies (enquiries sent Nov 17, 2026; no keys yet),
// and the Hotelbeds Bundle product is a dated hotel-packaging
// search, not a per-package tour total, so it does not feed this
// list. When a tour supplier goes live, its adapter fills this list
// and packagePrice() prefers the live fare, labeled with source +
// check time. The API stays honest meanwhile: every price is the
// planner's planning estimate.
export async function collectLivePackageFares(): Promise<LivePackageFare[]> {
  return [];
}

export type PackageApiPrice = {
  perTraveler: number;
  label: string;
  source: string | null;
};

export type PackageApiEntry = Package & { price: PackageApiPrice };

export type PackageApiResponse = {
  source: 'fujintrip-packages';
  checkedAt: string;
  packages: PackageApiEntry[];
  liveFares: LivePackageFare[];
  sources: {
    hotelbedsBundle: { enabled: boolean; configured: boolean; active: boolean; sandbox: true };
    tourRadar: { status: 'awaiting_reply'; note: string };
    intrepid: { status: 'awaiting_reply'; note: string };
    viator: { status: 'awaiting_reply'; note: string };
  };
  note: string;
};

// The response GET /api/packages serves. `featured` narrows to the
// six featured packages; `destination` narrows to one package (empty
// list when the planner cannot price it). Always 200, never an
// invented price: without a live fare every price is the planner's
// planning estimate, labeled as such.
export async function packagesResponse(
  opts: { featured?: boolean; destination?: string },
  bundleStatus: { enabled: boolean; configured: boolean; active: boolean; sandbox: true }
): Promise<PackageApiResponse> {
  const liveFares = await collectLivePackageFares();
  let list: Package[];
  if (opts.destination) {
    const one = packageFor(opts.destination);
    list = one ? [one] : [];
  } else if (opts.featured) {
    list = featuredPackages();
  } else {
    list = allPackages();
  }
  return {
    source: 'fujintrip-packages',
    checkedAt: new Date().toISOString(),
    packages: list.map((pkg) => ({ ...pkg, price: packagePrice(pkg, liveFares) })),
    liveFares,
    sources: {
      hotelbedsBundle: bundleStatus,
      tourRadar: {
        status: 'awaiting_reply',
        note: 'Wholesale enquiry sent Nov 17, 2026 — no key yet.',
      },
      intrepid: {
        status: 'awaiting_reply',
        note: 'API enquiry sent Nov 17, 2026 — payment model unconfirmed.',
      },
      viator: {
        status: 'awaiting_reply',
        note: 'Merchant tier enquiry sent Nov 17, 2026 — approval pending.',
      },
    },
    note: 'Prices are planning estimates until a live tour supplier connects. Hotelbeds Bundle (flight + hotel packaging) is a separate dated search at /api/hotelbeds-bundle.',
  };
}
