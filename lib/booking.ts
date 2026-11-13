// Unified booking connector layer — one interface per category, one
// adapter per supplier. Built Nov 11, 2026 by the booking agent.
// See files/booking-integration-plan.md for the full supplier table
// (data, fee model, access, lead time) and the ranking.
//
// Honesty rules (non-negotiable):
// - Every adapter reports its real state: live | test | not_configured |
//   not_applied | unavailable. Nothing ever returns a fake booking.
// - Cached/indicative data is labeled cached/indicative, never live.
// - Test-mode Duffel orders are labeled test_booking:true.
// - Live flight booking refuses until a live key AND Stripe are
//   configured, and says exactly which step is missing.
// - No secrets are ever logged or returned to the browser.

import { serviceFee } from './planner';

// ---------------------------------------------------------------------------
// Supplier registry
// ---------------------------------------------------------------------------

export type BookingCategory =
  | 'flights'
  | 'hotels'
  | 'cars'
  | 'cruises'
  | 'buses'
  | 'trains'
  | 'taxis'
  | 'activities';

export type SupplierState =
  | 'live' // bookable now, live credentials
  | 'test' // test/sandbox credentials only
  | 'not_configured' // access exists in principle, no key set here
  | 'not_applied' // needs an application the user has not done yet
  | 'unavailable'; // gated/closed (traffic, accreditation, invite, no public API)

export type BookingMode =
  | 'onsite' // traveler books inside FujinTrip checkout
  | 'redirect' // traveler finishes on the supplier's site (labeled as leaving)
  | 'affiliate_link' // tracked link out; commission on completed booking
  | 'data_only'; // comparison data, no booking through us

export type SupplierConnector = {
  id: string;
  name: string;
  categories: BookingCategory[];
  /** What the traveler gets from this supplier. */
  data: string;
  /** How money works: who pays whom, commission or fee. */
  feeModel: string;
  freeToStart: boolean;
  access: string;
  leadTime: string;
  state: SupplierState;
  mode: BookingMode;
  quickWin: boolean;
  envVar?: string;
  notes?: string;
};

/**
 * The full supplier list (verified Nov 11, 2026 — see the plan file for
 * sources). `state` is the state TODAY; env-keyed suppliers are re-read
 * at runtime by supplierStates() below.
 */
