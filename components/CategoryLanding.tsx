// Category landing pages (Nov 25, 2026): one route per homepage
// section — /flights, /hotels, /cars, /activities, /cruises, /buses,
// /taxis. Photo-led hero in the Wind & wander style (the same
// .hero-booking the homepage uses, so the search bar is the same
// white pill card in light AND dark mode), the category's own
// SearchWidget form front and centre, destination cards from the
// planner's own numbers, a trust strip, and one "Plan with AI" path.
//
// The search does not render results here: on submit the traveler
// goes to the homepage deep link (/?tab=…&from=…&to=…) — the tested
// path that auto-submits and shows results, including the live
// Ignav/LetsFG fares and their referral booking links. Switching
// tabs in the widget navigates to the sibling landing page. A
// destination card prefills the widget with that destination (the
// same prefill the homepage cards use) and scrolls to the form.
//
// Honesty: every card price comes from tabRowsFor (the planner's
// Best value, per traveler) and is labelled a planning estimate —
// 'full-trip' rows say they are not a category price. The flights
// page additionally shows a live-fare strip (New York → London,
// the route already verified live) with each fare labelled live,
// its source and checked time; a failed lookup shows the honest
// empty message, never a fake fare. No page promises on-site
// booking: referral-first — the traveler books on the seller's
// site.
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SiteHeader from './SiteHeader';
import SearchWidget from './SearchWidget';
import PhotoCarousel from './PhotoCarousel';
import { useTheme } from '../lib/theme';
import { HOME_TABS, noLegNote, tabRowsFor, type HomeTabId } from '../lib/homeTabs';
import { CATEGORY_LANDING, FEATURED_FLIGHT_ROUTE, categoryRouteFor, featuredFlightDates } from '../lib/categoryLanding';
import { leadPhotoFor } from '../lib/data';
import { discoveryDestinations } from '../lib/discovery';
import { searchQueryToParams, type SearchQuery } from '../lib/searchPlaces';
import { ignavEmptyMessage } from '../lib/ignav';
import { letsfgEmptyMessage } from '../lib/letsfg';
import { Icon } from './icons';

// The cards per landing page: the homepage shows its first band of
// destinations; the landing page shows the same band for its own
// category, with a link to the full list on the homepage.
const VISIBLE_CARDS = 8;

const FULL_TRIP_WORD: Partial<Record<HomeTabId, string>> = {
  cruises: 'cruise',
  buses: 'bus',
  taxis: 'taxi',
};

type LiveSourceState = {
  status: 'checking' | 'done';
  live: boolean;
  price: number | null;
  observedAt: string | null;
  reason?: string;
};

const CHECKING: LiveSourceState = { status: 'checking', live: false, price: null, observedAt: null };

