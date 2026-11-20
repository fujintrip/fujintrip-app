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
import { CITY_PHOTOS, GLOBAL_DESTINATIONS } from '../lib/data';
import { SafeImg } from './FujinChat';
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

// Photo per place (review round, Nov 17 2026 — gap 8; audit round,
// Nov 17 2026): from the verified pool — Barcelona and Tokyo from
// CITY_PHOTOS, Kyoto's own photo from GLOBAL_DESTINATIONS. The
// places are single destinations now (UX direction, Nov 19 2026 —
// P0-7): Central Europe and Japan were routes that already have a
// featured package card, so they no longer appear here.
function voicePhoto(place: string): string | null {
  if (place === 'Barcelona') return CITY_PHOTOS['Barcelona'] ?? null;
  if (place === 'Tokyo') return CITY_PHOTOS['Tokyo'] ?? null;
  return GLOBAL_DESTINATIONS.find((d) => d.name === place)?.image ?? null;
}

// The Local Voices places (UX direction, Nov 19 2026 — P0-7):
// single destinations with no other homepage band — Kyoto,
// Barcelona and Tokyo. FujinApp excludes these names from Popular
// destinations, so no place appears twice.
export const LOCAL_VOICES_PLACES = ['Kyoto', 'Barcelona', 'Tokyo'];

export function LocalVoicesTeaser() {
  const places = LOCAL_VOICES_PLACES;
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
            and it shows in your plan. Open a place to see the trip.
          </p>
          <p className="voices-chips">
            {places.map((p) => (
              <a key={p} className="chip" href={`/destination/${encodeURIComponent(p)}`}>
                {p}
              </a>
            ))}
            <a href="/chat" className="ghost voices-link">
              See it in a plan <Icon name="arrowRight" size={15} />
            </a>
          </p>
        </div>
      </div>
      {/* Grown into a real inspiration section (interface round, Nov
          16 2026 — P1 #11; photo cards, review round Nov 17 2026 —
          gap 8): one photo card per place with the best time to go
          and a link to the destination page, where the researched
          guide lives when one exists (lib/localGuides.ts,
          lib/bestTime.ts). A place with no researched guide says so
          plainly instead of getting invented editorial. The "See it
          in a plan" link stays — its removal is an open decision for
          the user, not this round's call. */}
      <div className="grid voices-grid">
        {places.map((p) => {
          const guide = guideFor(p);
          const photo = voicePhoto(p);
          return (
            <article className="card" key={p}>
              {photo ? <SafeImg src={photo} alt={p} label={p} /> : null}
              <div className="body">
                <span className="pill">Local voices</span>
                <h3>{p}</h3>
                <p className="plan-muted">{bestTimeLine(p)}</p>
                {guide ? (
                  <p className="plan-muted">A researched local guide is on the destination page — dishes to try and where to go.</p>
                ) : (
                  <p className="plan-muted">No researched local guide for {p} yet — the best time above is from our planner.</p>
                )}
                <a className="primary" href={`/destination/${encodeURIComponent(p)}`}>View trip</a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
