// Direction v3 search results (Nov 14, 2026): the results list for
// one search — Booking pattern (sort above the list, filters on the
// left, map toggle for stays). Flights break the pattern (Nov 16,
// 2026): full-screen card grid, one horizontal filter bar on top, no
// left sidebar, Duffel pairs and Ignav trips mixed in one sorted
// list. Results appear ONLY after a search; nothing here is
// pre-loaded. Every price is labeled as what it is: live Duffel TEST
// fares, cached Travelpayouts fares, Hotelbeds sandbox test hotels
// (never bookable), or the planner's Best value legs/totals per
// traveler as planning estimates. No "Book now"
// anywhere — the primary action on every card is "Save this search"
// (a request in My Trips, no booking, no payment).
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { comparisonFor, MONTH_NAMES, ROUTE_STOPS, routeKeyForDestination } from '../lib/planner';
import { cheapestDestinations, discoveryDestinations, type DiscoveryEntry } from '../lib/discovery';
import { fareSavedKey, tripSavedKey, type SavedDetail } from '../lib/savedTrips';
import {
  DUFFEL_TEST_FARE_WARNING,
  HOME_TABS,
  noFareMessage,
  noLegNote,
  tabRowsFor,
  type TabRow,
} from '../lib/homeTabs';
import {
  cheapestMultiCityTotal,
  destinationPhoto,
  flightBudgetCopy,
  flightContextFromSearch,
  flightFiltersActive,
  flightLegsFromSearch,
  isKnownPlace,
  liveFilterOptions,
  LIVE_PRICE_BANDS,
  rowIncludesPlace,
  searchRequestLabel,
  sortFareOffers,
  sortTabRows,
  BUS_TIERS,
  busTierOptions,
  busTierRows,
  CAR_TIERS,
  carDaysFor,
  carTierOptions,
  carTierRows,
  CRUISE_TIERS,
  cruiseTierOptions,
  cruiseTierRows,
  STAY_TIERS,
  stayNightsFor,
  stayTierOptions,
  stayTierRows,
  TAXI_TIERS,
  taxiTierOptions,
  taxiTierRows,
  TOUR_TIERS,
  tourDaysFor,
  tourTierOptions,
  tourTierRows,
  type RowSort,
  type LiveFilterOptions,
  type SearchQuery,
  type BusTier,
  type CarTier,
  type CruiseTier,
  type StayTier,
  type TaxiTier,
  type TourTier,
} from '../lib/searchPlaces';
import type { CompetitorFares } from '../lib/travelpayouts';
import type { DuffelFareOffer } from '../lib/duffel';
import { formatMinutes, layoversFor, perTravelerPrice, TIME_BUCKETS, timeBucketFor, CITY_IATA } from '../lib/duffel';
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
import type { LetsfgFaresResponse, LetsfgItinerary } from '../lib/letsfg';
import {
  cheapestLetsfgItinerary,
  LETSFG_MAX_ITINERARIES,
  letsfgEmptyMessage,
  letsfgItineraryMatches,
  letsfgSourceTag,
  sortLetsfgItineraries,
} from '../lib/letsfg';
import type { HotelbedsHotel, HotelbedsSearchResult } from '../lib/hotelbeds';
import {
  filterHotelbedsHotels,
  hotelbedsBoardOptions,
  hotelbedsEmptyMessage,
  hotelbedsProductEnabled,
  hotelbedsSandboxTag,
  hotelbedsStarOptions,
  hotelbedsStars,
  hotelbedsZoneOptions,
} from '../lib/hotelbeds';
import type { HotelbedsActivity, HotelbedsActivitiesResult } from '../lib/hotelbeds-activities';
import {
  activityModalityOptions,
  filterHotelbedsActivities,
  hotelbedsActivitiesEmptyMessage,
  hotelbedsActivitiesSandboxTag,
  type HotelbedsActivityDuration,
} from '../lib/hotelbeds-activities';
import type { HotelbedsTransfer, HotelbedsTransfersResult } from '../lib/hotelbeds-transfers';
import {
  filterHotelbedsTransfers,
  hotelbedsTransfersEmptyMessage,
  hotelbedsTransfersSandboxTag,
  transferTypeOptions,
} from '../lib/hotelbeds-transfers';
import { serviceFee } from '../lib/planner';
import { countFlightCards, mergeFlightOptions, type FlightOption } from '../lib/flightOptions';
import { SafeImg } from './FujinChat';
import HotelGallery from './HotelGallery';
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
  testFare = false,
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
  // A Duffel test fare (UX direction, Nov 19 2026 — P0-4): the
  // warning renders on the card itself, always — it never hides
  // behind a filter, unlike the small source tag.
  testFare?: boolean;
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
          </div>
        )}
      </div>
      {/* Breakdown line (UX direction round 2, Nov 21 2026 — P0-7):
          the per-traveler figure sits below the price, not under it
          in the same block — one price per card. Only when this
          card carries its own price (hidePrice cards are legs of a
          group, whose breakdown lives on the group). */}
      {!hidePrice && perPerson !== null && (
        <p className="fare-card-breakdown">
          ${perPerson.toLocaleString()} per traveler · {travelers} travelers
        </p>
      )}
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
      {testFare && <p className="fare-test-warning">{DUFFEL_TEST_FARE_WARNING}</p>}
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
        <button type="button" className="linklike" onClick={load}>
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
  onSaveFare,
  alreadySaved,
}: {
  itinerary: IgnavItinerary;
  travelers: number;
  cabin: string;
  labels: string[];
  // The small source + freshness tag for the whole trip (Nov 15,
  // 2026): the big column header is gone, so the trip total carries
  // its own "Ignav · live, checked …" line.
  sourceLabel?: string;
  // Save this fare (audit round, Nov 17, 2026): every flight card
  // has the same two actions — one primary pill (Save) + one text
  // link (See booking options). Duffel cards already had Save;
  // Ignav and LetsFG cards only offered booking, so the cheapest
  // live fare could not be picked.
  onSaveFare: (fareLabel: string) => void;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): already in My
  // Trips, so the card renders "Saved ✓" on load, not just after
  // the click.
  alreadySaved?: boolean;
}) {
  const [saved, setSaved] = useState(alreadySaved ?? false);
  // Same trip-card shape as the Duffel cards (Nov 17, 2026): one
  // price block, one action.
  return (
    <div className="ignav-itinerary">
      <TripPriceHeader total={itinerary.price} prefix="Trip total from" />
      {sourceLabel && <p className="fare-card-source">{sourceLabel}</p>}
      {itinerary.legs.map((leg, i) => (
        <div key={`${leg.airline}-${leg.price}-${i}`}>
          <h6 className="ignav-leg-label">{labels[i] ?? `Leg ${i + 1}`}</h6>
          <ul className="fare-list">
            <FareCard offer={leg} travelers={travelers} cabin={cabin} hidePrice />
          </ul>
        </div>
      ))}
      <FlightPriceBreakdown total={itinerary.price} travelers={travelers} />
      <div className="flight-option-actions">
        <button
          type="button"
          className="primary"
          disabled={saved}
          onClick={() => {
            onSaveFare(`${itinerary.legs[0]?.airline ?? 'Ignav'} · $${itinerary.price.toLocaleString()}`);
            setSaved(true);
          }}
        >
          {saved ? 'Saved ✓' : 'Save this fare'}
        </button>
        <IgnavBookingLinks key={itinerary.ignavId ?? itinerary.price} context={ignavBookingContext(itinerary)} travelers={travelers} />
      </div>
    </div>
  );
}

