// Cheapest-fares strip (homepage restructure, Nov 15, 2026): the
// lowest prices across the routes, as a horizontal strip. Honest by
// construction — there is NO live fare source today (Duffel is test
// mode with fictional fares, which never appear here), so every chip
// is the planner's Best value per-traveler total, labeled "planning
// estimate". When a live source connects, the strip reads it through
// the same live-fares seam as the packages (lib/packages.ts) — the
// chips keep their shape and gain a source + check time.
'use client';
import { cheapestPackages } from '../lib/packages';
import { Icon } from './icons';

export default function FaresStrip({ onPick }: { onPick: (destination: string) => void }) {
  const fares = cheapestPackages(8);
  return (
    <section className="home-section" aria-label="Cheapest fares">
      <p className="eyebrow">Cheapest fares</p>
      <h2>The lowest prices across our routes</h2>
      <p className="sub">
        Planning estimates, not live quotes — live fares arrive as suppliers connect. Tap one to fill in the search.
      </p>
      <div className="fares-strip" role="list">
        {fares.map((p) => (
          <button key={p.id} type="button" className="fare-chip" role="listitem" onClick={() => onPick(p.destination)}>
            <span className="fare-chip-route">
              <Icon name="pin" size={15} /> {p.destination}
            </span>
            <span className="fare-chip-price">from ${p.best.perTraveler.toLocaleString()} per traveler</span>
            <span className="fare-chip-label">planning estimate</span>
          </button>
        ))}
      </div>
    </section>
  );
}