export const SUPPLIERS: SupplierConnector[] = [
  // -- Flights -------------------------------------------------------------
  {
    id: 'duffel-flights', name: 'Duffel — flights', categories: ['flights'],
    data: 'Live fares, 300+ airlines; search, validate, book, seats, bags',
    feeModel: 'We pay Duffel $3/order (+1% Managed Content, +$2/ancillary); we earn our tiered service fee ($19/$35/$49)',
    freeToStart: true, access: 'Test key free; live needs company details + Managed Content + certification + live token',
    leadTime: 'Weeks (certification)', state: 'test', mode: 'onsite', quickWin: false,
    envVar: 'DUFFEL_API_KEY', notes: 'Test key verified live Nov 10. Live mode is user step 2 in the plan.',
  },
  {
    id: 'travelpayouts', name: 'Travelpayouts Data API', categories: ['flights', 'hotels'],
    data: 'Cached flight + hotel prices (Aviasales, last 48h–7 days), price calendar, cheapest dates; 729 airlines',
    feeModel: 'Free; we earn affiliate commission on bookings through our links',
    freeToStart: true, access: 'Register → free token auto-generated (X-Access-Token, server-side only). Live Search API needs 50,000+ MAU — not for a new site',
    leadTime: 'Days', state: 'not_configured', mode: 'data_only', quickWin: true,
    envVar: 'TRAVELPAYOUTS_TOKEN', notes: 'Always label "cached price — not a live quote".',
  },
  {
    id: 'skyscanner', name: 'Skyscanner Travel API', categories: ['flights', 'hotels', 'cars'],
    data: 'Live + indicative flight, hotel and car-hire prices; deep links to suppliers (no booking in-app)',
    feeModel: 'Free to use, no per-booking fee; partners earn an unpublished revenue share',
    freeToStart: false, access: 'Application + commercial agreement; minimum 100,000 monthly active users; ~2-week review',
    leadTime: '2 weeks review, gated on traffic', state: 'unavailable', mode: 'data_only', quickWin: false,
    notes: 'Apply once traffic passes 100k monthly visits.',
  },
  {
    id: 'kiwi', name: 'Kiwi.com Tequila', categories: ['flights'],
    data: 'Flight search, multicity, NOMAD, virtual interlining; Booking API revalidates + books',
    feeModel: 'Historically free API + partner commission',
    freeToStart: false, access: 'Invitation-only since May 2024 — email affiliates@kiwi.com; no self-service signup',
    leadTime: 'Unknown (invite)', state: 'unavailable', mode: 'onsite', quickWin: false,
    notes: 'Free MCP server (mcp.kiwi.com) exists for research — not a product API.',
  },
  {
    id: 'amadeus', name: 'Amadeus Enterprise', categories: ['flights', 'hotels', 'cars'],
    data: '100+ Enterprise APIs — flights, hotels, cars, seats, status; full GDS',
    feeModel: 'Negotiated monthly fee + quota, then per call (no published prices)',
    freeToStart: false, access: 'Self-service closed 17 Jul 2026, keys disabled. Enterprise only: request + consultant + negotiated contract + certification; aimed at IATA/ARC-accredited businesses',
    leadTime: 'Months', state: 'unavailable', mode: 'onsite', quickWin: false,
    notes: 'Do not build on old self-service tutorials — that door is closed.',
  },
  {
    id: 'serpapi-google-flights', name: 'SerpApi — Google Flights', categories: ['flights'],
    data: 'Google Flights results via extraction API; booking token',
    feeModel: 'Paid plans; cached results free (250 free searches/month per one source)',
    freeToStart: true, access: 'Sign up → API key', leadTime: 'Days',
    state: 'not_configured', mode: 'data_only', quickWin: true,
    notes: 'Google Flights has NO official API — third-party extraction. Check terms before relying on it.',
  },
  // -- Hotels --------------------------------------------------------------
  {
    id: 'duffel-stays', name: 'Duffel Stays', categories: ['hotels'],
    data: '1M+ properties; search → rates → quote → booking, same API as flights',
    feeModel: 'Duffel shares the provider commission with the seller (share grows with volume, paid monthly above $25, exact % negotiated)',
    freeToStart: false, access: 'Request Stays access in the Duffel dashboard (user said yes Nov 8 — whether requested is unconfirmed)',
    leadTime: 'With Duffel live', state: 'not_applied', mode: 'onsite', quickWin: false,
    envVar: 'DUFFEL_API_KEY', notes: 'Check status first — user step 1 in the plan.',
  },
  {
    id: 'expedia-rapid', name: 'Expedia Rapid', categories: ['hotels'],
    data: 'Live hotel inventory, rates, availability, booking; market-leader depth',
    feeModel: 'Hotels 10–15% commission (avg ~12%), paid 30–60 days after travel',
    freeToStart: false, access: 'Partner application → signed agreement → site review (prep draft: files/expedia-application-prep.md, NOT submitted)',
    leadTime: '12–20 weeks', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Longest lead in the plan — start first.',
  },
  {
    id: 'hotelbeds', name: 'Hotelbeds (HBX Group)', categories: ['hotels', 'activities', 'cars', 'buses'],
    data: '300,000+ properties, 170+ countries; Booking + Content + Cache APIs; also 23,000+ experiences, transfers, car hire',
    feeModel: 'B2B net rates — true wholesale prices, no retail floor; we set the retail price',
    freeToStart: true, access: 'Partner signup; sandbox immediate on registration (no commercial agreement needed for sandbox)',
    leadTime: 'Days (sandbox); weeks (production)', state: 'not_configured', mode: 'onsite', quickWin: true,
    envVar: 'HOTELBEDS_API_KEY', notes: 'Net rates give us the best price control in the plan. Also the route for HolidayTaxis-style airport transfers (same HBX Group) — partner route UNVERIFIED, needs direct contact.',
  },
  {
    id: 'booking-demand', name: 'Booking.com Demand API', categories: ['hotels'],
    data: 'Search + availability + prices + booking of Booking.com inventory (28M listings)',
    feeModel: 'Commission (rate negotiated, not published in sources checked)',
    freeToStart: false, access: 'Must be a Managed Affiliate Partner: contract + account manager → API key + X-Affiliate-Id',
    leadTime: 'Weeks–months', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Do NOT use the Connectivity API — it is for PMS/channel managers pushing their own properties, and new integrations are paused.',
  },
  {
    id: 'agoda', name: 'Agoda Partners API', categories: ['hotels'],
    data: '2M+ properties; strongest APAC depth (ryokan, hanok, Thai villas)',
    feeModel: '12–18% commission, paid post-stay; affiliate tier 4–7%',
    freeToStart: false, access: 'No self-serve key. Affiliate signup free (API tier selective after traffic); Partners API via BD team, 4–8 wks negotiation + 4–12 wks integration',
    leadTime: '4–8 wks + 4–12 wks', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'YCS is supply-side only (your own listed property) — not for us.',
  },
  // -- Cars ----------------------------------------------------------------
  {
    id: 'duffel-cars', name: 'Duffel — cars', categories: ['cars'],
    data: 'Rental-car search + reservation via Duffel',
    feeModel: 'Part of Duffel pricing (no separate fee published)',
    freeToStart: true, access: 'Same Duffel key', leadTime: 'With Duffel live',
    state: 'test', mode: 'onsite', quickWin: false,
    envVar: 'DUFFEL_API_KEY', notes: 'Only postpaid (pay at counter) quotes can be reserved natively; guarantee/prepaid go to the supplier site. Driver age on pickup date must match the birth date.',
  },
  {
    id: 'rentalcars', name: 'Rentalcars.com', categories: ['cars'],
    data: 'Unified search across Hertz, Avis, Enterprise, Sixt, Europcar, Budget, Alamo, Dollar, Thrifty, Firefly; 60,000+ locations',
    feeModel: 'Commission typically 3–10% (one source claims up to 60% — unverified)',
    freeToStart: true, access: 'Commercial partner program / affiliate signup; REST API, OAuth 2.0',
    leadTime: 'Weeks', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'QUALITY FLAG: Trustpilot ~1.5/5 (150k+ reviews) — surprise charges, refund difficulty. Judge against the quality standard before making it the face of our car offer.',
  },
  {
    id: 'cartrawler', name: 'CarTrawler', categories: ['cars'],
    data: 'Largest car aggregator; thousands of brands; Booking.com car-rental backend; 1,500+ partners',
    feeModel: 'Commercial (not published in sources checked)',
    freeToStart: false, access: 'Commercial partner agreement', leadTime: 'Weeks',
    state: 'not_applied', mode: 'onsite', quickWin: false,
  },
  {
    id: 'direct-car-chains', name: 'Sixt / Hertz / Avis / Enterprise / Europcar (direct)', categories: ['cars'],
    data: 'Each chain’s own live inventory, deepest per-brand access',
    feeModel: 'Commercial, better unit economics than aggregators at scale',
    freeToStart: false, access: 'Per-company commercial agreement + certification',
    leadTime: 'Weeks–months per chain', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Add 12–24 months after launch, by volume — one aggregator first.',
  },
  // -- Cruises --------------------------------------------------------------
  {
    id: 'traveltek', name: 'Traveltek Cruise API', categories: ['cruises'],
    data: 'Real-time pricing, availability, content; 27+ suppliers, 30,000+ itineraries (Royal Caribbean, Carnival, MSC, Princess, Costa, Virgin Voyages, Disney, …); iSell engine',
    feeModel: 'Commercial (not published); cruises pay 15–18% ocean / 15–20% river commission industry-wide',
    freeToStart: false, access: 'Contact sales / activation form; you need your own cruise credentials',
    leadTime: 'Weeks (sales cycle)', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Largest cruise coverage, one integration.',
  },
  {
    id: 'cruise-api', name: 'CRUISE-API (CRUISEHOST)', categories: ['cruises'],
    data: 'Content, real-time pricing, availability, live booking; 30 cruise lines, 32 pricing markets, 37 languages',
    feeModel: 'Not published',
    freeToStart: false, access: 'Sales contract', leadTime: 'Unknown',
    state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Announced Dec 2025 — new; verify maturity before committing.',
  },
  {
    id: 'cruise-itinerary', name: 'Cruise Itinerary (data only)', categories: ['cruises'],
    data: 'Day-by-day itineraries, ships, ports, weekly fare history, price index; 35 lines',
    feeModel: 'Free tier; $149 / $749 / $2,500 per month',
    freeToStart: true, access: 'Sign up → key (self-serve)', leadTime: 'Days',
    state: 'not_configured', mode: 'data_only', quickWin: true,
    envVar: 'CRUISE_ITINERARY_API_KEY', notes: 'Comparison data, not booking — "recent fares, not a live quote".',
  },
  // -- Buses ----------------------------------------------------------------
  {
    id: 'distribusion', name: 'Distribusion', categories: ['trains', 'buses'],
    data: 'B2B ground-transport marketplace: bus, rail, ferry; ~3,000 carriers, 70 markets, 250+ retailers; single booking API (one-way journeys)',
    feeModel: 'Commercial partnership (not published); buses/taxis are very low margin industry-wide',
    freeToStart: false, access: 'Commercial partnership / integration project — no self-serve signup',
    leadTime: 'Weeks–months', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Long-term ground backbone (bus + rail + ferry in one API). One-way only; seats assigned by the carrier.',
  },
  {
    id: 'busbud', name: 'Busbud', categories: ['buses'],
    data: 'Intercity bus + rail; 4,500+ carriers, 2.5M routes, 80+ countries; API or white-label',
    feeModel: 'Revenue-share (rate not published)',
    freeToStart: false, access: 'Distribution Partnership Program — Partnership Inquiry Form',
    leadTime: 'Weeks (exact review time unverified)', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Best bus-specific depth (North America, Europe, Latin America).',
  },
  {
    id: 'flixbus', name: 'FlixBus', categories: ['buses'],
    data: 'Europe’s largest long-distance coach network (also North America, Brazil); full network via partner API',
    feeModel: 'Commission per successful order (rate not published)',
    freeToStart: true, access: 'Affiliate via AWIN; static logos, or dynamic API integration for metasearchers/OTAs',
    leadTime: 'Days (affiliate)', state: 'not_configured', mode: 'affiliate_link', quickWin: true,
    notes: 'Dynamic API is the right tier for us.',
  },
  {
    id: 'gopaxo', name: 'Gopaxo', categories: ['trains', 'buses'],
    data: 'European train + bus in one REST API (TGV, Eurostar, Trenitalia, FlixBus, …); search, book, cancel, presales, ticket issuance (PDF / Apple Wallet / Google Wallet); 800+ carriers, 160 countries',
    feeModel: 'Commission or subscription — rate not published (unverified until the contract call)',
    freeToStart: true, access: 'Partner form → 30-min scoping call → sandbox token (24–48 business hours) → contract → production',
    leadTime: '2–6 weeks to production', state: 'not_configured', mode: 'onsite', quickWin: true,
    envVar: 'GOPAXO_API_KEY', notes: '#1 for trains + buses together — the fastest real bookable ground inventory. Free sandbox. Pick one of Gopaxo / Tictactrip for Europe ground, not both. Covers our Europe routes’ rail legs.',
  },
  {
    id: 'tictactrip', name: 'Tictactrip', categories: ['trains', 'buses'],
    data: '250+ European rail + intercity bus carriers (SNCF, Trenitalia, Renfe, FlixBus, BlaBlaCar Bus, ALSA, Ouigo); search → book → ticket PDF',
    feeModel: 'Pricing by volume/carrier mix (not published)',
    freeToStart: false, access: 'Sales contact; OpenAPI spec + Postman collection',
    leadTime: '2–6 weeks to go live', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Pick one of Gopaxo / Tictactrip for Europe ground, not both. Gopaxo relies on the Tictactrip API for some routes (per Gopaxo).',
  },
  // -- Trains --------------------------------------------------------------
  // Trains were never a category in the booking plan — most intercity
  // legs are trains. Ground-transport plan, Nov 12, 2026.
  {
    id: 'trainline-api', name: 'Trainline Partner Solutions — Global API', categories: ['trains'],
    data: 'REST API for search, booking, real-time information, exchanges, refunds and aftersales; 24+ European countries, 80+ railway carriers',
    feeModel: 'Commercial partnership — price/commission not published (unverified)',
    freeToStart: false, access: 'Contact Trainline Partner Solutions for the API agreement + docs; no public API reference exists',
    leadTime: '~12 weeks average partner integration', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'The deep Europe rail option — best UK + Europe rail coverage in one API, slowest to land. Apply after Gopaxo is live.',
  },
  {
    id: 'trainline-affiliate', name: 'Trainline Affiliate Programme', categories: ['trains'],
    data: 'Tracked deep links, banners, widgets to Trainline (trains + coaches, 40+ countries); managed on Partnerize, no joining fee',
    feeModel: 'Affiliate commission per eligible sale (Partnerize rates; third-party listings report up to 3% new / 1% existing — unverified)',
    freeToStart: true, access: 'Apply → review → Partnerize dashboard + campaign reference (affiliates@thetrainline.com)',
    leadTime: 'Days', state: 'not_configured', mode: 'affiliate_link', quickWin: true,
    notes: 'The no-code train path: a "Book this train" deep link on every rail leg, with commission, while the API integrations are pending.',
  },
  {
    id: 'omio', name: 'Omio B2B', categories: ['trains', 'buses'],
    data: '3,000+ operators: trains, buses, flights, ferries. Meta Search API (display real-time results, redirect to Omio checkout) and Booking API (full control inside FujinTrip); white-label, 20+ currencies, 30 languages',
    feeModel: 'Commercial — terms not published (unverified)',
    freeToStart: false, access: 'B2B contact / sales',
    leadTime: 'Unverified (no public lead time found)', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'The multimodal alternative to Gopaxo — evaluate against it and pick one Europe ground backbone, not two. Proposed Rail Europe acquisition announced 2026, not completed.',
  },
  {
    id: 'rail-europe', name: 'Rail Europe API', categories: ['trains'],
    data: 'Specialist European rail distributor: ~250 rail providers (DB, SNCF, Eurostar, Trenitalia, Renfe, SBB, ÖBB); single connection, after-sales support, group bookings; also sells seat reservations for Eurail/Interrail pass holders',
    feeModel: 'Commission structures exist but tiers not disclosed (unverified)',
    freeToStart: false, access: 'Commercial agreement → partner onboarding (reportedly completed within days — reported, not verified)',
    leadTime: 'Days after agreement (reported)', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Best for passes + long-haul rail: the natural home for selling Eurail/Interrail passes and pass-holder seat reservations.',
  },
  {
    id: 'eurail', name: 'Eurail / Interrail distribution', categories: ['trains'],
    data: 'Mobile Eurail + Interrail passes: unlimited travel on most trains in 33 European countries, 7/14/21 days (also flexi-day versions); sold via API or the Eurail Ticketing System',
    feeModel: 'Volume-based commission (rates vary by product — unverified)',
    freeToStart: false, access: 'Via a distributor (Rail Europe) or a direct Eurail distribution partnership',
    leadTime: 'Weeks (via Rail Europe)', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Eurail = non-European residents; Interrail = European residents. Never sell a pass without the seat-reservation warning — a pass does not include mandatory reservations.',
  },
  // -- Taxis ----------------------------------------------------------------
  {
    id: 'uber', name: 'Uber (Riders API v1.2)', categories: ['taxis'],
    data: 'Price estimates, ETAs, ride requests; sandbox available',
    feeModel: 'We pay nothing per call; the traveler pays Uber in their own Uber app/account',
    freeToStart: true, access: 'developer.uber.com → OAuth 2.0; `request` scope is privileged, needs Uber approval for production (usable in dev for the account’s own users)',
    leadTime: 'Days (dev); weeks (production approval)', state: 'not_configured', mode: 'redirect', quickWin: true,
    envVar: 'UBER_CLIENT_ID', notes: 'Estimates + deep-link now; on-platform request after approval.',
  },
  {
    id: 'lyft', name: 'Lyft', categories: ['taxis'],
    data: 'Cost estimates, ETAs, ride requests (v1 API); sandbox mode',
    feeModel: 'Traveler pays Lyft; no per-call fee published',
    freeToStart: true, access: 'Developer portal: app → Client ID/Secret; public endpoints via Client Token; rides.request needs 3-legged OAuth; production rides via a Lyft Business program (Concierge API gated behind a business agreement)',
    leadTime: 'Days (estimates); weeks (Business program)', state: 'not_configured', mode: 'redirect', quickWin: true,
    envVar: 'LYFT_CLIENT_ID', notes: 'US + Canada.',
  },
  {
    id: 'bolt', name: 'Bolt', categories: ['taxis'],
    data: 'Ride-hailing across Europe, Baltics, Africa; integrated with ChatGPT (Aug 2026)',
    feeModel: 'Not published',
    freeToStart: false, access: 'No public developer API — reach via Bolt Business sales, or via aggregators (Opran, Karhoo)',
    leadTime: 'Weeks (sales)', state: 'unavailable', mode: 'redirect', quickWin: false,
    notes: 'Aggregator route first — there is no public API to integrate.',
  },
  {
    id: 'mozio', name: 'Mozio', categories: ['taxis'],
    data: 'Ground transport API / white-label / widget; 3,000+ vetted providers, 3,500+ airports, 180+ countries (airport transfers, shuttles, limos)',
    feeModel: 'Commission on completed journeys; no public pricing (custom quote)',
    freeToStart: false, access: 'Partner form', leadTime: 'Weeks',
    state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'Airport transfers — the taxi use-case travelers actually need on a trip.',
  },
  {
    id: 'karhoo', name: 'Karhoo', categories: ['taxis'],
    data: 'B2B mobility marketplace: API / SDK / white-label for on-demand + pre-booked rides from licensed taxi/PHV fleets; ~1.8–2M vehicles, ~3,000–4,000 fleets, 1,500 cities, 125 countries',
    feeModel: 'Percentage of the fare per booking — rate not published (unverified)',
    freeToStart: false, access: 'Sales contact',
    leadTime: 'Unverified', state: 'not_applied', mode: 'onsite', quickWin: false,
    notes: 'The Bolt route + Europe taxi depth — Bolt has no public API. Whether Bolt inventory specifically flows through Karhoo is UNVERIFIED — ask in the sales call, do not claim it. Partners incl. SNCF, Renfe, Booking.com.',
  },
  {
    id: 'holidaytaxis', name: 'HolidayTaxis', categories: ['taxis'],
    data: 'Airport transfers in 150+ countries / 21,000+ destinations (private + shared, shuttles, minibuses, wheelchair-accessible, electric); part of HBX Group',
    feeModel: 'Not applicable — no seller API found',
    freeToStart: false, access: 'No seller API exists. Seller route: via Hotelbeds transfers (same group) or a HolidayTaxis affiliate/partner programme — UNVERIFIED, needs direct contact',
    leadTime: 'Unverified', state: 'unavailable', mode: 'redirect', quickWin: false,
    notes: 'CORRECTION (ground-transport plan, Nov 12, 2026): Supplier Connect API is SUPPLY-SIDE — it lets transfer companies feed bookings INTO HolidayTaxis, not buy transfers. Do NOT build against it. Route transfers through Hotelbeds (already in the plan). Grab is know-how only, not a registry entry: no B2B/partner API was found, so Southeast Asia taxi guidance says "use Grab" in the know-how strings.',
  },
  // -- Activities ------------------------------------------------------------
  {
    id: 'viator', name: 'Viator (Tripadvisor)', categories: ['activities'],
    data: 'Largest tour/activity catalog; product search, merchandising',
    feeModel: '8% commission on completed bookings, 30-day cookie, paid after the experience',
    freeToStart: true, access: 'Basic Affiliate API: free, self-service (key from dashboard, Tools → Affiliate API). Full / Full + Booking (booking on our site, Viator as merchant of record): approval + certification',
    leadTime: 'Days (Basic); weeks (Full)', state: 'not_configured', mode: 'affiliate_link', quickWin: true,
    envVar: 'VIATOR_API_KEY', notes: 'Activities are the highest-margin category (20–30%). Basic now, Full as the upgrade. Sandbox: api.sandbox.viator.com.',
  },
  {
    id: 'getyourguide', name: 'GetYourGuide', categories: ['activities'],
    data: 'Tours, attractions, tickets; partner share up to ~8%',
    feeModel: 'Affiliate commission via dashboard (booking happens on GetYourGuide); Partner API tier gated by partner type, expected volume, use-case alignment; enterprise custom',
    freeToStart: true, access: 'Affiliate signup (1–4 weeks setup); Partner API by application',
    leadTime: '1–4 weeks (affiliate)', state: 'not_configured', mode: 'affiliate_link', quickWin: true,
  },
  {
    id: 'tiqets', name: 'Tiqets', categories: ['activities'],
    data: 'Museums + attraction tickets; 3,000+ venues; instant mobile tickets, real-time availability',
    feeModel: '~6–8% commission (Awin: 6% other sites), 30-day cookie, monthly Net-30 payout',
    freeToStart: true, access: 'Sign up → eligibility validation; tools include API, widgets, links. No visitor/order minimum',
    leadTime: 'Days', state: 'not_configured', mode: 'affiliate_link', quickWin: true,
    notes: 'Best for attraction tickets — complements Viator’s tours.',
  },
  {
    id: 'klook', name: 'Klook', categories: ['activities'],
    data: '530,000+ activities, 1,700+ destinations; APAC strength; also hotels, car rentals, transport passes, eSIM',
    feeModel: 'Affiliate 2–20% by category (tours 6.5%, attractions 5%, eSIM 20%); 30-day cookie (7 days hotels/cars); Partner API tier 5–12%',
    freeToStart: true, access: 'Affiliate signup (via Involve Asia ~2 working days, or direct); Partner API: application + certification, 2–4 weeks',
    leadTime: 'Days (affiliate); 2–4 weeks (Partner API)', state: 'not_configured', mode: 'affiliate_link', quickWin: true,
    notes: 'APAC activities depth Viator/GetYourGuide lack.',
  },
];