// One LetsFG itinerary as a group (Nov 16, 2026): the same shape as
// an Ignav group — the trip total once on top ("from $X": a live
// fare can change before booking), one FareCard per leg with the
// price hidden — but the booking action is a direct link-out, not a
// lookup: every LetsFG offer carries its own booking_url to
// letsfg.co, where the traveler books and pays with their own
// Revolut method. FujinTrip never takes payment for a LetsFG fare
// and never presents one as bookable on FujinTrip.
function LetsfgItineraryGroup({
  itinerary,
  travelers,
  cabin,
  labels,
  sourceLabel,
  onSaveFare,
  alreadySaved,
}: {
  itinerary: LetsfgItinerary;
  travelers: number;
  cabin: string;
  labels: string[];
  // The small source + freshness tag for the whole trip (Nov 16,
  // 2026): the big column header is gone, so the trip total carries
  // its own "LetsFG · live, checked …" line.
  sourceLabel?: string;
  // Save this fare — see IgnavItineraryGroup: every flight card
  // carries the same two actions.
  onSaveFare: (fareLabel: string) => void;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): already in My
  // Trips, so the card renders "Saved ✓" on load.
  alreadySaved?: boolean;
}) {
  const [saved, setSaved] = useState(alreadySaved ?? false);
  // Same trip-card shape as the Ignav group (Nov 17, 2026): one
  // price block, one action.
  return (
    <div className="ignav-itinerary">
      <TripPriceHeader total={itinerary.price} prefix="Trip total from" />
      {sourceLabel && <p className="fare-card-source">{sourceLabel}</p>}
      {itinerary.legs.map((leg, i) => (
        <div key={`${leg.airline}-${leg.price}-${i}`}>
          <h6 className="ignav-leg-label">{labels[i] ?? `Leg ${i + 1}`}</h6>
          <ul className="fare-list">
            <FareCard offer={leg} travelers={travelers} cabin={cabin} hidePrice />
          </ul>
        </div>
      ))}
      <FlightPriceBreakdown total={itinerary.price} travelers={travelers} />
      <div className="flight-option-actions">
        <button
          type="button"
          className="primary"
          disabled={saved}
          onClick={() => {
            onSaveFare(`${itinerary.legs[0]?.airline ?? 'LetsFG'} · $${itinerary.price.toLocaleString()}`);
            setSaved(true);
          }}
        >
          {saved ? 'Saved ✓' : 'Save this fare'}
        </button>
        {itinerary.bookingUrl ? (
          <div className="booking-links">
            <ul>
              <li>
                <a href={itinerary.bookingUrl} target="_blank" rel="noreferrer">
                  See booking options on LetsFG
                  <Icon name="externalLink" size={14} />
                </a>
              </li>
            </ul>
            <p className="plan-muted">
              Opens letsfg.co — you book and pay there with your Revolut method, not on FujinTrip. Prices can change.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// One price block for every flight trip card (Nov 17, 2026;
  // headline-only since Nov 21 — UX direction round 2, P0-7): the
  // trip total once, loud (24px, tabular numerals — the Expedia
  // price-card). Live Ignav/LetsFG totals say "from" — a live fare
  // can change before booking. The per-traveler figure and the
  // service fee moved to FlightPriceBreakdown below, rendered after
  // the legs — the headline carries ONE dollar amount, never two.
function TripPriceHeader({ total, prefix }: { total: number; prefix: string }) {
  return (
    <p className="flight-option-price">
      {prefix} <strong>${total.toLocaleString()}</strong>
    </p>
  );
}

// The breakdown line (UX direction round 2, Nov 21 2026 — P0-7):
// one price per flight card means the headline shows ONLY the trip
// total. The per-traveler figure and, for Duffel only, the service
// fee live here — after the legs, before the actions, still on
// every card, still shown separately, never folded into the total
// and never hidden. The fee is a separate charge at checkout; the
// headline is the fare total alone. Returns null for a single
// traveler with no fee (nothing to break down).
function FlightPriceBreakdown({ total, travelers, fee }: { total: number; travelers: number; fee?: number }) {
  const perPerson = travelers > 1 ? perTravelerPrice(total, travelers) : null;
  const parts = [
    perPerson !== null ? `$${perPerson.toLocaleString()} per traveler · ${travelers} travelers` : null,
    fee !== undefined ? `+ $${fee.toLocaleString()} service fee per flight order` : null,
  ].filter((x): x is string => x !== null);
  if (parts.length === 0) return null;
  return <p className="flight-option-breakdown">{parts.join(' · ')}</p>;
}

// Checkout link for a Duffel offer (Stripe test mode, Nov 20 2026):
// only when the offer carries a Duffel id AND both cities resolve to
// IATA codes. Otherwise '' — the card shows no checkout link and
// never claims a booking it cannot open. The fare is passed along
// for display only; the checkout API re-prices from the offer.
function duffelCheckoutHref(args: {
  offerId?: string;
  returnOfferId?: string;
  originCity: string;
  destCity: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  fare: number;
  currency: string;
  airline: string;
}): string {
  const origin = CITY_IATA[args.originCity];
  const dest = CITY_IATA[args.destCity];
  if (!args.offerId || !origin || !dest) return '';
  const q = new URLSearchParams({
    offerId: args.offerId,
    ...(args.returnOfferId ? { returnOfferId: args.returnOfferId } : {}),
    origin,
    destination: dest,
    date: args.departDate,
    ...(args.returnDate ? { returnDate: args.returnDate } : {}),
    travelers: String(args.travelers),
    fare: String(args.fare),
    currency: args.currency,
    airline: args.airline,
  });
  return `/checkout?${q.toString()}`;
}

// One Duffel round-trip as a single card (Nov 16, 2026; one format
// for every trip card, Nov 17, 2026): the merged grid's Duffel
// option — an outbound + return leg pair, the trip total once on
// top (party total, exact — not "from"), the small source tag, then
// the two legs with their prices hidden (the pair total is the
// price; a per-leg price would read as a one-way fare next to
// round-trip totals), and two actions: "Save this fare" stores the
// chosen option in My Trips, and "Continue to checkout" (Stripe
// test mode, Nov 20, 2026) opens /checkout for the pair — test
// fares only, never a live booking.
function DuffelPairCard({
  out,
  back,
  travelers,
  cabin,
  sourceLabel,
  departDate,
  returnDate,
  onSaveFare,
  alreadySaved,
  testFare = false,
  checkoutHref = '',
}: {
  out: DuffelFareOffer;
  back: DuffelFareOffer;
  travelers: number;
  cabin: string;
  sourceLabel?: string;
  departDate: string;
  returnDate: string;
  onSaveFare: (fareLabel: string) => void;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): already in My
  // Trips, so the card renders "Saved ✓" on load.
  alreadySaved?: boolean;
  // A Duffel test fare (UX direction, Nov 19 2026 — P0-4): the
  // warning renders on the card itself, always — it never hides
  // behind a filter, unlike the small source tag.
  testFare?: boolean;
  // /checkout link for the pair ('' when either offer has no id or
  // a city has no IATA code — then no checkout link renders).
  checkoutHref?: string;
}) {
  const total = out.price + back.price;
  const fee = serviceFee(total);
  const [saved, setSaved] = useState(alreadySaved ?? false);
  return (
    <li className="flight-option-card">
      <TripPriceHeader total={total} prefix="Trip total" />
      {sourceLabel && <p className="fare-card-source">{sourceLabel}</p>}
      {testFare && <p className="fare-test-warning">{DUFFEL_TEST_FARE_WARNING}</p>}
      <h6 className="ignav-leg-label">Outbound — {departDate}</h6>
      <ul className="fare-list">
        <FareCard offer={out} travelers={travelers} cabin={cabin} hidePrice />
      </ul>
      <h6 className="ignav-leg-label">Return — {returnDate}</h6>
      <ul className="fare-list">
        <FareCard offer={back} travelers={travelers} cabin={cabin} hidePrice />
      </ul>
      <FlightPriceBreakdown total={total} travelers={travelers} fee={fee} />
      <div className="flight-option-actions">
        <button
          type="button"
          className="primary"
          disabled={saved}
          onClick={() => {
            onSaveFare(`${out.airline} + ${back.airline} · $${total.toLocaleString()}`);
            setSaved(true);
          }}
        >
          {saved ? 'Saved ✓' : 'Save this fare'}
        </button>
        {checkoutHref && (
          <a className="ghost" href={checkoutHref}>
            Continue to checkout
          </a>
        )}
      </div>
    </li>
  );
}

// One Duffel one-way as a trip card (Nov 17, 2026): the merged
// grid's one-way option — the same trip-card shape as a pair (trip
// total on top, source tag, one leg with its price hidden, one
// action), never a bare fare card with the price on the leg.
// "Continue to checkout" (Stripe test mode, Nov 20, 2026) opens
// /checkout for the offer — test fares only, never a live booking.
function DuffelOneWayCard({
  offer,
  travelers,
  cabin,
  sourceLabel,
  onSaveFare,
  alreadySaved,
  testFare = false,
  checkoutHref = '',
}: {
  offer: DuffelFareOffer;
  travelers: number;
  cabin: string;
  sourceLabel?: string;
  onSaveFare: (fareLabel: string) => void;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): already in My
  // Trips, so the card renders "Saved ✓" on load.
  alreadySaved?: boolean;
  // A Duffel test fare (UX direction, Nov 19 2026 — P0-4): the
  // warning renders on the card itself, always — it never hides
  // behind a filter, unlike the small source tag.
  testFare?: boolean;
  // /checkout link for the offer ('' when the offer has no id or a
  // city has no IATA code — then no checkout link renders).
  checkoutHref?: string;
}) {
  const fee = serviceFee(offer.price);
  const [saved, setSaved] = useState(alreadySaved ?? false);
  return (
    <li className="flight-option-card">
      <TripPriceHeader total={offer.price} prefix="Trip total" />
      {sourceLabel && <p className="fare-card-source">{sourceLabel}</p>}
      {testFare && <p className="fare-test-warning">{DUFFEL_TEST_FARE_WARNING}</p>}
      <ul className="fare-list">
        <FareCard offer={offer} travelers={travelers} cabin={cabin} hidePrice />
      </ul>
      <FlightPriceBreakdown total={offer.price} travelers={travelers} fee={fee} />
      <div className="flight-option-actions">
        <button
          type="button"
          className="primary"
          disabled={saved}
          onClick={() => {
            onSaveFare(`${offer.airline} · $${offer.price.toLocaleString()}`);
            setSaved(true);
          }}
        >
          {saved ? 'Saved ✓' : 'Save this fare'}
        </button>
        {checkoutHref && (
          <a className="ghost" href={checkoutHref}>
            Continue to checkout
          </a>
        )}
      </div>
    </li>
  );
}

// "Everywhere" inspiration search (roadmap, Nov 21 2026 — F2,
// Skyscanner model): the results page for a destination-less flights
// search (To = "Everywhere"). No live fares are fetched — the list is
// the planner's cheapest trips from the origin, per traveler,
// cheapest first, and every price is the planner's planning estimate,
// labeled as such on the page and on every card. The planner's price
// does not depend on dates, so the list is the same whatever dates
// the traveler picked — the copy says so instead of pretending the
// dates matter. "View trip" opens the destination page; "Save" keeps
// the trip in My Trips with its structured detail.
function EverywhereResults({
  query,
  onSaveSearch,
  onSaveFare,
  savedKeys,
}: {
  query: SearchQuery;
  onSaveSearch: (label: string) => void;
  onSaveFare?: (label: string, detail: SavedDetail) => void;
  savedKeys?: Set<string>;
}) {
  const trips = cheapestDestinations(10);
  const origin = query.from || 'your origin';
  return (
    <div aria-label="Cheapest trips from your origin">
      <h3>Cheapest trips from {origin}</h3>
      <p className="plan-muted">
        No destination picked — these are the cheapest trips FujinTrip&rsquo;s planner can build from {origin}, cheapest first.
        Every price is a planning estimate from the planner, not a live fare: the planner&rsquo;s price does not change with your
        dates, and live fares will vary by date. Pick a destination to see live fares for it.
      </p>
      {trips.length === 0 ? (
        <p className="plan-muted">No priced trips yet — the planner has no prices for this origin.</p>
      ) : (
        <ul className="flight-card-grid">
          {trips.map((t, i) => {
            const saved = savedKeys?.has(tripSavedKey(t.destination, t.perTraveler)) ?? false;
            const save = () => {
              const detail: SavedDetail = {
                key: tripSavedKey(t.destination, t.perTraveler),
                kind: 'trip',
                destination: t.destination,
                source: 'FujinTrip planner',
                priceKind: 'estimate',
                total: t.total,
                perTraveler: t.perTraveler,
                travelers: 2,
                route: t.destination,
                checkedAt: new Date().toISOString(),
              };
              const label = `${t.destination} · from $${t.perTraveler.toLocaleString()} per traveler · Planning estimate`;
              if (onSaveFare) onSaveFare(label, detail);
              else onSaveSearch(label);
            };
            return (
              <li key={t.destination} className="flight-option-card">
                <p className="plan-muted">
                  #{i + 1} cheapest · {t.tag}
                </p>
                <h4>{t.destination}</h4>
                <TripPriceHeader total={t.total} prefix="Trip total from" />
                <FlightPriceBreakdown total={t.total} travelers={2} />
                <p className="plan-muted">Planning estimate · Best value · 2 travelers</p>
                <div className="flight-option-actions">
                  <a className="primary" href={`/destination/${encodeURIComponent(t.destination)}`}>View trip</a>
                  <button type="button" className="ghost" disabled={saved} onClick={save}>
                    {saved ? 'Saved ✓' : '♥ Save'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p>
        <button type="button" className="primary" onClick={() => onSaveSearch(searchRequestLabel(query))}>
          Save this search
        </button>
      </p>
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
  hideSourceTags,
  onLiveOptions,
  onSave,
  onSaveFare,
  savedKeys,
  onClearLiveFilters,
  onClearPrice,
  onClearSort,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  stopsFilter: number[];
  airlinesFilter: string[];
  // Departure-time buckets the traveler picked ('' when none) — the
  // filter system, Nov 15 2026: airline, stops, price and times all
  // narrow the live offers. The facet counts come from the full
  // unfiltered inventory (Nov 16, 2026 — see liveFilterOptions), so a
  // count is what the filter actually shows; only the "Showing X of
  // Y" line counts what is on screen.
  timesFilter: string[];
  // Whether any filter is active (Nov 16, 2026, user decision): the
  // per-fare source tags hide while a filter is on and come back
  // when every filter is cleared. Set by the parent from the same
  // flightFiltersActive state the filter bar's Clear button uses.
  hideSourceTags: boolean;
  onLiveOptions: (opts: LiveFilterOptions | null) => void;
  onSave: (label: string) => void;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): a fare saved
  // from a card carries its structured detail to My Trips. Absent,
  // the label-only save is kept (the old behavior).
  onSaveFare?: (label: string, detail: SavedDetail) => void;
  savedKeys?: Set<string>;
  onClearLiveFilters: () => void;
  onClearPrice: () => void;
  onClearSort: () => void;
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
  // LetsFG live fares — the second live comparison column (Nov 16,
  // 2026). Fetched in parallel with Duffel and Ignav, one request
  // per search; the column renders its honest empty state when the
  // key is missing or LetsFG has no fares. Multi-city never calls
  // LetsFG — it has no multi-city endpoint.
  const [letsfg, setLetsfg] = useState<{ status: 'idle' | 'loading' | 'done'; data: LetsfgFaresResponse | null }>({
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
    // Multi-city never calls LetsFG (no multi-city endpoint), so its
    // state stays idle instead of loading forever.
    setLetsfg(tripType === 'multicity' ? { status: 'idle', data: null } : { status: 'loading', data: null });
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
    // LetsFG fires in parallel with Duffel and Ignav — one request
    // per search, never per keystroke. The route starts an async
    // LetsFG search and polls server-side, so this one fetch waits
    // for the completed result; the column renders when it lands.
    // Multi-city is skipped: LetsFG has no multi-city endpoint.
    if (tripType !== 'multicity') {
      const letsfgBody =
        tripType === 'oneway'
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
      (async () => {
        try {
          const r = await fetch('/api/letsfg-fares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(letsfgBody),
          });
          const j = (await r.json()) as LetsfgFaresResponse;
          if (!cancelled) setLetsfg({ status: 'done', data: j });
        } catch {
          if (!cancelled) setLetsfg({ status: 'done', data: null });
        }
      })();
    }
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

  // Whether the Duffel options on screen are test fares (UX
  // direction, Nov 19 2026 — P0-4): test fares sort after every
  // live fare and carry the unmissable warning on every card. The
  // mode comes from the price-check response, never from the key
  // prefix on the client.
  const duffelTest = fares.data?.mode === 'test';

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
    // LetsFG, filtered + sorted the same way as Duffel's fares and
    // Ignav's trips: the itinerary lists are the whole-trip
    // itineraries (one-way, round-trip); multi-city never reaches
    // this list — LetsFG has no multi-city endpoint.
    const letsfgFiltered = letsfg.data
      ? sortLetsfgItineraries(
          letsfg.data.itineraries.filter(
            (it) => letsfgItineraryMatches(it, stopsFilter, airlinesFilter, timesFilter) && passesPrice(it.price)
          ),
          sort
        )
      : [];
    const letsfgItineraries = letsfgFiltered.slice(0, LETSFG_MAX_ITINERARIES);
    return { out, back, legLists, ignavFiltered, ignavItineraries, ignavLegLists, letsfgFiltered, letsfgItineraries };
  }, [fares.data, ignav.data, letsfg.data, stopsFilter, airlinesFilter, timesFilter, maxPrice, sort, query.travelers]);
  const { out, back, legLists, ignavFiltered, ignavItineraries, ignavLegLists, letsfgFiltered, letsfgItineraries } = visibleLive;

  // The merged card grid (Nov 16, 2026): one list, sources
  // interleaved by the active sort — Duffel pairs + Ignav trips +
  // LetsFG trips. Multi-city has no merged view; its legs stay
  // per-leg lists.
  const mergedOptions: FlightOption[] = useMemo(() => {
    if (tripType === 'multicity') return [];
    return mergeFlightOptions({
      tripType,
      out: visibleLive.out,
      back: visibleLive.back,
      ignavItineraries: visibleLive.ignavItineraries,
      letsfgItineraries: visibleLive.letsfgItineraries,
      sort,
      duffelTest,
    });
  }, [tripType, visibleLive, sort, duffelTest]);

  // The filter options + counts (Nov 16, 2026): the options and the
  // facet counts come from the full live result, while shownCount /
  // totalCount count what is actually on screen — see
  // liveFilterOptions. The JSON-key guard keeps the parent from
  // re-rendering on an identical value.
  const liveOptionsValue = useMemo(() => {
    const totalVisible =
      (fares.data?.out.length ?? 0) +
      (fares.data?.back.length ?? 0) +
      (fares.data?.legs ?? []).reduce((n, l) => n + l.out.length, 0) +
      Math.min(ignav.data?.itineraries.length ?? 0, IGNAV_MAX_ITINERARIES) +
      (ignav.data?.legs ?? []).reduce((n, l) => n + l.out.length, 0) +
      Math.min(letsfg.data?.itineraries.length ?? 0, LETSFG_MAX_ITINERARIES);
    const base = liveFilterOptions({
      shownOffers: [
        ...visibleLive.out,
        ...visibleLive.back,
        ...visibleLive.legLists.flatMap((l) => l.offers),
        ...visibleLive.ignavLegLists.flatMap((l) => l.offers),
      ],
      shownItineraries: [...visibleLive.ignavItineraries, ...visibleLive.letsfgItineraries],
      allOffers: [
        ...(fares.data?.out ?? []),
        ...(fares.data?.back ?? []),
        ...(fares.data?.legs ?? []).flatMap((l) => l.out),
        ...(ignav.data?.legs ?? []).flatMap((l) => l.out),
      ],
      allItineraries: [...(ignav.data?.itineraries ?? []), ...(letsfg.data?.itineraries ?? [])],
      totalVisible,
      travelers: query.travelers,
    });
    if (!base || tripType === 'multicity') return base;
    // The card counts for the merged grid (audit round, Nov 17,
    // 2026): the facet counts are counted from the FILTERED merge,
    // so they match the cards on screen — the old leg-based counts
    // read "Under $1,000 (23)" next to 6 cards. The same merge on
    // the unfiltered inventory (Ignav and LetsFG still capped, as
    // totalVisible is) is the total the grid holds. Multi-city
    // keeps the fare counts above: its per-leg lists ARE the list,
    // so leg counts are the honest ones there.
    const totalOptions = mergeFlightOptions({
      tripType,
      out: fares.data?.out ?? [],
      back: fares.data?.back ?? [],
      ignavItineraries: (ignav.data?.itineraries ?? []).slice(0, IGNAV_MAX_ITINERARIES),
      letsfgItineraries: (letsfg.data?.itineraries ?? []).slice(0, LETSFG_MAX_ITINERARIES),
      sort,
      duffelTest,
    }).length;
    return { ...base, counts: countFlightCards(mergedOptions, query.travelers), shownOptions: mergedOptions.length, totalOptions };
  }, [visibleLive, fares.data, ignav.data, letsfg.data, query.travelers, tripType, sort, mergedOptions]);
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
  // clears the panel filters AND the max price AND the sort, so the
  // full list comes back and the source tags return (a changed sort
  // is itself a filter state — see flightFiltersActive).
  const clearAllLiveFilters = () => {
    onClearLiveFilters();
    onClearPrice();
    onClearSort();
  };
  // The per-fare source tags (Nov 15, 2026): the big supplier column
  // headers are gone, so each fare carries its own discreet tag.
  // Nov 16, 2026 (user decision): the tags show ONLY while no
  // filter is active — as soon as any filter is on, every card hides
  // its source + freshness tag; clearing every filter brings them
  // back. A tag is passed as undefined when hidden: FareCard,
  // DuffelPairCard and IgnavItineraryGroup render the tag only when
  // sourceLabel is set.
  const duffelTag = fares.data?.mode === 'live' ? 'Duffel · live fare' : 'Duffel · test fare';
  const ignavTag = ignavSourceTag(ignav.data?.observedAt ?? null);
  const letsfgTag = letsfgSourceTag(letsfg.data?.observedAt ?? null);
  const duffelTagShown = hideSourceTags ? undefined : duffelTag;
  const ignavTagShown = hideSourceTags ? undefined : ignavTag;
  const letsfgTagShown = hideSourceTags ? undefined : letsfgTag;
  // "Save this fare" (Nov 17, 2026; structured detail, Nov 21 2026 —
  // F1): the chosen option is stored in My Trips with the search
  // label AND its structured detail — source, price kind, totals,
  // route, dates, when it was checked — so the saved fare in My Trips
  // says what it is. A Duffel test fare is saved as 'test', never as
  // a live fare. Without the detail handler the label-only save is
  // kept (the old behavior). The airline is part of the key: two
  // airlines can quote the same total on the same route.
  const fareKey = (source: string, total: number, airline: string, ret?: string) =>
    fareSavedKey({
      source,
      from: ctx.origin,
      to: destCity,
      depart: departIso,
      ret: ret ?? (tripType === 'oneway' ? '' : returnIso),
      travelers: query.travelers,
      total,
      airline,
    });
  const saveFare = (
    source: 'Duffel' | 'Ignav' | 'LetsFG',
    total: number,
    testFare: boolean,
    fareLabel: string,
    airline: string,
    opts?: { route?: string; dates?: string; ret?: string },
  ) => {
    const label = `${searchRequestLabel(query)} · ${fareLabel}`;
    if (!onSaveFare) {
      onSave(label);
      return;
    }
    const ret = opts?.ret ?? (tripType === 'oneway' ? '' : returnIso);
    const detail: SavedDetail = {
      key: fareKey(source, total, airline, ret),
      kind: 'fare',
      destination: destCity,
      source,
      priceKind: testFare ? 'test' : 'live',
      total,
      perTraveler: Math.round(total / query.travelers),
      travelers: query.travelers,
      route: opts?.route ?? `${ctx.origin} → ${destCity}`,
      dates: opts?.dates ?? (tripType === 'oneway' ? departIso : `${departIso} – ${returnIso}`),
      checkedAt: new Date().toISOString(),
    };
    onSaveFare(label, detail);
  };
  const isFareSaved = (source: string, total: number, airline: string, ret?: string) =>
    savedKeys?.has(fareKey(source, total, airline, ret)) ?? false;
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
      {/* One merged live-fares grid (Nov 16, 2026): the big supplier
          column headers ("Duffel", "Ignav — live") are gone — the
          traveler sees one card grid, Duffel pairs, Ignav trips and
          LetsFG trips interleaved by the active sort, each card a
          complete trip option with its own small source + freshness
          tag while no filter is active (the tags hide while any
          filter is on). The "Showing X of Y" line lives in the
          count row above the list, not here. Multi-city keeps its
          per-leg lists below. */}
      <div className="fare-live-list">
        {/* One loading state (UX direction, Nov 19 2026 — P0-8):
            the results bar above carries the single "Checking live
            fares…" line while the first live data is still on its
            way — the per-source lines (Duffel, Ignav, LetsFG) are
            gone, so the line never appears twice. */}
        {tripType !== 'multicity' && (fares.status === 'done' || ignav.status === 'done') && (
          <>
            {mergedOptions.length > 0 ? (
              <ul className="flight-card-grid">
                {mergedOptions.map((opt) => {
                  if (opt.kind === 'duffel-pair') {
                    return (
                      <DuffelPairCard
                        key={opt.key}
                        out={opt.out}
                        back={opt.back}
                        travelers={query.travelers}
                        cabin={query.cabin}
                        sourceLabel={duffelTagShown}
                        departDate={fares.data?.departDate ?? departIso}
                        returnDate={fares.data?.returnDate ?? returnIso}
                        onSaveFare={(label) =>
                          saveFare('Duffel', opt.out.price + opt.back.price, duffelTest, label, `${opt.out.airline} + ${opt.back.airline}`)
                        }
                        alreadySaved={isFareSaved('Duffel', opt.out.price + opt.back.price, `${opt.out.airline} + ${opt.back.airline}`)}
                        testFare={duffelTest}
                        checkoutHref={duffelCheckoutHref({
                          offerId: opt.out.offerId,
                          returnOfferId: opt.back.offerId,
                          originCity: ctx.origin,
                          destCity,
                          departDate: fares.data?.departDate ?? departIso,
                          returnDate: fares.data?.returnDate ?? returnIso,
                          travelers: query.travelers,
                          fare: opt.out.price + opt.back.price,
                          currency: opt.out.currency,
                          airline: opt.out.airline,
                        })}
                      />
                    );
                  }
                  if (opt.kind === 'duffel-oneway') {
                    return (
                      <DuffelOneWayCard
                        key={opt.key}
                        offer={opt.offer}
                        travelers={query.travelers}
                        cabin={query.cabin}
                        sourceLabel={duffelTagShown}
                        onSaveFare={(label) => saveFare('Duffel', opt.offer.price, duffelTest, label, opt.offer.airline)}
                        alreadySaved={isFareSaved('Duffel', opt.offer.price, opt.offer.airline)}
                        testFare={duffelTest}
                        checkoutHref={duffelCheckoutHref({
                          offerId: opt.offer.offerId,
                          originCity: ctx.origin,
                          destCity,
                          departDate: fares.data?.departDate ?? departIso,
                          returnDate: '',
                          travelers: query.travelers,
                          fare: opt.offer.price,
                          currency: opt.offer.currency,
                          airline: opt.offer.airline,
                        })}
                      />
                    );
                  }
                  if (opt.kind === 'letsfg') {
                    return (
                      <li key={opt.key} className="flight-option-card">
                        <LetsfgItineraryGroup
                          itinerary={opt.itinerary}
                          travelers={query.travelers}
                          cabin={query.cabin}
                          labels={tripType === 'oneway' ? ['One-way'] : ['Outbound', 'Return']}
                          sourceLabel={letsfgTagShown}
                          onSaveFare={(label) =>
                            saveFare('LetsFG', opt.itinerary.price, false, label, opt.itinerary.legs[0]?.airline ?? 'LetsFG')
                          }
                          alreadySaved={isFareSaved('LetsFG', opt.itinerary.price, opt.itinerary.legs[0]?.airline ?? 'LetsFG')}
                        />
                      </li>
                    );
                  }
                  return (
                    <li key={opt.key} className="flight-option-card">
                      <IgnavItineraryGroup
                        itinerary={opt.itinerary}
                        travelers={query.travelers}
                        cabin={query.cabin}
                        labels={tripType === 'oneway' ? ['One-way'] : ['Outbound', 'Return']}
                        sourceLabel={ignavTagShown}
                        onSaveFare={(label) =>
                          saveFare('Ignav', opt.itinerary.price, false, label, opt.itinerary.legs[0]?.airline ?? 'Ignav')
                        }
                        alreadySaved={isFareSaved('Ignav', opt.itinerary.price, opt.itinerary.legs[0]?.airline ?? 'Ignav')}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              (fares.data?.live || ignav.data?.live) && (
                <p className="plan-muted">
                  {liveFiltersActive ? 'No fares match the filters.' : 'No live fares for this search right now.'}{' '}
                  {liveFiltersActive && (
                    <button type="button" className="linklike" onClick={clearAllLiveFilters}>
                      Clear filters
                    </button>
                  )}
                </p>
              )
            )}
            {ignavFiltered.length > IGNAV_MAX_ITINERARIES && (
              <p className="plan-muted">Showing the {IGNAV_MAX_ITINERARIES} cheapest live trips from Ignav.</p>
            )}
            {letsfgFiltered.length > LETSFG_MAX_ITINERARIES && (
              <p className="plan-muted">Showing the {LETSFG_MAX_ITINERARIES} cheapest live trips from LetsFG.</p>
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
                        sourceLabel={duffelTagShown}
                        testFare={duffelTest}
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
                <p className="plan-muted">
                  Cheapest all legs: <strong>${cheapestMultiCityTotal(legLists).toLocaleString()}</strong> for {query.travelers} traveler
                  {query.travelers > 1 ? 's' : ''} · cheapest fare of each leg, summed · + ${serviceFee(cheapestMultiCityTotal(legLists)).toLocaleString()} service fee per flight order.
                  {duffelTest ? ` ${DUFFEL_TEST_FARE_WARNING}.` : ''}
                </p>
              )}
              <p>
                <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query))}>
                  Save this search
                </button>
              </p>
            </>
          )}
          {/* The "Book-now read" line is NOT rendered here (defect,
              Nov 14 2026: it read as a stray paragraph on the results
              page). The API still returns it — the chat's trip card
              uses it where it belongs. */}
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
          {ignav.status === 'done' && ignav.data && !ignav.data.live && (
            <p>{ignavEmptyMessage(ignav.data.reason)}</p>
          )}
          {ignav.status === 'done' && !ignav.data && <p>Could not check live fares from Ignav right now.</p>}
          {letsfg.status === 'done' && letsfg.data && !letsfg.data.live && (
            <p>{letsfgEmptyMessage(letsfg.data.reason)}</p>
          )}
          {letsfg.status === 'done' && !letsfg.data && <p>Could not check live fares from LetsFG right now.</p>}
          {letsfg.status === 'done' && letsfg.data?.live && (
            <p className="plan-muted">
              Live fares from LetsFG — prices are live and can change; booking opens on letsfg.co.
            </p>
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
                    sourceLabel={ignavTagShown}
                    onSaveFare={(label) =>
                      saveFare('Ignav', it.price, false, label, it.legs.map((l) => l.airline).join(' + '), {
                        route: queryLegs.map((l) => `${l.from} → ${l.to}`).join(' · '),
                        dates: queryLegs.length > 1 ? `${queryLegs[0].depart} – ${queryLegs[queryLegs.length - 1].depart}` : queryLegs[0].depart,
                        ret: queryLegs[queryLegs.length - 1].depart,
                      })
                    }
                    alreadySaved={isFareSaved('Ignav', it.price, it.legs.map((l) => l.airline).join(' + '), queryLegs[queryLegs.length - 1].depart)}
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
                  <p className="plan-muted">
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
                          sourceLabel={ignavTagShown}
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
                  <p className="plan-muted">
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
      {/* The planner budget (P0-5): the qualifier names it as a
          typical-prices estimate, unrelated to today's live fares —
          one coherent price story per results page. */}
      {known && tripType === 'roundtrip' && (
        <p>
          {budget.label}: <strong>${plannerFlight.toLocaleString()}</strong> · {query.travelers} traveler
          {query.travelers > 1 ? 's' : ''} · {budget.qualifier}
        </p>
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

// One Hotelbeds sandbox hotel as a card: the hotel name, its
// ContentAPI photo, the zone, and the cheapest test price for the
// whole stay (per night + per traveler). The sandbox tag is on
// EVERY card and never hides behind a filter — it is the honesty
// label (test data, not a bookable room), not a source tag. No
// "Book now": sandbox rooms cannot be booked, so the primary
// action is "Save this search" like every other card.
// One Hotelbeds sandbox hotel as a card: the gallery (ContentAPI,
// up to 6 photos — the card is no longer one photo), the name
// linked to its detail page, the star class, zone, room + board,
// and the total test price for the whole stay (per night + per
// traveler beside it). The sandbox tag is on EVERY card and never
// hides behind a filter — it is the honesty label (test data, not a
// bookable room), not a source tag. No "Book now": sandbox hotels
// cannot be booked, so the primary action is "Save this search"
// like every other card.
function HotelbedsHotelCard({
  hotel,
  query,
  checkedAt,
  onSave,
}: {
  hotel: HotelbedsHotel;
  query: SearchQuery;
  checkedAt: string | null;
  onSave: (label: string) => void;
}) {
  const money = (n: number) =>
    hotel.currency === 'USD' ? `$${n.toLocaleString()}` : `${n.toLocaleString()} ${hotel.currency}`;
  const place = [hotel.zoneName, hotel.destinationName].filter(Boolean).join(' · ');
  const stars = hotelbedsStars(hotel);
  const gallery = hotel.images && hotel.images.length > 0 ? hotel.images : hotel.imageUrl ? [hotel.imageUrl] : [];
  const detailHref = `/hotels/${hotel.code}?dest=${encodeURIComponent(query.dest)}&checkIn=${query.depart}&checkOut=${query.ret}&guests=${query.guests}&rooms=${query.rooms}`;
  return (
    <article className="result-card result-card--wide">
      <HotelGallery images={gallery} name={hotel.name} />
      <div className="result-body">
        <h3>
          <a href={detailHref}>{hotel.name}</a>
          {stars !== null ? ` · ${'★'.repeat(stars)}` : ''}
        </h3>
        {(hotel.categoryName || place) && (
          <p className="plan-muted">
            {[hotel.categoryName, place].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="plan-muted">
          {hotel.nights} night{hotel.nights > 1 ? 's' : ''} · {query.guests} guest{query.guests > 1 ? 's' : ''} ·{' '}
          {query.rooms} room{query.rooms > 1 ? 's' : ''}
          {hotel.roomName ? ` · ${hotel.roomName}` : ''}
          {hotel.boardName ? ` · ${hotel.boardName}` : ''}
        </p>
        <p className="fare-card-source">{hotelbedsSandboxTag(checkedAt)}</p>
      </div>
      <div className="result-wide-side">
        <p className="result-price">from {money(hotel.price)} total</p>
        <p className="plan-muted">
          {money(hotel.perNight)}/night · {money(hotel.perTraveler)} per traveler
        </p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dest))}>
          Save this search
        </button>
      </div>
    </article>
  );
}
// Hotelbeds sandbox hotels (Nov 16, 2026): the Stays tab's first
// live hotel source — TEST data from the Hotelbeds evaluation
// account, fetched once per search (the server caches 6h; the
// evaluation key allows 50 requests/day). The section renders its
// honest empty state when the key is missing, the destination has
// no location, dates are missing, or Hotelbeds has no test hotels
// — never an invented hotel. The max-price filter narrows these
// cards by per-traveler price, the same unit the sidebar quotes.
function HotelbedsStays({
  query,
  sort,
  maxPrice,
  starFilter,
  zoneFilter,
  boardFilter,
  onSave,
  onHotels,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  starFilter: number | null;
  zoneFilter: string | null;
  boardFilter: string | null;
  onSave: (label: string) => void;
  onHotels: (hotels: HotelbedsHotel[]) => void;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done'; data: HotelbedsSearchResult | null }>({
    status: 'idle',
    data: null,
  });
  const key = `${query.dest}|${query.depart}|${query.ret}|${query.guests}|${query.rooms}`;
  const fetchedKeyRef = useRef('');
  useEffect(() => {
    if (fetchedKeyRef.current === key) return;
    fetchedKeyRef.current = key;
    setState({ status: 'loading', data: null });
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/hotelbeds-stays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: query.dest,
            checkIn: query.depart,
            checkOut: query.ret,
            guests: query.guests,
            rooms: query.rooms,
          }),
        });
        const j = (await r.json()) as HotelbedsSearchResult;
        if (!cancelled) setState({ status: 'done', data: j });
      } catch {
        if (!cancelled) setState({ status: 'done', data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The hotels lift up to the results shell: the sidebar facets
  // (star, zone, board) and the map price pins both read the full
  // list, while this section only renders the filtered view.
  const hotels = state.data?.hotels ?? [];
  useEffect(() => {
    onHotels(state.data?.live ? hotels : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);
  const visible = useMemo(() => {
    const filtered = filterHotelbedsHotels(hotels, { star: starFilter, zone: zoneFilter, board: boardFilter, maxPrice });
    if (sort === 'cheapest' || sort === 'best') return [...filtered].sort((a, b) => a.price - b.price);
    return filtered;
  }, [hotels, maxPrice, sort, starFilter, zoneFilter, boardFilter]);
  const nights = state.data?.nights ?? null;
  const anyFilter = maxPrice !== null || starFilter !== null || zoneFilter !== null || boardFilter !== null;
  return (
    // Sample stays (UX direction, Nov 19 2026 — P1-2): the sandbox
    // hotels sit behind a clearly labelled disclosure, closed by
    // default — the planning-estimate tiers lead the stays results,
    // so 1–3-star Room Only test hotels in Ilford/Heathrow are never
    // the only named hotels a search returns. The sandbox label stays
    // on every card inside, and never hides behind a filter (that
    // exemption stands).
    <details className="sample-stays">
      <summary>
        <span className="details-heading">Sample stays (test data)</span>
        <span className="plan-muted">
          {' '}
          — test hotels from the Hotelbeds evaluation account, not live quotes, and the rooms cannot be booked.
        </span>
      </summary>
      <div aria-label="Hotelbeds sandbox hotels">
      <h4>Hotels in {query.dest || 'your destination'} — Hotelbeds sandbox</h4>
      {state.status === 'loading' && <p className="plan-muted">Checking Hotelbeds sandbox hotels…</p>}
      {state.status === 'done' && !state.data && (
        <p className="plan-muted">Hotelbeds could not be reached right now.</p>
      )}
      {state.status === 'done' && state.data && !state.data.live && (
        <p className="plan-muted">{hotelbedsEmptyMessage(state.data.reason)}</p>
      )}
      {state.status === 'done' && state.data && state.data.live && (
        <>
          {anyFilter && (
            <p className="fare-count">
              Showing {visible.length} of {state.data.hotels.length} sandbox hotels.
            </p>
          )}
          {visible.length === 0 ? (
            <p className="plan-muted">No sandbox hotels match those filters — clear them or raise the max price.</p>
          ) : (
            <div className="result-cards result-cards--wide">
              {visible.map((h) => (
                <HotelbedsHotelCard
                  key={h.code}
                  hotel={h}
                  query={query}
                  checkedAt={state.data?.checkedAt ?? null}
                  onSave={onSave}
                />
              ))}
            </div>
          )}
          <p className="plan-muted">
            {hotelbedsSandboxTag(state.data.checkedAt)}
            {nights !== null ? ` · ${nights} night${nights > 1 ? 's' : ''} · ` : ' · '}
            {state.data.guests} guest{state.data.guests > 1 ? 's' : ''} · {state.data.rooms} room
            {state.data.rooms > 1 ? 's' : ''}. Live bookable stays arrive when Expedia Rapid / Duffel Stays connect.
          </p>
        </>
      )}
      </div>
    </details>
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
  starFilter,
  zoneFilter,
  boardFilter,
  onSave,
  onHotels,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  stayTier: StayTier;
  starFilter: number | null;
  zoneFilter: string | null;
  boardFilter: string | null;
  onSave: (label: string) => void;
  onHotels: (hotels: HotelbedsHotel[]) => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? stayTierOptions(query.dest, query.guests) : null;
  const nights = stayNightsFor(query, query.dest || undefined);
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const guests = `${query.guests} guest${query.guests > 1 ? 's' : ''}`;
  const rooms = `${query.rooms} room${query.rooms > 1 ? 's' : ''}`;
  return (
    <div aria-label="Stay results">
      <h3>
        Stays · {query.dest || 'Anywhere'} · {dates}
        {nights !== null ? ` · ${nights} night${nights > 1 ? 's' : ''}` : ''} · {guests} · {rooms}
      </h3>
      <p className="plan-muted">
        Hotelbeds sandbox is connected — sample test hotels are behind the &ldquo;Sample stays (test data)&rdquo;
        disclosure below. Live hotel prices arrive when Expedia Rapid / Duffel Stays connect.
      </p>
      <p className="plan-muted">
        No named property is attached to these prices. Live bookable stays open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Stays in {query.dest}</h4>
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
      {hotelbedsProductEnabled('hotel') && (
        <HotelbedsStays
          query={query}
          sort={sort}
          maxPrice={maxPrice}
          starFilter={starFilter}
          zoneFilter={zoneFilter}
          boardFilter={boardFilter}
          onSave={onSave}
          onHotels={onHotels}
        />
      )}
    </div>
  );
}

// Car rental results (Nov 15, 2026 — the Car rental section, same
// standard as the Stays section): the searched destination's three
// planner tiers as car cards — the whole page, nothing else (UX
// direction, Nov 19 2026 — P0-2). Every figure is the planner's
// own car leg for the party — a planning estimate, never a live
// quote, never a named company or model. No "Book now": no live
// supplier exists yet.
function CarResults({
  query,
  carTier,
  onSave,
}: {
  query: SearchQuery;
  carTier: CarTier;
  onSave: (label: string) => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? carTierOptions(query.dest, query.travelers) : null;
  const days = carDaysFor(query, query.dest || undefined);
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  return (
    <div aria-label="Car rental results">
      <h3>
        Car rental · {query.dest || 'Anywhere'} · {dates}
        {days !== null ? ` · ${days} day${days > 1 ? 's' : ''}` : ''} · {travelers}
      </h3>
      <p className="plan-muted">Live car prices arrive when Rentalcars / CarTrawler connect.</p>
      <p className="plan-muted">
        No company or model is attached to these prices. Live bookable cars open as suppliers connect.
      </p>
      {query.pickupTime && <p className="plan-muted">Pick-up {query.pickupTime}.</p>}
      {!query.sameLocation && query.dropoff && <p className="plan-muted">Drop-off in {query.dropoff}.</p>}
      {tiers && (
        <>
          <h4>Car rental in {query.dest}</h4>
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
    </div>
  );
}

// Attractions results (Nov 15, 2026 — the Attractions section,
// same standard as the Stays and Car rental sections): the searched
// destination's three planner tiers as attraction cards — the whole
// page, nothing else (UX direction, Nov 19 2026 — P0-2). Every
// figure is the planner's own activities leg for the party — a
// planning estimate, never a live quote, never a named attraction,
// tour, or operator. No "Book now": no live supplier exists yet.
// One Hotelbeds sandbox activity as a card: the activity name,
// its photo, the modality and destination, and the cheapest test
// price per person (party total beside it). The sandbox tag is on
// EVERY card and never hides behind a filter — it is the honesty
// label (test data, not a bookable activity), not a source tag. No
// "Book now": sandbox activities cannot be booked, so the primary
// action is "Save this search" like every other card.
function HotelbedsActivityCard({
  activity,
  query,
  checkedAt,
  onSave,
}: {
  activity: HotelbedsActivity;
  query: SearchQuery;
  checkedAt: string | null;
  onSave: (label: string) => void;
}) {
  const money = (n: number) =>
    activity.currency === 'USD' ? `$${n.toLocaleString()}` : `${n.toLocaleString()} ${activity.currency}`;
  const place = [activity.destinationName, activity.countryName].filter(Boolean).join(' · ');
  const detailHref = `/activities/${encodeURIComponent(activity.code)}?dest=${encodeURIComponent(query.dest)}&from=${query.depart}&to=${query.ret}&travelers=${query.travelers}`;
  return (
    <article className="result-card">
      {activity.imageUrl && <SafeImg src={activity.imageUrl} alt={activity.name} label={activity.name} className="result-photo" />}
      <div className="result-body">
        <h3>
          <a href={detailHref}>{activity.name}</a>
        </h3>
        {place && <p className="plan-muted">{place}</p>}
        {(activity.modalityName || activity.durationDays !== undefined) && (
          <p className="plan-muted">
            {activity.modalityName ?? ''}
            {activity.modalityName && activity.durationDays !== undefined ? ' · ' : ''}
            {activity.durationDays !== undefined ? `${activity.durationDays} day${activity.durationDays === 1 ? '' : 's'}` : ''}
          </p>
        )}
        {activity.summary && <p className="plan-muted">{activity.summary}</p>}
        <p className="result-price">
          from {money(activity.price)} per person{' '}
          <span className="plan-muted">
            · {money(activity.total)} total for {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
          </span>
        </p>
        <p className="fare-card-source">{hotelbedsActivitiesSandboxTag(checkedAt)}</p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dest))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Hotelbeds sandbox activities (Nov 16, 2026): the Attractions
// tab's live activity source — TEST data from the Hotelbeds
// evaluation account, fetched once per search (the server caches
// 6h; the evaluation key allows 50 requests/day). The parent
// renders this only while the activities toggle is on in
// lib/hotelbeds.ts — when it is off, nothing here mounts, nothing
// is fetched, and the tab is exactly its planning-estimate view.
// The section renders its honest empty state when the key is
// missing, the destination has no location, dates are missing, or
// Hotelbeds has no test activities — never an invented tour.
function HotelbedsActivities({
  query,
  sort,
  maxPrice,
  onSave,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  onSave: (label: string) => void;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done'; data: HotelbedsActivitiesResult | null }>({
    status: 'idle',
    data: null,
  });
  // Modality chips + duration filter (interface round, Nov 16 2026):
  // local filter state — the planner attraction list has no modality
  // or duration data, so the chips narrow the sandbox activities
  // only. Counts come from the full result set.
  const [modality, setModality] = useState<string | null>(null);
  const [duration, setDuration] = useState<HotelbedsActivityDuration>('any');
  const key = `${query.dest}|${query.depart}|${query.ret}|${query.travelers}`;
  const fetchedKeyRef = useRef('');
  useEffect(() => {
    if (fetchedKeyRef.current === key) return;
    fetchedKeyRef.current = key;
    setState({ status: 'loading', data: null });
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/hotelbeds-activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: query.dest,
            from: query.depart,
            to: query.ret,
            travelers: query.travelers,
          }),
        });
        const j = (await r.json()) as HotelbedsActivitiesResult;
        if (!cancelled) setState({ status: 'done', data: j });
      } catch {
        if (!cancelled) setState({ status: 'done', data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const activities = state.data?.activities ?? [];
  const modalityOptions = useMemo(() => activityModalityOptions(activities), [activities]);
  const visible = useMemo(() => {
    const filtered = filterHotelbedsActivities(activities, { modality, duration, maxPrice });
    if (sort === 'cheapest' || sort === 'best') return [...filtered].sort((a, b) => a.price - b.price);
    return filtered;
  }, [activities, maxPrice, sort, modality, duration]);
  const anyFilter = maxPrice !== null || modality !== null || duration !== 'any';
  return (
    <div aria-label="Hotelbeds sandbox activities">
      <h4>Activities in {query.dest || 'your destination'} — Hotelbeds sandbox</h4>
      <p className="plan-muted">
        Test activities from the Hotelbeds evaluation account — the prices below are sandbox test data, not live quotes,
        and the activities cannot be booked.
      </p>
      {state.status === 'loading' && <p className="plan-muted">Checking Hotelbeds sandbox activities…</p>}
      {state.status === 'done' && !state.data && (
        <p className="plan-muted">Hotelbeds could not be reached right now.</p>
      )}
      {state.status === 'done' && state.data && !state.data.live && (
        <p className="plan-muted">{hotelbedsActivitiesEmptyMessage(state.data.reason)}</p>
      )}
      {state.status === 'done' && state.data && state.data.live && (
        <>
          <div className="filter-chips" role="group" aria-label="Filter sandbox activities by type">
            <button
              type="button"
              className={`chip${modality === null ? ' selected' : ''}`}
              onClick={() => setModality(null)}
              aria-pressed={modality === null}
            >
              All types ({activities.length})
            </button>
            {modalityOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`chip${modality === o.value ? ' selected' : ''}`}
                onClick={() => setModality(modality === o.value ? null : o.value)}
                aria-pressed={modality === o.value}
              >
                {o.label} ({o.count})
              </button>
            ))}
            <label className="filter-chip-select">
              <span>Duration</span>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value as HotelbedsActivityDuration)}
                aria-label="Filter sandbox activities by duration"
              >
                <option value="any">Any duration</option>
                <option value="1">1 day or less</option>
                <option value="2">2 days</option>
                <option value="3plus">3 days or more</option>
              </select>
            </label>
          </div>
          {anyFilter && (
            <p className="fare-count">
              Showing {visible.length} of {state.data.activities.length} sandbox activities.
            </p>
          )}
          {visible.length === 0 ? (
            <p className="plan-muted">No sandbox activities match those filters — clear them or raise the max price.</p>
          ) : (
            <div className="result-cards">
              {visible.map((a) => (
                <HotelbedsActivityCard
                  key={a.code}
                  activity={a}
                  query={query}
                  checkedAt={state.data?.checkedAt ?? null}
                  onSave={onSave}
                />
              ))}
            </div>
          )}
          <p className="plan-muted">
            {hotelbedsActivitiesSandboxTag(state.data.checkedAt)} · {state.data.travelers} traveler
            {state.data.travelers > 1 ? 's' : ''}. Live bookable attractions arrive when Viator / GetYourGuide / Klook
            connect.
          </p>
        </>
      )}
    </div>
  );
}

function TourResults({
  query,
  sort,
  maxPrice,
  tourTier,
  onSave,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  tourTier: TourTier;
  onSave: (label: string) => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? tourTierOptions(query.dest, query.travelers) : null;
  const days = tourDaysFor(query, query.dest || undefined);
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  return (
    <div aria-label="Attractions results">
      <h3>
        Attractions · {query.dest || 'Anywhere'} · {dates}
        {days !== null ? ` · ${days} day${days > 1 ? 's' : ''}` : ''} · {travelers}
      </h3>
      <p className="plan-muted">Live tours arrive when Viator / GetYourGuide / Klook connect.</p>
      <p className="plan-muted">
        No attraction, tour, or operator is attached to these prices. Live bookable attractions open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Attractions in {query.dest}</h4>
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
      {hotelbedsProductEnabled('activities') && (
        <HotelbedsActivities query={query} sort={sort} maxPrice={maxPrice} onSave={onSave} />
      )}
    </div>
  );
}

// Cruises results (Nov 15, 2026 — the Cruises section, same
// standard as the Stays, Car rental and Attractions sections): the
// searched destination's three planner tiers as cruise cards — the
// whole page, nothing else (UX direction, Nov 19 2026 — P0-2).
// Every figure is the planner's own per-tier FULL-TRIP total — the
// planner breaks out no cruise leg, so these are full-trip planning
// estimates, never cruise prices, never a named line, ship, or
// sailing. No "Book now": no live supplier exists yet.
function CruiseResults({
  query,
  cruiseTier,
  onSave,
}: {
  query: SearchQuery;
  cruiseTier: CruiseTier;
  onSave: (label: string) => void;
}) {
  const known = isKnownPlace(query.dest);
  const tiers = known ? cruiseTierOptions(query.dest, query.travelers) : null;
  const monthLabel = query.month ? MONTH_NAMES[Number(query.month) - 1] : 'Flexible month';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const note = noLegNote('cruises');
  return (
    <div aria-label="Cruises results">
      <h3>
        Cruises · {query.dest || 'Anywhere'} · {monthLabel} · {travelers}
      </h3>
      <p className="plan-muted">Live cruise prices arrive when Traveltek connects.</p>
      {note && <p className="results-note">{note}</p>}
      <p className="plan-muted">
        These are full-trip totals, not cruise prices, and no cruise line, ship, or sailing is attached to them. Live
        bookable cruises open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Cruises in {query.dest}</h4>
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
                  <p className="card-note">Full-trip total — not a cruise price.</p>
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
    </div>
  );
}

// Buses results (Nov 15, 2026 — the Buses section, same standard
// as the Cruises section): the searched route's three planner
// tiers as bus cards — the whole page, nothing else (UX direction,
// Nov 19 2026 — P0-2). Every figure is the planner's own per-tier
// FULL-TRIP total — the planner breaks out no bus leg, so these
// are full-trip planning estimates, never bus prices, never a named
// operator, route, or timetable. No "Book now": no live supplier
// exists yet.
function BusResults({
  query,
  busTier,
  onSave,
}: {
  query: SearchQuery;
  busTier: BusTier;
  onSave: (label: string) => void;
}) {
  const known = isKnownPlace(query.to);
  const tiers = known ? busTierOptions(query.to, query.travelers) : null;
  const dates = query.depart ? `${query.depart}${query.ret ? ` – ${query.ret}` : ''}` : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const note = noLegNote('buses');
  return (
    <div aria-label="Buses results">
      <h3>
        Buses · {query.from || 'Anywhere'} → {query.to || 'Anywhere'} · {dates} · {travelers}
      </h3>
      <p className="plan-muted">Live bus prices arrive when Distribusion / Busbud / FlixBus connect.</p>
      {note && <p className="results-note">{note}</p>}
      <p className="plan-muted">
        These are full-trip totals, not bus prices, and no bus operator, route, or timetable is attached to them. Live
        bookable buses open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Buses to {query.to}</h4>
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
                  <p className="card-note">Full-trip total — not a bus price.</p>
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
    </div>
  );
}

// Taxis results (Nov 15, 2026 — the Taxis section, same standard
// as the Stays, Car rental, Attractions, Cruises and Buses
// sections): the searched ride's three planner tiers as taxi cards
// — the whole page, nothing else (UX direction, Nov 19 2026 —
// P0-2). Every figure is the planner's own per-tier FULL-TRIP
// total — the planner breaks out no taxi leg, so these are
// full-trip planning estimates, never taxi prices, never a named
// company, route, or timetable. No "Book now": no live supplier
// exists yet.
// One Hotelbeds sandbox transfer as a card: the vehicle and
// category, the transfer type, the pickup date and time, and the
// total test price for the whole party (per traveler beside it).
// The sandbox tag is on EVERY card and never hides behind a filter
// — it is the honesty label (test data, not a bookable transfer),
// not a source tag. No "Book now": sandbox transfers cannot be
// booked, so the primary action is "Save this search" like every
// other card.
function HotelbedsTransferCard({
  transfer,
  query,
  checkedAt,
  onSave,
}: {
  transfer: HotelbedsTransfer;
  query: SearchQuery;
  checkedAt: string | null;
  onSave: (label: string) => void;
}) {
  const money = (n: number) =>
    transfer.currency === 'USD' ? `$${n.toLocaleString()}` : `${n.toLocaleString()} ${transfer.currency}`;
  const typeLabel = transfer.transferType === 'PRIVATE' ? 'Private transfer' : 'Shared shuttle';
  const route = [transfer.fromDescription, transfer.toDescription].filter(Boolean).join(' → ');
  return (
    <article className="result-card">
      {transfer.imageUrl && <SafeImg src={transfer.imageUrl} alt={transfer.vehicleName ?? 'Transfer'} label={transfer.vehicleName ?? 'Transfer'} className="result-photo" />}
      <div className="result-body">
        <h3>
          {transfer.vehicleName ?? typeLabel}
          {transfer.categoryName ? ` · ${transfer.categoryName}` : ''}
        </h3>
        <p className="plan-muted">{typeLabel}</p>
        {route && <p className="plan-muted">{route}</p>}
        <p className="plan-muted">
          {transfer.pickupDate ? `${transfer.pickupDate}` : ''}
          {transfer.pickupDate && transfer.pickupTime ? ` · ${transfer.pickupTime}` : transfer.pickupTime ?? ''}
          {transfer.maxPaxCapacity !== undefined ? ` · up to ${transfer.maxPaxCapacity} passengers` : ''}
        </p>
        {transfer.remarks && <p className="plan-muted">{transfer.remarks}</p>}
        <p className="result-price">
          from {money(transfer.price)} total{' '}
          <span className="plan-muted">
            · {money(transfer.perTraveler)} per traveler · {query.travelers} traveler{query.travelers > 1 ? 's' : ''}
          </span>
        </p>
        <p className="fare-card-source">{hotelbedsTransfersSandboxTag(checkedAt)}</p>
        <button type="button" className="primary" onClick={() => onSave(searchRequestLabel(query, query.dropoff || query.from))}>
          Save this search
        </button>
      </div>
    </article>
  );
}

// Hotelbeds sandbox transfers (Nov 16, 2026): the Taxis tab's
// airport-transfer source — TEST data from the Hotelbeds
// evaluation account, fetched once per search (the server caches
// 6h; the evaluation key allows 50 requests/day). The parent
// renders this only while the transfers toggle is on in
// lib/hotelbeds.ts — when it is off, nothing here mounts, nothing
// is fetched, and the tab is exactly its planning-estimate view.
// The section renders its honest empty state when the key is
// missing, a side has no airport or location, the date is missing,
// or Hotelbeds has no test transfers — never an invented transfer.
function HotelbedsTransfers({
  query,
  sort,
  maxPrice,
  onSave,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  onSave: (label: string) => void;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done'; data: HotelbedsTransfersResult | null }>({
    status: 'idle',
    data: null,
  });
  // Private/shared + capacity filters (interface round, Nov 16
  // 2026): local filter state — the planner taxi list has no
  // transfer type or capacity data, so the filters narrow the
  // sandbox transfers only. Counts come from the full result set.
  const [transferType, setTransferType] = useState<'ALL' | 'PRIVATE' | 'SHARED'>('ALL');
  const [minCapacity, setMinCapacity] = useState<number | null>(null);
  const key = `${query.from}|${query.dropoff}|${query.depart}|${query.pickupTime}|${query.travelers}`;
  const fetchedKeyRef = useRef('');
  useEffect(() => {
    if (fetchedKeyRef.current === key) return;
    fetchedKeyRef.current = key;
    setState({ status: 'loading', data: null });
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/hotelbeds-transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: query.from,
            to: query.dropoff || query.from,
            depart: query.depart,
            pickupTime: query.pickupTime,
            travelers: query.travelers,
          }),
        });
        const j = (await r.json()) as HotelbedsTransfersResult;
        if (!cancelled) setState({ status: 'done', data: j });
      } catch {
        if (!cancelled) setState({ status: 'done', data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const transfers = state.data?.transfers ?? [];
  const typeOptions = useMemo(() => transferTypeOptions(transfers), [transfers]);
  const visible = useMemo(() => {
    const filtered = filterHotelbedsTransfers(transfers, { type: transferType, minCapacity, maxPrice });
    if (sort === 'cheapest' || sort === 'best') return [...filtered].sort((a, b) => a.price - b.price);
    return filtered;
  }, [transfers, maxPrice, sort, transferType, minCapacity]);
  const anyFilter = maxPrice !== null || transferType !== 'ALL' || minCapacity !== null;
  return (
    <div aria-label="Hotelbeds sandbox transfers">
      <h4>
        Airport transfers · {query.from || 'Anywhere'} → {query.dropoff || query.from || 'Anywhere'} — Hotelbeds sandbox
      </h4>
      <p className="plan-muted">
        Test transfers from the Hotelbeds evaluation account — the prices below are sandbox test data, not live quotes,
        and the transfers cannot be booked.
      </p>
      {state.status === 'loading' && <p className="plan-muted">Checking Hotelbeds sandbox transfers…</p>}
      {state.status === 'done' && !state.data && (
        <p className="plan-muted">Hotelbeds could not be reached right now.</p>
      )}
      {state.status === 'done' && state.data && !state.data.live && (
        <p className="plan-muted">{hotelbedsTransfersEmptyMessage(state.data.reason)}</p>
      )}
      {state.status === 'done' && state.data && state.data.live && (
        <>
          <div className="filter-chips" role="group" aria-label="Filter sandbox transfers by type">
            <button
              type="button"
              className={`chip${transferType === 'ALL' ? ' selected' : ''}`}
              onClick={() => setTransferType('ALL')}
              aria-pressed={transferType === 'ALL'}
            >
              All transfers ({transfers.length})
            </button>
            {typeOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`chip${transferType === o.value ? ' selected' : ''}`}
                onClick={() => setTransferType(transferType === o.value ? 'ALL' : o.value)}
                aria-pressed={transferType === o.value}
              >
                {o.label} ({o.count})
              </button>
            ))}
            <label className="filter-chip-select">
              <span>Fits at least</span>
              <select
                value={minCapacity === null ? '' : String(minCapacity)}
                onChange={(e) => setMinCapacity(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="Filter sandbox transfers by passenger capacity"
              >
                <option value="">Any capacity</option>
                <option value="2">2 passengers</option>
                <option value="4">4 passengers</option>
                <option value="6">6 passengers</option>
                <option value="8">8 passengers</option>
              </select>
            </label>
          </div>
          {anyFilter && (
            <p className="fare-count">
              Showing {visible.length} of {state.data.transfers.length} sandbox transfers.
            </p>
          )}
          {visible.length === 0 ? (
            <p className="plan-muted">No sandbox transfers match those filters — clear them or raise the max price.</p>
          ) : (
            <div className="result-cards">
              {visible.map((t) => (
                <HotelbedsTransferCard
                  key={`${t.id}-${t.direction}`}
                  transfer={t}
                  query={query}
                  checkedAt={state.data?.checkedAt ?? null}
                  onSave={onSave}
                />
              ))}
            </div>
          )}
          <p className="plan-muted">
            {hotelbedsTransfersSandboxTag(state.data.checkedAt)} · {state.data.adults} traveler
            {state.data.adults > 1 ? 's' : ''}. Live taxi prices arrive when Uber / Lyft / Mozio connect.
          </p>
        </>
      )}
    </div>
  );
}

function TaxiResults({
  query,
  sort,
  maxPrice,
  taxiTier,
  onSave,
}: {
  query: SearchQuery;
  sort: RowSort;
  maxPrice: number | null;
  taxiTier: TaxiTier;
  onSave: (label: string) => void;
}) {
  const dropOff = query.dropoff || query.from;
  const known = isKnownPlace(dropOff);
  const tiers = known ? taxiTierOptions(dropOff, query.travelers) : null;
  const dates = query.depart
    ? `${query.depart}${query.pickupTime ? ` · ${query.pickupTime}` : ''}`
    : 'Flexible dates';
  const travelers = `${query.travelers} traveler${query.travelers > 1 ? 's' : ''}`;
  const note = noLegNote('taxis');
  return (
    <div aria-label="Taxis results">
      <h3>
        Taxis · {query.from || 'Anywhere'} → {query.dropoff || 'Anywhere'} · {dates} · {travelers}
      </h3>
      <p className="plan-muted">Live taxi prices arrive when Uber / Lyft / Mozio connect.</p>
      {note && <p className="results-note">{note}</p>}
      <p className="plan-muted">
        These are full-trip totals, not taxi prices, and no taxi company, route, or timetable is attached to them. Live
        bookable taxis open as suppliers connect.
      </p>
      {tiers && (
        <>
          <h4>Taxis to {dropOff}</h4>
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
                  <p className="card-note">Full-trip total — not a taxi price.</p>
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
      {hotelbedsProductEnabled('transfers') && (
        <HotelbedsTransfers query={query} sort={sort} maxPrice={maxPrice} onSave={onSave} />
      )}
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
  onSaveFare,
  savedKeys,
  onEditSearch,
  onClearSearch,
}: {
  query: SearchQuery;
  dark: boolean;
  onSaveSearch: (label: string) => void;
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): a fare saved
  // from a flight card carries its structured detail to My Trips.
  // Absent, the fare falls back to the label-only save (the old
  // behavior) — nothing breaks for callers that do not pass it.
  onSaveFare?: (label: string, detail: SavedDetail) => void;
  savedKeys?: Set<string>;
  onEditSearch: () => void;
  onClearSearch: () => void;
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
  // Stays facets (interface round, Nov 16 2026): star rating, zone,
  // board/meal plan for the Hotelbeds sandbox hotels. The hotels
  // lift up from HotelbedsStays so the sidebar facets and the map
  // price pins both read the full list; the planner stay cards have
  // no star/zone/board data, so the facets narrow the sandbox
  // hotels only.
  const [hbHotels, setHbHotels] = useState<HotelbedsHotel[]>([]);
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<string | null>(null);
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
  // The max-price counts (Nov 16, 2026): on the flights tab with
  // live fares loaded, the bands count LIVE FARES per traveler —
  // the same unit the filter applies — never the estimate rows below
  // the results (the old code counted those 21 destination cards, so
  // every band read (21) and picking one changed nothing visible).
  // While the fares are still loading, or on any other tab, the
  // bands count the estimate rows the price filter actually narrows.
  const underCount = (max: number) =>
    query.tab === 'flights' && liveOptions ? liveOptions.counts.prices[max] ?? 0 : estimateRows.filter((r) => r.pricePerTraveler <= max).length;
  // The Stays facet options, from the full sandbox list — counts
  // are what the filter reveals, the same rule as the flight facets.
  const starOptions = useMemo(() => hotelbedsStarOptions(hbHotels), [hbHotels]);
  const zoneOptions = useMemo(() => hotelbedsZoneOptions(hbHotels), [hbHotels]);
  const boardOptions = useMemo(() => hotelbedsBoardOptions(hbHotels), [hbHotels]);
  // The map toggle (defect, Nov 14 2026: the live flights results
  // page had no "map" at all — the toggle existed only on Stays). It
  // lives here now, shared by Flights and Stays: the discovery pins
  // are destinations with trip totals, which is what both tabs show.
  const [showMap, setShowMap] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const discovery = useMemo(() => discoveryDestinations(), []);
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
    setHbHotels([]);
    setStarFilter(null);
    setZoneFilter(null);
    setBoardFilter(null);
  }, [queryKey]);

  const primaryPlace =
    query.tab === 'buses' ? query.to : query.tab === 'taxis' ? query.dropoff || query.from : query.tab === 'flights' ? query.to : query.dest;
  const unknownPlace = primaryPlace !== '' && !isKnownPlace(primaryPlace);
  // "Everywhere" inspiration search (roadmap, Nov 21 2026 — F2):
  // a flights search with To = "Everywhere" skips the live-fare
  // fetch entirely and shows the planner's cheapest trips instead.
  const isEverywhere = query.tab === 'flights' && query.to === 'Everywhere';

  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // The Stays filters (review round, Nov 17 2026 — gap 6): sort,
  // max price, tier and the three sandbox facets all live in the
  // sidebar now — one filter surface, the Expedia pattern. Clear
  // resets sort, price, tier and the three sandbox facets, so the
  // source tags come back too. These two consts sit above
  // filtersBody because the sidebar reads them.
  const stayFiltersActive =
    sort !== 'best' || maxPrice !== null || stayTier !== 'best' || starFilter !== null || zoneFilter !== null || boardFilter !== null;
  const clearAllStayFilters = () => {
    setSort('best');
    setMaxPrice(null);
    setStayTier('best');
    setStarFilter(null);
    setZoneFilter(null);
    setBoardFilter(null);
  };

  const liveFiltersActive = flightFiltersActive({ sort, maxPrice, stopsFilter, airlinesFilter, timesFilter });
  const clearAllFlightFilters = () => {
    setStopsFilter([]);
    setAirlinesFilter([]);
    setTimesFilter([]);
    setMaxPrice(null);
    // A changed sort is itself a filter state — clearing restores
    // Best value, so the source tags come back too.
    setSort('best');
  };
  const filtersBody = (
    <>
      {/* Sort + max price live in the sidebar for every tab
          (review round, Nov 17 2026 — gap 6: one filter surface;
          the Stays top bar is gone). */}
      {(
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
              {LIVE_PRICE_BANDS.map((band) => (
                <option key={band} value={band}>
                  Under ${band.toLocaleString()} ({underCount(band)})
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {/* Flight facets (audit round, Nov 17, 2026): stops, airline and
          departure time moved from the top filter bar into this rail —
          the same facet-check lists the Stays sidebar uses. The
          counts come from the cards on screen (countFlightCards), so
          "Nonstop (3)" means 3 visible cards, never a leg count from
          another dataset. */}
      {query.tab === 'flights' && liveOptions && (
        <>
          <div className="filter-group">
            <h3>Stops</h3>
            {liveOptions.stops.map((s) => (
              <label key={s} className="facet-check">
                <input type="checkbox" checked={stopsFilter.includes(s)} onChange={() => setStopsFilter((l) => toggleIn(l, s))} />
                {s === 0 ? 'Nonstop' : `${s} stop${s > 1 ? 's' : ''}`} ({liveOptions.counts.stops[s] ?? 0})
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>Airline</h3>
            {liveOptions.airlines.map((a) => (
              <label key={a} className="facet-check">
                <input type="checkbox" checked={airlinesFilter.includes(a)} onChange={() => setAirlinesFilter((l) => toggleIn(l, a))} />
                {a} ({liveOptions.counts.airlines[a] ?? 0})
              </label>
            ))}
          </div>
          {liveOptions.times.length > 0 && (
            <div className="filter-group">
              <h3>Departure time</h3>
              {liveOptions.times.map((t) => (
                <label key={t} className="facet-check">
                  <input type="checkbox" checked={timesFilter.includes(t)} onChange={() => setTimesFilter((l) => toggleIn(l, t))} />
                  {TIME_BUCKETS.find((b) => b.id === t)?.label ?? t} ({liveOptions.counts.times[t] ?? 0})
                </label>
              ))}
            </div>
          )}
          {liveFiltersActive && (
            <p>
              <button type="button" className="linklike" onClick={clearAllFlightFilters}>
                Clear filters
              </button>
            </p>
          )}
        </>
      )}
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
      {query.tab === 'hotels' && stayFiltersActive && (
        <p>
          <button type="button" className="linklike" onClick={clearAllStayFilters}>
            Clear filters
          </button>
        </p>
      )}
      {/* Stays facets (interface round, Nov 16 2026): star rating,
          zone, board/meal plan — from the Hotelbeds sandbox hotels
          actually returned, with counts. They narrow the sandbox
          hotels only; the planner stay cards carry no star, zone, or
          meal-plan data. The groups appear once the hotels load. */}
      {query.tab === 'hotels' && hbHotels.length > 0 && (
        <>
          <p className="plan-muted">Star, area and meal plan narrow the Hotelbeds sandbox hotels below.</p>
          <div className="filter-group">
            <h3>Star rating</h3>
            {starOptions.map((o) => (
              <label key={o.value} className="facet-check">
                <input
                  type="checkbox"
                  checked={starFilter === Number(o.value)}
                  onChange={() => setStarFilter(starFilter === Number(o.value) ? null : Number(o.value))}
                />
                {o.label} ({o.count})
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>Area</h3>
            {zoneOptions.map((o) => (
              <label key={o.value} className="facet-check">
                <input
                  type="checkbox"
                  checked={zoneFilter === o.value}
                  onChange={() => setZoneFilter(zoneFilter === o.value ? null : o.value)}
                />
                {o.label} ({o.count})
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>Meal plan</h3>
            {boardOptions.map((o) => (
              <label key={o.value} className="facet-check">
                <input
                  type="checkbox"
                  checked={boardFilter === o.value}
                  onChange={() => setBoardFilter(boardFilter === o.value ? null : o.value)}
                />
                {o.label} ({o.count})
              </label>
            ))}
          </div>
        </>
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
    </>
  );

  // Flight filter state (audit round, Nov 17, 2026): the facets
  // live in the left rail now (filtersBody) — the top filter bar is
  // gone. Sort, max price, stops, airline and departure time are the
  // same controls, and the "Showing X of Y" count lives in the count
  // row above the list. The facet counts are card counts
  // (countFlightCards), so a count is what the filter reveals; only
  // multi-city falls back to live-fare counts, which has no merged
  // grid.
  // The map toggle + map (Nov 14, 2026): shared by the flights
  // full-width branch and the sidebar layout's main column — the
  // discovery pins are destinations with trip totals, which is what
  // both Flights and Stays show.
  // Stays map price pins (interface round, Nov 16 2026): on the
  // Stays tab, once the sandbox hotels load, the map shows one
  // price pin per hotel (total for the stay, from the hotel's own
  // lat/lng) instead of the discovery trip pins. Tapping a pin
  // selects that hotel; the panel beside the map shows the hotel,
  // its sandbox tag, and Save — never a trip total, never a live
  // claim. Before the hotels load (or on Flights) the map keeps the
  // discovery pins.
  const hotelPins = useMemo<DiscoveryEntry[]>(() => {
    if (query.tab !== 'hotels') return [];
    return hbHotels
      .filter((h) => h.latitude !== undefined && h.longitude !== undefined)
      .map((h) => ({
        key: `hb-${h.code}`,
        destination: h.name,
        kind: 'place' as const,
        tag: 'Hotelbeds sandbox',
        pinCity: h.zoneName ?? query.dest,
        lat: h.latitude as number,
        lng: h.longitude as number,
        stops: [],
        days: h.nights,
        nights: h.nights,
        experiences: 0,
        stays: 1,
        transports: 0,
        price: h.price,
        bestMonth: 0,
        bestNote: '',
      }));
  }, [query.tab, hbHotels, query.dest]);
  const mapPins = query.tab === 'hotels' && hotelPins.length > 0 ? hotelPins : discovery;
  const selectedMapEntry: DiscoveryEntry | null = mapPins.find((d) => d.key === selectedPin) ?? mapPins[0] ?? null;
  const selectedHotel: HotelbedsHotel | null =
    selectedMapEntry && selectedMapEntry.key.startsWith('hb-')
      ? (hbHotels.find((h) => `hb-${h.code}` === selectedMapEntry.key) ?? null)
      : null;
  const mapToggle = showMapToggle && (
    <p>
      <button type="button" className="ghost" aria-expanded={showMap} onClick={() => setShowMap((s) => !s)}>
        {showMap ? 'Hide map' : query.tab === 'hotels' && hotelPins.length > 0 ? 'Show hotels on map' : 'Show on map'}
      </button>
    </p>
  );
  const mapBlock = showMapToggle && showMap && (
    <div className="discover" style={{ marginBottom: 20 }}>
      <div className="discover-map">
        <DiscoveryMap pins={mapPins} selectedKey={selectedMapEntry?.key ?? null} onSelect={(e) => setSelectedPin(e.key)} dark={dark} />
      </div>
      {selectedHotel ? (
        <article className="card discover-panel">
          <div className="body">
            <span className="pill">Hotelbeds sandbox</span>
            <h3>{selectedHotel.name}</h3>
            <p>
              {selectedHotel.zoneName ? `${selectedHotel.zoneName} · ` : ''}
              {selectedHotel.nights} night{selectedHotel.nights > 1 ? 's' : ''} · {selectedHotel.roomName ?? 'Room'}
              {selectedHotel.boardName ? ` · ${selectedHotel.boardName}` : ''}
            </p>
            <p className="price">
              from ${selectedHotel.price.toLocaleString()} total · ${selectedHotel.perNight.toLocaleString()}/night
            </p>
            <p className="plan-muted">{hotelbedsSandboxTag(null)}</p>
            <button
              type="button"
              className="primary"
              onClick={() => onSaveSearch(searchRequestLabel(query, selectedHotel.name))}
            >
              Save this search
            </button>
          </div>
        </article>
      ) : (
        selectedMapEntry && (
          <article className="card discover-panel">
            <div className="body">
              <span className="pill">{selectedMapEntry.tag}</span>
              <h3>{selectedMapEntry.destination}</h3>
              <p>
                {selectedMapEntry.days} days · {selectedMapEntry.nights} nights · Best value · 2 travelers · planning estimate
              </p>
              {selectedMapEntry.price !== null && <p className="price">from ${selectedMapEntry.price.toLocaleString()} total</p>}
              <button
                type="button"
                className="primary"
                onClick={() => onSaveSearch(searchRequestLabel(query, selectedMapEntry.destination))}
              >
                Save this search
              </button>
            </div>
          </article>
        )
      )}
    </div>
  );

  return (
    <section
      className="results-section"
      id="results"
      aria-label="Search results"
    >
      <div className="results-bar">
        <span>
          <strong>{label}</strong> · {searchSummary(query)}
        </span>
        <span className="results-bar-note">
          {isEverywhere
            ? 'Planning estimates from FujinTrip\u2019s planner — not live fares. Live fares appear once you pick a destination.'
            : query.tab === 'flights'
              ? 'Planning estimates from FujinTrip\u2019s planner, plus live fares from Ignav and LetsFG.'
              : 'Planning estimates from FujinTrip\u2019s planner — not live prices. Live inventory arrives as suppliers connect.'}{' '}
          <a href="/faq#pricing">How pricing works →</a>
        </span>
        <button type="button" className="ghost" onClick={onEditSearch}>
          Edit search
        </button>{' '}
        <button type="button" className="ghost" onClick={onClearSearch}>
          Clear search
        </button>
      </div>
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
      ) : query.tab === 'flights' ? (
        // "Everywhere" inspiration search (roadmap, Nov 21 2026 —
        // F2): a destination-less search never fetches fares — it
        // shows the planner's cheapest trips from the origin instead.
        isEverywhere ? (
          <EverywhereResults query={query} onSaveSearch={onSaveSearch} onSaveFare={onSaveFare} savedKeys={savedKeys} />
        ) : (
        // Flights (audit round, Nov 17, 2026): the same 230px left
        // rail + results column as every other tab — the top filter
        // bar is gone. Sort + price + facets live in the rail
        // (filtersBody); the count row above the list carries the
        // "Showing X of Y" count, counted from the cards.
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
            <div className="results-count-row">
              <span>
                {liveOptions
                  ? liveOptions.shownOptions !== undefined
                    ? `Showing ${liveOptions.shownOptions} of ${liveOptions.totalOptions} options`
                    : `Showing ${liveOptions.shownCount} of ${liveOptions.totalCount} live fares`
                  : 'Checking live fares…'}
              </span>
              {liveFiltersActive && (
                <button type="button" className="linklike" onClick={clearAllFlightFilters}>
                  Clear filters
                </button>
              )}
            </div>
            {mapToggle}
            {mapBlock}
            <FlightResults
              query={query}
              sort={sort}
              maxPrice={maxPrice}
              stopsFilter={stopsFilter}
              airlinesFilter={airlinesFilter}
              timesFilter={timesFilter}
              hideSourceTags={liveFiltersActive}
              onLiveOptions={setLiveOptions}
              onSave={onSaveSearch}
              onSaveFare={onSaveFare}
              savedKeys={savedKeys}
              onClearLiveFilters={() => {
                setStopsFilter([]);
                setAirlinesFilter([]);
                setTimesFilter([]);
              }}
              onClearPrice={() => setMaxPrice(null)}
              onClearSort={() => setSort('best')}
            />
          </div>
        </div>
        )
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
            {mapToggle}
            {mapBlock}
            {query.tab === 'hotels' ? (
              <>
                <StayResults
                  query={query}
                  sort={sort}
                  maxPrice={maxPrice}
                  stayTier={stayTier}
                  starFilter={starFilter}
                  zoneFilter={zoneFilter}
                  boardFilter={boardFilter}
                  onSave={onSaveSearch}
                  onHotels={setHbHotels}
                />
              </>
            ) : query.tab === 'cars' ? (
              <CarResults
                query={query}
                carTier={carTier}
                onSave={onSaveSearch}
              />
            ) : query.tab === 'tours' ? (
              <TourResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                tourTier={tourTier}
                onSave={onSaveSearch}
              />
            ) : query.tab === 'cruises' ? (
              <CruiseResults
                query={query}
                cruiseTier={cruiseTier}
                onSave={onSaveSearch}
              />
            ) : query.tab === 'buses' ? (
              <BusResults
                query={query}
                busTier={busTier}
                onSave={onSaveSearch}
              />
            ) : query.tab === 'taxis' ? (
              <TaxiResults
                query={query}
                sort={sort}
                maxPrice={maxPrice}
                taxiTier={taxiTier}
                onSave={onSaveSearch}
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
