// Deals of the week (homepage restructure, Nov 15, 2026): the three
// lowest planning estimates this week — the same honest estimate,
// never a marked-up price or a discount that does not exist. The
// ranking is the planner's own data (cheapestPackages), so the shelf
// changes only when the planner's prices change. Same card as the
// packages shelf, in the 3-column grid (audit round, Nov 17 2026:
// the wide rows read as empty white — Expedia shows deals as a
// 3-column grid), same actions: "Save this search" first, "View
// package" second, never "Book now".
'use client';
import { cheapestPackages, type LivePackageFare, type Package } from '../lib/packages';
import { PackageCard } from './PackagesSection';

export default function DealsSection({
  onViewPackage,
  onSavePackage,
  liveFares,
}: {
  onViewPackage: (destination: string) => void;
  onSavePackage: (pkg: Package) => void;
  liveFares?: LivePackageFare[] | null;
}) {
  const deals = cheapestPackages(3);
  return (
    <section className="home-section" aria-label="Deals of the week">
      <p className="eyebrow">Deals of the week</p>
      <h2>Our lowest prices this week</h2>
      <p className="sub">
        The three lowest planning estimates across all our trips — no marked-up prices, no fake discounts. Prices are
        planning estimates until live suppliers connect.
      </p>
      <div className="deals-grid">
        {deals.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            liveFares={liveFares}
            onView={() => onViewPackage(pkg.destination)}
            onSave={() => onSavePackage(pkg)}
          />
        ))}
      </div>
    </section>
  );
}
