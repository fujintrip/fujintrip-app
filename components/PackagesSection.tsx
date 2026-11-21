// Ready-made packages (homepage restructure, Nov 15, 2026; section
// plan rebuilt Nov 21 — UX direction round 2, P0-4): the Trip of the
// week is a full-width feature row (photo 7 cols / content 5 cols) in
// its own band, and Ready-made trips is a grid of six equal cards —
// the five featured packages that are NOT this week's trip, plus the
// cheapest trip with no other homepage band. One card component, one
// grid: the old bento hero card (first card spanning 2×2, different
// size and shape) is gone. One price per card — Best value per
// traveler — and one action, "View trip", which opens the package
// detail page where the Cheapest / Best value / Premium tiers and
// the cost breakdown live. Every price is the planner's own math
// (lib/packages.ts) — planning estimate until a live supplier
// connects. Never "Book now" — checkout is not built.
'use client';
import { packagePrice, readyMadePackages, tripOfTheWeek, tripOfTheWeekPreview, type LivePackageFare, type Package } from '../lib/packages';
import { packageSavedKey } from '../lib/savedTrips';
import { shareTextFor } from '../lib/share';
import { Icon } from './icons';
import { SafeImg } from './FujinChat';
import ShareMenu from './ShareMenu';

export type SavePackageFn = (pkg: Package, price: { perTraveler: number; label: string; source: string | null }) => void;

export function PackageCard({
  pkg,
  liveFares,
  photo,
  savedKeys,
  onSavePackage,
}: {
  pkg: Package;
  liveFares?: LivePackageFare[] | null;
  // P2-4: the homepage's one-photo-per-destination assignment.
  // `undefined` means "no assignment — use the package's own
  // photo"; `null` means "assigned elsewhere — render the labeled
  // fallback, never a borrowed photo".
  photo?: string | null;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): the keys
  // already in My Trips, so a saved package renders "Saved ✓" on
  // every load. Absent outside the homepage (e.g. the destination
  // page) — then no Save button renders at all.
  savedKeys?: Set<string>;
  onSavePackage?: SavePackageFn;
}) {
  const price = packagePrice(pkg, liveFares);
  const saved = savedKeys?.has(packageSavedKey(pkg.destination, price.perTraveler)) ?? false;
  const shownPhoto = photo === undefined ? pkg.photo : photo;
  return (
    <article className="pkg-card">
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
          {onSavePackage && (
            <button type="button" className="ghost" disabled={saved} onClick={() => onSavePackage(pkg, price)}>
              {saved ? 'Saved ✓' : '♥ Save'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// Trip of the week as a full-width feature row (UX direction round 2,
// Nov 21 2026 — P0-3/P0-4): the week's trip in its own band, photo
// 7 columns / content 5, with its 3-day preview — the first three
// days of this package's own plan, each day with different copy (the
// round-2 planner fix). The old tall hero card with empty space
// below the fold is gone.
export function TripOfTheWeekFeature({
  liveFares,
  photo,
  savedKeys,
  onSavePackage,
}: {
  liveFares?: LivePackageFare[] | null;
  photo?: string | null;
  savedKeys?: Set<string>;
  onSavePackage?: SavePackageFn;
}) {
  const weekTrip = tripOfTheWeek();
  const preview = tripOfTheWeekPreview(weekTrip);
  const price = packagePrice(weekTrip, liveFares);
  const saved = savedKeys?.has(packageSavedKey(weekTrip.destination, price.perTraveler)) ?? false;
  const shownPhoto = photo === undefined ? weekTrip.photo : photo;
  return (
    <section className="home-section" id="trip-of-the-week" aria-label="Trip of the week">
      <p className="eyebrow">Trip of the week</p>
      <div className="feature-row">
        <div className="feature-photo">
          {shownPhoto ? (
            <SafeImg src={shownPhoto} alt={weekTrip.destination} label={weekTrip.destination} className="feature-photo-img" />
          ) : (
            <div className="pkg-photo-fallback" role="img" aria-label={weekTrip.destination}>
              <span>{weekTrip.destination}</span>
            </div>
          )}
        </div>
        <div className="feature-body">
          <div className="card-top">
            <span className="pill">{weekTrip.tag}</span>
            <ShareMenu
              url="/#trip-of-the-week"
              text={shareTextFor('package', weekTrip.destination, `from $${price.perTraveler.toLocaleString()} per traveler · planning estimate`)}
              buttonClassName="linklike"
            />
          </div>
          <h2>{weekTrip.destination}</h2>
          <p className="pkg-route">{weekTrip.stops.join(' → ')}</p>
          <p className="pkg-meta">
            <Icon name="calendar" size={15} /> {weekTrip.nights} nights · {weekTrip.stops.length}{' '}
            {weekTrip.stops.length === 1 ? 'city' : 'cities'} · {weekTrip.experiences} experiences
          </p>
          <ol className="pkg-preview" aria-label={`First three days in ${weekTrip.destination}`}>
            {preview.map((d) => (
              <li key={d.day}>
                <strong>Day {d.day} — {d.title}</strong>
                <span>{d.morning}</span>
              </li>
            ))}
          </ol>
          <p className="pkg-price">
            from ${price.perTraveler.toLocaleString()} <span>per traveler</span>
          </p>
          {price.source && (
            <p className="plan-muted">
              {price.label} · {price.source}
            </p>
          )}
          <div className="pkg-actions">
            <a className="primary" href={`/destination/${encodeURIComponent(weekTrip.destination)}`}>View trip</a>
            {onSavePackage && (
              <button type="button" className="ghost" disabled={saved} onClick={() => onSavePackage(weekTrip, price)}>
                {saved ? 'Saved ✓' : '♥ Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function PackagesSection({
  liveFares,
  photosById,
  savedKeys,
  onSavePackage,
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
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): passed through
  // to every card, so a saved package renders "Saved ✓".
  savedKeys?: Set<string>;
  onSavePackage?: SavePackageFn;
}) {
  const pkgs = readyMadePackages();
  return (
    <section className="home-section" id="packages" aria-label="Ready-made packages">
      <p className="eyebrow">Ready-made trips</p>
      <h2>Pick a trip, ready to go</h2>
      <p className="sub">
        Full plans — flights, stay, car and activities in one price. Pick one ready instead of building your own.
      </p>
      <div className="pkg-grid">
        {pkgs.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            liveFares={liveFares}
            photo={photosById ? photosById.get(`pkg:${pkg.id}`)?.[0] ?? null : undefined}
            savedKeys={savedKeys}
            onSavePackage={onSavePackage}
          />
        ))}
      </div>
    </section>
  );
}
