// Homepage tabs (direction v2, Nov 13, 2026): the seven things you can
// book, each with its search (the existing SearchForm, preselected) and
// results underneath — no AI, no sign-up. The tab is deep-linkable
// (?tab=hotels): the page reads it on the server, so a shared link and
// the tests both land on the right panel.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTE_STOPS, comparisonFor, routeKeyForDestination } from '../lib/planner';
import { addDays, suggestedStart } from '../lib/tripCard';
import { DUFFEL_TEST_LABEL, HOME_TABS, flightContextFor, homeTabIdFromQuery, noFareMessage, noLegNote, tabRowsFor, type HomeTabId } from '../lib/homeTabs';
import type { CompetitorFares } from '../lib/travelpayouts';
import type { DuffelFareOffer } from '../lib/duffel';
import type { Tab } from '../lib/data';
import { SearchForm } from './FujinChat';

export type HomeTripContext = {
  destination: string;
  travelers: number;
  origin?: string;
  month?: number;
  durationDays?: number;
};

type PriceCheckResponse = {
  live: boolean;
  reason?: string;
  origin: string;
  destination: string;
  destCity: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  out: DuffelFareOffer[];
  back: DuffelFareOffer[];
  liveTotal: number;
  plannerFlight: number;
  line: string;
};

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The first city of the route — the fare destination, the same city the
// chat's live fares use.
function destCityFor(destination: string): string {
  const routeKey = routeKeyForDestination(destination);
  return routeKey ? ROUTE_STOPS[routeKey][0].city : destination;
}