function checkedTime(observedAt: string | null): string {
  if (!observedAt) return '';
  const d = new Date(observedAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function LiveFareStrip({ dates }: { dates: { depart: string; return: string } }) {
  const [ignav, setIgnav] = useState<LiveSourceState>(CHECKING);
  const [letsfg, setLetsfg] = useState<LiveSourceState>(CHECKING);
  useEffect(() => {
    let cancelled = false;
    const body = {
      tripType: 'roundtrip',
      origin: FEATURED_FLIGHT_ROUTE.from,
      destination: FEATURED_FLIGHT_ROUTE.to,
      depart: dates.depart,
      return: dates.return,
      travelers: FEATURED_FLIGHT_ROUTE.travelers,
      cabin: 'Economy',
    };
    const parse = (j: unknown): LiveSourceState => {
      const o = (j ?? {}) as { live?: unknown; itineraries?: unknown; observedAt?: unknown; reason?: unknown };
      const itineraries = Array.isArray(o.itineraries) ? (o.itineraries as { price?: unknown }[]) : [];
      const prices = itineraries
        .map((it) => it.price)
        .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
      return {
        status: 'done',
        live: o.live === true,
        price: prices.length ? Math.min(...prices) : null,
        observedAt: typeof o.observedAt === 'string' ? o.observedAt : null,
        reason: typeof o.reason === 'string' ? o.reason : undefined,
      };
    };
    void fetch('/api/ignav-fares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setIgnav(parse(j));
      })
      .catch(() => {
        if (!cancelled) setIgnav({ status: 'done', live: false, price: null, observedAt: null });
      });
    void fetch('/api/letsfg-fares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setLetsfg(parse(j));
      })
      .catch(() => {
        if (!cancelled) setLetsfg({ status: 'done', live: false, price: null, observedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [dates.depart, dates.return]);
  const searchHref = `/?${new URLSearchParams({
    tab: 'flights',
    from: FEATURED_FLIGHT_ROUTE.from,
    to: FEATURED_FLIGHT_ROUTE.to,
    depart: dates.depart,
    return: dates.return,
    travelers: String(FEATURED_FLIGHT_ROUTE.travelers),
  }).toString()}`;
  const renderSource = (label: string, s: LiveSourceState, empty: (reason?: string) => string) => {
    if (s.status === 'checking') {
      return (
        <div className="landing-live-fare">
          <strong>{label}</strong>
          <p className="plan-muted">Checking live fares…</p>
        </div>
      );
    }
    if (!s.live || s.price === null) {
      return (
        <div className="landing-live-fare">
          <strong>{label}</strong>
          <p className="plan-muted">{empty(s.reason)}</p>
        </div>
      );
    }
    const checked = checkedTime(s.observedAt);
    return (
      <div className="landing-live-fare">
        <strong>{label}</strong>
        <p className="result-price">
          from ${s.price.toLocaleString()} <span className="plan-muted">total, {FEATURED_FLIGHT_ROUTE.travelers} travelers</span>
        </p>
        <p className="plan-muted">
          Live fare{checked ? ` · checked ${checked}` : ''}
        </p>
      </div>
    );
  };
  return (
    <section className="home-section landing-live" aria-label="Live fares right now">
      <p className="eyebrow">Live right now</p>
      <h2>
        New York → London, {dates.depart} – {dates.return}
      </h2>
      <p className="sub">The cheapest live fare from each seller — book on the seller’s site.</p>
      <div className="landing-live-fares">
        {renderSource('Ignav', ignav, ignavEmptyMessage)}
        {renderSource('LetsFG', letsfg, letsfgEmptyMessage)}
      </div>
      <p>
        <a href={searchHref}>See all fares for this route →</a>
      </p>
      <p className="plan-muted">Fares from different sellers — you book on the seller’s site, not on FujinTrip.</p>
    </section>
  );
}

export default function CategoryLanding({ tab }: { tab: HomeTabId }) {
  const cfg = CATEGORY_LANDING[tab];
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [prefill, setPrefill] = useState<{ destination: string; nonce: number } | null>(null);
  const searchRef = useRef<HTMLElement | null>(null);
  const [dates] = useState(() => featuredFlightDates());
  const rows = tabRowsFor(tab, 2);
  const note = noLegNote(tab);
  const entries = discoveryDestinations();
  const byDest = new Map(entries.map((e) => [e.destination, e]));
  const cards = rows.slice(0, VISIBLE_CARDS);
  const otherTabs = HOME_TABS.filter((t) => t.id !== tab);

  const handleSubmit = (q: SearchQuery) => {
    router.push(`/?${searchQueryToParams(q)}`);
  };
  const handleTabChange = (id: HomeTabId) => {
    router.push(categoryRouteFor(id));
  };
  const pickDestination = (destination: string) => {
    setPrefill({ destination, nonce: Date.now() });
    searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <a href="#landing-search" className="skip-link">
        Skip to search
      </a>
      <SiteHeader
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onSelectCategory={handleTabChange}
        myTripsHref="/account"
      />
      {/* Photo hero (Wind & wander): the same .hero-booking the
          homepage uses — full-bleed photo, scrim, white headline,
          and the search bar floating as a white pill card in light
          AND dark mode. */}
      <section className="hero-booking" ref={searchRef} id="landing-search">
        <img className="hero-photo" src={cfg.heroPhoto} alt={cfg.heroAlt} />
        <div className="hero-scrim" aria-hidden="true" />
        <div className="wrap hero-booking-inner">
          <p className="hero-booking-eyebrow">{cfg.eyebrow}</p>
          <h1>{cfg.h1}</h1>
          <p className="hero-booking-sub">{cfg.sub}</p>
          <SearchWidget
            tab={tab}
            onTabChange={handleTabChange}
            initialSearch={null}
            prefill={prefill}
            onSubmit={handleSubmit}
          />
          <p className="hero-ai-link">
            Not sure yet? <a href="/chat">Ask Fujin AI →</a>
          </p>
          <p className="hero-trust">All-in prices · No hidden fees · Compare prices from different sources</p>
        </div>
      </section>
      <main className="wrap">
        {tab === 'flights' && <LiveFareStrip dates={dates} />}
        <section className="home-section">
          <p className="eyebrow">{cfg.label}</p>
          <h2>{cfg.introTitle}</h2>
          <p className="sub">{cfg.intro}</p>
          <p className="results-note">{cfg.liveNote}</p>
        </section>
        <section className="home-section" aria-label="Popular trips">
          <p className="eyebrow">Where travelers go</p>
          <h2>Popular trips</h2>
          {note ? (
            <p className="sub">{note}</p>
          ) : (
            <p className="sub">Best value per traveler — planning estimate, not a live quote.</p>
          )}
          <div className="landing-cards">
            {cards.map((r) => {
              const entry = byDest.get(r.destination);
              const photo = leadPhotoFor(r.destination, entry?.stops.map((s) => s.city) ?? []);
              const priceLabel =
                r.kind === 'leg'
                  ? `from $${r.pricePerTraveler.toLocaleString()} per traveler · planning estimate`
                  : `from $${r.pricePerTraveler.toLocaleString()} per traveler · full-trip planning estimate — not a ${FULL_TRIP_WORD[tab] ?? 'category'} price`;
              return (
                <article className="card dest-card" key={r.destination}>
                  <PhotoCarousel
                    photos={photo ? [photo] : []}
                    alt={r.destination}
                    overlay={
                      <div className="dest-overlay">
                        <h3>
                          <Icon name="pin" size={18} /> {r.destination}
                        </h3>
                        <p className="result-price">
                          from ${r.pricePerTraveler.toLocaleString()} <span className="plan-muted">per traveler</span>
                        </p>
                      </div>
                    }
                  />
                  <div className="body">
                    <p className="plan-muted">{r.routeLine}</p>
                    <p className="plan-muted">{priceLabel}</p>
                    <button type="button" className="linklike" onClick={() => pickDestination(r.destination)}>
                      Search this trip →
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <p>
            <a href={`/?tab=${tab}`}>See every trip for {cfg.label.toLowerCase()} →</a>
          </p>
        </section>
        <section className="home-section" aria-label="How it works">
          <p className="eyebrow">How it works</p>
          <h2>Three steps, no surprises</h2>
          <div className="landing-steps">
            {cfg.steps.map((s, i) => (
              <div className="landing-step" key={s.title}>
                <strong>
                  {i + 1}. {s.title}
                </strong>
                <p className="plan-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="home-section" aria-label="Why book with Fujin">
          <p className="eyebrow">Why FujinTrip</p>
          <h2>Quality first, prices affordable</h2>
          <div className="landing-trust">
            {cfg.trust.map((t) => (
              <div className="landing-trust-item" key={t.title}>
                <strong>{t.title}</strong>
                <p className="plan-muted">{t.text}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="home-section landing-ai" aria-label="Plan with AI">
          <p className="eyebrow">Plan with AI</p>
          <h2>Not sure where to start?</h2>
          <p className="sub">
            Tell Fujin AI where you want to go — it builds the whole trip in Cheapest, Best value or Premium, with the{' '}
            {cfg.label.toLowerCase()} included.
          </p>
          <a className="primary" href="/chat">
            Plan with AI →
          </a>
        </section>
        <section className="home-section" aria-label="Explore more">
          <p className="eyebrow">Explore more</p>
          <h2>Everything else for the trip</h2>
          <div className="landing-explore">
            {otherTabs.map((t) => (
              <a key={t.id} href={categoryRouteFor(t.id)}>
                {t.label} →
              </a>
            ))}
          </div>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <div className="footer-cols">
            <div className="footer-col">
              <h3>Book</h3>
              <ul>
                {HOME_TABS.map((t) => (
                  <li key={t.id}>
                    <a href={categoryRouteFor(t.id)}>{t.label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="footer-col">
              <h3>Company</h3>
              <ul>
                <li>
                  <a href="/about">About</a>
                </li>
                <li>
                  <a href="/community">Community</a>
                </li>
                <li>
                  <a href="/contact">Contact</a>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h3>Help</h3>
              <ul>
                <li>
                  <a href="/faq">FAQ</a>
                </li>
                <li>
                  <a href="/faq#cancellation">Cancellation</a>
                </li>
                <li>
                  <a href="/privacy">Privacy Policy</a>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h3>Account</h3>
              <ul>
                <li>
                  <a href="/account">My Trips</a>
                </li>
              </ul>
            </div>
          </div>
          <p>
            <strong>FujinTrip</strong> — Ride the wind. Pay less. Travel globally, act locally.
          </p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
          <p>Fujin artwork: Ogata Korin, Wind God, c.1700 (public domain). Photo credits in the destination cards are from Unsplash / Wikimedia Commons.</p>
        </div>
      </footer>
    </div>
  );
}
