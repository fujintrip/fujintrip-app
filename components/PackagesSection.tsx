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
import { featuredPackages, packagePrice, tripOfTheWeek, tripOfTheWeekPreview, type LivePackageFare, type Package } from '../lib/packages';
import type { DayPlan } from '../lib/planner';
import { shareTextFor } from '../lib/share';
import { Icon } from './icons';
import { SafeImg } from './FujinChat';
import ShareMenu from './ShareMenu';

export function PackageCard({
  pkg,
  hero,
  liveFares,
  photo,
  preview,
}: {
  pkg: Package;
  hero?: boolean;
  liveFares?: LivePackageFare[] | null;
  // P2-4: the homepage's one-photo-per-destination assignment.
  // `undefined` means "no assignment — use the package's own
  // photo"; `null` means "assigned elsewhere — render the labeled
  // fallback, never a borrowed photo".
  photo?: string | null;
  // P2-1: the Trip-of-the-week hero card's 3-day preview — the
  // first three days of this package's own plan, passed in by the
  // section. Only the hero card gets one.
  preview?: DayPlan[];
}) {
  const price = packagePrice(pkg, liveFares);
  const shownPhoto = photo === undefined ? pkg.photo : photo;
  return (
    <article className={`pkg-card${hero ? ' pkg-card--hero' : ''}`}>
      {shownPhoto ? (
        <SafeImg src={shownPhoto} alt={pkg.destination} label={pkg.destination} className="pkg-photo" />
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
          {hero && <span className="pill">Trip of the week</span>}
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
        {preview && (
          <ol className="pkg-preview" aria-label={`First three days in ${pkg.destination}`}>
            {preview.map((d) => (
              <li key={d.day}>
                <strong>Day {d.day} — {d.title}</strong>
                <span>{d.morning}</span>
              </li>
            ))}
          </ol>
        )}
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
  photosById,
}: {
  // Live fares, when a supplier connects — always null today, so
  // every card shows the planning estimate (see lib/packages.ts).
  liveFares?: LivePackageFare[] | null;
  // P2-4: the homepage's one-photo-per-destination assignment
  // (lib/data.ts assignPhotos), keyed `pkg:<package id>`. When
  // given, the card shows the assigned photo — or the labeled
  // fallback when its photo was claimed by another card. When
  // absent, the package's own photo is used.
  photosById?: Map<string, string[]>;
}) {
  const pkgs = featuredPackages();
  // P2-1: the week's trip leads the band in the larger hero card
  // (the bento's first slot spans 2×2) with its 3-day preview; the
  // other five follow in their usual order. One price, one "View
  // trip" — same as every other card.
  const weekTrip = tripOfTheWeek();
  const ordered = [weekTrip, ...pkgs.filter((p) => p.id !== weekTrip.id)];
  const preview = tripOfTheWeekPreview(weekTrip);
  return (
    <section className="home-section" id="packages" aria-label="Ready-made packages">
      <p className="eyebrow">Ready-made trips</p>
      <h2>Pick a trip, ready to go</h2>
      <p className="sub">
        Full plans — flights, stay, car and activities in one price. Pick one ready instead of building your own.
      </p>
      <div className="pkg-grid">
        {ordered.map((pkg, i) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            hero={i === 0}
            liveFares={liveFares}
            photo={photosById ? photosById.get(`pkg:${pkg.id}`)?.[0] ?? null : undefined}
            preview={i === 0 ? preview : undefined}
          />
        ))}
      </div>
    </section>
  );
}
