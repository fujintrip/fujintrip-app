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
import { comparisonFor, MONTH_NAMES, ROUTE_STOPS, routeKeyForDestination } from '../lib/planner';
import { discoveryDestinations, type DiscoveryEntry } from '../lib/discovery';
import {
  HOME_TABS,
  noFareMessage,
  noLegNote,
  tabRowsFor,
  type TabRow,
} from '../lib/homeTabs';
import {
  cheapestMultiCityTotal,
  cheapestOneWayTotal,
  cheapestOutBackTotal,
  destinationPhoto,
  flightBudgetCopy,
  flightContextFromSearch,
  flightLegsFromSearch,
  isKnownPlace,
  liveFilterOptions,
  rowIncludesPlace,
  searchRequestLabel,
  sortFareOffers,
  sortTabRows,
  BUS_TIERS,
  busTierLabel,
  busTierOptions,
  busTierRows,
  CAR_TIERS,
  carDaysFor,
  carTierLabel,
  carTierOptions,
  carTierRows,
  CRUISE_TIERS,
  cruiseTierLabel,
  cruiseTierOptions,
  cruiseTierRows,
  STAY_TIERS,
  stayNightsFor,
  stayTierLabel,
  stayTierOptions,
  stayTierRows,
  TAXI_TIERS,
  taxiTierLabel,
  taxiTierOptions,
  taxiTierRows,
  TOUR_TIERS,
  tourDaysFor,
  tourTierLabel,
  tourTierOptions,
  tourTierRows,
  type RowSort,
  type LiveFilterOptions,
  type SearchQuery,
  type BusTier,
  type BusTierRow,
  type CarTier,
  type CarTierRow,
  type CruiseTier,
  type CruiseTierRow,
  type StayTier,
  type StayTierRow,
  type TaxiTier,
  type TaxiTierRow,
  type TourTier,
  type TourTierRow,
} from '../lib/searchPlaces';
import type { CompetitorFares } from '../lib/travelpayouts';
import type { DuffelFareOffer } from '../lib/duffel';
import { formatMinutes, layoversFor, perTravelerPrice, TIME_BUCKETS, timeBucketFor } from '../lib/duffel';
import type { IgnavBookingLink, IgnavFaresResponse, IgnavItinerary, IgnavLegOffer } from '../lib/ignav';
import {
  cheapestIgnavItinerary,
  IGNAV_MAX_ITINERARIES,
  ignavBookingContext,
  ignavBookingContextForOffer,
  ignavEmptyMessage,
  ignavItineraryMatches,
  ignavSourceTag,
  sortIgnavItineraries,
} from '../lib/ignav';
import { serviceFee } from '../lib/planner';
import { SafeImg } from './FujinChat';
import { AirlineLogo } from './AirlineLogo';
import { Icon } from './icons';

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
  tripType: 'roundtrip' | 'oneway' | 'multicity';
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
  // Multi-city only: one entry per leg, each with its own fares.
  // Empty for round-trip and one-way.
  legs: {
    origin: string;
    destination: string;
    destCity: string;
    date: string;
    live: boolean;
    reason?: string;
    out: DuffelFareOffer[];
  }[];
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

