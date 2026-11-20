// Ready-made packages (homepage restructure, Nov 15, 2026): the
// centerpiece — curated trips a traveler picks ready instead of
// building a plan. Bento grid: the first card is the hero (spans
// 2×2), the rest fill around it; on a phone every card stacks full
// width. One price per card — Best value per traveler — and one
// action, "View trip", which opens the package detail page where
// the Cheapest / Best value / Premium tiers and the cost breakdown
// live (UX direction, Nov 19 2026 — P0-3). Every price is the
// planner's own math (lib/packages.ts) — planning estimate until a
// live supplier connects. Never "Book now" — checkout is not built.
'use client';
import { featuredPackages, packagePrice, type LivePackageFare, type Package } from '../lib/packages';
import { shareTextFor } from '../lib/share';
import { Icon } from './icons';
import { SafeImg } from './FujinChat';
import ShareMenu from './ShareMenu';

export function PackageCard({
  pkg,
  hero,
  liveFares,
}: {
  pkg: Package;
  hero?: boolean;
  liveFares?: LivePackageFare[] | null;
}) {
  const price = packagePrice(pkg, liveFares);
  return (
    <article className={`pkg-card${hero ? ' pkg-card--hero' : ''}`}>
      {pkg.photo ? (
        <SafeImg src={pkg.photo} alt={pkg.destination} label={pkg.destination} className="pkg-photo" />
      ) : (
        <div className="pkg-photo-fallback" role="img" aria-label={pkg.destination}>
          <span>{pkg.destination}</span>
        </div>
      )}
      <div className="pkg-body">
        {/* Card top row (audit round, Nov 17, 2026): the tag pill and
            share sit together up top, so the action row below holds
            exactly one primary action. */}
        <div className="card-top">
          <span className="pill">{pkg.tag}</span>
          {/* Social share-out (Nov 15, 2026): the link lands on the
              packages grid; the text names the package and its
              from-price. Posting happens on the network the traveler
              picks, never by FujinTrip. */}
          <ShareMenu
            url="/#packages"
            text={shareTextFor('package', pkg.destination, `from $${price.perTraveler.toLocaleString()} per traveler · planning estimate`)}
            buttonClassName="linklike"
          />
        </div>
        <h3>{pkg.destination}</h3>
        <p className="pkg-route">{pkg.stops.join(' → ')}</p>
        <p className="pkg-meta">
          <Icon name="calendar" size={15} /> {pkg.nights} nights · {pkg.stops.length}{' '}
          {pkg.stops.length === 1 ? 'city' : 'cities'} · {pkg.experiences} experiences
        </p>
        <p className="pkg-price">
          from ${price.perTraveler.toLocaleString()} <span>per traveler</span>
        </p>
        {/* The estimate label is gone from the card (UX direction,
            Nov 19 2026 — P1-3): one honesty line per page — the
            widget line under the search — covers it. A LIVE fare
            keeps its label + source, because that is the quote. */}
        {price.source && (
          <p className="plan-muted">
            {price.label} · {price.source}
          </p>
        )}
        <div className="pkg-actions">
          <a className="primary" href={`/destination/${encodeURIComponent(pkg.destination)}`}>View trip</a>
        </div>
      </div>
    </article>
  );
}

export default function PackagesSection({
  liveFares,
}: {
  // Live fares, when a supplier connects — always null today, so
  // every card shows the planning estimate (see lib/packages.ts).
  liveFares?: LivePackageFare[] | null;
}) {
  const pkgs = featuredPackages();
  return (
    <section className="home-section" id="packages" aria-label="Ready-made packages">
      <p className="eyebrow">Ready-made trips</p>
      <h2>Pick a trip, ready to go</h2>
      <p className="sub">
        Full plans — flights, stay, car and activities in one price. Pick one ready instead of building your own.
      </p>
      <div className="pkg-grid">
        {pkgs.map((pkg, i) => (
          <PackageCard key={pkg.id} pkg={pkg} hero={i === 0} liveFares={liveFares} />
        ))}
      </div>
    </section>
  );
}