export function listSuppliers(category?: BookingCategory): SupplierConnector[] {
  return category ? SUPPLIERS.filter((s) => s.categories.includes(category)) : SUPPLIERS;
}

export function getSupplier(id: string): SupplierConnector | undefined {
  return SUPPLIERS.find((s) => s.id === id);
}

export function quickWins(): SupplierConnector[] {
  return SUPPLIERS.filter((s) => s.quickWin);
}

export function longApplications(): SupplierConnector[] {
  return SUPPLIERS.filter((s) => s.state === 'not_applied' && !s.quickWin);
}

/** Runtime state: env-keyed suppliers flip to test/not_configured by key presence. */
export function supplierStates(): Array<{ id: string; state: SupplierState; envVar?: string }> {
  return SUPPLIERS.map((s) => {
    if (!s.envVar) return { id: s.id, state: s.state, envVar: s.envVar };
    const key = process.env[s.envVar];
    if (!key) return { id: s.id, state: 'not_configured', envVar: s.envVar };
    if (s.id === 'duffel-flights' || s.id === 'duffel-cars' || s.id === 'duffel-stays') {
      return { id: s.id, state: key.includes('live') ? 'live' : 'test', envVar: s.envVar };
    }
    return { id: s.id, state: 'test', envVar: s.envVar };
  });
}

