// Destination page (interface round, Nov 16 2026 — P1 #16):
// /destination/[name] — the largest content build in the analysis,
// and the one most dependent on nothing but layout work: every
// piece of content to fill it already exists in lib/. Hero photo,
// plan tiers, day-by-day, best time, local guide, related
// destinations, and the map — all from real data, all labelled.
// No review scores, no ranked "top hotels/restaurants", no
// invented editorial: a destination with no researched guide says
// so. The header's "Plan with AI" pill stays the only AI entry
// point — no second AI button anywhere on the page.
'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS } from '../../../lib/data';
import { discoveryDestinations, type DiscoveryEntry } from '../../../lib/discovery';
import { buildPlan } from '../../../lib/planner';
import { bestTimeLine } from '../../../lib/bestTime';
import { guideFor } from '../../../lib/localGuides';
import { categoriesFor } from '../../../lib/tripCategories';
import { useTheme } from '../../../lib/theme';
import SiteHeader from '../../../components/SiteHeader';
import { SafeImg } from '../../../components/FujinChat';

const DiscoveryMap = dynamic(() => import('../../../components/DiscoveryMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
      <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Loading the map…</p>
    </div>
  ),
});

export default function DestinationPage() {
  const params = useParams();
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const name = decodeURIComponent(typeof params.name === 'string' ? params.name : '');
  const info = GLOBAL_DESTINATIONS.find((d) => d.name === name) ?? HIDDEN_GEMS.find((d) => d.name === name) ?? null;
  const discovery = useMemo(() => discoveryDestinations(), []);
  const entry = discovery.find((d) => d.destination === name) ?? null;
  const plan = useMemo(() => {
    try {
      return buildPlan(name, 2, 3);
    } catch {
      return null;
    }
  }, [name]);
  const guide = guideFor(name);
  const cats = categoriesFor(name);
  const related = useMemo(
    () =>
      discovery
        .filter((d) => d.destination !== name && categoriesFor(d.destination).some((c) => cats.includes(c)))
        .slice(0, 4),
    [discovery, name, cats]
  );
  const mapPins: DiscoveryEntry[] = useMemo(() => {
    const pins = entry ? [entry, ...related] : [...related];
    return pins.filter((p, i, arr) => arr.findIndex((x) => x.key === p.key) === i);
  }, [entry, related]);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const selectedEntry = mapPins.find((d) => d.key === selectedPin) ?? mapPins[0] ?? null;
  const planHref = `/?plan=${encodeURIComponent(name)}`;
  const bestValue = plan?.options.find((o) => o.name === 'Best value') ?? null;

  return (
    <div>
      <SiteHeader
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onSelectCategory={(id) => router.push(`/?tab=${id}`)}
        myTripsHref="/#mytrips"
      />
      <main className="wrap">
        {!info && !entry ? (
          <section>
            <h1>No guide for {name || 'this destination'} yet</h1>
            <p className="plan-muted">
              FujinTrip has no destination guide for this place yet — the guides cover the destinations in our library.
              Try the search instead, or pick a destination from the homepage.
            </p>
            <p>
              <a href={planHref}>Search {name || 'this destination'} →</a> · <a href="/">Back to FujinTrip →</a>
            </p>
          </section>
        ) : (
          <>
            <section>
              {info?.image && <SafeImg src={info.image} alt={name} label={name} className="result-photo" />}
              <p className="eyebrow">{info?.tag ?? entry?.tag ?? 'Destination'}</p>
              <h1>
                {name}
                {info?.country ? `, ${info.country}` : ''}
              </h1>
              {info?.blurb && <p className="sub">{info.blurb}</p>}
              {bestValue && (
                <p className="price">from ${Math.round(bestValue.total / 2).toLocaleString()} per traveler</p>
              )}
              {bestValue && <p className="plan-muted">Best value · 2 travelers · 3 days · planning estimate</p>}
              <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <a className="primary" href={planHref}>
                  Search this destination
                </a>
                <a href="/#destinations">All destinations →</a>
              </p>
            </section>

            {plan && (
              <section>
                <h2>Plan it in three ways</h2>
                <p className="sub">Planning estimates from FujinTrip&apos;s planner — not live quotes.</p>
                <div className="result-cards">
                  {plan.options.map((o) => (
                    <article className="result-card" key={o.name}>
                      <div className="result-body">
                        <h3>{o.name}</h3>
                        <p className="result-price">
                          from ${Math.round(o.total / 2).toLocaleString()} per traveler{' '}
                          <span className="plan-muted">· planning estimate</span>
                        </p>
                        <p className="plan-muted">
                          Flight ${Math.round(o.flight / 2).toLocaleString()} · Stay $
                          {Math.round(o.hotel / 2).toLocaleString()} · Car ${Math.round(o.car / 2).toLocaleString()} ·
                          Activities ${Math.round(o.activities / 2).toLocaleString()} per traveler
                        </p>
                        <a className="primary" href={planHref}>
                          Search this destination
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {info?.itinerary && info.itinerary.length > 0 && (
              <section>
                <h2>Three days in {name}</h2>
                <ul style={{ fontSize: 15, paddingLeft: 18 }}>
                  {info.itinerary.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2>When to go</h2>
              <p>{bestTimeLine(name)}</p>
            </section>

            <section>
              <h2>Local voices</h2>
              {guide ? (
                <>
                  <p>
                    <strong>To try</strong>
                  </p>
                  <ul style={{ fontSize: 14, paddingLeft: 18 }}>
                    {guide.dishes.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  <p>
                    <strong>Where to go</strong>
                  </p>
                  <ul style={{ fontSize: 14, paddingLeft: 18 }}>
                    {guide.places.map((pl) => (
                      <li key={pl}>{pl}</li>
                    ))}
                  </ul>
                  <p>
                    <strong>Three days, the local way</strong>
                  </p>
                  <ul style={{ fontSize: 14, paddingLeft: 18 }}>
                    {guide.sketch.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  <p className="plan-muted">{guide.source}</p>
                </>
              ) : (
                <p className="plan-muted">
                  No researched local guide for {name} yet — the best time above is from our planner, and the
                  destination&apos;s own itinerary is above.
                </p>
              )}
            </section>

            {mapPins.length >= 2 && (
              <section>
                <h2>On the map</h2>
                <div className="discover" style={{ marginBottom: 20 }}>
                  <div className="discover-map">
                    <DiscoveryMap
                      pins={mapPins}
                      selectedKey={selectedEntry?.key ?? null}
                      onSelect={(e) => setSelectedPin(e.key)}
                      dark={theme === 'dark'}
                    />
                  </div>
                  {selectedEntry && (
                    <article className="card discover-panel">
                      <div className="body">
                        <span className="pill">{selectedEntry.tag}</span>
                        <h3>{selectedEntry.destination}</h3>
                        <p>
                          {selectedEntry.days} days · {selectedEntry.nights} nights · Best value · 2 travelers ·
                          planning estimate
                        </p>
                        {selectedEntry.price !== null && (
                          <p className="price">from ${selectedEntry.price.toLocaleString()} total</p>
                        )}
                        <a className="primary" href={`/?plan=${encodeURIComponent(selectedEntry.destination)}`}>
                          Search this destination
                        </a>
                      </div>
                    </article>
                  )}
                </div>
              </section>
            )}

            {related.length > 0 && (
              <section>
                <h2>Related destinations</h2>
                <p className="sub">Same kind of trip — {cats.join(', ') || 'destinations'}.</p>
                <div className="grid">
                  {related.map((d) => (
                    <article className="card" key={d.key}>
                      <div className="body">
                        <span className="pill">{d.tag}</span>
                        <h3>{d.destination}</h3>
                        {d.price !== null && <p className="price">from ${Math.round(d.price / 2).toLocaleString()} per traveler</p>}
                        <p className="plan-muted">Best value · 2 travelers · planning estimate</p>
                        <a className="primary" href={`/destination/${encodeURIComponent(d.destination)}`}>View trip</a>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        <div className="wrap">
          <p>
            <strong>FujinTrip</strong> — Ride the wind. Pay less. Named for Fujin, Japan’s wind god.
          </p>
          <p>
            <a href="/">Back to FujinTrip</a> · <a href="/privacy">Privacy Policy</a>
          </p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
        </div>
      </footer>
    </div>
  );
}
