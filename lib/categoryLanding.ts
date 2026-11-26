// Category landing pages (Nov 25, 2026): one route per homepage
// section — /flights, /hotels, /cars, /activities, /cruises, /buses,
// /taxis. The route follows the app's existing naming: the tab id
// ('hotels', 'tours') is the source of truth, and the route is the
// URL the tab already owns in spirit — /hotels matches the existing
// /hotels/[code] detail route, /activities matches /activities/[code].
// The stays page lives at /hotels (not /stays) for the same reason.
//
// Referral-first (user, Nov 25 2026 — Google Flights / Skyscanner
// model): the pages compare and the traveler books on the seller's
// site; FujinTrip takes an affiliate percentage. No page promises
// on-site booking. Flights already have live referral
// fares (Ignav + LetsFG, labelled live with source + checked time);
// every other category has no live supplier yet beyond Hotelbeds
// sandbox (labelled test data), so those pages show the planner's
// Best value leg as a labelled planning estimate and say live
// comparison arrives as suppliers connect. Nothing is invented:
// hero photos come from the verified pool in lib/data.ts only, and
// every price comes from tabRowsFor (lib/homeTabs) or a live fare
// response — never a hand-written number.

import { CITY_PHOTOS, GLOBAL_DESTINATIONS, HIDDEN_GEMS } from './data';
import type { HomeTabId } from './homeTabs';

export type CategoryLandingConfig = {
  tab: HomeTabId;
  route: string;
  /** The label the header nav and footer already use for this tab. */
  label: string;
  h1: string;
  eyebrow: string;
  sub: string;
  /** Verified pool URL only — never an invented photo. */
  heroPhoto: string;
  heroAlt: string;
  metaTitle: string;
  metaDescription: string;
  introTitle: string;
  intro: string;
  /** The honest line about what is live for this category today. */
  liveNote: string;
  steps: { title: string; text: string }[];
  trust: { title: string; text: string }[];
};

const photo = (name: string): string =>
  GLOBAL_DESTINATIONS.find((d) => d.name === name)?.image ??
  HIDDEN_GEMS.find((d) => d.name === name)?.image ??
  CITY_PHOTOS[name] ??
  '';

