// Ready-made packages (homepage restructure, Nov 15, 2026): curated
// trips a traveler picks ready instead of building a plan. Every
// number comes from the planner's own math (buildPlan, same totals the
// destination cards and the AI price table quote) — a package and the
// plan for the same route can never disagree. Prices are planning
// estimates until a supplier fare replaces a leg; nothing here is a
// live quote, and no price is ever invented.
//
// The live-fare seam: a package carries its planner totals, and
// packagePrice() prefers a supplier fare for the same destination
// when one exists (see LivePackageFare below). Hotelbeds Bundle feeds
// it today (Nov 21, 2026): the Bundle packaging search returns
// packaged hotel rates (SANDBOX TEST DATA), and the cheapest packaged
// hotel replaces the package's hotel leg — the flight, car and
// activities legs stay the planner's estimates, and the composed
// price is labeled test data, never live, never bookable. When Bundle
// returns nothing for a package, or the route cannot be served by a
// single-city packaging search, the planner estimate stands — the
// card never has to change shape when fares land, and no test fare
// can ever leak in as a "cheapest fare" (Duffel test fares are
// fictional and stay out of this list).

import { buildPlan, type DayPlan } from './planner';
import { discoveryDestinations, type DiscoveryEntry } from './discovery';
import { HIDDEN_GEMS, leadPhotoFor } from './data';
import { CITY_INFO } from './tripCard';
import { hotelbedsProductActive } from './hotelbeds';
import { searchHotelbedsBundle } from './hotelbeds-bundle';

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

// Ready-made trips (UX direction round 2, Nov 21 2026 — P0-4): the
// six cards in the Ready-made band — the five featured packages that
// are NOT this week's trip, plus the cheapest trip with no other
// homepage band, so the band still shows six and the week's trip
// never repeats. The filler is deterministic (cheapestPackages), so
// the band is stable week to week except for the rotation.
export function readyMadePackages(): Package[] {
  const weekTrip = tripOfTheWeek();
  const rest = featuredPackages().filter((p) => p.id !== weekTrip.id);
  const filler = cheapestPackages(1, [
    ...featuredPackages().map((p) => p.destination),
    ...HIDDEN_GEMS.map((g) => g.name),
    'Europe',
  ]);
  return [...rest, ...filler];
}

// Trip of the week (UX direction, Nov 19 2026 — P2-1): one of the
// six featured packages gets the larger hero card in the Ready-made
// trips band, with a 3-day preview of its real plan. The pick
// rotates by ISO calendar week — week-of-year modulo the featured
// list — so it changes weekly with no manual work and is
// deterministic: the same week always picks the same trip, on the
// server and in the browser. Week 53 wraps by the modulo. Dates are
// read in UTC so the pick does not flip at local midnight.
export function isoWeekOfYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function tripOfTheWeek(date: Date = new Date()): Package {
  const featured = featuredPackages();
  return featured[(isoWeekOfYear(date) - 1) % featured.length];
}