function fareRow(o: DuffelFareOffer) {
  return (
    <li key={`${o.airline}-${o.price}`} className="fare-row">
      <strong>{o.airline}</strong>
      <span>
        ${o.price.toLocaleString()} · {o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`}
        {o.duration ? ` · ${o.duration}` : ''}
        {o.bags ? ` · ${o.bags}` : ''}
      </span>
    </li>
  );
}

// Flights tab results: live Duffel test fares for the traveler's trip
// (POST /api/price-check — honest live:false + reason when there is no
// fare) + the cached competitor fare (GET /api/competitor-fares), then
// the per-route flight legs as planning estimates. Nothing here is
// presented as a live bookable price.
function FlightResults({ trip }: { trip: HomeTripContext | null }) {
  const ctx = useMemo(() => flightContextFor(trip), [trip]);
  const destCity = destCityFor(ctx.destination);
  const depart = suggestedStart(ctx.month);
  const ret = addDays(depart, ctx.durationDays - 1);
  const departIso = isoDate(depart);
  const returnIso = isoDate(ret);
  const plannerFlight = comparisonFor(ctx.destination, ctx.travelers).best.flight;
  const rows = useMemo(() => tabRowsFor('flights', ctx.travelers), [ctx.travelers]);

  const [fares, setFares] = useState<{ status: 'loading' | 'done'; data: PriceCheckResponse | null }>({ status: 'loading', data: null });
  const [competitor, setCompetitor] = useState<{ status: 'idle' | 'loading' | 'done'; data: CompetitorFares | null }>({ status: 'idle', data: null });
  const fetchedKeyRef = useRef('');
  const ctxKey = `${ctx.origin}|${ctx.destination}|${ctx.travelers}|${ctx.month}|${ctx.durationDays}`;

  useEffect(() => {
    if (fetchedKeyRef.current === ctxKey) return;
    fetchedKeyRef.current = ctxKey;
    setFares({ status: 'loading', data: null });
    setCompetitor({ status: 'idle', data: null });
    let cancelled = false;
    (async () => {
      let pc: PriceCheckResponse | null = null;
      try {
        const r = await fetch('/api/price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: ctx.origin, destination: ctx.destination, travelers: ctx.travelers, month: ctx.month, durationDays: ctx.durationDays }),
        });
        pc = (await r.json()) as PriceCheckResponse;
      } catch {
        pc = null;
      }
      if (cancelled) return;
      setFares({ status: 'done', data: pc });
      if (pc?.departDate && pc?.returnDate) {
        setCompetitor({ status: 'loading', data: null });
        try {
          const cr = await fetch(
            `/api/competitor-fares?origin=${encodeURIComponent(ctx.origin)}&destination=${encodeURIComponent(ctx.destination)}&depart=${pc.departDate}&return=${pc.returnDate}&travelers=${ctx.travelers}`
          );
          const cj = (await cr.json()) as CompetitorFares;
          if (!cancelled) setCompetitor({ status: 'done', data: cj });
        } catch {
          if (!cancelled) setCompetitor({ status: 'done', data: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  return (
    <div className="tab-results" aria-label="Flight results">
      <h3>
        Flights · {ctx.origin} → {destCity} · {departIso} – {returnIso} · {ctx.travelers} traveler{ctx.travelers > 1 ? 's' : ''}
      </h3>
      {fares.status === 'loading' && <p>Checking live fares…</p>}
      {fares.status === 'done' && fares.data?.live && (
        <div className="fare-block">
          <h4>Outbound — {fares.data.departDate}</h4>
          <ul className="fare-list">
            {fares.data.out.map(fareRow)}
            {fares.data.out.length === 0 && <li className="plan-muted">No outbound fares returned.</li>}
          </ul>
          <h4>Return — {fares.data.returnDate}</h4>
          <ul className="fare-list">
            {fares.data.back.map(fareRow)}
            {fares.data.back.length === 0 && <li className="plan-muted">No return fares returned.</li>}
          </ul>
          <p className="plan-muted">{DUFFEL_TEST_LABEL}</p>
          {fares.data.liveTotal > 0 && (
            <p>
              Cheapest out + back: <strong>${fares.data.liveTotal.toLocaleString()}</strong> for {ctx.travelers} traveler{ctx.travelers > 1 ? 's' : ''}.
            </p>
          )}
          {fares.data.line && <p className="plan-muted">{fares.data.line}</p>}
        </div>
      )}
      {fares.status === 'done' && fares.data && !fares.data.live && (
        <p>{noFareMessage(fares.data.reason, plannerFlight)}</p>
      )}
      {fares.status === 'done' && !fares.data && (
        <p>
          Could not check live fares right now. The plan&apos;s flight budget for this trip is ${plannerFlight.toLocaleString()} (planning estimate).
        </p>
      )}
      <p>
        Plan flight budget: <strong>${plannerFlight.toLocaleString()}</strong> · {ctx.travelers} traveler{ctx.travelers > 1 ? 's' : ''} · planning estimate
      </p>
      {competitor.status === 'loading' && <p>Checking other sites…</p>}
      {competitor.status === 'done' && competitor.data?.available && (
        <div className="fare-block">
          <h4>Other sites (cached)</h4>
          <p>
            {competitor.data.airline ? `${competitor.data.airline} · ` : ''}${(competitor.data.total ?? 0).toLocaleString()} round trip · {competitor.data.travelers} traveler
            {competitor.data.travelers > 1 ? 's' : ''}
          </p>
          <p className="plan-muted">{competitor.data.label}</p>
        </div>
      )}
      {competitor.status === 'done' && competitor.data && !competitor.data.available && (
        <div className="fare-block">
          <h4>Other sites (cached)</h4>
          <p className="plan-muted">{competitor.data.label}</p>
        </div>
      )}
      <h4>Flights by destination — planning estimates</h4>
      <ul className="tab-rows">
        {rows.map((r) => (
          <li key={r.destination} className="tab-row">
            <div>
              <strong>{r.destination}</strong> <span className="plan-muted">{r.routeLine}</span>
            </div>
            <div>
              from ${r.pricePerTraveler.toLocaleString()} per traveler <span className="plan-muted">· Best value flight leg · planning estimate</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One tab's results: the per-route planner numbers for this category,
// per traveler, labeled planning estimate. Cruises / buses / taxis
// carry the honest note instead of a broken-out price.
function CategoryResults({ tab, travelers, onPlanTrip }: { tab: HomeTabId; travelers: number; onPlanTrip: (name: string) => void }) {
  const rows = useMemo(() => tabRowsFor(tab, travelers), [tab, travelers]);
  const note = noLegNote(tab);
  const label = HOME_TABS.find((t) => t.id === tab)?.label ?? tab;
  return (
    <div className="tab-results" aria-label={`${label} results`}>
      {note && <p className="results-note">{note}</p>}
      <ul className="tab-rows">
        {rows.map((r) => (
          <li key={r.destination} className="tab-row">
            <div>
              <strong>{r.destination}</strong> <span className="plan-muted">{r.routeLine}</span>
            </div>
            <div>
              from ${r.pricePerTraveler.toLocaleString()} per traveler{' '}
              <span className="plan-muted">· {r.kind === 'leg' ? 'Best value · planning estimate' : 'Full trip · planning estimate'}</span>{' '}
              <button type="button" className="textlink" onClick={() => onPlanTrip(r.destination)}>
                Plan this trip
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="plan-muted">
        Best value per traveler, {travelers} traveler{travelers > 1 ? 's' : ''} · planning estimate — not a live quote. Live comparison arrives as suppliers connect.
      </p>
    </div>
  );
}

export default function HomeTabs({
  initialTab,
  trip,
  onSaveTrip,
  onPlanTrip,
  onSeedChat,
}: {
  initialTab: HomeTabId;
  trip: HomeTripContext | null;
  onSaveTrip: (label: string) => void;
  onPlanTrip: (name: string, focusInput?: boolean) => void;
  onSeedChat: (name: string, sourceTips?: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HomeTabId>(initialTab);
  const selectTab = (id: HomeTabId) => {
    setActiveTab(id);
    try {
      router.replace(`/?tab=${id}`, { scroll: false });
    } catch {}
  };
  // Back / forward must move the tab too — the URL is the deep link.
  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search).get('tab');
      setActiveTab(homeTabIdFromQuery(q));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const active = HOME_TABS.find((t) => t.id === activeTab) ?? HOME_TABS[1];
  const travelers = trip?.travelers ?? 2;

  // "Start from a link" — same /api/extract as the chat's, but the
  // result seeds /chat instead of posting into a chat that isn't on
  // this page. A link with no known places reports the note inline.
  const [homeLinkInput, setHomeLinkInput] = useState('');
  const [homeLinkBusy, setHomeLinkBusy] = useState(false);
  const [homeLinkNote, setHomeLinkNote] = useState<string | null>(null);
  const startHomeFromLink = async () => {
    const raw = homeLinkInput.trim();
    if (!raw || homeLinkBusy) return;
    setHomeLinkBusy(true);
    setHomeLinkNote(null);
    const isUrl = /^https?:\/\//i.test(raw);
    try {
      const r = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: raw } : { text: raw }),
      });
      const j = (await r.json()) as { destination?: string; cities?: string[]; stops?: { city: string; tip: string }[]; note?: string };
      if (!j.destination || !j.cities?.length) {
        setHomeLinkNote(j.note ?? 'I couldn’t find any places I know in that link or text — try a link to a travel article, or paste text naming the cities (for example Kyoto, Bangkok, Lisbon).');
        return;
      }
      const sourceTips: Record<string, string> = {};
      for (const s of j.stops ?? []) if (s.city && s.tip) sourceTips[s.city] = s.tip;
      setHomeLinkInput('');
      onSeedChat(j.destination, Object.keys(sourceTips).length ? sourceTips : undefined);
    } catch {
      setHomeLinkNote('I couldn’t load that link right now — check it and try again, or paste the text of the article instead.');
    } finally {
      setHomeLinkBusy(false);
    }
  };

  return (
    <section className="book-section" id="book">
      <h2>Book it</h2>
      <p className="book-sub">
        Pick a category — the search fills in for it, and the results below compare prices from different sources. Everything you save lands in My Trips as a request; the price you see is the price you pay, no hidden fees.
      </p>
      <div className="home-tabs" role="tablist" aria-label="Book by category">
        {HOME_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            className={`tab-btn${activeTab === t.id ? ' selected' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tabpanel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
        <SearchForm tab={active.tab as Tab} onSave={(label) => onSaveTrip(label)} />
        {active.id === 'flights' ? (
          <FlightResults trip={trip} />
        ) : (
          <CategoryResults tab={active.id} travelers={travelers} onPlanTrip={(name) => onPlanTrip(name)} />
        )}
      </div>
      <div className="link-box">
        <h3>Start from a link</h3>
        <p>Paste a travel article or a list of places — Fujin AI reads it and starts the trip in the chat.</p>
        <div className="row">
          <input
            value={homeLinkInput}
            onChange={(e) => setHomeLinkInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startHomeFromLink()}
            placeholder="Paste a link or article text"
            aria-label="Link or text to start a trip from"
          />
          <button className="ghost" onClick={startHomeFromLink} disabled={!homeLinkInput.trim() || homeLinkBusy}>
            {homeLinkBusy ? 'Reading…' : 'Start from this'}
          </button>
        </div>
        {homeLinkNote && (
          <p className="link-note" role="status">
            {homeLinkNote}
          </p>
        )}
      </div>
    </section>
  );
}