export const CATEGORY_LANDING: Record<HomeTabId, CategoryLandingConfig> = {
  flights: {
    tab: 'flights',
    route: '/flights',
    label: 'Flights',
    h1: 'Flights',
    eyebrow: 'Flights · Compare fares from many sellers',
    sub: 'Search once, compare live fares from different sellers — then book on the seller’s site. The fare you see is the seller’s fare: no hidden margin, no surprise fees.',
    heroPhoto: CITY_PHOTOS['New York'],
    heroAlt: 'New York skyline from Liberty Island',
    metaTitle: 'Flights — compare live fares from many sellers | FujinTrip',
    metaDescription:
      'Compare live flight fares from Ignav and LetsFG side by side, then book on the seller’s site. All-in prices, no hidden fees — FujinTrip, ride the wind, pay less.',
    introTitle: 'Live fares, side by side',
    intro:
      'FujinTrip works like Google Flights: we show fares from different sellers in one list, each labelled with its source and when it was checked. You pick a fare and book on the seller’s own site — FujinTrip never takes your payment.',
    liveNote:
      'Live fares from Ignav and LetsFG, checked just now — each labelled with its source and checked time.',
    steps: [
      { title: 'Search', text: 'Tell us where you’re flying from, where to, and when.' },
      { title: 'Compare', text: 'Live fares from Ignav and LetsFG in one list, cheapest first — each with its source and checked time.' },
      { title: 'Book on the seller’s site', text: 'Pick a fare and finish booking where the seller sells it. FujinTrip takes an affiliate percentage — you pay the seller’s fare.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The fare you see is the fare — taxes included, no margin added on top.' },
      { title: 'Fares from many sellers', text: 'Ignav and LetsFG live, plus a cached competitor fare — never mixed, never averaged.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the flight becomes one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
  hotels: {
    tab: 'hotels',
    route: '/hotels',
    label: 'Stays',
    h1: 'Stays',
    eyebrow: 'Stays · Hotels for every trip',
    sub: 'Hotels and stays for every trip — plan with honest estimates while live hotel prices connect. Every price is labelled as what it is.',
    heroPhoto: photo('Santorini'),
    heroAlt: 'Santorini — white villages above the caldera',
    metaTitle: 'Stays — hotels with honest planning estimates | FujinTrip',
    metaDescription:
      'Hotels and stays for every trip, with Best value planning estimates per traveler while live hotel prices connect. All-in prices, no hidden fees — FujinTrip.',
    introTitle: 'Plan the stay, honestly',
    intro:
      'Live hotel prices arrive as suppliers connect — for now the stay for each trip shows the planner’s Best value estimate, labelled a planning estimate, never a live quote. Hotelbeds sandbox data, where shown, is labelled test data.',
    liveNote:
      'No live hotel supplier yet beyond Hotelbeds sandbox (labelled test data). Live hotel comparison arrives as suppliers connect.',
    steps: [
      { title: 'Search', text: 'Tell us the destination, dates and how many are travelling.' },
      { title: 'Compare estimates', text: 'The Best value stay estimate per traveler for each trip — labelled a planning estimate, never a live quote.' },
      { title: 'Plan it with AI', text: 'Ask Fujin AI and the stay becomes part of one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The estimate you see is the whole stay budget — no hidden margin, no surprise fees.' },
      { title: 'Labelled, never dressed up', text: 'Planning estimates say so. Test data says so. A live price will say live.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the stay becomes one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
  cars: {
    tab: 'cars',
    route: '/cars',
    label: 'Car rental',
    h1: 'Car rental',
    eyebrow: 'Car rental · Drive the trip yourself',
    sub: 'A car for the open road — plan with honest estimates while live car prices connect. Every price is labelled as what it is.',
    heroPhoto: photo('St. George'),
    heroAlt: 'St. George, Utah — red-rock desert road',
    metaTitle: 'Car rental — plan with honest estimates | FujinTrip',
    metaDescription:
      'Car rental for every trip, with Best value planning estimates per traveler while live car prices connect. All-in prices, no hidden fees — FujinTrip.',
    introTitle: 'Plan the drive, honestly',
    intro:
      'Live car prices arrive as suppliers connect — for now the car for each trip shows the planner’s Best value estimate, labelled a planning estimate, never a live quote.',
    liveNote:
      'No live car supplier yet. Live car comparison arrives as suppliers connect.',
    steps: [
      { title: 'Search', text: 'Tell us where you’re picking up, when, and where you’re headed.' },
      { title: 'Compare estimates', text: 'The Best value car estimate per traveler for each trip — labelled a planning estimate, never a live quote.' },
      { title: 'Plan it with AI', text: 'Ask Fujin AI and the car becomes part of one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The estimate you see is the whole car budget — no hidden margin, no surprise fees.' },
      { title: 'Labelled, never dressed up', text: 'Planning estimates say so. A live price will say live.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the drive becomes one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
  tours: {
    tab: 'tours',
    route: '/activities',
    label: 'Attractions',
    h1: 'Attractions & activities',
    eyebrow: 'Attractions · Sightseeing and tours',
    sub: 'Tours, tickets and local experiences — plan with honest estimates while live attraction prices connect. Every price is labelled as what it is.',
    heroPhoto: photo('Kyoto'),
    heroAlt: 'Kyoto — temples and bamboo groves',
    metaTitle: 'Attractions & activities — tours with honest estimates | FujinTrip',
    metaDescription:
      'Tours, tickets and local experiences for every trip, with Best value planning estimates per traveler while live attraction prices connect. FujinTrip.',
    introTitle: 'Plan what you’ll do, honestly',
    intro:
      'Live attraction prices arrive as suppliers connect — for now the activities for each trip show the planner’s Best value estimate, labelled a planning estimate, never a live quote. Hotelbeds sandbox activities, where shown, are labelled test data.',
    liveNote:
      'No live attractions supplier yet beyond Hotelbeds sandbox (labelled test data). Live attraction comparison arrives as suppliers connect.',
    steps: [
      { title: 'Search', text: 'Tell us the destination and when you’ll be there.' },
      { title: 'Compare estimates', text: 'The Best value activities estimate per traveler for each trip — labelled a planning estimate, never a live quote.' },
      { title: 'Plan it with AI', text: 'Ask Fujin AI and the activities become part of one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The estimate you see is the whole activities budget — no hidden margin, no surprise fees.' },
      { title: 'Labelled, never dressed up', text: 'Planning estimates say so. Test data says so. A live price will say live.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the day’s activities become one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
  cruises: {
    tab: 'cruises',
    route: '/cruises',
    label: 'Cruises',
    h1: 'Cruises',
    eyebrow: 'Cruises · Slow travel by sea',
    sub: 'Ocean and river cruises — plan with honest estimates while live cruise prices connect. Every price is labelled as what it is.',
    heroPhoto: photo('Caribbean'),
    heroAlt: 'Caribbean — turquoise water and island hopping',
    metaTitle: 'Cruises — plan with honest estimates | FujinTrip',
    metaDescription:
      'Ocean and river cruises for every trip, with full-trip planning estimates per traveler while live cruise prices connect. All-in prices, no hidden fees — FujinTrip.',
    introTitle: 'Plan the cruise, honestly',
    intro:
      'The planner does not break out a cruise leg yet, so the rows below are the full-trip planning estimates for each route — they are not cruise prices, and they say so. Live cruise comparison arrives as suppliers connect.',
    liveNote:
      'No live cruise supplier yet. Live cruise comparison arrives as suppliers connect.',
    steps: [
      { title: 'Search', text: 'Tell us where you’d like to sail and when.' },
      { title: 'Compare trips', text: 'Full-trip planning estimates per traveler for each route — labelled as full-trip estimates, never as cruise prices.' },
      { title: 'Plan it with AI', text: 'Ask Fujin AI and the cruise becomes part of one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The estimate you see is the whole trip budget — no hidden margin, no surprise fees.' },
      { title: 'Labelled, never dressed up', text: 'Full-trip estimates say so. A live price will say live.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the sailing becomes one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
  buses: {
    tab: 'buses',
    route: '/buses',
    label: 'Buses',
    h1: 'Buses',
    eyebrow: 'Buses · Overland, the slow way',
    sub: 'Bus travel between cities — plan with honest estimates while live bus prices connect. Every price is labelled as what it is.',
    heroPhoto: CITY_PHOTOS['Lisbon'],
    heroAlt: 'Lisbon — Tram 28 climbing the old town',
    metaTitle: 'Buses — plan with honest estimates | FujinTrip',
    metaDescription:
      'Bus travel between cities, with full-trip planning estimates per traveler while live bus prices connect. All-in prices, no hidden fees — FujinTrip.',
    introTitle: 'Plan the bus, honestly',
    intro:
      'The planner does not break out a bus leg yet, so the rows below are the full-trip planning estimates for each route — they are not bus prices, and they say so. Live bus comparison arrives as suppliers connect.',
    liveNote:
      'No live bus supplier yet. Live bus comparison arrives as suppliers connect.',
    steps: [
      { title: 'Search', text: 'Tell us where you’re leaving from, where to, and when.' },
      { title: 'Compare trips', text: 'Full-trip planning estimates per traveler for each route — labelled as full-trip estimates, never as bus prices.' },
      { title: 'Plan it with AI', text: 'Ask Fujin AI and the bus becomes part of one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The estimate you see is the whole trip budget — no hidden margin, no surprise fees.' },
      { title: 'Labelled, never dressed up', text: 'Full-trip estimates say so. A live price will say live.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the overland leg becomes one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
  taxis: {
    tab: 'taxis',
    route: '/taxis',
    label: 'Taxis',
    h1: 'Taxis & transfers',
    eyebrow: 'Taxis · Door to door, on arrival',
    sub: 'Taxis and airport transfers — plan with honest estimates while live transfer prices connect. Every price is labelled as what it is.',
    heroPhoto: CITY_PHOTOS['London'],
    heroAlt: 'London — Big Ben at sunset',
    metaTitle: 'Taxis & transfers — plan with honest estimates | FujinTrip',
    metaDescription:
      'Taxis and airport transfers for every trip, with full-trip planning estimates per traveler while live transfer prices connect. FujinTrip.',
    introTitle: 'Plan the transfer, honestly',
    intro:
      'The planner does not break out a taxi leg yet, so the rows below are the full-trip planning estimates for each route — they are not taxi prices, and they say so. Live transfer comparison arrives as suppliers connect.',
    liveNote:
      'No live taxi supplier yet. Live transfer comparison arrives as suppliers connect.',
    steps: [
      { title: 'Search', text: 'Tell us where you’re picked up, where to, and when.' },
      { title: 'Compare trips', text: 'Full-trip planning estimates per traveler for each route — labelled as full-trip estimates, never as taxi prices.' },
      { title: 'Plan it with AI', text: 'Ask Fujin AI and the transfer becomes part of one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
    trust: [
      { title: 'All-in prices, no hidden fees', text: 'The estimate you see is the whole trip budget — no hidden margin, no surprise fees.' },
      { title: 'Labelled, never dressed up', text: 'Full-trip estimates say so. A live price will say live.' },
      { title: 'One plan, three ways', text: 'Ask Fujin AI and the transfer becomes one day-by-day trip in Cheapest, Best value or Premium.' },
    ],
  },
};

export function categoryRouteFor(tab: HomeTabId): string {
  return CATEGORY_LANDING[tab].route;
}

export function categoryTabForRoute(route: string): HomeTabId | null {
  const found = (Object.keys(CATEGORY_LANDING) as HomeTabId[]).find(
    (tab) => CATEGORY_LANDING[tab].route === route,
  );
  return found ?? null;
}

// The featured live-fare strip on the flights page: New York →
// London, the route already verified live (Ignav $1,615, LetsFG
// $1,743 ITA Airways, Dec 10–17 2026, 2 pax). The dates roll forward
// — 28 days out, a 7-day trip — so the strip never shows a stale
// date as a live fare. Pure, so the tests can pin the shape.
export function featuredFlightDates(now: Date = new Date()): { depart: string; return: string } {
  const fmt = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const depart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 28);
  const ret = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 35);
  return { depart: fmt(depart), return: fmt(ret) };
}

export const FEATURED_FLIGHT_ROUTE = { from: 'New York', to: 'London', travelers: 2 } as const;