// The hero card's 3-day preview: the FIRST THREE DAYS of the
// package's own day-by-day plan (buildPlan, same data the detail
// page shows) — never invented itinerary days. Days carry the
// planner's generic day titles; the body names the destination.
export function tripOfTheWeekPreview(pkg: Package): DayPlan[] {
  return buildPlan(pkg.destination, 2, pkg.days).days.slice(0, 3);
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

// --- Live-fare seam -------------------------------------------------
// When a live supplier connects, its per-package fares arrive as
// LivePackageFare (source + when checked + per-traveler total) and
// packagePrice() prefers the live figure, labeled with its source and
// check time. Hotelbeds Bundle feeds the seam today (Nov 21, 2026):
// the packaging search returns packaged hotel rates — SANDBOX TEST
// DATA — and the cheapest packaged hotel replaces the package's hotel
// leg in the composed total. A Bundle fare is NEVER a live fare:
// its label is always the sandbox label, never "Live fare", never
// "bookable". Duffel test fares are fictional and stay out of this
// list entirely.
//
// A Bundle fare's perTraveler has one meaning per currency, and the
// type says which: when currency is USD it is the COMPOSED package
// total (planner flight + car + activities legs, Bundle hotel leg);
// otherwise it is the packaged hotel's own per-traveler price, and
// packagePrice() surfaces it as the bundleHotel detail instead of
// the total — two currencies are never added into one total, and no
// invented exchange rate is ever applied. hotelPerTraveler always
// carries the packaged hotel's own per-traveler price, in `currency`.
export type LivePackageFare = {
  destination: string;
  source: string;
  checkedAt: string;
  perTraveler: number;
  kind?: 'tour' | 'bundle';
  checkIn?: string;
  checkOut?: string;
  hotelName?: string;
  currency?: string;
  hotelPerTraveler?: number;
};

// The label every Bundle-sourced price carries — the sandbox
// warning, not a live quote. A Bundle price is test data from
// Hotelbeds' evaluation account: never a real price, never bookable.
export const PACKAGE_BUNDLE_LABEL = 'Test data — not a real price';

// The packaged hotel behind a Bundle fare, in its own currency —
// the detail the card shows when the fare cannot compose into the
// USD total (its currency is not USD). The hotel price is Bundle
// sandbox test data; the package total stays the planner estimate.
export type BundleHotelDetail = {
  hotelName: string;
  perTraveler: number;
  currency: string;
  checkIn: string;
  checkOut: string;
  checkedAt: string;
};

export type PackagePrice = {
  perTraveler: number;
  label: string;
  source: string | null;
  bundleHotel?: BundleHotelDetail;
};

export function currencySymbol(code: string): string {
  if (code === 'USD') return '$';
  if (code === 'EUR') return '€';
  if (code === 'GBP') return '£';
  return code;
}

// The card line for a packaged hotel that could not compose into
// the total: hotel, price in its own currency, dates, and the
// sandbox warning — never "live", never "bookable".
export function bundleHotelLabel(detail: BundleHotelDetail): string {
  return `Packaged hotel: ${detail.hotelName} from ${currencySymbol(detail.currency)}${detail.perTraveler.toLocaleString()} · ${detail.checkIn} → ${detail.checkOut} · ${PACKAGE_BUNDLE_LABEL}`;
}

export function packagePrice(
  pkg: Package,
  liveFares: LivePackageFare[] | null | undefined
): PackagePrice {
  const fares = liveFares ?? [];
  // A real live fare wins over sandbox test data: the Bundle branch
  // below never shadows a market price. Test-mode fares are never
  // live fares either — a source whose name says "test" is skipped,
  // so a Duffel test fare can never be shown as a market price.
  const live = fares.find(
    (f) => f.destination === pkg.destination && f.kind !== 'bundle' && !/test/i.test(f.source)
  );
  if (live) {
    return { perTraveler: live.perTraveler, label: 'Live fare', source: `${live.source} · checked ${live.checkedAt.slice(0, 10)}` };
  }
  // No live fare: a Bundle fare is sandbox test data, so its label
  // is always the sandbox label — never "Live fare" — and a fare in
  // another currency never becomes the total.
  const bundle = fares.find((f) => f.destination === pkg.destination && f.kind === 'bundle');
  if (bundle && bundle.currency === 'USD' && bundle.checkIn && bundle.checkOut && bundle.hotelName && bundle.checkedAt) {
    return {
      perTraveler: bundle.perTraveler,
      label: PACKAGE_BUNDLE_LABEL,
      source: `Hotelbeds Bundle (sandbox) · ${bundle.hotelName} · ${bundle.checkIn} → ${bundle.checkOut} · checked ${bundle.checkedAt.slice(0, 10)}`,
    };
  }
  // No live fare, or a Bundle fare in another currency: the planner
  // estimate stands — and a non-USD packaged hotel is still shown,
  // in its own currency, as the bundleHotel detail.
  const price: PackagePrice = { perTraveler: pkg.best.perTraveler, label: PACKAGE_ESTIMATE_LABEL, source: null };
  if (
    bundle &&
    bundle.currency &&
    bundle.currency !== 'USD' &&
    bundle.hotelPerTraveler !== undefined &&
    bundle.checkIn &&
    bundle.checkOut &&
    bundle.hotelName &&
    bundle.checkedAt
  ) {
    price.bundleHotel = {
      hotelName: bundle.hotelName,
      perTraveler: bundle.hotelPerTraveler,
      currency: bundle.currency,
      checkIn: bundle.checkIn,
      checkOut: bundle.checkOut,
      checkedAt: bundle.checkedAt,
    };
  }
  return price;
}

// --- The packages API seam (GET /api/packages) ----------------------
// collectLivePackageFares(): the ONE place live package fares enter
// the API. Today the fares come from the Hotelbeds Bundle packaging
// search (Nov 21, 2026): one search per package, at the trip's first
// stop city, for the package's nights — on the caller's checkIn when
// one is given, else the 1st of the package's best month at its next
// occurrence. The search is a single-city packaging search, so a
// route whose first stop has no coordinates in CITY_INFO cannot be
// served and keeps its planner estimate; a search that returns no
// hotels, errors, or hits the quota falls back the same way. The
// composed total replaces ONLY the hotel leg (Best value flight +
// car + activities legs stay the planner's), and only when the
// packaged hotel prices in USD — a fare in another currency is
// returned as the hotel-only detail, never added into a USD total.
//
// WHY it returned [] before: the seam was written Nov 17, 2026, when
// Bundle was read as "a dated hotel-packaging search, not a
// per-package tour total" and the toggle was off — so the function
// hard-returned [] by design. The toggle is on now (Nov 17), and the
// composition above is the honest way a hotel-packaging search feeds
// a package price: the hotel leg is the leg Bundle actually prices.
function validIsoDate(v: string | undefined): v is string {
  if (!v) return false;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The 1st of the package's best month at its next occurrence (UTC):
// this year's 1st when it is still ahead, else next year's. The
// dates are the search window, disclosed on the fare — never a
// price, never a booking.
export function nextBestMonthStart(bestMonth: number, now: Date = new Date()): string {
  const month = Math.min(12, Math.max(1, Math.floor(bestMonth) || 1));
  const thisYear = Date.UTC(now.getUTCFullYear(), month - 1, 1);
  const start = thisYear > now.getTime() ? thisYear : Date.UTC(now.getUTCFullYear() + 1, month - 1, 1);
  return new Date(start).toISOString().slice(0, 10);
}

export async function collectLivePackageFares(opts?: {
  packages?: Package[];
  checkIn?: string;
}): Promise<LivePackageFare[]> {
  if (!hotelbedsProductActive('bundle')) return [];
  const list = opts?.packages ?? allPackages();
  const start = validIsoDate(opts?.checkIn) ? opts.checkIn : undefined;
  const settled = await Promise.allSettled(
    list.map(async (pkg): Promise<LivePackageFare | null> => {
      const city = pkg.stops[0];
      const info = city ? CITY_INFO[city] : undefined;
      if (!info) return null;
      const checkIn = start ?? nextBestMonthStart(pkg.bestMonth);
      const checkOut = addDaysIso(checkIn, pkg.nights);
      const res = await searchHotelbedsBundle({
        latitude: info.lat,
        longitude: info.lng,
        destination: city,
        checkIn,
        checkOut,
        guests: 1,
        rooms: 1,
      }).catch(() => null);
      if (!res || !res.live || !res.hotels.length || !res.checkedAt) return null;
      const hotel = res.hotels[0];
      if (hotel.currency === 'USD') {
        // The hotel leg is the only leg Bundle prices: the composed
        // total is the planner's Best value total with its hotel leg
        // swapped for the packaged hotel's per-traveler price.
        const composed = Math.max(1, Math.round(pkg.best.perTraveler - pkg.includes.hotel + hotel.perTraveler));
        return {
          destination: pkg.destination,
          source: 'hotelbeds-bundle',
          checkedAt: res.checkedAt,
          perTraveler: composed,
          kind: 'bundle',
          checkIn,
          checkOut,
          hotelName: hotel.name,
          currency: 'USD',
          hotelPerTraveler: hotel.perTraveler,
        };
      }
      return {
        destination: pkg.destination,
        source: 'hotelbeds-bundle',
        checkedAt: res.checkedAt,
        perTraveler: hotel.perTraveler,
        kind: 'bundle',
        checkIn,
        checkOut,
        hotelName: hotel.name,
        currency: hotel.currency,
        hotelPerTraveler: hotel.perTraveler,
      };
    })
  );
  const fares: LivePackageFare[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) fares.push(s.value);
  }
  return fares;
}

export type PackageApiPrice = {
  perTraveler: number;
  label: string;
  source: string | null;
  // A packaged hotel that could not compose into the USD total (its
  // currency is not USD): shown in its own currency, test data.
  bundleHotel?: BundleHotelDetail;
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
// list when the planner cannot price it); `checkIn` (YYYY-MM-DD)
// sets the Bundle search start — the stay length is always the
// package's nights, and without a checkIn each package is searched
// on the 1st of its best month at its next occurrence. Always 200,
// never an invented price: without a Bundle fare every price is the
// planner's planning estimate, labeled as such.
export async function packagesResponse(
  opts: { featured?: boolean; destination?: string; checkIn?: string },
  bundleStatus: { enabled: boolean; configured: boolean; active: boolean; sandbox: true }
): Promise<PackageApiResponse> {
  let list: Package[];
  if (opts.destination) {
    const one = packageFor(opts.destination);
    list = one ? [one] : [];
  } else if (opts.featured) {
    list = featuredPackages();
  } else {
    list = allPackages();
  }
  // The Bundle search runs only for the packages actually listed —
  // a featured call searches six, not twenty-one — so one API call
  // never burns the whole daily Bundle quota.
  const liveFares = await collectLivePackageFares({ packages: list, checkIn: opts.checkIn });
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
    note: 'Prices are planning estimates unless a Hotelbeds Bundle fare is shown: Bundle fares are sandbox test data (hotel leg from the packaging search, other legs planner estimates) and are labeled "Test data — not a real price". Tour suppliers (TourRadar, Intrepid, Viator) are still awaiting replies.',
  };
}
