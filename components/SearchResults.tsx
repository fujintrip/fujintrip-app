// Direction v3 search results (Nov 14, 2026): the results list for
// one search — Booking pattern (sort above the list, filters on the
// left, map toggle for stays). Results appear ONLY after a search;
// nothing here is pre-loaded. Every price is labeled as what it is:
// live Duffel TEST fares, cached Travelpayouts fares, or the
// planner's Best value legs/totals per traveler as planning
// estimates. No "Book now" anywhere — the primary action on every
// card is "Save this search" (a request in My Trips, no booking, no
// payment).
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { comparisonFor, ROUTE_STOPS, routeKeyForDestination } from '../lib/planner';
import { discoveryDestinations, type DiscoveryEntry } from '../lib/discovery';
import {
  HOME_TABS,
  duffelFareLabel,
  noFareMessage,
  noLegNote,
  tabRowsFor,
  type TabRow,
} from '../lib/homeTabs';
import {
  cheapestOutBackTotal,
  destinationPhoto,
  flightBudgetCopy,
  flightContextFromSearch,
  isKnownPlace,
  rowIncludesPlace,
  searchRequestLabel,
  sortFareOffers,
  sortTabRows,
  type RowSort,
  type SearchQuery,
} from '../lib/searchPlaces';
import type { CompetitorFares } from '../lib/travelpayouts';
import type { DuffelFareOffer } from '../lib/duffel';
import { SafeImg } from './FujinChat';

// Discovery map (design #15) — same client-only pattern as the trip
// map. Used only by the Stays "Show on map" toggle.
const DiscoveryMap = dynamic(() => import('../components/DiscoveryMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
      <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Loading the map…</p>
    </div>
  ),
});

type PriceCheckResponse = {
  live: boolean;
  reason?: string;
  origin: string;
  destination: string;
  destCity: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  cabin: string;
  mode: 'test' | 'live';
  out: DuffelFareOffer[];
  back: DuffelFareOffer[];
  liveTotal: number;
  plannerFlight: number;
  line: string;
};

// The first city of the route — the fare destination, the same city
// the chat's live fares use.
function destCityFor(destination: string): string {
  const routeKey = routeKeyForDestination(destination);
  return routeKey ? ROUTE_STOPS[routeKey][0].city : destination;
}

function fareRow(o: DuffelFareOffer) {
  return (
    <li key={`${o.airline}-${o.price}`} className="fare-row">
      <strong>{o.airline}</strong>
      <span>
        {o.departTime ? `${o.departTime}${o.arriveTime ? ` → ${o.arriveTime}` : ''} · ` : ''}${o.price.toLocaleString()} · {o.stops === 0 ? 'nonstop' : `${o.stops} stop${o.stops > 1 ? 's' : ''}`}
        {o.duration ? ` · ${o.duration}` : ''}
        {o.bags ? ` · ${o.bags}` : ''}
      </span>
    </li>
  );
}

// One labeled column per fare source (multi-API panel, Nov 15 2026):
// the traveler sees where each price came from and how fresh it is,
// never a merged or averaged price. A source that isn't connected
// yet renders NO column at all — the column appears only when its
// source can say something (live fares, cached fares, or an honest
// empty state from a connected source).
function FareSourceColumn({
  title,
  freshness,
  children,
}: {
  title: string;
  freshness: string;
  children: React.ReactNode;
}) {
  return (
    <section className="fare-source" aria-label={title}>
      <div className="fare-source-head">
        <h4>{title}</h4>
        <p className="plan-muted">{freshness}</p>
      </div>
      {children}
    </section>
  );
}

function searchSummary(q: SearchQuery): string {
  const travelers = `${q.travelers} traveler${q.travelers > 1 ? 's' : ''}`;
  const dates = q.depart ? `${q.depart}${q.ret ? ` – ${q.ret}` : ''}` : 'Flexible dates';
  switch (q.tab) {
    case 'flights':
      return `${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${dates} · ${travelers} · ${q.cabin}`;
    case 'hotels':
      return `${q.dest || 'Anywhere'} · ${dates} · ${q.guests} guest${q.guests > 1 ? 's' : ''} · ${q.rooms} room${q.rooms > 1 ? 's' : ''}`;
    case 'cars':
      return `${q.dest || 'Anywhere'} · ${dates}${q.pickupTime ? ` ${q.pickupTime}` : ''} · ${travelers}`;
    case 'tours':
      return `${q.dest || 'Anywhere'} · ${dates} · ${travelers}`;
    case 'cruises':
      return `${q.dest || 'Anywhere'} · ${q.month ? `Month ${q.month}` : 'Flexible month'} · ${travelers}`;
    case 'buses':
      return `${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${dates} · ${travelers}`;
    case 'taxis':
      return `${q.from || 'Anywhere'} → ${q.dropoff || 'Anywhere'} · ${dates} · ${travelers}`;
  }
}