// One fare as a full card (rich fare cards, Nov 15 2026): airline
// logo + name, departure/arrival times with airport codes, total
// duration, stops with the layover airport + wait (computed from the
// offer's own segment times, never invented), flight number, cabin,
// baggage and aircraft only when Duffel provides them — and the
// price in the largest type on the card, with the per-traveler price
// underneath. The segment list opens behind a "Flight details"
// toggle (44px target, aria-expanded). Every field Duffel does not
// provide is omitted, not guessed: no times → times show "—", no
// airport codes → no codes, no bags → no bags line, no aircraft →
// no aircraft line, no segments at all → no details toggle.
function FareCard({
  offer,
  travelers,
  cabin,
  hidePrice = false,
  footer,
  sourceLabel,
}: {
  offer: DuffelFareOffer;
  travelers: number;
  cabin: string;
  // Trip-priced itineraries (Ignav round-trip / multi-city) show the
  // trip total once on the group header instead of a price on every
  // leg card — the per-card price would double-count the trip.
  hidePrice?: boolean;
  // An action that belongs to this fare (Ignav's "See booking
  // options"), rendered at the foot of the card.
  footer?: React.ReactNode;
  // The small, discreet source + freshness tag on the fare itself
  // (Nov 15, 2026): the big supplier column headers are gone, but
  // every fare still says where it came from and when it was checked
  // — a test fare must never be mistaken for a real bookable fare.
  sourceLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const segs = offer.segments ?? [];
  const layovers = layoversFor(offer);
  const fromCode = segs[0]?.from ?? '';
  const toCode = segs.length ? segs[segs.length - 1].to : '';
  const stopsLabel = offer.stops === 0 ? 'Nonstop' : `${offer.stops} stop${offer.stops > 1 ? 's' : ''}`;
  const layoverLabel = layovers
    .map((l) => `${l.airport}${l.minutes !== undefined ? ` ${formatMinutes(l.minutes)}` : ''}`)
    .filter((s) => s)
    .join(' · ');
  const singleFlight = segs.length === 1 ? segs[0].flightNumber : undefined;
  const perPerson = travelers > 1 ? perTravelerPrice(offer.price, travelers) : null;
  return (
    <li className="fare-card">
      <div className="fare-card-main">
        <div className="fare-card-airline">
          <AirlineLogo code={offer.carrierCode} name={offer.airline} />
          <div className="fare-card-airline-name">
            <strong>{offer.airline}</strong>
            {singleFlight && <span className="plan-muted"> · {singleFlight}</span>}
            <span className="plan-muted fare-card-sub">{cabin}</span>
          </div>
        </div>
        <div className="fare-card-times">
          <div className="fare-card-time">
            <strong>{offer.departTime ?? '—'}</strong>
            {fromCode && <span>{fromCode}</span>}
          </div>
          <div className="fare-card-route">
            <span className="fare-card-duration">{offer.duration || '—'}</span>
            <span className="fare-card-line" aria-hidden="true" />
            <span className="fare-card-stops">
              {stopsLabel}
              {layoverLabel ? ` · ${layoverLabel}` : ''}
            </span>
          </div>
          <div className="fare-card-time">
            <strong>{offer.arriveTime ?? '—'}</strong>
            {toCode && <span>{toCode}</span>}
          </div>
        </div>
        {!hidePrice && (
          <div className="fare-card-price">
            <strong>${offer.price.toLocaleString()}</strong>
            {perPerson !== null && (
              <span>
                ${perPerson.toLocaleString()} per traveler · {travelers} travelers
              </span>
            )}
          </div>
        )}
      </div>
      {offer.bags && (
        <p className="fare-card-bags">
          <Icon name="luggage" size={16} /> {offer.bags}
        </p>
      )}
      {segs.length > 0 && (
        <div>
          <button
            type="button"
            className="fare-card-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide details' : 'Flight details'}
            <Icon name="chevronDown" size={16} className={open ? 'fare-card-chevron open' : 'fare-card-chevron'} />
          </button>
          {open && (
            <ol className="fare-card-segments fare-card-details">
              {segs.map((s, i) => (
                <li key={`${s.flightNumber ?? s.carrierName}-${s.from}-${s.to}-${i}`}>
                  <div className="fare-card-segment">
                    <strong>{s.flightNumber ?? s.carrierName}</strong>
                    <span>
                      {s.from || '?'} → {s.to || '?'}
                    </span>
                    <span>
                      {s.departTime ?? '—'}
                      {s.arriveTime ? ` – ${s.arriveTime}` : ''}
                    </span>
                    {s.duration && <span>{s.duration}</span>}
                    {s.aircraft && <span>{s.aircraft}</span>}
                  </div>
                  {i < layovers.length && (
                    <p className="fare-card-layover">
                      Layover in {layovers[i].airport}
                      {layovers[i].minutes !== undefined ? ` · ${formatMinutes(layovers[i].minutes)}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {sourceLabel && <p className="fare-card-source">{sourceLabel}</p>}
      {footer && <div className="fare-card-footer">{footer}</div>}
    </li>
  );
}

// Booking links for one Ignav itinerary (Nov 15, 2026): the fare
// search never returns booking URLs — they come from a separate
// Ignav lookup, one billable request, fetched only when the
// traveler asks. The links open the airline's or OTA's own site;
// the traveler books and pays there, never on FujinTrip, and no
// commission is claimed.
function IgnavBookingLinks({
  context,
  travelers,
}: {
  context: ReturnType<typeof ignavBookingContext> | ReturnType<typeof ignavBookingContextForOffer>;
  travelers: number;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; links: IgnavBookingLink[] }>({
    status: 'idle',
    links: [],
  });
  if (!context.ignavId) return null;
  const load = async () => {
    setState({ status: 'loading', links: [] });
    try {
      const r = await fetch('/api/ignav-fares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'booking-links', ...context, adults: travelers }),
      });
      const j = (await r.json()) as { available?: boolean; links?: IgnavBookingLink[] };
      setState({ status: 'done', links: Array.isArray(j.links) ? j.links : [] });
    } catch {
      setState({ status: 'error', links: [] });
    }
  };
  return (
    <div className="booking-links">
      {state.status === 'idle' && (
        <button type="button" className="ghost" onClick={load}>
          See booking options
        </button>
      )}
      {state.status === 'loading' && <p className="plan-muted">Checking booking options…</p>}
      {state.status === 'error' && (
        <p className="plan-muted">
          Booking options could not be checked right now.{' '}
          <button type="button" className="linklike" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {state.status === 'done' && state.links.length === 0 && (
        <p className="plan-muted">No booking links for this itinerary right now.</p>
      )}
      {state.status === 'done' && state.links.length > 0 && (
        <>
          <ul>
            {state.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noreferrer">
                  {l.specificity === 'search_results' ? `See it on ${l.providerName}` : `Book with ${l.providerName}`}
                  {l.providerType === 'airline' ? ' · Airline' : l.providerType === 'third_party' ? ' · Travel site' : ''}
                  {l.price !== undefined ? ` — from $${l.price.toLocaleString()}` : ''}
                  <Icon name="externalLink" size={14} />
                </a>
                {l.fareName && <span className="plan-muted"> · {l.fareName}</span>}
              </li>
            ))}
          </ul>
          <p className="plan-muted">
            Opens the provider&apos;s site — you book and pay there, not on FujinTrip. Prices can change.
          </p>
        </>
      )}
    </div>
  );
}

// One Ignav itinerary as a group: the trip total once on top
// ("from $X" — Ignav's FAQ says to phrase live prices that way),
// one FareCard per leg with the price hidden (a per-card price
// would double-count the trip), and the booking options for the
// whole itinerary below.
function IgnavItineraryGroup({
  itinerary,
  travelers,
  cabin,
  labels,
  sourceLabel,
}: {
  itinerary: IgnavItinerary;
  travelers: number;
  cabin: string;
  labels: string[];
  // The small source + freshness tag for the whole trip (Nov 15,
  // 2026): the big column header is gone, so the trip total carries
  // its own "Ignav · live, checked …" line.
  sourceLabel?: string;
}) {
  const perPerson = travelers > 1 ? perTravelerPrice(itinerary.price, travelers) : null;
  return (
    <div className="ignav-itinerary">
      <p className="ignav-total">
        Trip total from <strong>${itinerary.price.toLocaleString()}</strong>
        {perPerson !== null && (
          <span className="plan-muted">
            {' '}
            · ${perPerson.toLocaleString()} per traveler · {travelers} travelers
          </span>
        )}
      </p>
      {sourceLabel && <p className="fare-card-source">{sourceLabel}</p>}
      {itinerary.legs.map((leg, i) => (
        <div key={`${leg.airline}-${leg.price}-${i}`}>
          <h6 className="ignav-leg-label">{labels[i] ?? `Leg ${i + 1}`}</h6>
          <ul className="fare-list">
            <FareCard offer={leg} travelers={travelers} cabin={cabin} hidePrice />
          </ul>
        </div>
      ))}
      <IgnavBookingLinks key={itinerary.ignavId ?? itinerary.price} context={ignavBookingContext(itinerary)} travelers={travelers} />
    </div>
  );
}

function searchSummary(q: SearchQuery): string {
  const travelers = `${q.travelers} traveler${q.travelers > 1 ? 's' : ''}`;
  const dates = q.depart ? `${q.depart}${q.ret ? ` – ${q.ret}` : ''}` : 'Flexible dates';
  switch (q.tab) {
    case 'flights': {
      if (q.tripType === 'multicity' && q.legs.length >= 2) {
        const hops = q.legs.map((l) => `${l.from} → ${l.to}`).join(' · ');
        const dates = q.legs.map((l) => l.depart).join(', ');
        return `Multi-city · ${hops} · ${dates} · ${travelers} · ${q.cabin}`;
      }
      if (q.tripType === 'oneway') {
        return `One-way · ${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${q.depart || 'Flexible dates'} · ${travelers} · ${q.cabin}`;
      }
      return `${q.from || 'Anywhere'} → ${q.to || 'Anywhere'} · ${dates} · ${travelers} · ${q.cabin}`;
    }
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
  timesFilter,
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
  // Departure-time buckets the traveler picked ('' when none) — the
  // filter system, Nov 15 2026: airline, stops, price and times all
  // narrow the live offers, and every count matches what is shown.
  timesFilter: string[];
  onLiveOptions: (opts: LiveFilterOptions | null) => void;
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
  // Ignav live fares — the live comparison column (Nov 15, 2026).
  // Fetched in parallel with the Duffel price-check, one request per
  // search; the column renders its honest empty state when the key
  // is missing or Ignav has no fares.
  const [ignav, setIgnav] = useState<{ status: 'idle' | 'loading' | 'done'; data: IgnavFaresResponse | null }>({
    status: 'idle',
    data: null,
  });
  const fetchedKeyRef = useRef('');
  const tripType = query.tripType ?? 'roundtrip';
  const queryLegs = useMemo(() => flightLegsFromSearch(query), [query]);
  const ctxKey = `${tripType}|${ctx.origin}|${ctx.destination}|${query.travelers}|${ctx.month}|${ctx.durationDays}|${ctx.depart}|${ctx.return}|${ctx.cabin}|${queryLegs.map((l) => `${l.from}>${l.to}@${l.depart}`).join(',')}`;

  useEffect(() => {
    if (fetchedKeyRef.current === ctxKey) return;
    fetchedKeyRef.current = ctxKey;
    setFares({ status: 'loading', data: null });
    setCompetitor({ status: 'idle', data: null });
    setIgnav({ status: 'loading', data: null });
    onLiveOptions(null);
    let cancelled = false;
    // Ignav fires in parallel with the Duffel price-check — one
    // Ignav request per search, never per keystroke. The promise
    // resolves on its own time; the column renders when it lands.
    const ignavBody =
      tripType === 'multicity'
        ? {
            tripType: 'multicity',
            legs: queryLegs.map((l) => ({ origin: l.from, destination: l.to, date: l.depart })),
            travelers: query.travelers,
            cabin: ctx.cabin,
          }
        : tripType === 'oneway'
          ? {
              tripType: 'oneway',
              origin: ctx.origin,
              destination: ctx.destination,
              travelers: query.travelers,
              depart: ctx.depart,
              cabin: ctx.cabin,
            }
          : {
              origin: ctx.origin,
              destination: ctx.destination,
              travelers: query.travelers,
              depart: ctx.depart,
              return: ctx.return,
              cabin: ctx.cabin,
            };
    const ignavPromise = (async (): Promise<IgnavFaresResponse | null> => {
      try {
        const r = await fetch('/api/ignav-fares', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ignavBody),
        });
        return (await r.json()) as IgnavFaresResponse;
      } catch {
        return null;
      }
    })();
    ignavPromise.then((ig) => {
      if (!cancelled) setIgnav({ status: 'done', data: ig });
    });
    (async () => {
      let pc: PriceCheckResponse | null = null;
      try {
        // The price-check body follows the trip type: round-trip sends
        // depart + return; one-way sends depart only (no return is
        // fetched and none is invented); multi-city sends one leg per
        // hop and the route runs one one-way request per leg.
        const body =
          tripType === 'multicity'
            ? {
                tripType: 'multicity',
                legs: queryLegs.map((l) => ({ origin: l.from, destination: l.to, date: l.depart })),
                travelers: query.travelers,
                cabin: ctx.cabin,
              }
            : tripType === 'oneway'
              ? {
                  tripType: 'oneway',
                  origin: ctx.origin,
                  destination: ctx.destination,
                  travelers: query.travelers,
                  month: ctx.month,
                  durationDays: ctx.durationDays,
                  depart: ctx.depart,
                  cabin: ctx.cabin,
                }
              : {
                  origin: ctx.origin,
                  destination: ctx.destination,
                  travelers: query.travelers,
                  month: ctx.month,
                  durationDays: ctx.durationDays,
                  depart: ctx.depart,
                  return: ctx.return,
                  cabin: ctx.cabin,
                };
        const r = await fetch('/api/price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        pc = (await r.json()) as PriceCheckResponse;
      } catch {
        pc = null;
      }
      if (cancelled) return;
      setFares({ status: 'done', data: pc });
      // The cached competitor fare is a round-trip fare (Travelpayouts
      // prices_for_dates) — one-way and multi-city have no round-trip
      // to compare, so the column stays out instead of faking one.
      if (tripType === 'roundtrip' && pc?.departDate && pc?.returnDate) {
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

  // The live offers actually on screen (Nov 15, 2026): every filter
  // — airline, stops, departure time and max price — narrows these
  // lists, and the lists are memoized so the counts below are stable
  // references (the counts effect must not fire on every render).
  // Max price reads per traveler, the same unit the sidebar quotes:
  // a leg passes when its own per-traveler price fits. An offer with
  // no departure time matches no time filter — its time is unknown,
  // never assumed.
  const visibleLive = useMemo(() => {
    const passesPrice = (price: number) => maxPrice === null || perTravelerPrice(price, query.travelers) <= maxPrice;
    const passesTime = (o: DuffelFareOffer) => {
      if (timesFilter.length === 0) return true;
      const bucket = timeBucketFor(o.departMinutes);
      return bucket !== null && timesFilter.includes(bucket);
    };
    const passesOffer = (o: DuffelFareOffer) =>
      (stopsFilter.length === 0 || stopsFilter.includes(o.stops)) &&
      (airlinesFilter.length === 0 || airlinesFilter.includes(o.airline)) &&
      passesTime(o) &&
      passesPrice(o.price);
    // The sidebar sort re-orders the live fares too — cheapest,
    // shortest or earliest departure — not just the estimate rows.
    const out = fares.data ? sortFareOffers(fares.data.out.filter(passesOffer), sort) : [];
    const back = fares.data ? sortFareOffers(fares.data.back.filter(passesOffer), sort) : [];
    // Multi-city: one filtered + sorted list per leg, from the
    // response's own legs — each leg keeps its route and its date.
    const legLists = (fares.data?.legs ?? []).map((leg) => ({
      ...leg,
      offers: sortFareOffers(leg.out.filter(passesOffer), sort),
    }));
    // Ignav, filtered + sorted the same way as Duffel's fares: the
    // itinerary lists are the whole-trip itineraries (one-way,
    // round-trip, 2-leg multi-city); the per-leg lists are the 3–4-leg
    // multi-city legs, each with its own fares.
    const ignavFiltered = ignav.data
      ? sortIgnavItineraries(
          ignav.data.itineraries.filter(
            (it) => ignavItineraryMatches(it, stopsFilter, airlinesFilter, timesFilter) && passesPrice(it.price)
          ),
          sort
        )
      : [];
    const ignavItineraries = ignavFiltered.slice(0, IGNAV_MAX_ITINERARIES);
    const ignavLegLists = (ignav.data?.legs ?? []).map((leg) => ({
      ...leg,
      offers: sortFareOffers(leg.out.filter(passesOffer), sort),
    }));
    return { out, back, legLists, ignavFiltered, ignavItineraries, ignavLegLists };
  }, [fares.data, ignav.data, stopsFilter, airlinesFilter, timesFilter, maxPrice, sort, query.travelers]);
  const { out, back, legLists, ignavFiltered, ignavItineraries, ignavLegLists } = visibleLive;

  // The filter options + counts (Nov 15, 2026): the options come from
  // the full live result, the counts only from the offers on screen —
  // see liveFilterOptions. The JSON-key guard keeps the parent from
  // re-rendering on an identical value.
  const liveOptionsValue = useMemo(() => {
    const totalVisible =
      (fares.data?.out.length ?? 0) +
      (fares.data?.back.length ?? 0) +
      (fares.data?.legs ?? []).reduce((n, l) => n + l.out.length, 0) +
      Math.min(ignav.data?.itineraries.length ?? 0, IGNAV_MAX_ITINERARIES) +
      (ignav.data?.legs ?? []).reduce((n, l) => n + l.out.length, 0);
    return liveFilterOptions({
      shownOffers: [
        ...visibleLive.out,
        ...visibleLive.back,
        ...visibleLive.legLists.flatMap((l) => l.offers),
        ...visibleLive.ignavLegLists.flatMap((l) => l.offers),
      ],
      shownItineraries: visibleLive.ignavItineraries,
      allOffers: [
        ...(fares.data?.out ?? []),
        ...(fares.data?.back ?? []),
        ...(fares.data?.legs ?? []).flatMap((l) => l.out),
        ...(ignav.data?.legs ?? []).flatMap((l) => l.out),
      ],
      allItineraries: ignav.data?.itineraries ?? [],
      totalVisible,
    });
  }, [visibleLive, fares.data, ignav.data]);
  const liveOptionsKeyRef = useRef('');
  useEffect(() => {
    const key = liveOptionsValue === null ? 'null' : JSON.stringify(liveOptionsValue);
    if (key === liveOptionsKeyRef.current) return;
    liveOptionsKeyRef.current = key;
    onLiveOptions(liveOptionsValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOptionsValue]);

  const liveFiltersActive =
    stopsFilter.length > 0 || airlinesFilter.length > 0 || timesFilter.length > 0 || maxPrice !== null;
  // One way back from any live filter — the live "Clear filters"
  // clears the panel filters AND the max price, so the full list
  // comes back (the price filter also narrows the live offers).
  const clearAllLiveFilters = () => {
    onClearLiveFilters();
    onClearPrice();
  };
  // The per-fare source tags (Nov 15, 2026): the big supplier column
  // headers are gone, so each fare carries its own discreet tag.
  const duffelTag = fares.data?.mode === 'live' ? 'Duffel · live fare' : 'Duffel · test fare';
  const ignavTag = ignavSourceTag(ignav.data?.observedAt ?? null);
  // The plan flight budget is a round-trip figure — for one-way and
  // multi-city it would quote a budget that does not apply, so the
  // line (and the budget inside noFareMessage) stays round-trip only.
  const budgetFlight = tripType === 'roundtrip' ? plannerFlight : 0;

  return (
    <div aria-label="Flight results">
      <h3>
        {tripType === 'multicity'
          ? `Flights · Multi-city · ${queryLegs.map((l) => `${l.from} → ${l.to}`).join(' · ')} · ${query.travelers} traveler${
              query.travelers > 1 ? 's' : ''
            } · ${query.cabin}`
          : tripType === 'oneway'
            ? `Flights · One-way · ${ctx.origin} → ${destCity} · ${departIso} · ${query.travelers} traveler${
                query.travelers > 1 ? 's' : ''
              } · ${query.cabin}`
            : `Flights · ${ctx.origin} → ${destCity} · ${departIso} – ${returnIso} · ${query.travelers} traveler${
                query.travelers > 1 ? 's' : ''
              } · ${query.cabin}`}
      </h3>
      {/* One clean live-fares list (Nov 15, 2026): the big supplier
          column headers ("Duffel", "Ignav — live") are gone — the
          traveler sees one results list, and each fare carries its
          own small source + freshness tag instead. The trip structure
          stays: outbound / return lists, whole-trip itinerary groups.
          The summary line counts the live offers actually shown. */}
      <div className="fare-live-list">
        {liveOptionsValue && liveFiltersActive && (
          <p className="fare-count">
            Showing {liveOptionsValue.shownCount} of {liveOptionsValue.totalCount} live fares.{' '}
            <button type="button" className="linklike" onClick={clearAllLiveFilters}>
              Clear filters
            </button>
          </p>
        )}
        {fares.status === 'loading' && <p>Checking live fares…</p>}
        {fares.status === 'done' && fares.data?.live && tripType === 'oneway' && (
          <>
            <h5>Outbound — {fares.data.departDate}</h5>
            <ul className="fare-list">
              {out.map((o) => (
                <FareCard
                  key={`${o.airline}-${o.price}-${o.departTime ?? ''}-${o.arriveTime ?? ''}`}
                  offer={o}
                  travelers={query.travelers}
                  cabin={query.cabin}
                  sourceLabel={duffelTag}
                />
              ))}
              {out.length === 0 && (
                <li className="plan-muted">
                  No outbound fares match the filters.{' '}
                  <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                    Clear filters
                  </button>
                </li>
              )}
            </ul>
            {cheapestOneWayTotal(out) > 0 && (
              <p className="fare-total">
                Cheapest one-way: <strong>${cheapestOneWayTotal(out).toLocaleString()}</strong> for {query.travelers} traveler
                {query.travelers > 1 ? 's' : ''} · + ${serviceFee(cheapestOneWayTotal(out)).toLocaleString()} service fee per flight order.
              </p>
            )}
            <p>
              <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query))}>
                Save this search
              </button>
            </p>
          </>
        )}
          {fares.status === 'done' && fares.data?.live && tripType === 'multicity' && (
            <>
              {legLists.map((leg, i) => (
                <div key={`${leg.origin}-${leg.destCity}-${leg.date}`}>
                  <h5>
                    Leg {i + 1} — {leg.origin} → {leg.destCity} · {leg.date}
                  </h5>
                  <ul className="fare-list">
                    {leg.offers.map((o) => (
                      <FareCard
                        key={`${o.airline}-${o.price}-${o.departTime ?? ''}-${o.arriveTime ?? ''}`}
                        offer={o}
                        travelers={query.travelers}
                        cabin={query.cabin}
                        sourceLabel={duffelTag}
                      />
                    ))}
                    {leg.offers.length === 0 && (
                      <li className="plan-muted">
                        {leg.out.length === 0
                          ? 'No fares for this leg.'
                          : 'No fares for this leg match the filters.'}{' '}
                        {leg.out.length > 0 && (
                          <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                            Clear filters
                          </button>
                        )}
                      </li>
                    )}
                  </ul>
                </div>
              ))}
              {cheapestMultiCityTotal(legLists) > 0 && (
                <p className="fare-total">
                  Cheapest all legs: <strong>${cheapestMultiCityTotal(legLists).toLocaleString()}</strong> for {query.travelers} traveler
                  {query.travelers > 1 ? 's' : ''} · cheapest fare of each leg, summed · + ${serviceFee(cheapestMultiCityTotal(legLists)).toLocaleString()} service fee per flight order.
                </p>
              )}
              <p>
                <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query))}>
                  Save this search
                </button>
              </p>
            </>
          )}
          {fares.status === 'done' && fares.data?.live && tripType === 'roundtrip' && (
            <>
              <h5>Outbound — {fares.data.departDate}</h5>
              <ul className="fare-list">
                {out.map((o) => (
                  <FareCard
                    key={`${o.airline}-${o.price}-${o.departTime ?? ''}-${o.arriveTime ?? ''}`}
                    offer={o}
                    travelers={query.travelers}
                    cabin={query.cabin}
                    sourceLabel={duffelTag}
                  />
                ))}
                {out.length === 0 && (
                  <li className="plan-muted">
                    No outbound fares match the filters.{' '}
                    <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                      Clear filters
                    </button>
                  </li>
                )}
              </ul>
              <h5>Return — {fares.data.returnDate}</h5>
              <ul className="fare-list">
                {back.map((o) => (
                  <FareCard
                    key={`${o.airline}-${o.price}-${o.departTime ?? ''}-${o.arriveTime ?? ''}`}
                    offer={o}
                    travelers={query.travelers}
                    cabin={query.cabin}
                    sourceLabel={duffelTag}
                  />
                ))}
                {back.length === 0 && (
                  <li className="plan-muted">
                    No return fares match the filters.{' '}
                    <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                      Clear filters
                    </button>
                  </li>
                )}
              </ul>
              {cheapestOutBackTotal(out, back) > 0 && (
                <p className="fare-total">
                  Cheapest out + back: <strong>${cheapestOutBackTotal(out, back).toLocaleString()}</strong> for {query.travelers} traveler
                  {query.travelers > 1 ? 's' : ''} · + ${serviceFee(cheapestOutBackTotal(out, back)).toLocaleString()} service fee per flight order.
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
            <p>{noFareMessage(fares.data.reason, budgetFlight, budget.qualifier)}</p>
          )}
          {fares.status === 'done' && !fares.data && (
            <p>
              Could not check live fares right now.
              {known && tripType === 'roundtrip'
                ? ` The plan's flight budget for this trip is $${plannerFlight.toLocaleString()} (${budget.qualifier}).`
                : ''}
            </p>
          )}
          {ignav.status === 'loading' && <p>Checking live fares from Ignav…</p>}
          {ignav.status === 'done' && ignav.data && !ignav.data.live && (
            <p>{ignavEmptyMessage(ignav.data.reason)}</p>
          )}
          {ignav.status === 'done' && !ignav.data && <p>Could not check live fares from Ignav right now.</p>}
            {ignav.status === 'done' && ignav.data?.live && tripType === 'oneway' && (
              <>
                <ul className="fare-list">
                  {ignavItineraries.map((it) => {
                    const leg = it.legs[0];
                    if (!leg) return null;
                    return (
                      <FareCard
                        key={it.ignavId ?? `${leg.airline}-${it.price}`}
                        offer={leg}
                        travelers={query.travelers}
                        cabin={query.cabin}
                        sourceLabel={ignavTag}
                        footer={<IgnavBookingLinks context={ignavBookingContext(it)} travelers={query.travelers} />}
                      />
                    );
                  })}
                  {ignavItineraries.length === 0 && (
                    <li className="plan-muted">
                      No Ignav fares match the filters.{' '}
                      <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                        Clear filters
                      </button>
                    </li>
                  )}
                </ul>
                {cheapestIgnavItinerary(ignavItineraries) > 0 && (
                  <p className="fare-total">
                    Cheapest one-way (Ignav): from{' '}
                    <strong>${cheapestIgnavItinerary(ignavItineraries).toLocaleString()}</strong> for {query.travelers} traveler
                    {query.travelers > 1 ? 's' : ''}
                  </p>
                )}
                {ignavFiltered.length > IGNAV_MAX_ITINERARIES && (
                  <p className="plan-muted">Showing the {IGNAV_MAX_ITINERARIES} cheapest live fares from Ignav.</p>
                )}
              </>
            )}
            {ignav.status === 'done' && ignav.data?.live && tripType === 'roundtrip' && (
              <>
                {ignavItineraries.map((it) => (
                  <IgnavItineraryGroup
                    key={it.ignavId ?? `${it.price}-${it.legs[0]?.airline ?? ''}`}
                    itinerary={it}
                    travelers={query.travelers}
                    cabin={query.cabin}
                    labels={['Outbound', 'Return']}
                    sourceLabel={ignavTag}
                  />
                ))}
                {ignavItineraries.length === 0 && (
                  <p className="plan-muted">
                    No Ignav fares match the filters.{' '}
                    <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                      Clear filters
                    </button>
                  </p>
                )}
                {cheapestIgnavItinerary(ignavItineraries) > 0 && (
                  <p className="fare-total">
                    Cheapest round-trip (Ignav): from{' '}
                    <strong>${cheapestIgnavItinerary(ignavItineraries).toLocaleString()}</strong> for {query.travelers} traveler
                    {query.travelers > 1 ? 's' : ''}
                  </p>
                )}
                {ignavFiltered.length > IGNAV_MAX_ITINERARIES && (
                  <p className="plan-muted">Showing the {IGNAV_MAX_ITINERARIES} cheapest live trips from Ignav.</p>
                )}
              </>
            )}
            {ignav.status === 'done' && ignav.data?.live && tripType === 'multicity' && ignav.data.itineraries.length > 0 && (
              <>
                {ignavItineraries.map((it) => (
                  <IgnavItineraryGroup
                    key={it.ignavId ?? `${it.price}-${it.legs[0]?.airline ?? ''}`}
                    itinerary={it}
                    travelers={query.travelers}
                    cabin={query.cabin}
                    labels={queryLegs.map((l, i) => `Leg ${i + 1} — ${l.from} → ${l.to} · ${l.depart}`)}
                    sourceLabel={ignavTag}
                  />
                ))}
                {ignavItineraries.length === 0 && (
                  <p className="plan-muted">
                    No Ignav fares match the filters.{' '}
                    <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                      Clear filters
                    </button>
                  </p>
                )}
                {cheapestIgnavItinerary(ignavItineraries) > 0 && (
                  <p className="fare-total">
                    Cheapest multi-city (Ignav): from{' '}
                    <strong>${cheapestIgnavItinerary(ignavItineraries).toLocaleString()}</strong> for {query.travelers} traveler
                    {query.travelers > 1 ? 's' : ''}
                  </p>
                )}
                {ignavFiltered.length > IGNAV_MAX_ITINERARIES && (
                  <p className="plan-muted">Showing the {IGNAV_MAX_ITINERARIES} cheapest live trips from Ignav.</p>
                )}
              </>
            )}
            {ignav.status === 'done' && ignav.data?.live && tripType === 'multicity' && ignavLegLists.length > 0 && (
              <>
                {ignavLegLists.map((leg, i) => (
                  <div key={`${leg.origin}-${leg.destination}-${leg.date}`}>
                    <h5>
                      Leg {i + 1} — {leg.origin} → {leg.destCity ?? leg.destination} · {leg.date}
                    </h5>
                    <ul className="fare-list">
                      {leg.offers.map((o) => (
                        <FareCard
                          key={`${o.airline}-${o.price}-${o.departTime ?? ''}-${o.arriveTime ?? ''}`}
                          offer={o}
                          travelers={query.travelers}
                          cabin={query.cabin}
                          sourceLabel={ignavTag}
                          footer={<IgnavBookingLinks context={ignavBookingContextForOffer(o)} travelers={query.travelers} />}
                        />
                      ))}
                      {leg.offers.length === 0 && (
                        <li className="plan-muted">
                          {leg.out.length === 0
                            ? 'No live fares from Ignav for this leg.'
                            : 'No fares for this leg match the filters.'}{' '}
                          {leg.out.length > 0 && (
                            <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                              Clear filters
                            </button>
                          )}
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
                {cheapestMultiCityTotal(ignavLegLists.map((l) => ({ out: l.offers }))) > 0 && (
                  <p className="fare-total">
                    Cheapest all legs (Ignav): from{' '}
                    <strong>${cheapestMultiCityTotal(ignavLegLists.map((l) => ({ out: l.offers }))).toLocaleString()}</strong> for{' '}
                    {query.travelers} traveler{query.travelers > 1 ? 's' : ''} · cheapest fare of each leg, summed.
                  </p>
                )}
              </>
            )}
            {ignav.status === 'done' && ignav.data?.live && (
              <p className="plan-muted">
                Live fares from Ignav — prices are approximate and can change; confirm on the booking site.
              </p>
            )}
          </div>
          {competitor.status !== 'idle' && (
            <section className="fare-block" aria-label="Other sites (cached)">
              <h4>Other sites (cached)</h4>
              <p className="plan-muted">
                {competitor.status === 'loading'
                  ? 'Checking other sites…'
                  : competitor.data?.available
                    ? competitor.data.label
                    : 'Cached fares from other sites'}
              </p>
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
          </section>
        )}
      {known && tripType === 'roundtrip' && (
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

// One stay row as a card: the destination's photo and route, the
// stay's nights and party, the selected tier's per-traveler price
// and party total. No property name, rating, or per-night figure:
// the planner has none of those, so the card shows none of those.
function StayCard({
  row,
  query,
  nights,
  onSave,
}: {
  row: StayTierRow;
  query: SearchQuery;
  nights: number | null;
  onSave: (label: string) => void;
}) {
  const photo = destinationPhoto(row.destination);
  const highlight = rowIncludesPlace(row.destination, query.dest);
  const tierLabel = stayTierLabel(query.stayTier);
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        <p className="plan-muted">
          {nights !== null ? `${nights} night${nights > 1 ? 's' : ''} · ` : ''}
          {query.guests} guest{query.guests > 1 ? 's' : ''} · {query.rooms} room{query.rooms > 1 ? 's' : ''}
        </p>
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {tierLabel} · planning estimate</span>
        </p>
        <p className="plan-muted">
          ${row.total.toLocaleString()} total for {query.guests} guest{query.guests > 1 ? 's' : ''}
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Stays results (Nov 15, 2026 — the Stays section, same standard as
// the Flights section): the searched destination's three planner
// tiers as stay cards, then the per-destination stay list in the
// selected tier. Every figure is the planner's own hotel leg for
// the party — a planning estimate, never a live quote, never a named
// property. No "Book now": no live supplier exists yet.
function StayResults({
  query,
  sort,
  maxPrice,
  stayTier,
  onSave,
  onClearPrice,
  onClearStayFilters,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  stayTier: StayTier;
  onSave: (label: string) => void;
  onClearPrice: () => void;
  onClearStayFilters: () => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? stayTierOptions(query.dest, query.guests) : null;
  const nights = stayNightsFor(query, query.dest || undefined);
  const allRows = useMemo(() => stayTierRows(stayTier, query.guests), [stayTier, query.guests]);
  const rows = useMemo(() => {
    const sorted = sortTabRows(allRows, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [allRows, sort, maxPrice]);
  const filtersActive = maxPrice !== null || stayTier !== 'best';
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const guests = `${query.guests} guest${query.guests > 1 ? 's' : ''}`;
  const rooms = `${query.rooms} room${query.rooms > 1 ? 's' : ''}`;
  const tierLabel = stayTierLabel(stayTier);
  return (
    <div aria-label="Stay results">
      <h3>
        Stays · {query.dest || 'Anywhere'} · {dates}
        {nights !== null ? ` · ${nights} night${nights > 1 ? 's' : ''}` : ''} · {guests} · {rooms}
      </h3>
      <p className="plan-muted">Live hotel prices arrive when Expedia Rapid / Duffel Stays connect.</p>
      <p className="plan-muted">
        Stay prices below are planning estimates from FujinTrip&apos;s planner — not live quotes, and no named property is
        attached to them. Live bookable stays open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Stays in {query.dest} — planning estimates</h4>
          <div className="result-cards">
            {tiers.map((t) => (
              <article key={t.tier} className={`result-card${t.tier === stayTier ? ' result-match' : ''}`}>
                <div className="result-body">
                  <h3>
                    {t.label}
                    {t.tier === 'best' ? ' · Our pick' : ''}
                  </h3>
                  <p className="plan-muted">
                    {nights !== null ? `${nights} night${nights > 1 ? 's' : ''} · ` : ''}
                    {guests} · {rooms}
                  </p>
                  <p className="result-price">
                    from ${t.perTraveler.toLocaleString()} per traveler{' '}
                    <span className="plan-muted">· planning estimate</span>
                  </p>
                  <p className="plan-muted">
                    ${t.hotel.toLocaleString()} total for {guests}
                  </p>
                  <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dest))}>
                    Save this search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {filtersActive && (
        <p className="fare-count">
          Showing {rows.length} of {allRows.length} destinations · {tierLabel} stays.{' '}
          <button type="button" className="linklike" onClick={onClearStayFilters}>
            Clear filters
          </button>
        </p>
      )}
      <h4>Stays by destination — planning estimates</h4>
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
            <StayCard key={r.destination} row={r} query={query} nights={stayNightsFor(query, r.destination)} onSave={onSave} />
          ))}
        </div>
      )}
      <p className="plan-muted">
        {tierLabel} stay per traveler, {guests} · planning estimate — not a live quote. Live comparison arrives as suppliers
        connect.
      </p>
    </div>
  );
}

// One car row as a card: the destination's photo and route, the
// rental's days and party, the selected tier's per-traveler price
// and party total. No company name, model, rating, or per-day
// figure: the planner has none of those, so the card shows none
// of those.
function CarCard({
  row,
  query,
  days,
  onSave,
}: {
  row: CarTierRow;
  query: SearchQuery;
  days: number | null;
  onSave: (label: string) => void;
}) {
  const photo = destinationPhoto(row.destination);
  const highlight = rowIncludesPlace(row.destination, query.dest);
  const tierLabel = carTierLabel(query.carTier);
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        <p className="plan-muted">
          {days !== null ? `${days} day${days > 1 ? 's' : ''} · ` : ''}
          {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
          {query.pickupTime ? ` · pick-up ${query.pickupTime}` : ''}
        </p>
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {tierLabel} · planning estimate</span>
        </p>
        <p className="plan-muted">
          ${row.total.toLocaleString()} total for {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Car rental results (Nov 15, 2026 — the Car rental section, same
// standard as the Stays section): the searched destination's three
// planner tiers as car cards, then the per-destination car list in
// the selected tier. Every figure is the planner's own car leg for
// the party — a planning estimate, never a live quote, never a
// named company or model. No "Book now": no live supplier exists
// yet.
function CarResults({
  query,
  sort,
  maxPrice,
  carTier,
  onSave,
  onClearPrice,
  onClearCarFilters,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  carTier: CarTier;
  onSave: (label: string) => void;
  onClearPrice: () => void;
  onClearCarFilters: () => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? carTierOptions(query.dest, query.travelers) : null;
  const days = carDaysFor(query, query.dest || undefined);
  const allRows = useMemo(() => carTierRows(carTier, query.travelers), [carTier, query.travelers]);
  const rows = useMemo(() => {
    const sorted = sortTabRows(allRows, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [allRows, sort, maxPrice]);
  const filtersActive = maxPrice !== null || carTier !== 'best';
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const tierLabel = carTierLabel(carTier);
  return (
    <div aria-label="Car rental results">
      <h3>
        Car rental · {query.dest || 'Anywhere'} · {dates}
        {days !== null ? ` · ${days} day${days > 1 ? 's' : ''}` : ''} · {travelers}
      </h3>
      <p className="plan-muted">Live car prices arrive when Rentalcars / CarTrawler connect.</p>
      <p className="plan-muted">
        Car rental prices below are planning estimates from FujinTrip&apos;s planner — not live quotes, and no company or
        model is attached to them. Live bookable cars open as suppliers connect.
      </p>
      {query.pickupTime && <p className="plan-muted">Pick-up {query.pickupTime}.</p>}
      {!query.sameLocation && query.dropoff && <p className="plan-muted">Drop-off in {query.dropoff}.</p>}
      {tiers && (
        <>
          <h4>Car rental in {query.dest} — planning estimates</h4>
          <div className="result-cards">
            {tiers.map((t) => (
              <article key={t.tier} className={`result-card${t.tier === carTier ? ' result-match' : ''}`}>
                <div className="result-body">
                  <h3>
                    {t.label}
                    {t.tier === 'best' ? ' · Our pick' : ''}
                  </h3>
                  <p className="plan-muted">
                    {days !== null ? `${days} day${days > 1 ? 's' : ''} · ` : ''}
                    {travelers}
                  </p>
                  <p className="result-price">
                    from ${t.perTraveler.toLocaleString()} per traveler{' '}
                    <span className="plan-muted">· planning estimate</span>
                  </p>
                  <p className="plan-muted">
                    ${t.car.toLocaleString()} total for {travelers}
                  </p>
                  <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dest))}>
                    Save this search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {filtersActive && (
        <p className="fare-count">
          Showing {rows.length} of {allRows.length} destinations · {tierLabel} cars.{' '}
          <button type="button" className="linklike" onClick={onClearCarFilters}>
            Clear filters
          </button>
        </p>
      )}
      <h4>Cars by destination — planning estimates</h4>
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
            <CarCard key={r.destination} row={r} query={query} days={carDaysFor(query, r.destination)} onSave={onSave} />
          ))}
        </div>
      )}
      <p className="plan-muted">
        {tierLabel} car per traveler, {travelers} · planning estimate — not a live quote. Live comparison arrives as suppliers
        connect.
      </p>
    </div>
  );
}

// One attraction row: the destination, the visit's days and
// party, the selected tier's per-traveler price and party total.
// No attraction name, tour name, operator, rating, or per-day
// figure: the planner has none of those, so the card shows none
// of those.
function TourCard({
  row,
  query,
  days,
  onSave,
}: {
  row: TourTierRow;
  query: SearchQuery;
  days: number | null;
  onSave: (label: string) => void;
}) {
  const photo = destinationPhoto(row.destination);
  const highlight = rowIncludesPlace(row.destination, query.dest);
  const tierLabel = tourTierLabel(query.tourTier);
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        <p className="plan-muted">
          {days !== null ? `${days} day${days > 1 ? 's' : ''} · ` : ''}
          {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {tierLabel} · planning estimate</span>
        </p>
        <p className="plan-muted">
          ${row.total.toLocaleString()} total for {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Attractions results (Nov 15, 2026 — the Attractions section,
// same standard as the Stays and Car rental sections): the searched
// destination's three planner tiers as attraction cards, then the
// per-destination attraction list in the selected tier. Every
// figure is the planner's own activities leg for the party — a
// planning estimate, never a live quote, never a named attraction,
// tour, or operator. No "Book now": no live supplier exists yet.
function TourResults({
  query,
  sort,
  maxPrice,
  tourTier,
  onSave,
  onClearPrice,
  onClearTourFilters,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  tourTier: TourTier;
  onSave: (label: string) => void;
  onClearPrice: () => void;
  onClearTourFilters: () => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? tourTierOptions(query.dest, query.travelers) : null;
  const days = tourDaysFor(query, query.dest || undefined);
  const allRows = useMemo(() => tourTierRows(tourTier, query.travelers), [tourTier, query.travelers]);
  const rows = useMemo(() => {
    const sorted = sortTabRows(allRows, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [allRows, sort, maxPrice]);
  const filtersActive = maxPrice !== null || tourTier !== 'best';
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const tierLabel = tourTierLabel(tourTier);
  return (
    <div aria-label="Attractions results">
      <h3>
        Attractions · {query.dest || 'Anywhere'} · {dates}
        {days !== null ? ` · ${days} day${days > 1 ? 's' : ''}` : ''} · {travelers}
      </h3>
      <p className="plan-muted">Live tours arrive when Viator / GetYourGuide / Klook connect.</p>
      <p className="plan-muted">
        Attraction prices below are planning estimates from FujinTrip&apos;s planner — not live quotes, and no attraction,
        tour, or operator is attached to them. Live bookable attractions open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Attractions in {query.dest} — planning estimates</h4>
          <div className="result-cards">
            {tiers.map((t) => (
              <article key={t.tier} className={`result-card${t.tier === tourTier ? ' result-match' : ''}`}>
                <div className="result-body">
                  <h3>
                    {t.label}
                    {t.tier === 'best' ? ' · Our pick' : ''}
                  </h3>
                  <p className="plan-muted">
                    {days !== null ? `${days} day${days > 1 ? 's' : ''} · ` : ''}
                    {travelers}
                  </p>
                  <p className="result-price">
                    from ${t.perTraveler.toLocaleString()} per traveler{' '}
                    <span className="plan-muted">· planning estimate</span>
                  </p>
                  <p className="plan-muted">
                    ${t.activities.toLocaleString()} total for {travelers}
                  </p>
                  <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dest))}>
                    Save this search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {filtersActive && (
        <p className="fare-count">
          Showing {rows.length} of {allRows.length} destinations · {tierLabel} attractions.{' '}
          <button type="button" className="linklike" onClick={onClearTourFilters}>
            Clear filters
          </button>
        </p>
      )}
      <h4>Attractions by destination — planning estimates</h4>
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
            <TourCard key={r.destination} row={r} query={query} days={tourDaysFor(query, r.destination)} onSave={onSave} />
          ))}
        </div>
      )}
      <p className="plan-muted">
        {tierLabel} attraction per traveler, {travelers} · planning estimate — not a live quote. Live comparison arrives as suppliers
        connect.
      </p>
    </div>
  );
}

// One cruise row: the destination, the searched month and party,
// the selected tier's per-traveler price and party total. No cruise
// line, ship, sailing, rating, or per-night figure: the planner has
// none of those, so the card shows none of those. The price is the
// per-tier FULL-TRIP total, labeled as such — never a cruise price.
function CruiseCard({
  row,
  query,
  onSave,
}: {
  row: CruiseTierRow;
  query: SearchQuery;
  onSave: (label: string) => void;
}) {
  const photo = destinationPhoto(row.destination);
  const highlight = rowIncludesPlace(row.destination, query.dest);
  const tierLabel = cruiseTierLabel(query.cruiseTier);
  const monthLabel = query.month ? MONTH_NAMES[Number(query.month) - 1] : 'Flexible month';
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        <p className="plan-muted">
          {monthLabel} · {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {tierLabel} · Full trip · planning estimate</span>
        </p>
        <p className="plan-muted">
          ${row.total.toLocaleString()} total for {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Cruises results (Nov 15, 2026 — the Cruises section, same
// standard as the Stays, Car rental and Attractions sections): the
// searched destination's three planner tiers as cruise cards, then
// the per-destination cruise list in the selected tier. Every
// figure is the planner's own per-tier FULL-TRIP total — the
// planner breaks out no cruise leg, so these are full-trip planning
// estimates, never cruise prices, never a named line, ship, or
// sailing. No "Book now": no live supplier exists yet.
function CruiseResults({
  query,
  sort,
  maxPrice,
  cruiseTier,
  onSave,
  onClearPrice,
  onClearCruiseFilters,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  cruiseTier: CruiseTier;
  onSave: (label: string) => void;
  onClearPrice: () => void;
  onClearCruiseFilters: () => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? cruiseTierOptions(query.dest, query.travelers) : null;
  const allRows = useMemo(() => cruiseTierRows(cruiseTier, query.travelers), [cruiseTier, query.travelers]);
  const rows = useMemo(() => {
    const sorted = sortTabRows(allRows, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [allRows, sort, maxPrice]);
  const filtersActive = maxPrice !== null || cruiseTier !== 'best';
  const monthLabel = query.month ? MONTH_NAMES[Number(query.month) - 1] : 'Flexible month';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const tierLabel = cruiseTierLabel(cruiseTier);
  const note = noLegNote('cruises');
  return (
    <div aria-label="Cruises results">
      <h3>
        Cruises · {query.dest || 'Anywhere'} · {monthLabel} · {travelers}
      </h3>
      <p className="plan-muted">Live cruise prices arrive when Traveltek connects.</p>
      {note && <p className="results-note">{note}</p>}
      <p className="plan-muted">
        Cruise prices below are full-trip planning estimates from FujinTrip&apos;s planner — not cruise prices and not live
        quotes, and no cruise line, ship, or sailing is attached to them. Live bookable cruises open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Cruises in {query.dest} — full-trip planning estimates</h4>
          <div className="result-cards">
            {tiers.map((t) => (
              <article key={t.tier} className={`result-card${t.tier === cruiseTier ? ' result-match' : ''}`}>
                <div className="result-body">
                  <h3>
                    {t.label}
                    {t.tier === 'best' ? ' · Our pick' : ''}
                  </h3>
                  <p className="plan-muted">
                    {monthLabel} · {travelers}
                  </p>
                  <p className="result-price">
                    from ${t.perTraveler.toLocaleString()} per traveler{' '}
                    <span className="plan-muted">· Full trip · planning estimate</span>
                  </p>
                  <p className="plan-muted">
                    ${t.total.toLocaleString()} total for {travelers}
                  </p>
                  <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dest))}>
                    Save this search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {filtersActive && (
        <p className="fare-count">
          Showing {rows.length} of {allRows.length} destinations · {tierLabel} cruises.{' '}
          <button type="button" className="linklike" onClick={onClearCruiseFilters}>
            Clear filters
          </button>
        </p>
      )}
      <h4>Cruises by destination — full-trip planning estimates</h4>
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
            <CruiseCard key={r.destination} row={r} query={query} onSave={onSave} />
          ))}
        </div>
      )}
      <p className="plan-muted">
        {tierLabel} full trip per traveler, {travelers} · planning estimate — not a live quote. Live comparison arrives as suppliers
        connect.
      </p>
    </div>
  );
}

// One bus row: the destination, the searched route and dates, the
// selected tier's per-traveler price and party total. No bus
// operator, route, timetable, rating, or per-ride figure: the
// planner has none of those, so the card shows none of those. The
// price is the per-tier FULL-TRIP total, labeled as such — never a
// bus price.
function BusCard({
  row,
  query,
  onSave,
}: {
  row: BusTierRow;
  query: SearchQuery;
  onSave: (label: string) => void;
}) {
  const photo = destinationPhoto(row.destination);
  const highlight = rowIncludesPlace(row.destination, query.to);
  const tierLabel = busTierLabel(query.busTier);
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        <p className="plan-muted">
          {dates} · {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {tierLabel} · Full trip · planning estimate</span>
        </p>
        <p className="plan-muted">
          ${row.total.toLocaleString()} total for {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Buses results (Nov 15, 2026 — the Buses section, same standard
// as the Stays, Car rental, Attractions and Cruises sections): the
// searched route's three planner tiers as bus cards, then the
// per-destination bus list in the selected tier. Every figure is
// the planner's own per-tier FULL-TRIP total — the planner breaks
// out no bus leg, so these are full-trip planning estimates, never
// bus prices, never a named operator, route, or timetable. No
// "Book now": no live supplier exists yet.
function BusResults({
  query,
  sort,
  maxPrice,
  busTier,
  onSave,
  onClearPrice,
  onClearBusFilters,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  busTier: BusTier;
  onSave: (label: string) => void;
  onClearPrice: () => void;
  onClearBusFilters: () => void;
}) {
  const known = isKnownPlace(query.to);
  const tiers = known ? busTierOptions(query.to, query.travelers) : null;
  const allRows = useMemo(() => busTierRows(busTier, query.travelers), [busTier, query.travelers]);
  const rows = useMemo(() => {
    const sorted = sortTabRows(allRows, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [allRows, sort, maxPrice]);
  const filtersActive = maxPrice !== null || busTier !== 'best';
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const tierLabel = busTierLabel(busTier);
  const note = noLegNote('buses');
  return (
    <div aria-label="Buses results">
      <h3>
        Buses · {query.from || 'Anywhere'} → {query.to || 'Anywhere'} · {dates} · {travelers}
      </h3>
      <p className="plan-muted">Live bus prices arrive when Distribusion / Busbud / FlixBus connect.</p>
      {note && <p className="results-note">{note}</p>}
      <p className="plan-muted">
        Bus prices below are full-trip planning estimates from FujinTrip&apos;s planner — not bus prices and not live
        quotes, and no bus operator, route, or timetable is attached to them. Live bookable buses open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Buses to {query.to} — full-trip planning estimates</h4>
          <div className="result-cards">
            {tiers.map((t) => (
              <article key={t.tier} className={`result-card${t.tier === busTier ? ' result-match' : ''}`}>
                <div className="result-body">
                  <h3>
                    {t.label}
                    {t.tier === 'best' ? ' · Our pick' : ''}
                  </h3>
                  <p className="plan-muted">
                    {query.from || 'Anywhere'} → {query.to} · {dates} · {travelers}
                  </p>
                  <p className="result-price">
                    from ${t.perTraveler.toLocaleString()} per traveler{' '}
                    <span className="plan-muted">· Full trip · planning estimate</span>
                  </p>
                  <p className="plan-muted">
                    ${t.total.toLocaleString()} total for {travelers}
                  </p>
                  <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.to))}>
                    Save this search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {filtersActive && (
        <p className="fare-count">
          Showing {rows.length} of {allRows.length} destinations · {tierLabel} buses.{' '}
          <button type="button" className="linklike" onClick={onClearBusFilters}>
            Clear filters
          </button>
        </p>
      )}
      <h4>Buses by destination — full-trip planning estimates</h4>
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
            <BusCard key={r.destination} row={r} query={query} onSave={onSave} />
          ))}
        </div>
      )}
      <p className="plan-muted">
        {tierLabel} full trip per traveler, {travelers} · planning estimate — not a live quote. Live comparison arrives as suppliers
        connect.
      </p>
    </div>
  );
}

// One taxi row: the destination, the searched ride and date/time, the
// selected tier's per-traveler price and party total. No taxi
// company, route, timetable, rating, or per-ride figure: the
// planner has none of those, so the card shows none of those. The
// price is the per-tier FULL-TRIP total, labeled as such — never a
// taxi price.
function TaxiCard({
  row,
  query,
  onSave,
}: {
  row: TaxiTierRow;
  query: SearchQuery;
  onSave: (label: string) => void;
}) {
  const photo = destinationPhoto(row.destination);
  const highlight = rowIncludesPlace(row.destination, query.dropoff || query.from);
  const tierLabel = taxiTierLabel(query.taxiTier);
  const dates = query.depart
    ? `${query.depart}${query.pickupTime ? ` · ${query.pickupTime}` : ''}`
    : 'Flexible dates';
  return (
    <article className={`result-card${highlight ? ' result-match' : ''}`}>
      {photo && <SafeImg src={photo} alt={row.destination} label={row.destination} className="result-photo" />}
      <div className="result-body">
        <h3>{row.destination}</h3>
        <p className="plan-muted">{row.routeLine}</p>
        <p className="plan-muted">
          {dates} · {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        {highlight && <p className="result-match-line">Includes the place you searched for.</p>}
        <p className="result-price">
          from ${row.pricePerTraveler.toLocaleString()} per traveler{' '}
          <span className="plan-muted">· {tierLabel} · Full trip · planning estimate</span>
        </p>
        <p className="plan-muted">
          ${row.total.toLocaleString()} total for {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, row.destination))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Taxis results (Nov 15, 2026 — the Taxis section, same standard
// as the Stays, Car rental, Attractions, Cruises and Buses
// sections): the searched ride's three planner tiers as taxi cards,
// then the per-destination taxi list in the selected tier. Every
// figure is the planner's own per-tier FULL-TRIP total — the planner
// breaks out no taxi leg, so these are full-trip planning estimates,
// never taxi prices, never a named company, route, or timetable. No
// "Book now": no live supplier exists yet.
function TaxiResults({
  query,
  sort,
  maxPrice,
  taxiTier,
  onSave,
  onClearPrice,
  onClearTaxiFilters,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  taxiTier: TaxiTier;
  onSave: (label: string) => void;
  onClearPrice: () => void;
  onClearTaxiFilters: () => void;
}) {
  const dropOff = query.dropoff || query.from;
  const known = isKnownPlace(dropOff);
  const tiers = known ? taxiTierOptions(dropOff, query.travelers) : null;
  const allRows = useMemo(() => taxiTierRows(taxiTier, query.travelers), [taxiTier, query.travelers]);
  const rows = useMemo(() => {
    const sorted = sortTabRows(allRows, sort);
    return maxPrice === null ? sorted : sorted.filter((r) => r.pricePerTraveler <= maxPrice);
  }, [allRows, sort, maxPrice]);
  const filtersActive = maxPrice !== null || taxiTier !== 'best';
  const dates = query.depart
    ? `${query.depart}${query.pickupTime ? ` · ${query.pickupTime}` : ''}`
    : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const tierLabel = taxiTierLabel(taxiTier);
  const note = noLegNote('taxis');
  return (
    <div aria-label="Taxis results">
      <h3>
        Taxis · {query.from || 'Anywhere'} → {query.dropoff || 'Anywhere'} · {dates} · {travelers}
      </h3>
      <p className="plan-muted">Live taxi prices arrive when Uber / Lyft / Mozio connect.</p>
      {note && <p className="results-note">{note}</p>}
      <p className="plan-muted">
        Taxi prices below are full-trip planning estimates from FujinTrip&apos;s planner — not taxi prices and not live
        quotes, and no taxi company, route, or timetable is attached to them. Live bookable taxis open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Taxis to {dropOff} — full-trip planning estimates</h4>
          <div className="result-cards">
            {tiers.map((t) => (
              <article key={t.tier} className={`result-card${t.tier === taxiTier ? ' result-match' : ''}`}>
                <div className="result-body">
                  <h3>
                    {t.label}
                    {t.tier === 'best' ? ' · Our pick' : ''}
                  </h3>
                  <p className="plan-muted">
                    {query.from || 'Anywhere'} → {query.dropoff || 'Anywhere'} · {dates} · {travelers}
                  </p>
                  <p className="result-price">
                    from ${t.perTraveler.toLocaleString()} per traveler{' '}
                    <span className="plan-muted">· Full trip · planning estimate</span>
                  </p>
                  <p className="plan-muted">
                    ${t.total.toLocaleString()} total for {travelers}
                  </p>
                  <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, dropOff))}>
                    Save this search
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {filtersActive && (
        <p className="fare-count">
          Showing {rows.length} of {allRows.length} destinations · {tierLabel} taxis.{' '}
          <button type="button" className="linklike" onClick={onClearTaxiFilters}>
            Clear filters
          </button>
        </p>
      )}
      <h4>Taxis by destination — full-trip planning estimates</h4>
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
            <TaxiCard key={r.destination} row={r} query={query} onSave={onSave} />
          ))}
        </div>
      )}
      <p className="plan-muted">
        {tierLabel} full trip per traveler, {travelers} · planning estimate — not a live quote. Live comparison arrives as suppliers
        connect.
      </p>
    </div>
  );
}

// One tab's estimate results: the per-route planner numbers for this
// category, per traveler, labeled planning estimate. Every tab has
// its own results component since Nov 15, 2026 — this is the
// fallback for a tab without one.
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
  const [liveOptions, setLiveOptions] = useState<LiveFilterOptions | null>(null);
  const [stopsFilter, setStopsFilter] = useState<number[]>([]);
  const [airlinesFilter, setAirlinesFilter] = useState<string[]>([]);
  const [timesFilter, setTimesFilter] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Stays tier (Nov 15, 2026): which planner tier the stay list
  // prices in. It is filter state, not search state — a new search
  // resets it to the tier the search itself carries.
  const [stayTier, setStayTier] = useState<StayTier>(query.stayTier ?? 'best');
  // Car rental tier (Nov 15, 2026): the same filter-state pattern
  // as the Stays tier, for the car list.
  const [carTier, setCarTier] = useState<CarTier>(query.carTier ?? 'best');
  // Attractions tier (Nov 15, 2026): the same filter-state pattern
  // as the Stays and Car rental tiers, for the attraction list.
  const [tourTier, setTourTier] = useState<TourTier>(query.tourTier ?? 'best');
  // Cruises tier (Nov 15, 2026): the same filter-state pattern
  // as the Stays, Car rental and Attractions tiers, for the cruise list.
  const [cruiseTier, setCruiseTier] = useState<CruiseTier>(query.cruiseTier ?? 'best');
  // Buses tier (Nov 15, 2026): the same filter-state pattern
  // as the Stays, Car rental, Attractions and Cruises tiers, for the bus list.
  const [busTier, setBusTier] = useState<BusTier>(query.busTier ?? 'best');
  // Taxis tier (Nov 15, 2026): the same filter-state pattern
  // as the Stays, Car rental, Attractions, Cruises and Buses tiers, for the taxi list.
  const [taxiTier, setTaxiTier] = useState<TaxiTier>(query.taxiTier ?? 'best');
  // The estimate rows behind the max-price counts — the counts on the
  // price options come from the same rows the list shows. Stays price
  // for the searched party (guests), in the selected tier — the
  // flights travelers default would price a 4-guest stay for 2.
  // Cars price for the searched travelers, in the selected tier.
  // Attractions price for the searched travelers, in the selected tier.
  // Cruises price for the searched travelers, in the selected tier
  // (full-trip totals — the planner breaks out no cruise leg).
  // Buses price for the searched travelers, in the selected tier
  // (full-trip totals — the planner breaks out no bus leg).
  // Taxis price for the searched travelers, in the selected tier
  // (full-trip totals — the planner breaks out no taxi leg).
  const estimateRows = useMemo(
    () =>
      query.tab === 'hotels'
        ? stayTierRows(stayTier, query.guests)
        : query.tab === 'cars'
          ? carTierRows(carTier, query.travelers)
          : query.tab === 'tours'
            ? tourTierRows(tourTier, query.travelers)
            : query.tab === 'cruises'
              ? cruiseTierRows(cruiseTier, query.travelers)
              : query.tab === 'buses'
                ? busTierRows(busTier, query.travelers)
                : query.tab === 'taxis'
                  ? taxiTierRows(taxiTier, query.travelers)
                  : tabRowsFor(query.tab, query.travelers),
    [query.tab, query.travelers, query.guests, stayTier, carTier, tourTier, cruiseTier, busTier, taxiTier]
  );
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
  const queryKey = `${query.tab}|${query.tripType ?? 'roundtrip'}|${query.from}|${query.to}|${query.dest}|${query.depart}|${query.ret}|${query.month || ''}|${query.travelers}|${query.guests}|${query.rooms}|${query.stayTier ?? 'best'}|${query.carTier ?? 'best'}|${query.tourTier ?? 'best'}|${query.cruiseTier ?? 'best'}|${query.busTier ?? 'best'}|${query.taxiTier ?? 'best'}|${(query.legs ?? []).map((l) => `${l.from}>${l.to}@${l.depart}`).join(',')}`;
  // A new search resets the filters — last search's stops and
  // airlines do not carry over.
  useEffect(() => {
    setStopsFilter([]);
    setAirlinesFilter([]);
    setTimesFilter([]);
    setLiveOptions(null);
    setFiltersOpen(false);
    setStayTier(query.stayTier ?? 'best');
    setCarTier(query.carTier ?? 'best');
    setTourTier(query.tourTier ?? 'best');
    setCruiseTier(query.cruiseTier ?? 'best');
    setBusTier(query.busTier ?? 'best');
    setTaxiTier(query.taxiTier ?? 'best');
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
      {query.tab === 'hotels' && (
        <div className="filter-group">
          <h3>Stay price</h3>
          <select value={stayTier} onChange={(e) => setStayTier(e.target.value as StayTier)} aria-label="Stay price tier">
            {STAY_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {query.tab === 'cars' && (
        <div className="filter-group">
          <h3>Car price</h3>
          <select value={carTier} onChange={(e) => setCarTier(e.target.value as CarTier)} aria-label="Car price tier">
            {CAR_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {query.tab === 'tours' && (
        <div className="filter-group">
          <h3>Attraction price</h3>
          <select value={tourTier} onChange={(e) => setTourTier(e.target.value as TourTier)} aria-label="Attraction price tier">
            {TOUR_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {query.tab === 'cruises' && (
        <div className="filter-group">
          <h3>Cruise price</h3>
          <select value={cruiseTier} onChange={(e) => setCruiseTier(e.target.value as CruiseTier)} aria-label="Cruise price tier">
            {CRUISE_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {query.tab === 'buses' && (
        <div className="filter-group">
          <h3>Bus price</h3>
          <select value={busTier} onChange={(e) => setBusTier(e.target.value as BusTier)} aria-label="Bus price tier">
            {BUS_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {query.tab === 'taxis' && (
        <div className="filter-group">
          <h3>Taxi price</h3>
          <select value={taxiTier} onChange={(e) => setTaxiTier(e.target.value as TaxiTier)} aria-label="Taxi price tier">
            {TAXI_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
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
          {liveOptions.times.length > 0 && (
            <div className="filter-group">
              <h3>Departure time</h3>
              {liveOptions.times.map((t) => (
                <label key={t} className="filter-check">
                  <input type="checkbox" checked={timesFilter.includes(t)} onChange={() => setTimesFilter((l) => toggleIn(l, t))} />
                  {TIME_BUCKETS.find((b) => b.id === t)?.label ?? t} ({liveOptions.counts.times[t] ?? 0})
                </label>
              ))}
            </div>
          )}
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
                timesFilter={timesFilter}
                onLiveOptions={setLiveOptions}
                onSave={onSaveSearch}
                onClearLiveFilters={() => {
                  setStopsFilter([]);
                  setAirlinesFilter([]);
                  setTimesFilter([]);
                }}
                onClearPrice={() => setMaxPrice(null)}
              />
            ) : query.tab === 'hotels' ? (
              <StayResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                stayTier={stayTier}
                onSave={onSaveSearch}
                onClearPrice={() => setMaxPrice(null)}
                onClearStayFilters={() => {
                  setMaxPrice(null);
                  setStayTier('best');
                }}
              />
            ) : query.tab === 'cars' ? (
              <CarResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                carTier={carTier}
                onSave={onSaveSearch}
                onClearPrice={() => setMaxPrice(null)}
                onClearCarFilters={() => {
                  setMaxPrice(null);
                  setCarTier('best');
                }}
              />
            ) : query.tab === 'tours' ? (
              <TourResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                tourTier={tourTier}
                onSave={onSaveSearch}
                onClearPrice={() => setMaxPrice(null)}
                onClearTourFilters={() => {
                  setMaxPrice(null);
                  setTourTier('best');
                }}
              />
            ) : query.tab === 'cruises' ? (
              <CruiseResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                cruiseTier={cruiseTier}
                onSave={onSaveSearch}
                onClearPrice={() => setMaxPrice(null)}
                onClearCruiseFilters={() => {
                  setMaxPrice(null);
                  setCruiseTier('best');
                }}
              />
            ) : query.tab === 'buses' ? (
              <BusResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                busTier={busTier}
                onSave={onSaveSearch}
                onClearPrice={() => setMaxPrice(null)}
                onClearBusFilters={() => {
                  setMaxPrice(null);
                  setBusTier('best');
                }}
              />
            ) : query.tab === 'taxis' ? (
              <TaxiResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                taxiTier={taxiTier}
                onSave={onSaveSearch}
                onClearPrice={() => setMaxPrice(null)}
                onClearTaxiFilters={() => {
                  setMaxPrice(null);
                  setTaxiTier('best');
                }}
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