export function duffelMode(): 'live' | 'test' | 'none' {
  const key = process.env.DUFFEL_API_KEY;
  if (!key) return 'none';
  return key.includes('live') ? 'live' : 'test';
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type PassengerInput = {
  given_name: string;
  family_name: string;
  born_on: string; // YYYY-MM-DD
  gender: 'm' | 'f';
  email?: string;
  phone_number?: string;
  accompanying_adult?: number;
  identity_documents?: Array<{
    type: 'passport';
    unique_identifier: string;
    issuing_country_code: string;
    expires_on: string;
  }>;
  loyalty_programme_accounts?: Array<{ airline_iata_code: string; account_number: string }>;
};

export type FlightQuote = {
  mode: 'test' | 'live' | 'not_configured';
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  travelers: number;
  offers: Array<{
    offerId: string;
    airline: string;
    price: number;
    currency: string;
    stops: number;
    duration: string;
    fare: number;
    serviceFee: number;
    total: number;
  }>;
  label: string;
};

export type ValidationResult = {
  readyToBook: boolean;
  offerId: string;
  totalAmount?: number;
  totalCurrency?: string;
  requiredMissing: string[];
  invalid: string[];
  errors: string[];
  label: string;
};

export type OrderResult = {
  booked: boolean;
  testBooking: boolean;
  orderId?: string;
  bookingReference?: string;
  fare?: number;
  serviceFee?: number;
  total?: number;
  totalCurrency?: string;
  label: string;
  missingSteps?: string[];
};

// ---------------------------------------------------------------------------
// Duffel flights — search / validate / book (real API calls)
// ---------------------------------------------------------------------------

const DUFFEL_BASE = 'https://api.duffel.com';
const FETCH_TIMEOUT_MS = 15000;

type DuffelOfferRaw = {
  id?: string;
  total_amount?: string;
  total_currency?: string;
  slices?: Array<{ duration?: string; segments?: Array<{ operating_carrier?: { name?: string }; marketing_carrier?: { name?: string } }> }>;
};

function parseIsoDuration(iso: string | undefined): string {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return '';
  const h = m[1] ? `${Number(m[1])}h` : '';
  const min = m[2] ? ` ${Number(m[2])}m` : '';
  return `${h}${min}`.trim();
}

function duffelHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
  };
}