// Flights results: live Duffel test fares for the searched trip
// (POST /api/price-check — honest live:false + reason when there is
// no fare) + the cached competitor fare (GET /api/competitor-fares),
// then the per-route flight legs as planning estimates. Nothing here
// is presented as a live bookable price. The plan flight budget
// shows only when the destination is a place the planner knows —
// for an unknown place the planner's fallback base is not shown as
// a budget.
function FlightResults({
  query,
  sort,
  maxPrice,
  stopsFilter,
  airlinesFilter,
  onLiveOptions,
  onSave,
  onClearLiveFilters,
  onClearPrice,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  stopsFilter: number[];
  airlinesFilter: string[];
  onLiveOptions: (opts: {
    airlines: string[];
    stops: number[];
    // How many live fares (outbound + return combined) each filter
    // option holds — the counts in the filters panel come from the
    // fares themselves, never from the planner.
    counts: { airlines: Record<string, number>; stops: Record<number, number> };
  } | null) => void;
  onSave: (label: string) => void;
  onClearLiveFilters: () => void;
  onClearPrice: () => void;
}) {
  const ctx = useMemo(() => flightContextFromSearch(query), [query]);
  const known = isKnownPlace(ctx.destination);
  const destCity = destCityFor(ctx.destination);
  // The heading and the fare lookup use the SEARCHED dates (defect,
  // Nov 14 2026: a Jan 15–22 search showed Jan 4–11 — the planner's
  // suggested start — because the dates came from suggestedStart
  // instead of the search). ctx carries the searched dates when the
  // traveler gave them, else the planner's suggestion.
  const departIso = ctx.depart;
  const returnIso = ctx.return;
  const plannerFlight = known ? comparisonFor(ctx.destination, query.travelers).best.flight : 0;
  // The planner budget is an economy figure (see flightBudgetCopy):
  // on a Business/First search the line says so instead of printing
  // a $630 economy budget next to business fares (defect, Nov 15
  // 2026). No cabin multiplier is invented — the figure stays the
  // economy estimate and the label says so.
  const budget = flightBudgetCopy(query.cabin);
  const rows = useMemo(() => {
    const all = tabRowsFor('flights', query.travelers);
    const sorted = sortTabRows(all, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [query.travelers, sort, maxPrice]);

  const [fares, setFares] = useState<{ status: 'loading' | 'done'; data: PriceCheckResponse | null }>({
    status: 'loading',
    data: null,
  });
  const [competitor, setCompetitor] = useState<{ status: 'idle' | 'loading' | 'done'; data: CompetitorFares | null }>({
    status: 'idle',
    data: null,
  });
  const fetchedKeyRef = useRef('');
  const ctxKey = `${ctx.origin}|${ctx.destination}|${query.travelers}|${ctx.month}|${ctx.durationDays}|${ctx.depart}|${ctx.return}|${ctx.cabin}`;

  useEffect(() => {
    if (fetchedKeyRef.current === ctxKey) return;
    fetchedKeyRef.current = ctxKey;
    setFares({ status: 'loading', data: null });
    setCompetitor({ status: 'idle', data: null });
    onLiveOptions(null);
    let cancelled = false;
    (async () => {
      let pc: PriceCheckResponse | null = null;
      try {
        const r = await fetch('/api/price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: ctx.origin, destination: ctx.destination, travelers: query.travelers, month: ctx.month, durationDays: ctx.durationDays, depart: ctx.depart, return: ctx.return, cabin: ctx.cabin }),
        });
        pc = (await r.json()) as PriceCheckResponse;
      } catch {
        pc = null;
      }
      if (cancelled) return;
      setFares({ status: 'done', data: pc });
      if (pc?.live) {
        const airlines = [...new Set([...pc.out, ...pc.back].map((o) => o.airline))].sort();
        const stops = [...new Set([...pc.out, ...pc.back].map((o) => o.stops))].sort((a, b) => a - b);
        const counts = { airlines: {} as Record<string, number>, stops: {} as Record<number, number> };
        for (const o of [...pc.out, ...pc.back]) {
          counts.airlines[o.airline] = (counts.airlines[o.airline] ?? 0) + 1;
          counts.stops[o.stops] = (counts.stops[o.stops] ?? 0) + 1;
        }
        onLiveOptions({ airlines, stops, counts });
      }
      if (pc?.departDate && pc?.returnDate) {
        setCompetitor({ status: 'loading', data: null });
        try {
          const cr = await fetch(
            `/api/competitor-fares?origin=${encodeURIComponent(ctx.origin)}&destination=${encodeURIComponent(ctx.destination)}&depart=${pc.departDate}&return=${pc.returnDate}&travelers=${query.travelers}`
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

  const filterOffers = (list: DuffelFareOffer[]) =>
    list.filter(
      (o) =>
        (stopsFilter.length === 0 || stopsFilter.includes(o.stops)) &&
        (airlinesFilter.length === 0 || airlinesFilter.includes(o.airline))
    );
  // The sidebar sort re-orders the live fares too — cheapest, shortest
  // or earliest departure — not just the estimate rows below.
  const out = fares.data ? sortFareOffers(filterOffers(fares.data.out), sort) : [];
  const back = fares.data ? sortFareOffers(filterOffers(fares.data.back), sort) : [];
  const liveFiltersActive = stopsFilter.length > 0 || airlinesFilter.length > 0;

  return (
    <div aria-label="Flight results">
      <h3>
        Flights · {ctx.origin} → {destCity} · {departIso} – {returnIso} · {query.travelers} traveler
        {query.travelers > 1 ? 's' : ''} · {query.cabin}
      </h3>
      <div className="fare-sources">
        <FareSourceColumn
          title="Duffel"
          freshness={
            fares.status === 'done' && fares.data
              ? duffelFareLabel(fares.data.mode)
              : 'Live fares — checking now…'
          }
        >
          {fares.status === 'loading' && <p>Checking live fares…</p>}
          {fares.status === 'done' && fares.data?.live && (
            <>
              {liveFiltersActive && (
                <p className="fare-count">
                  Showing {out.length} of {fares.data.out.length} outbound · {back.length} of {fares.data.back.length} return fares.{' '}
                  <button type="button" className="linklike" onClick={onClearLiveFilters}>
                    Clear filters
                  </button>
                </p>
              )}
              <h5>Outbound — {fares.data.departDate}</h5>
              <ul className="fare-list">
                {out.map(fareRow)}
                {out.length === 0 && (
                  <li className="plan-muted">
                    No outbound fares match the filters.{' '}
                    <button type="button" className="linklike" onClick={onClearLiveFilters}>
                      Clear filters
                    </button>
                  </li>
                )}
              </ul>
              <h5>Return — {fares.data.returnDate}</h5>
              <ul className="fare-list">
                {back.map(fareRow)}
                {back.length === 0 && (
                  <li className="plan-muted">
                    No return fares match the filters.{' '}
                    <button type="button" className="linklike" onClick={onClearLiveFilters}>
                      Clear filters
                    </button>
                  </li>
                )}
              </ul>
              {cheapestOutBackTotal(out, back) > 0 && (
                <p className="fare-total">
                  Cheapest out + back: <strong>${cheapestOutBackTotal(out, back).toLocaleString()}</strong> for {query.travelers} traveler
                  {query.travelers > 1 ? 's' : ''}.
                </p>
              )}
              {/* The "Book-now read" line is NOT rendered here (defect,
                  Nov 14 2026: it read as a stray paragraph on the results
                  page). The API still returns it — the chat's trip card
                  uses it where it belongs. */}
              <p>
                <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query))}>
                  Save this search
                </button>
              </p>
            </>
          )}
          {fares.status === 'done' && fares.data && !fares.data.live && (
            <p>{noFareMessage(fares.data.reason, plannerFlight, budget.qualifier)}</p>
          )}
          {fares.status === 'done' && !fares.data && (
            <p>
              Could not check live fares right now.
              {known ? ` The plan's flight budget for this trip is $${plannerFlight.toLocaleString()} (${budget.qualifier}).` : ''}
            </p>
          )}
        </FareSourceColumn>
        {competitor.status !== 'idle' && (
          <FareSourceColumn
            title="Other sites (cached)"
            freshness={
              competitor.status === 'loading'
                ? 'Checking other sites…'
                : competitor.data?.available
                  ? competitor.data.label
                  : 'Cached fares from other sites'
            }
          >
            {competitor.status === 'loading' && <p>Checking other sites…</p>}
            {competitor.status === 'done' && competitor.data?.available && (
              <p>
                {competitor.data.airline ? `${competitor.data.airline} · ` : ''}${(competitor.data.total ?? 0).toLocaleString()} round trip ·{' '}
                {competitor.data.travelers} traveler{competitor.data.travelers > 1 ? 's' : ''}
              </p>
            )}
            {competitor.status === 'done' && competitor.data && !competitor.data.available && (
              <p className="plan-muted">{competitor.data.label}</p>
            )}
          </FareSourceColumn>
        )}
      </div>
      {known && (
        <p>
          {budget.label}: <strong>${plannerFlight.toLocaleString()}</strong> · {query.travelers} traveler
          {query.travelers > 1 ? 's' : ''} · {budget.qualifier}
        </p>
      )}
      <h4>Flights by destination — planning estimates</h4>
      {rows.length === 0 ? (
        <p className="plan-muted">
          No destinations under that price — raise the max price or clear it.{' '}
          <button type="button" className="linklike" onClick={onClearPrice}>
            Clear price filter
          </button>
        </p>
      ) : (
        <div className="result-cards">
          {rows.map((r) => (
            <EstimateCard key={r.destination} row={r} query={query} onSave={onSave} />
          ))}
        </div>
      )}
    </div>
  );
}

// One estimate row as a card: photo where one exists, the route,
// the trip length from the discovery entry, the price line, and the
// one primary action — "Save this search". No property, operator,
// rating, or per-night/per-day figure anywhere: the planner has
// none of those, so the card shows none of those.
function EstimateCard({
  row,
  query,
  onSave,
  highlight,
}: {
  row: TabRow;
  query: SearchQuery;
  onSave: (label: string) => void;
  highlight?: boolean;
}) {
  const photo = destinationPhoto(row.destination);
  const entry = discoveryDestinations().find((e) => e.destination === row.destination);
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        {entry && (
          <p className="plan-muted">
            {entry.days} days · {entry.nights} nights · Best value
          </p>
        )}
        {query.tab === 'cars' && <p className="plan-muted">Car class (example): Economy · Compact · SUV</p>}
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {row.kind === 'leg' ? 'Best value · planning estimate' : 'Full trip · planning estimate'}</span>
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// One tab's estimate results: the per-route planner numbers for this
// category, per traveler, labeled planning estimate. Cruises / buses
// / taxis carry the honest note instead of a broken-out price.
function CategoryResults({
  query,
  sort,
  maxPrice,
  onSave,
  onClearPrice,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  onSave: (label: string) => void;
  onClearPrice: () => void;
}) {
  const rows = useMemo(() => {
    const all = tabRowsFor(query.tab, query.travelers);
    const sorted = sortTabRows(all, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [query.tab, query.travelers, sort, maxPrice]);
  const note = noLegNote(query.tab);
  const label = HOME_TABS.find((t) => t.id === query.tab)?.label ?? query.tab;
  const searchPlace = query.tab === 'buses' ? query.to : query.tab === 'taxis' ? query.dropoff || query.from : query.dest;
  const listNote =
    query.tab === 'hotels'
      ? 'Live hotel prices arrive when Expedia Rapid / Duffel Stays connect.'
      : query.tab === 'cars'
        ? 'Live car prices arrive when Rentalcars / CarTrawler connect.'
        : query.tab === 'tours'
          ? 'Live tours arrive when Viator / GetYourGuide / Klook connect.'
          : null;

  return (
    <div aria-label={`${label} results`}>
      {note && <p className="results-note">{note}</p>}
      {listNote && <p className="plan-muted">{listNote}</p>}
      {rows.length === 0 ? (
        <p className="plan-muted">
          No destinations under that price — raise the max price or clear it.{' '}
          <button type="button" className="linklike" onClick={onClearPrice}>
            Clear price filter
          </button>
        </p>
      ) : (
        <div className="result-cards">
          {rows.map((r) => (
            <EstimateCard
              key={r.destination}
              row={r}
              query={query}
              onSave={onSave}
              highlight={rowIncludesPlace(r.destination, searchPlace)}
            />
          ))}
        </div>
      )}
      <p className="plan-muted">
        Best value per traveler, {query.travelers} traveler{query.travelers > 1 ? 's' : ''} · planning estimate — not a live quote. Live comparison
        arrives as suppliers connect.
      </p>
    </div>
  );
}

export default function SearchResults({
  query,
  dark,
  onSaveSearch,
  onEditSearch,
}: {
  query: SearchQuery;
  dark: boolean;
  onSaveSearch: (label: string) => void;
  onEditSearch: () => void;
}) {
  const label = HOME_TABS.find((t) => t.id === query.tab)?.label ?? query.tab;
  const [sort, setSort] = useState<RowSort>('best');
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [liveOptions, setLiveOptions] = useState<{
    airlines: string[];
    stops: number[];
    counts: { airlines: Record<string, number>; stops: Record<number, number> };
  } | null>(null);
  const [stopsFilter, setStopsFilter] = useState<number[]>([]);
  const [airlinesFilter, setAirlinesFilter] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The estimate rows behind the max-price counts — the counts on the
  // price options come from the same rows the list shows.
  const estimateRows = useMemo(() => tabRowsFor(query.tab, query.travelers), [query.tab, query.travelers]);
  const underCount = (max: number) => estimateRows.filter((r) => r.pricePerTraveler <= max).length;
  // The map toggle (defect, Nov 14 2026: the live flights results
  // page had no "map" at all — the toggle existed only on Stays). It
  // lives here now, shared by Flights and Stays: the discovery pins
  // are destinations with trip totals, which is what both tabs show.
  const [showMap, setShowMap] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const discovery = useMemo(() => discoveryDestinations(), []);
  const selectedDiscovery: DiscoveryEntry | null =
    discovery.find((d) => d.key === selectedPin) ?? discovery[0] ?? null;
  const showMapToggle = query.tab === 'flights' || query.tab === 'hotels';
  const queryKey = `${query.tab}|${query.from}|${query.to}|${query.dest}|${query.depart}|${query.ret}|${query.travelers}`;
  // A new search resets the filters — last search's stops and
  // airlines do not carry over.
  useEffect(() => {
    setStopsFilter([]);
    setAirlinesFilter([]);
    setLiveOptions(null);
    setFiltersOpen(false);
  }, [queryKey]);

  const primaryPlace =
    query.tab === 'buses' ? query.to : query.tab === 'taxis' ? query.dropoff || query.from : query.tab === 'flights' ? query.to : query.dest;
  const unknownPlace = primaryPlace !== '' && !isKnownPlace(primaryPlace);

  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const filtersBody = (
    <>
      <div className="filter-group">
        <h3>Sort</h3>
        <select value={sort} onChange={(e) => setSort(e.target.value as RowSort)} aria-label="Sort results">
          <option value="best">Best value first</option>
          <option value="cheapest">Cheapest first</option>
          {query.tab === 'flights' && <option value="duration">Shortest first</option>}
          {query.tab === 'flights' && <option value="departure">Earliest departure</option>}
        </select>
      </div>
      <div className="filter-group">
        <h3>Max price per traveler</h3>
        <select
          value={maxPrice === null ? '' : String(maxPrice)}
          onChange={(e) => setMaxPrice(e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Maximum price per traveler"
        >
          <option value="">Any price</option>
          <option value="1000">Under $1,000 ({underCount(1000)})</option>
          <option value="1500">Under $1,500 ({underCount(1500)})</option>
          <option value="2000">Under $2,000 ({underCount(2000)})</option>
        </select>
      </div>
      {query.tab === 'flights' && liveOptions && (
        <>
          <div className="filter-group">
            <h3>Stops</h3>
            {liveOptions.stops.map((s) => (
              <label key={s} className="filter-check">
                <input type="checkbox" checked={stopsFilter.includes(s)} onChange={() => setStopsFilter((l) => toggleIn(l, s))} />
                {s === 0 ? 'Nonstop' : `${s} stop${s > 1 ? 's' : ''}`} ({liveOptions.counts.stops[s] ?? 0})
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>Airline</h3>
            {liveOptions.airlines.map((a) => (
              <label key={a} className="filter-check">
                <input type="checkbox" checked={airlinesFilter.includes(a)} onChange={() => setAirlinesFilter((l) => toggleIn(l, a))} />
                {a} ({liveOptions.counts.airlines[a] ?? 0})
              </label>
            ))}
          </div>
        </>
      )}
    </>
  );

  return (
    <section className="results-section" id="results" aria-label="Search results">
      <div className="results-bar">
        <span>
          <strong>{label}</strong> · {searchSummary(query)}
        </span>
        <button type="button" className="ghost" onClick={onEditSearch}>
          Edit search
        </button>
      </div>
      <h2>{label}</h2>
      <p className="results-honesty">
        Planning estimates from FujinTrip&apos;s planner — not live prices. Live fares arrive as suppliers connect.
      </p>
      {unknownPlace && query.tab !== 'flights' ? (
        <div>
          <p>
            No results for &ldquo;{primaryPlace}&rdquo; yet — try another destination or date. Live inventory arrives as suppliers connect.
          </p>
          <p>
            <button type="button" className="primary" onClick={() => onSaveSearch(searchRequestLabel(query))}>
              Save this search
            </button>
          </p>
        </div>
      ) : (
        <div className="results-layout">
          <aside className="results-filters" aria-label="Filters">
            {filtersBody}
          </aside>
          <div className="results-main">
            <p className="filters-open-row">
              <button type="button" className="ghost" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
                Filters
              </button>
            </p>
            {showMapToggle && (
              <p>
                <button type="button" className="ghost" aria-expanded={showMap} onClick={() => setShowMap((s) => !s)}>
                  {showMap ? 'Hide map' : 'Show on map'}
                </button>
              </p>
            )}
            {showMapToggle && showMap && (
              <div className="discover" style={{ marginBottom: 20 }}>
                <div className="discover-map">
                  <DiscoveryMap pins={discovery} selectedKey={selectedDiscovery?.key ?? null} onSelect={(e) => setSelectedPin(e.key)} dark={dark} />
                </div>
                {selectedDiscovery && (
                  <article className="card discover-panel">
                    <div className="body">
                      <span className="pill">{selectedDiscovery.tag}</span>
                      <h3>{selectedDiscovery.destination}</h3>
                      <p>
                        {selectedDiscovery.days} days · {selectedDiscovery.nights} nights · Best value · 2 travelers · planning estimate
                      </p>
                      {selectedDiscovery.price !== null && <p className="price">from ${selectedDiscovery.price.toLocaleString()} total</p>}
                      <button
                        type="button"
                        className="primary"
                        onClick={() => onSaveSearch(searchRequestLabel(query, selectedDiscovery.destination))}
                      >
                        Save this search
                      </button>
                    </div>
                  </article>
                )}
              </div>
            )}
            {query.tab === 'flights' ? (
              <FlightResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                stopsFilter={stopsFilter}
                airlinesFilter={airlinesFilter}
                onLiveOptions={setLiveOptions}
                onSave={onSaveSearch}
                onClearLiveFilters={() => {
                  setStopsFilter([]);
                  setAirlinesFilter([]);
                }}
                onClearPrice={() => setMaxPrice(null)}
              />
            ) : (
              <CategoryResults query={query} sort={sort} maxPrice={maxPrice} onSave={onSaveSearch} onClearPrice={() => setMaxPrice(null)} />
            )}
          </div>
        </div>
      )}
      {filtersOpen && (
        <div className="filters-sheet" role="dialog" aria-label="Filters">
          <div className="filters-sheet-head">
            <strong>Filters</strong>
            <button type="button" className="ghost" onClick={() => setFiltersOpen(false)}>
              Done
            </button>
          </div>
          {filtersBody}
        </div>
      )}
    </section>
  );
}
