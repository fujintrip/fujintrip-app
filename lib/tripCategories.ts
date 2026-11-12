// Template categories (Layla-dynamic round, Nov 12, 2026): layla.ai's
// "Trips ready to book" template library has category filter pills —
// ours get the same interaction, with honest categories derived from
// each destination's own card data (its tag, blurb and itinerary in
// lib/data.ts, plus the trip card's stops). A destination carries only
// the categories its own itinerary genuinely fits. Deliberately NOT
// copied: Layla's 72+ template count and remix counts — we have no
// remix data, and no count is ever invented here; the pill counts are
// the real number of cards in the category.
export type TripCategory = 'Cities & culture' | 'Beach & islands' | 'Mountains & nature' | 'Food';

export const TRIP_CATEGORIES: TripCategory[] = ['Cities & culture', 'Beach & islands', 'Mountains & nature', 'Food'];

// One judgment call per destination, from its own card:
// - Santorini: white villages + blue domes (culture); caldera cruise +
//   beach (islands). One wine day does not make it a food trip — Food
//   is left out on purpose.
// - Kyoto: temples, bamboo groves, tea houses, Gion (culture); tea
//   houses + tea ceremony (food).
// - Bali: surf + island mornings (islands); its own trend line is
//   "Surf + food favourite" (food); temples (culture).
// - Caribbean: turquoise water + island hopping (islands); local
//   markets (food).
// - Maldives: overwater calm + reef snorkelling + sandbank — islands
//   only; its card claims no food or culture.
// - Paris: museums + Montmartre (culture); cafés + markets (food).
// - St. George: Zion + red-rock canyons + desert trails — mountains
//   and nature only.
// - Tacoma: Mount Rainier + forests (mountains); Museum of Glass +
//   waterfront (culture).
// - Hilo: volcanoes + waterfalls (mountains); black-sand beaches
//   (islands); farmers' market (food).
const CATEGORIES: Record<string, TripCategory[]> = {
  Santorini: ['Cities & culture', 'Beach & islands'],
  Kyoto: ['Cities & culture', 'Food'],
  Bali: ['Beach & islands', 'Food', 'Cities & culture'],
  Caribbean: ['Beach & islands', 'Food'],
  Maldives: ['Beach & islands'],
  Paris: ['Cities & culture', 'Food'],
  'St. George': ['Mountains & nature'],
  Tacoma: ['Mountains & nature', 'Cities & culture'],
  Hilo: ['Mountains & nature', 'Beach & islands', 'Food'],
};

// Categories for a destination, or [] when it has none — never
// guessed: an unknown name gets no categories, so it can only show
// under "All".
export function categoriesFor(name: string): TripCategory[] {
  return CATEGORIES[name] ?? [];
}

export type PackageFilter = TripCategory | 'All';

// Filter a list of destination names by category. Pure — unit-tested.
export function filterByCategory(names: string[], filter: PackageFilter): string[] {
  if (filter === 'All') return [...names];
  return names.filter((n) => categoriesFor(n).includes(filter));
}

// Real counts per category, for the filter pills — categories with no
// cards are omitted, so a pill can never lead to an empty grid.
export function categoryCounts(names: string[]): Array<{ category: TripCategory; count: number }> {
  return TRIP_CATEGORIES.map((category) => ({
    category,
    count: names.filter((n) => categoriesFor(n).includes(category)).length,
  })).filter((c) => c.count > 0);
}