async function duffelFetch(
  apiKey: string,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${DUFFEL_BASE}${path}`, {
      method,
      headers: duffelHeaders(apiKey),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  } finally {
    clearTimeout(timeout);
  }
}

function toQuoteOffer(o: DuffelOfferRaw): FlightQuote['offers'][number] | null {
  if (!o.id || !o.total_amount || !o.slices?.length) return null;
  const slice = o.slices[0];
  const segments = slice.segments ?? [];
  const first = segments[0];
  const fare = Math.round(Number(o.total_amount));
  const fee = serviceFee(fare);
  return {
    offerId: o.id,
    airline: first?.operating_carrier?.name || first?.marketing_carrier?.name || 'See details',
    price: fare,
    currency: o.total_currency || 'USD',
    stops: Math.max(0, segments.length - 1),
    duration: parseIsoDuration(slice.duration),
    fare,
    serviceFee: fee,
    total: fare + fee,
  };
}

/** Live/test Duffel Offer Requests (one-way; call twice for a return). */
export async function searchFlightOffers(opts: {
  origin: string;
  destination: string;
  date: string;
  travelers: number;
}): Promise<FlightQuote> {
  const base: FlightQuote = {
    mode: 'not_configured',
    origin: opts.origin.toUpperCase(),
    destination: opts.destination.toUpperCase(),
    departDate: opts.date,
    travelers: opts.travelers,
    offers: [],
    label: 'Duffel is not configured — no live fares. Add DUFFEL_API_KEY to see fares.',
  };
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return base;
  const mode = duffelMode();
  const res = await duffelFetch(apiKey, '/air/offer_requests', 'POST', {
    data: {
      slices: [{ origin: base.origin, destination: base.destination, departure_date: opts.date }],
      passengers: Array.from({ length: opts.travelers }, () => ({ type: 'adult' })),
      cabin_class: 'economy',
    },
  });
  if (!res.ok) {
    const detail = (res.json.errors as Array<{ title?: string }> | undefined)?.[0];
    return {
      ...base,
      mode: mode === 'none' ? 'not_configured' : mode,
      label:
        res.status === 401
          ? 'Duffel rejected the API key — check DUFFEL_API_KEY in DigitalOcean (test keys start with test_).'
          : `Duffel lookup failed (${res.status || 'network'})${detail?.title ? `: ${detail.title}` : ''} — no live fares right now.`,
    };
  }
  const offers = (((res.json.data as Record<string, unknown> | undefined)?.offers as DuffelOfferRaw[] | undefined) ?? [])
    .map(toQuoteOffer)
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .sort((a, b) => a.price - b.price)
    .slice(0, 6);
  return {
    ...base,
    mode: mode === 'none' ? 'not_configured' : mode,
    offers,
    label:
      mode === 'live'
        ? `Live fares from Duffel — ${base.origin} → ${base.destination} · ${opts.date}. Prices before booking; confirm at checkout.`
        : 'Test fares from Duffel (test mode — not real market prices). Real bookable fares need Duffel live mode.',
  };
}

/** Refresh one offer's current price/terms before the final review. */
export async function getFlightOffer(offerId: string): Promise<{
  found: boolean;
  offer?: FlightQuote['offers'][number];
  label: string;
}> {
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return { found: false, label: 'Duffel is not configured.' };
  const res = await duffelFetch(apiKey, `/air/offers/${encodeURIComponent(offerId)}`, 'GET');
  if (!res.ok) return { found: false, label: `Could not refresh this offer (${res.status || 'network'}). Do not book it at the old price.` };
  const offer = toQuoteOffer((res.json.data as DuffelOfferRaw | undefined) ?? {});
  if (!offer) return { found: false, label: 'This offer is no longer available at Duffel. Pick a fresh fare.' };
  return { found: true, offer, label: 'Offer refreshed — price confirmed just now.' };
}

function duffelErrorMessages(json: Record<string, unknown>): string[] {
  const errors = json.errors as Array<{ title?: string; message?: string; code?: string }> | undefined;
  if (!errors?.length) return [];
  return errors.map((e) => [e.code, e.title, e.message].filter(Boolean).join(': '));
}

/**
 * Validate a flight booking without payment or approval.
 * Duffel validates an order creation request that omits `payments`:
 * a 422 lists the missing/invalid fields; a 2xx means the payload is
 * complete. If Duffel changes this behaviour the raw error titles are
 * surfaced (never hidden), so the mismatch is visible.
 */
export async function validateFlightBooking(opts: {
  offerId: string;
  passengers: PassengerInput[];
  /** Duffel service ids (seats/bags) resolved via seat-options / bag-options. */
  services?: string[];
}): Promise<ValidationResult> {
  const fail = (label: string, errors: string[] = []): ValidationResult => ({
    readyToBook: false, offerId: opts.offerId, requiredMissing: [], invalid: [], errors, label,
  });
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return fail('Duffel is not configured — nothing was validated.');
  if (!opts.passengers.length) return fail('Add at least one traveler before validating.');
  const res = await duffelFetch(apiKey, '/air/orders', 'POST', {
    data: {
      selected_offers: [opts.offerId],
      passengers: opts.passengers,
      ...(opts.services?.length ? { services: opts.services.map((id) => ({ id, quantity: 1 })) } : {}),
    },
  });
  if (res.ok) {
    const data = res.json.data as Record<string, unknown> | undefined;
    if (data?.id) {
      // Duffel returned an order object for a no-payment request: treat
      // it as created, never re-submit it.
      return {
        readyToBook: true,
        offerId: opts.offerId,
        totalAmount: data?.total_amount ? Math.round(Number(data.total_amount)) : undefined,
        totalCurrency: (data?.total_currency as string | undefined) || 'USD',
        requiredMissing: [],
        invalid: [],
        errors: [],
        label: `Duffel returned an order for this payload (order ${String(data.id)}). Treat it as created — do not submit again.`,
      };
    }
    return {
      readyToBook: true,
      offerId: opts.offerId,
      totalAmount: undefined,
      totalCurrency: 'USD',
      requiredMissing: [],
      invalid: [],
      errors: [],
      label: 'Validation passed — this booking is ready to book. (Order was validated, not created.)',
    };
  }
  const messages = duffelErrorMessages(res.json);
  const requiredMissing = messages.filter((m) => /required|missing/i.test(m));
  const invalid = messages.filter((m) => /invalid/i.test(m));
  return {
    readyToBook: false,
    offerId: opts.offerId,
    requiredMissing,
    invalid,
    errors: messages,
    label:
      res.status === 422
        ? 'Duffel needs more before this booking can go ahead — see requiredMissing / invalid.'
        : `Validation failed (${res.status || 'network'})${messages[0] ? `: ${messages[0]}` : ''}.`,
  };
}

/**
 * Create a Duffel flight order. GATED:
 * - Test mode: only with confirm:true, and the result is labeled
 *   test_booking:true (a test order, no real ticket, no real charge).
 * - Live mode: refuses unless DUFFEL_LIVE_BOOKING_ENABLED=true AND
 *   STRIPE_SECRET_KEY is set — live payment goes through Link by Stripe
 *   virtual card (per the Duffel connector doc), which this route does
 *   not handle on its own. The refusal names the missing step.
 */
export async function createFlightOrder(opts: {
  offerId: string;
  passengers: PassengerInput[];
  confirm: boolean;
}): Promise<OrderResult> {
  const mode = duffelMode();
  if (mode === 'none') {
    return { booked: false, testBooking: false, label: 'Duffel is not configured — nothing was booked.', missingSteps: ['Set DUFFEL_API_KEY.'] };
  }
  if (!opts.confirm) {
    return { booked: false, testBooking: false, label: 'Booking not confirmed — pass confirm:true after the traveler approves the exact total and terms.' };
  }
  if (mode === 'live') {
    const missing: string[] = [];
    if (process.env.DUFFEL_LIVE_BOOKING_ENABLED !== 'true') missing.push('Set DUFFEL_LIVE_BOOKING_ENABLED=true after Duffel live certification.');
    if (!process.env.STRIPE_SECRET_KEY) missing.push('Connect Stripe (STRIPE_SECRET_KEY) — live Duffel bookings pay via Link by Stripe.');
    return {
      booked: false, testBooking: false,
      label: 'Live flight booking is not enabled yet — no booking was created and nothing was charged.',
      missingSteps: missing,
    };
  }
  const apiKey = process.env.DUFFEL_API_KEY!;
  // Test mode: Duffel accepts a balance payment against the test balance.
  // First refresh the offer so the fare we pay is the current one.
  // NOTE: Duffel is paid the FARE only. Our service fee is charged
  // separately through Stripe merchant checkout — never through Duffel.
  const refreshed = await getFlightOffer(opts.offerId);
  if (!refreshed.found || !refreshed.offer) {
    return { booked: false, testBooking: true, label: refreshed.label };
  }
  const fare = refreshed.offer.fare;
  const fee = refreshed.offer.serviceFee;
  const res = await duffelFetch(apiKey, '/air/orders', 'POST', {
    data: {
      selected_offers: [opts.offerId],
      passengers: opts.passengers,
      payments: [{ type: 'balance', amount: String(fare), currency: refreshed.offer.currency }],
    },
  });
  if (!res.ok) {
    const messages = duffelErrorMessages(res.json);
    return {
      booked: false, testBooking: true,
      label: `Test order was NOT created (${res.status || 'network'})${messages[0] ? `: ${messages[0]}` : ''}. Check whether an order exists before retrying.`,
    };
  }
  const data = res.json.data as Record<string, unknown> | undefined;
  return {
    booked: true,
    testBooking: true,
    orderId: data?.id as string | undefined,
    bookingReference: data?.booking_reference as string | undefined,
    fare,
    serviceFee: fee,
    total: fare + fee,
    totalCurrency: (data?.total_currency as string | undefined) || refreshed.offer.currency,
    label: 'TEST booking created in Duffel test mode — no real ticket, no real charge. Fare paid to Duffel; our service fee is settled separately at checkout. Do not present this as a real booking.',
  };
}

// ---------------------------------------------------------------------------
// Travelpayouts — cached comparison fares (Data API)
// ---------------------------------------------------------------------------

export type CachedFare = {
  price: number;
  currency: string;
  airline?: string;
  departDate?: string;
  returnDate?: string;
  stops?: number;
  returnStops?: number;
  durationMinutes?: number;
  link?: string;
  expiresAt?: string;
};

/**
 * Cached fares for the "our rates vs competitors" column.
 * Returns live:false data with the label "cached" — never a live quote.
 * Endpoint: GET api.travelpayouts.com/aviasales/v3/prices_for_dates
 * (token via X-Access-Token header, server-side only; token query param
 * is also accepted by the API but hit 502s in third-party testing, so
 * the header is the only auth used here).
 *
 * Verified Nov 12, 2026 against the official Aviasales Data API docs:
 * - Auth: X-Access-Token header, token from Profile → API token
 *   (free, auto-generated at signup).
 * - Params: origin/destination are IATA city codes; departure_at and
 *   return_at accept YYYY-MM or YYYY-MM-DD; one_way defaults true —
 *   pass one_way=false with a return_at to get round-trip offers, whose
 *   price is the round-trip fare for ONE traveler.
 * - `currency` is the documented currency param (the docs' example URL
 *   also shows `cy` — both are sent, the API ignores the unknown one).
 * - `market=us`: the cache is per-market and defaults to ru; partners
 *   in America should ask for the US market.
 * - Freshness: cheapest tickets found by Aviasales users in the last
 *   48h; the cache is stored up to 7 days. The docs recommend caching
 *   results onsite for 24h.
 * - Rate limit: 600 req/min for /v3/prices_for_dates (429 if exceeded).
 */
export async function fetchCachedFares(opts: {
  origin: string;
  destination: string;
  month: string; // YYYY-MM (kept for the checkout caller)
  departDate?: string; // YYYY-MM-DD — exact trip start, preferred
  returnDate?: string; // YYYY-MM-DD — exact trip end; implies round-trip
  oneWay?: boolean; // default: round-trip when returnDate is given
  market?: string;
  currency?: string;
}): Promise<{ configured: boolean; ok: boolean; fares: CachedFare[]; label: string; checkedAt: string }> {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  const checkedAt = new Date().toISOString().slice(0, 10);
  if (!token) {
    return { configured: false, ok: false, fares: [], label: 'Travelpayouts is not configured — no cached comparison fares. Add TRAVELPAYOUTS_TOKEN (free) to enable them.', checkedAt };
  }
  const departureAt = opts.departDate || opts.month;
  const roundTrip = opts.returnDate ? opts.oneWay !== true : false;
  const params = new URLSearchParams({
    origin: opts.origin.toUpperCase(),
    destination: opts.destination.toUpperCase(),
    departure_at: departureAt,
    ...(opts.returnDate ? { return_at: opts.returnDate } : {}),
    ...(roundTrip ? { one_way: 'false' } : {}),
    market: opts.market || 'us',
    currency: opts.currency || 'USD',
    cy: opts.currency || 'usd',
    sorting: 'price',
    limit: '5',
  });
  try {
    const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`, {
      headers: { 'X-Access-Token': token },
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Array<Record<string, unknown>> };
    if (!res.ok) return { configured: true, ok: false, fares: [], label: `Travelpayouts lookup failed (${res.status}) — no cached fares right now.`, checkedAt };
    const fares: CachedFare[] = (json.data ?? []).map((d) => ({
      price: Math.round(Number(d.price ?? 0)),
      currency: (d.currency as string | undefined) || opts.currency || 'USD',
      airline: d.airline as string | undefined,
      departDate: d.departure_at as string | undefined,
      returnDate: d.return_at as string | undefined,
      stops: typeof d.transfers === 'number' ? d.transfers : undefined,
      returnStops: typeof d.return_transfers === 'number' ? d.return_transfers : undefined,
      durationMinutes: typeof d.duration === 'number' ? d.duration : undefined,
      link: typeof d.link === 'string' ? d.link : undefined,
      expiresAt: typeof d.expires_at === 'string' ? d.expires_at : undefined,
    })).filter((f) => f.price > 0);
    return {
      configured: true,
      ok: true,
      fares,
      label: `Cached prices (Travelpayouts/Aviasales — cheapest tickets found in the last 48h, cache kept up to 7 days), checked ${checkedAt}. Indicative only — not a live quote.`,
      checkedAt,
    };
  } catch {
    return { configured: true, ok: false, fares: [], label: 'Could not reach Travelpayouts right now — no cached fares.', checkedAt };
  }
}

