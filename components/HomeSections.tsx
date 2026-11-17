// Small homepage sections (restructure, Nov 15, 2026): How it works
// and the Local Voices teaser. Short, honest copy only — nothing
// claimed that the site does not do today. "Book" means saving the
// trip; booking through FujinTrip opens as live suppliers connect.
// The teaser links to /chat with "See it in a plan" — the header
// pill stays the site's only "Plan with AI" wording.
'use client';
import { Icon } from './icons';
import { HOME_TABS } from '../lib/homeTabs';
import { bestTimeLine } from '../lib/bestTime';
import { guideFor } from '../lib/localGuides';
import type { SearchQuery } from '../lib/searchPlaces';
import type { PriceWatch, Trip } from './FujinChat';

// "Continue where you left off" (interface round, Nov 16 2026 —
// P0 #2): Expedia's Fall 2026 headline feature, from local data
// only — the last search, saved trips, and price watches, all
// already in localStorage. Nothing is fetched, nothing is guessed:
// a strip with nothing to continue renders nothing at all.
function continueLabel(q: SearchQuery): string {
  const tabLabel = HOME_TABS.find((t) => t.id === q.tab)?.label ?? q.tab;
  const place =
    q.tab === 'flights' || q.tab === 'buses'
      ? `${q.from || 'Anywhere'} → ${q.to || 'Anywhere'}`
      : q.tab === 'taxis'
        ? `${q.from || 'Anywhere'} → ${q.dropoff || 'Anywhere'}`
        : q.dest || 'Anywhere';
  const dates = q.depart ? `${q.depart}${q.ret ? ` – ${q.ret}` : ''}` : 'Flexible dates';
  return `${tabLabel} · ${place} · ${dates} · ${q.travelers} traveler${q.travelers > 1 ? 's' : ''}`;
}

export function ContinueStrip({
  trips,
  watches,
  lastSearch,
  onResumeSearch,
  onGoToTrips,
}: {
  trips: Trip[];
  watches: PriceWatch[];
  lastSearch: SearchQuery | null;
  onResumeSearch: (q: SearchQuery) => void;
  onGoToTrips: () => void;
}) {
  if (!lastSearch && trips.length === 0 && watches.length === 0) return null;
  return (
    <section className="home-section continue-strip" aria-label="Continue where you left off">
      <p className="eyebrow">Continue where you left off</p>
      <h2>Pick up your trip</h2>
      <div className="continue-cards">
        {lastSearch && (
          <button type="button" className="continue-card" onClick={() => onResumeSearch(lastSearch)}>
            <span className="continue-card-label">Continue your search</span>
            <strong>{continueLabel(lastSearch)}</strong>
            <span className="plan-muted">Tap to see the results again</span>
          </button>
        )}
        {trips.slice(0, 3).map((t) => (
          <button key={t.id} type="button" className="continue-card" onClick={onGoToTrips}>
            <span className="continue-card-label">Saved trip</span>
            <strong>{t.label}</strong>
            <span className="plan-muted">
              {t.status} · {t.date}
            </span>
          </button>
        ))}
        {watches.slice(0, 3).map((w) => (
          <article key={w.id} className="continue-card">
            <span className="continue-card-label">Price watch</span>
            <strong>{w.destination}</strong>
            <span className="plan-muted">
              {w.baseline !== null ? `Watching from $${w.baseline.toLocaleString()}` : 'Waiting for a live fare'}
              {w.lastTotal !== null ? ` · now $${w.lastTotal.toLocaleString()}` : ''}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HowItWorksSection() {
  const steps = [
    {
      icon: 'compass' as const,
      title: 'Plan',
      text: 'Search, or tell Fujin AI where to go — one day-by-day plan in Cheapest, Best value and Premium.',
    },
    {
      icon: 'bookmark' as const,
      title: 'Book',
      text: 'Save the trip to My Trips. Booking through FujinTrip opens as live suppliers connect.',
    },
    {
      icon: 'map' as const,
      title: 'Follow',
      text: 'Take the plan on the trip — the Today view and your saved trips, on this device, even offline.',
    },
  ];
  return (
    <section className="home-section" aria-label="How FujinTrip works">
      <p className="eyebrow">How it works</p>
      <h2>Plan, book, follow</h2>
      <p className="sub">The three jobs FujinTrip does for every trip.</p>
      <div className="steps">
        {steps.map((s, i) => (
          <div className="step" key={s.title}>
            <span className="step-icon" aria-hidden="true">
              <Icon name={s.icon} size={24} />
            </span>
            <p className="step-num">Step {i + 1}</p>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LocalVoicesTeaser({ onPick }: { onPick: (destination: string) => void }) {
  const places = ['Kyoto', 'Central Europe', 'Japan'];
  return (
    <section className="home-section" aria-label="Local voices">
      <div className="voices-teaser">
        <span className="voices-icon" aria-hidden="true">
          <Icon name="compass" size={28} />
        </span>
        <div>
          <p className="eyebrow">Local voices</p>
          <h2>What travelers say, from the places you go</h2>
          <p className="sub">
            Fujin AI brings back what locals and travelers say — dishes to try, places to eat, how to spend the days —
            and it shows in your plan. Tap a place to fill in the search.
          </p>
          <p className="voices-chips">
            {places.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => onPick(p)}>
                {p}
              </button>
            ))}
            <a href="/chat" className="ghost voices-link">
              See it in a plan <Icon name="arrowRight" size={15} />
            </a>
          </p>
        </div>
      </div>
      {/* Grown into a real inspiration section (interface round, Nov
          16 2026 — P1 #11): one card per place with the best time to
          go and, where a researched guide exists, what to eat and
          where to go — all real data (lib/localGuides.ts,
          lib/bestTime.ts). A place with no researched guide says so
          plainly instead of getting invented editorial. The "See it
          in a plan" link stays — its removal is an open decision for
          the user, not this round's call. */}
      <div className="grid voices-grid">
        {places.map((p) => {
          const guide = guideFor(p);
          return (
            <article className="card" key={p}>
              <div className="body">
                <span className="pill">Local voices</span>
                <h3>{p}</h3>
                <p className="plan-muted">{bestTimeLine(p)}</p>
                {guide ? (
                  <>
                    <p>
                      <strong>To try</strong>
                    </p>
                    <ul style={{ fontSize: 13, paddingLeft: 18, margin: '4px 0' }}>
                      {guide.dishes.slice(0, 3).map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                    <p>
                      <strong>Where to go</strong>
                    </p>
                    <ul style={{ fontSize: 13, paddingLeft: 18, margin: '4px 0' }}>
                      {guide.places.slice(0, 2).map((pl) => (
                        <li key={pl}>{pl}</li>
                      ))}
                    </ul>
                    <p className="plan-muted">{guide.source}</p>
                  </>
                ) : (
                  <p className="plan-muted">No researched local guide for {p} yet — the best time above is from our planner.</p>
                )}
                <button className="primary" onClick={() => onPick(p)}>
                  Search {p}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
