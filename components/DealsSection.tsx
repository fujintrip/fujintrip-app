// Deals of the week (homepage restructure, Nov 15, 2026): the three
// lowest planning estimates this week — the same honest estimate,
// never a marked-up price or a discount that does not exist. The
// ranking is the planner's own data (cheapestPackages), so the shelf
// changes only when the planner's prices change. Same card as the
// packages shelf, in the 3-column grid (audit round, Nov 17 2026:
// the wide rows read as empty white — Expedia shows deals as a
// 3-column grid). One price per card, one action ("View trip") —
// see PackageCard. Never "Book now".
//
// Dedup (UX direction, Nov 19 2026 — P0-7): the deals are the
// cheapest of the trips that have NO other homepage band — the
// featured shelf, the hidden gems and 'Europe' are excluded, so no
// destination appears in more than one band.
'use client';
import { dealsPackages, type LivePackageFare } from '../lib/packages';
import { PackageCard } from './PackagesSection';

export default function DealsSection({
  liveFares,
}: {
  liveFares?: LivePackageFare[] | null;
}) {
  const deals = dealsPackages();
  return (
    <section className="home-section" aria-label="Deals of the week">
      <p className="eyebrow">Deals of the week</p>
      <h2>Our lowest prices this week</h2>
      <p className="sub">
        The three lowest planning estimates from the trips not shown elsewhere on this page — no marked-up prices, no
        fake discounts. Prices are planning estimates until live suppliers connect.
      </p>
      <div className="deals-grid">
        {deals.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} liveFares={liveFares} />
        ))}
      </div>
    </section>
  );
}
