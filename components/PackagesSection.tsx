// Ready-made packages (homepage restructure, Nov 15, 2026): the
// centerpiece — curated trips a traveler picks ready instead of
// building a plan. Bento grid: the first card is the hero (spans
// 2×2), the rest fill around it; on a phone every card stacks full
// width. The total price is the largest type on the card, with the
// breakdown underneath (research: prices are the product, make them
// loud). Every price is the planner's own math (lib/packages.ts) —
// planning estimate until a live supplier connects. Primary action
// is "Save this search" (a saved request in My Trips); "View
// package" prefills the search widget. Never "Book now" — checkout
// is not built.
'use client';
import { featuredPackages, packagePrice, type LivePackageFare, type Package } from '../lib/packages';
import { Icon } from './icons';
import { SafeImg } from './FujinChat';

export function PackageCard({
  pkg,
  hero,
  liveFares,
  onView,
  onSave,
}: {
  pkg: Package;
  hero?: boolean;
  liveFares?: LivePackageFare[] | null;
  onView: () => void;
  onSave: () => void;
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
        <span className="pill">{pkg.tag}</span>
        <h3>{pkg.destination}</h3>
        <p className="pkg-route">{pkg.stops.join(' → ')}</p>
        <p className="pkg-meta">
          <Icon name="calendar" size={15} /> {pkg.nights} nights · {pkg.days} days
        </p>
        <p className="pkg-price">
          from ${price.perTraveler.toLocaleString()} <span>per traveler</span>
        </p>
        <p className="plan-muted">
          {price.label}
          {price.source ? ` · ${price.source}` : ''}
        </p>
        <ul className="pkg-includes" aria-label="What the price includes, per traveler, Best value">
          <li>
            <Icon name="plane" size={15} /> Flights ${pkg.includes.flight.toLocaleString()}
          </li>
          <li>
            <Icon name="bed" size={15} /> Stays ${pkg.includes.hotel.toLocaleString()}
          </li>
          <li>
            <Icon name="car" size={15} /> Car ${pkg.includes.car.toLocaleString()}
          </li>
          <li>
            <Icon name="ticket" size={15} /> Activities ${pkg.includes.activities.toLocaleString()}
          </li>
        </ul>
        <p className="pkg-tiers" aria-label="All three prices, per traveler">
          {pkg.tiers.map((t) => (
            <span key={t.name}>
              {t.name} <strong>${t.perTraveler.toLocaleString()}</strong>
            </span>
          ))}
        </p>
        <div className="pkg-actions">
          <button type="button" className="primary" onClick={onSave}>
            Save this search
          </button>
          <button type="button" className="ghost" onClick={onView}>
            View package
          </button>
        </div>
      </div>
    </article>
  );
}

export default function PackagesSection({
  onViewPackage,
  onSavePackage,
  liveFares,
}: {
  onViewPackage: (destination: string) => void;
  onSavePackage: (pkg: Package) => void;
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
        Full plans — flights, stay, car and activities in one price. Pick one ready instead of building your own; the
        price is a planning estimate until live suppliers connect.
      </p>
      <div className="pkg-grid">
        {pkgs.map((pkg, i) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            hero={i === 0}
            liveFares={liveFares}
            onView={() => onViewPackage(pkg.destination)}
            onSave={() => onSavePackage(pkg)}
          />
        ))}
      </div>
    </section>
  );
}
