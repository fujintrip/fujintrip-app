// Small homepage sections (restructure, Nov 15, 2026): How it works
// and the Local Voices teaser. Short, honest copy only — nothing
// claimed that the site does not do today. "Book" means saving the
// trip; booking through FujinTrip opens as live suppliers connect.
// The teaser links to /chat with "See it in a plan" — the header
// pill stays the site's only "Plan with AI" wording.
'use client';
import { Icon } from './icons';

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
    </section>
  );
}