// ---------------------------------------------------------------------------
// Cars (Duffel) — stub: the REST shape for car search/quote/book is not
// verified in the app's docs, so this adapter refuses honestly instead of
// guessing an endpoint. The Duffel CLI covers it operationally:
//   duffel car-search / car-quote / car-book (pay-at-pickup only).
// ---------------------------------------------------------------------------

export function carRentalState(): { configured: boolean; label: string } {
  const mode = duffelMode();
  if (mode === 'none') return { configured: false, label: 'Duffel is not configured — no car rental search yet.' };
  return {
    configured: true,
    label:
      mode === 'live'
        ? 'Car rental via Duffel: only pay-at-pickup quotes can be reserved; guarantee/prepaid go to the supplier’s site.'
        : 'Car rental via Duffel (test mode): only pay-at-pickup quotes can be reserved. REST booking endpoint not yet wired — use the Duffel CLI car commands.',
  };
}

/** The $1 plan-PDF rule, in one place: free when booked with us, $1 when not. */
export function planPdfPrice(bookedWithUs: boolean): { amountCents: number; label: string } {
  return bookedWithUs
    ? { amountCents: 0, label: 'Free — you booked this trip with FujinTrip.' }
    : { amountCents: 100, label: '$1 — free when you book this trip with FujinTrip.' };
}
