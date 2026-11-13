'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, LOCAL_TRIPS, TABS, type Tab } from '../lib/data';
import { discoveryDestinations, discoveryPriceLabel, routeLineFor, type DiscoveryEntry } from '../lib/discovery';
import { askFujin, applyRevision, buildPlan, comparisonFor, distributeNights, distributeNightsForStops, fareClassForTier, findMonth, findOrigin, findOriginAnswer, MONTH_NAMES, optionsLine, parseDuration, parseKidAges, passengerTotals, routeKeyForDestination, ROUTE_STOPS, soloLine, stopsForRoute, type Plan, type Revision, type RouteOverride } from '../lib/planner';
import { settleUp, settlementLine, type Expense } from '../lib/settle';
import { applySwaps, type DaySwap } from '../lib/daySwap';
import { goNowLine } from '../lib/disruption';
import { bestTimeFor, type BestTime } from '../lib/bestTime';
import { buildTripCard, cardComparison, CITY_INFO, suggestedStart, type TripCard, type TripLeg } from '../lib/tripCard';
import { categoryCounts, filterByCategory, type PackageFilter, type TripCategory } from '../lib/tripCategories';
import { bundleFromLegs, bundleTotal, bundleLine, bundleLockedUntil, bundleKey } from '../lib/bundle';
import { appendObservation, parseLiveFares, trendLine, type LiveFares, type TrendObservation } from '../lib/duffel';
import type { CompetitorFares } from '../lib/travelpayouts';
import type { TonightResult } from '../lib/food';
import { visaForDestination, VISA_LAST_CHECKED, VISA_PASSPORT_NOTE, type VisaInfo } from '../lib/visa';
import { checkPassportValidity, isSchengenCountry, parsePassportExpiry, parsePassportExpiryValue, passportWarningLine, schengenRemaining, type PassportCheck } from '../lib/passport';
import { DIETARY_OPTIONS, mergeProfile, parsePreferenceSignals, parseProfile, profileLine, profileSummary, type Dietary, type TravelerProfile } from '../lib/preferences';
import { paceFromProfile } from '../lib/pace';
import { interfaceState } from '../lib/interface';
import { useTheme } from '../lib/theme';
import { buildChecklist, checklistKeyFor, type ChecklistItem } from '../lib/checklist';
import { parseDepartureTime, parseHHMM, parseLandingTime } from '../lib/arrival';
import { auditTrip, checkConnection, departureDayFlags, feasibilitySummary } from '../lib/feasibility';
import { checkInKeyFor, checkInMissed, parseCheckIn, type CheckIn } from '../lib/emergency';
import Checklist from '../components/Checklist';
import { guideFor } from '../lib/localGuides';
import AdSlot from '../components/AdSlot';
import Expandable from '../components/Expandable';
import PhotoCarousel from '../components/PhotoCarousel';
import KnowHowBlock from '../components/KnowHow';
import TripPanel, { type PanelStopEdit } from '../components/TripPanel';
import OfflineBanner from '../components/OfflineBanner';
import TodayView from '../components/TodayView';
import EmergencySheet, { SosButton } from '../components/EmergencySheet';
import ReelsFeed from '../components/ReelsFeed';
import ReelsStrip from '../components/ReelsStrip';
import ReelComposer from '../components/ReelComposer';

// Trip map (Leaflet) is client-only — it needs window, so it loads
// without server rendering. While the chunk loads, a map-shaped skeleton
// with a shimmer shows instead of a blank area (design #9 — calmer
// loading; never a full-page spinner).
const TripMap = dynamic(() => import('../components/TripMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
      <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Loading the map…</p>
    </div>
  ),
});

// Discovery map (design #15) — same client-only pattern as the trip map.
const DiscoveryMap = dynamic(() => import('../components/DiscoveryMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the discovery map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
      <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Loading the map…</p>
    </div>
  ),
});

type Trip = { id: string; label: string; status: string; date: string; destination?: string };
// The shape of a parsed server reply (streamed `done` result or atomic
// JSON) — shared by the streaming path and the atomic fallback path.
type ServerParsed = { destination: string; travelers: number; reply: string; missing: string[]; tips?: string[]; kids?: number[]; routeOverride?: RouteOverride; tier?: number };

// Whole-trip price check (competitor learning #4, Mindtrip / Kayak):
// the /api/price-check response, and a price watch. A watch measures a
// DROP against the live fare when the watch started (the baseline) —
// never against the planner estimate, which is static and never moves.
type PriceCheckOffer = { airline: string; price: number; currency: string; stops: number; duration: string };
type PriceCheckData = {
  live: boolean;
  reason?: string;
  origin: string;
  destination: string;
  destCity: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  out: PriceCheckOffer[];
  back: PriceCheckOffer[];
  liveTotal: number;
  plannerFlight: number;
  diff: number;
  verdict: 'under' | 'over' | 'same' | 'no_fare';
  line: string;
  // The trend read of the watch's own past checks (round 2 #3) — a
  // humble sentence with a low/medium confidence, or an empty line when
  // there are fewer than 2 observations to read.
  trend?: { confidence: 'none' | 'low' | 'medium'; line: string };
};
type PriceWatch = {
  id: string;
  destination: string;
  travelers: number;
  origin: string;
  month: number;
  durationDays: number;
  // Live out+back total when the watch started (null = no live fare
  // yet — the watch waits for one instead of inventing a baseline).
  baseline: number | null;
  baselineAt: string;
  lastTotal: number | null;
  lastCheckedAt: string | null;
  // The watch's own past checks (round 2 #3): one live out+back total
  // per check date, baseline first. The trend is read from these —
  // never from a forecast, never from the planner estimate.
  history: TrendObservation[];
};
type Voices = { destination: string; text: string; source: string } | null;
// On-trip flight status (competitor learning #5, TripIt Pro / Romie /
// Layla): the /api/flight-status response. live:false is the honest
// answer when the CLI is not on the server or the flight isn't found.
type FlightStatusData = {
  live: boolean;
  reason?: string;
  message?: string;
  flight?: string;
  date?: string;
  status?: string;
  cancellationConfirmed?: boolean;
  cancellationUnconfirmed?: boolean;
  cancellationNote?: string;
  delayedMinutes?: number;
  diverted?: boolean;
  origin?: { iata: string; city: string; name: string };
  destination?: { iata: string; city: string; name: string };
  scheduledDeparture?: string | null;
  estimatedDeparture?: string | null;
  actualDeparture?: string | null;
  scheduledArrival?: string | null;
  estimatedArrival?: string | null;
  actualArrival?: string | null;
  gateOrigin?: string | null;
  gateDestination?: string | null;
  terminalOrigin?: string | null;
  terminalDestination?: string | null;
  baggageClaim?: string | null;
};
// Local copy of the Ogata Korin Wind God (public domain) — the Wikimedia
// Commons URL this used to point at 404s (the file is not on Commons under
// that name), so the portrait never loaded. Served locally now; credit stays
// in the footer.
const FUJIN_IMG = '/images/fujin-wind-god.jpg';

// Image with a graceful fallback: a failed image never shows a broken
// icon — it becomes a soft gray placeholder with the destination name.
// While it loads, a warm shimmer tile with the name shows instead of a
// blank space (design #9 — the loaded-error state is the fallback; this
// is the loading state).
function SafeImg({ src, alt, label, className }: { src: string; alt: string; label: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) {
    return (
      <div className={`img-fallback ${className ?? ''}`} role="img" aria-label={alt}>
        <span>{label}</span>
      </div>
    );
  }
  return (
    <>
      {!loaded && (
        <div className={`img-loading skeleton ${className ?? ''}`} role="img" aria-label={alt}>
          <span>{label}</span>
        </div>
      )}
      <img src={src} alt={alt} loading="lazy" className={className} style={loaded ? undefined : { display: 'none' }} onError={() => setFailed(true)} onLoad={() => setLoaded(true)} />
    </>
  );
}

// Render an AI reply as readable formatted text. The model writes
// markdown (bold, bullets, headings), and a plain-text bubble shows it as
// a wall of asterisks (Nov 11 review: a Europe plan was unreadable).
// Small safe renderer — no HTML parsing, React escapes all text, so no
// injection risk. User messages stay plain text.
function inlineMd(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={`${keyPrefix}-${i}`}>{p.slice(1, -1)}</em>;
    return <span key={`${keyPrefix}-${i}`}>{p}</span>;
  });
}

function formatReply(text: string): ReactNode {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    out.push(
      <ul key={`ul-${out.length}`} style={{ margin: '6px 0', paddingLeft: 18 }}>
        {items.map((b, i) => (
          <li key={i}>{inlineMd(b, `b${out.length}-${i}`)}</li>
        ))}
      </ul>
    );
  };
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBullets();
      return;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    const heading = trimmed.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      flushBullets();
      out.push(
        <p key={i} style={{ margin: '8px 0 4px', fontWeight: 700 }}>
          {inlineMd(heading[1], `h${i}`)}
        </p>
      );
      return;
    }
    flushBullets();
    out.push(
      <p key={i} style={{ margin: '4px 0' }}>
        {inlineMd(trimmed, `p${i}`)}
      </p>
    );
  });
  flushBullets();
  return <>{out}</>;
}

function Chat({ onParsed, onSaveTrip, onWatchPrices, bookedDestinations, watches, seed, onSeedUsed, onShareReel, trips, profile, onProfileChange, emergencyContact, embassyNumber, onEmbassyChange }: { onParsed?: (t: { destination: string; travelers: number; kids?: number[] }) => void; onSaveTrip: (label: string, status: string, destination?: string) => void; onWatchPrices: (w: Omit<PriceWatch, 'id' | 'baselineAt' | 'lastCheckedAt'>) => void; bookedDestinations: string[]; watches: PriceWatch[]; seed?: { destination: string; cities: string[] } | null; onSeedUsed?: () => void; onShareReel?: (destination: string) => void; trips: Trip[]; profile: TravelerProfile; onProfileChange: (p: TravelerProfile) => void; emergencyContact: { name: string; phone: string }; embassyNumber: string; onEmbassyChange: (v: string) => void }) {
  // The opening line — also the line a "New trip" resets to, so the
  // trip switcher and the plan view's "Start a new trip" restart the
  // conversation in exactly the same words.
  const GREETING = 'Hi, I’m Fujin AI. Tell me where you want to go, for how many people — I’ll gather flights, hotels, cars and sightseeing into one plan, in Cheapest / Best value / Premium.';
  const [msgs, setMsgs] = useState<{ who: string; text: string; tips?: string[] }[]>([{ who: 'ai', text: GREETING }]);
  const [input, setInput] = useState('');
  // Chips fill, don't fire (Layla-dynamic round): a chip puts its full
  // prompt in this input and focuses it, so the traveler can edit
  // before sending — Layla's chips behave the same way. Sending still
  // happens only via Send/Enter (or the "Build my plan" chip action).
  const inputRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState(1);
  const [lastParsed, setLastParsed] = useState<{ destination: string; travelers: number; origin?: string; month?: number; durationDays?: number; routeKey?: string; kids?: number[]; routeOverride?: RouteOverride; sourceTips?: Record<string, string>; passportExpiry?: { month: number; year: number }; landingTime?: string; departureTime?: string } | null>(null);
  const [aiLive, setAiLive] = useState<boolean | null>(null);
  // Typing indicator + streaming (design #2): the send is followed by
  // ~3.4s of silence today. The indicator shows within 200ms of Send;
  // after 5s with no first chunk it escalates to a status line. While the
  // reply streams, the Send button becomes a Stop button (AbortController)
  // and the partial text is kept if the traveler stops it.
  const [thinking, setThinking] = useState<'thinking' | 'searching' | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Preference profile (round 3 #2): the "Using what you told me last
  // time…" line, captured BEFORE this message's own signals are merged
  // — a trip that starts with "direct flights please" should not
  // announce the preference the traveler just stated as if it were
  // from last time. Set in send(), read once in handleParsed.
  const profileLineRef = useRef('');
  const stopThinking = () => {
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = null;
    setThinking(null);
    setStreamingText(null);
  };
  // Fresh traveler material fetched live for the last chat destination
  // (route returns it as `voices`) — feeds the "What travelers say" block.
  const [voices, setVoices] = useState<Voices>(null);
  // Per-city voices (round 3 #1): one voices block per stop city, in
  // route order — the plan view renders these under "What travelers
  // say" instead of one generic region blob.
  type CityVoicesState = { city: string; text: string; source: string }[];
  const [cityVoices, setCityVoices] = useState<CityVoicesState>([]);
  // Live Duffel fares for the current trip (route returns them as
  // `liveFares`) — the trip card and the map show these same fares, so
  // the chat, the card and the map never quote different flight prices.
  // Null means no live fares: the card falls back to the planner
  // estimate. Validated by parseLiveFares; the card itself also checks
  // the fares match its own trip (travelers, origin, first city, dates).
  const [liveFares, setLiveFares] = useState<LiveFares | null>(null);
  // On-trip mode: the traveler is already at the destination and wants
  // short, right-now local answers. WhatsApp delivery is a later step
  // (needs a business number) — this mode works in the chat today.
  const [tripMode, setTripMode] = useState(false);
  // App shell (Nov 12): which zone the traveler sees on a narrow
  // screen — side by side above 1200px, one zone at a time below it.
  // 'chat' is the default; a seeded template opens in the chat.
  const [mobileZone, setMobileZone] = useState<'chat' | 'trip' | 'map'>('chat');
  // "My Trips" menu in the app bar, and the trip panel's refusal line
  // (an impossible edit explains itself in the panel — the chat only
  // records edits that actually happened).
  const [tripsOpen, setTripsOpen] = useState(false);
  const [panelNotice, setPanelNotice] = useState('');
  // Theme (interface round §6): light by default, dark by preference —
  // never forced. The pre-paint script in layout.tsx sets the first
  // value; this hook keeps the toggle and the maps in sync with it.
  const [theme, setTheme] = useTheme();
  // Interface state (interface round §2/§5): S0 no trip, S1 destination
  // known, S2 plan built. The zones gate on it — nothing renders before
  // its data exists (M1). hasUserMsg (declared with the chips below)
  // gates the dietary row off the first paint (M4): the S0 screen is
  // the greeting, the input, 3 chips and one quiet link — nothing else.
  const uiState = interfaceState({ lastParsed, plan });
  // A mobile zone that no longer exists (Trip without a plan, or any
  // zone at S0) resets to the chat — a zone button must never point
  // at nothing.
  useEffect(() => {
    if (uiState === 'S0' && mobileZone !== 'chat') setMobileZone('chat');
    if (uiState === 'S1' && mobileZone === 'trip') setMobileZone('chat');
  }, [uiState, mobileZone]);
  // On-trip flight check (competitor learning #5): flight number/date
  // the traveler typed, and the last checked status ('loading' while it
  // runs). A live status rides with the "my flight was cancelled"
  // message so the AI quotes a confirmed status, never a guess.
  const [flightNo, setFlightNo] = useState('');
  const [flightDate, setFlightDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [flightStatus, setFlightStatus] = useState<FlightStatusData | 'loading' | null>(null);
  const checkFlight = async () => {
    const ident = flightNo.trim().toUpperCase().replace(/\s+/g, '');
    if (!ident || !flightDate) return;
    setFlightStatus('loading');
    try {
      const r = await fetch('/api/flight-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flight: ident, date: flightDate }),
      });
      const j = (await r.json()) as FlightStatusData;
      setFlightStatus(j);
    } catch {
      setFlightStatus({
        live: false,
        reason: 'error',
        flight: ident,
        date: flightDate,
        message: `Live flight status couldn't be reached — check ${ident} on ${flightDate} on your airline's flight status page.`,
      });
    }
  };
  // "My flight was cancelled" — sends the disruption report with the
  // checked status attached when there is one, so the AI can list
  // rebooking options (the live fares) instead of inventing them.
  const reportCancellation = () => {
    const ident = flightNo.trim().toUpperCase().replace(/\s+/g, '');
    const checked = flightStatus && flightStatus !== 'loading' && flightStatus.live ? flightStatus : null;
    const statusLine = checked
      ? ` (checked status: ${checked.status ?? ''}${checked.cancellationConfirmed ? ', cancellation confirmed' : ''}${checked.cancellationUnconfirmed ? ', cancellation NOT confirmed' : ''}${checked.estimatedDeparture ? `, now due ${new Date(checked.estimatedDeparture).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''})`
      : '';
    void send(`My flight${ident ? ` ${ident}` : ''} was cancelled${statusLine} — what are my options?`, checked);
  };
  // "Tonight near you" (competitor learning round 2 #4): the city the
  // traveler is in is the route's first city (the trip's starting
  // point); the 3 places open now come from /api/food on demand.
  const foodCity = lastParsed ? (routeKeyForDestination(lastParsed.destination) ? ROUTE_STOPS[routeKeyForDestination(lastParsed.destination)][0].city : lastParsed.destination) : '';
  const [tonight, setTonight] = useState<TonightResult | 'loading' | null>(null);
  const fetchTonightPlaces = async () => {
    if (!foodCity) return;
    setTonight('loading');
    try {
      const r = await fetch('/api/food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: foodCity }),
      });
      const j = (await r.json()) as TonightResult;
      setTonight(j);
    } catch {
      setTonight({ city: foodCity, tz: null, places: [], checkedAt: new Date().toISOString() });
    }
  };
  // Start Anywhere (competitor learning round 2 #6, Mindtrip): paste a
  // link to a travel article, or paste the text of one, and the trip is
  // drafted from the places it names. A link the server cannot read
  // (PDF, image, dead link) returns the honest reason — the trip is
  // never invented from an unreadable input. Screenshots cannot be
  // pasted here; the box says so.
  const [linkInput, setLinkInput] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const startFromLink = async () => {
    const raw = linkInput.trim();
    if (!raw || linkBusy) return;
    setLinkBusy(true);
    const isUrl = /^https?:\/\//i.test(raw);
    setMsgs((m) => [...m, { who: 'user', text: isUrl ? `Start from this link: ${raw}` : `Start from this text: ${raw.length > 120 ? `${raw.slice(0, 120)}…` : raw}` }]);
    try {
      const r = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: raw } : { text: raw }),
      });
      const j = (await r.json()) as { destination?: string; cities?: string[]; stops?: { city: string; tip: string }[]; note?: string };
      if (!j.destination || !j.cities?.length) {
        setMsgs((m) => [...m, { who: 'ai', text: j.note ?? 'I couldn’t find any places I know in that link or text — try a link to a travel article, or paste text naming the cities (for example Kyoto, Bangkok, Lisbon).' }]);
        return;
      }
      const cities = j.cities.slice(0, 8);
      const sourceTips: Record<string, string> = {};
      for (const s of j.stops ?? []) if (s.city && s.tip) sourceTips[s.city] = s.tip;
      setPlan(null);
      setChosenLegs(new Set());
      setSelectedLeg(null);
      setExpenses([]);
      setWeatherCheck(null);
      setLastParsed({
        destination: j.destination,
        travelers: lastParsed?.travelers ?? 2,
        ...(lastParsed?.origin ? { origin: lastParsed.origin } : {}),
        ...(lastParsed?.month ? { month: lastParsed.month } : {}),
        ...(lastParsed?.durationDays ? { durationDays: lastParsed.durationDays } : {}),
        ...(routeKeyForDestination(j.destination) ? { routeKey: routeKeyForDestination(j.destination) } : {}),
        ...(lastParsed?.kids?.length ? { kids: lastParsed.kids } : {}),
        routeOverride: { cities },
        sourceTips,
      });
      onParsed?.({ destination: j.destination, travelers: lastParsed?.travelers ?? 2, ...(lastParsed?.kids?.length ? { kids: lastParsed.kids } : {}) });
      const days = lastParsed?.durationDays ? ` for ${lastParsed.durationDays} days` : '';
      setMsgs((m) => [...m, { who: 'ai', text: `Started from your link — ${j.destination}${days}: ${cities.join(' → ')}. I kept the notes from your link on each stop. Tap Build my plan to see prices and the day-by-day.` }]);
      setLinkInput('');
    } catch {
      setMsgs((m) => [...m, { who: 'ai', text: 'I couldn’t load that link right now — check it and try again, or paste the text of the article instead.' }]);
    } finally {
      setLinkBusy(false);
    }
  };
  // "Leave now" hint for a flight that is still on the ground and
  // departs within 4 hours — general advice, not a per-flight fact.
  // The clock math lives in lib/disruption's goNowLine (round 2 #9);
  // this keeps the guards (live status, not cancelled, not departed).
  const leaveNow = (s: FlightStatusData): string | null => {
    if (!s.live || s.cancellationConfirmed || s.actualDeparture || !s.estimatedDeparture) return null;
    return goNowLine(s.estimatedDeparture);
  };
  // "Plan this trip" from a destination card (design #13): the card's
  // route becomes the trip — the destination, the ordered cities as a
  // route override, 2 travelers — and the chat asks the next question
  // (when, how long) instead of re-proposing a route. The seed fires
  // once per distinct card tap.
  const seedKeyRef = useRef('');
  useEffect(() => {
    if (!seed) return;
    const key = JSON.stringify(seed);
    if (seedKeyRef.current === key) return;
    seedKeyRef.current = key;
    const cities = seed.cities.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()).slice(0, 8);
    if (!cities.length) return;
    setPlan(null);
    setChosenLegs(new Set());
    setSelectedLeg(null);
    setExpenses([]);
    setWeatherCheck(null);
    setLastParsed({
      destination: seed.destination,
      travelers: 2,
      ...(routeKeyForDestination(seed.destination) ? { routeKey: routeKeyForDestination(seed.destination) } : {}),
      routeOverride: { cities },
    });
    // A seeded template opens in the chat — on a narrow screen the
    // chat is the zone the traveler needs to personalize it.
    setMobileZone('chat');
    onParsed?.({ destination: seed.destination, travelers: 2 });
    setMsgs((m) => [...m, { who: 'ai', text: `Let's plan ${seed.destination}: ${cities.join(' → ')} — for 2 travelers. When are you going, and for how long?` }]);
    onSeedUsed?.();
    // Run on the seed only — onParsed/onSeedUsed are Home's stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  // "Make it yours" (app shell): a template button below the fold asks
  // for the chat input to take focus, so the traveler can start
  // personalizing the seeded trip right away. A window event keeps the
  // template (Home) from reaching into the chat's refs.
  useEffect(() => {
    const onFocusChat = () => inputRef.current?.focus();
    window.addEventListener('fujintrip:focus-chat', onFocusChat);
    return () => window.removeEventListener('fujintrip:focus-chat', onFocusChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Confirmation line for the plan actions below (share / watch / hold / human).
  const [actionMsg, setActionMsg] = useState('');
  // Dietary slot at intake (round 3 #3): the row under the chips, and
  // its one-line confirmation — cleared on the next sent message.
  const [dietaryDismissed, setDietaryDismissed] = useState(false);
  const [dietaryNote, setDietaryNote] = useState('');
  // The dietary row shows at most 4 options + a "More" chip — 6 options
  // + a dismiss button is a row of its own, and the first screen has
  // no room for a second row of chips (M4).
  const [dietaryMore, setDietaryMore] = useState(false);
  // "Prefer forms?" (interface round M2): the 8-tab bar is gone — the
  // chat is the way in, and the search forms live behind one quiet
  // disclosure under the input. Same SearchForm the tabs used to show,
  // with a category select in place of the tab.
  const [formsOpen, setFormsOpen] = useState(false);
  const [formTab, setFormTab] = useState<Tab>('Flights');
  // PDF download state: the $1 rule is decided by the server route.
  const [pdfNotice, setPdfNotice] = useState('');
  const [pdfPay, setPdfPay] = useState(false);
  // Options stay in memory: the in-progress trip and built plan survive a
  // reload (localStorage) until the traveler requests the plan or starts
  // a new trip. Restored once on mount; writes wait until restore is done
  // so the mount-time nulls don't wipe the saved values.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const t = localStorage.getItem('fujintrip-current-trip');
      if (t) {
        const p = JSON.parse(t) as { destination?: unknown; travelers?: unknown; origin?: unknown; month?: unknown; durationDays?: unknown; routeKey?: unknown; kids?: unknown; routeOverride?: unknown; sourceTips?: unknown; passportExpiry?: unknown; landingTime?: unknown; departureTime?: unknown };
        if (typeof p.destination === 'string' && typeof p.travelers === 'number') {
          // Restore the revised route (if any) — same validation as the
          // server reply, so a stale or corrupt value never breaks the page.
          const restoredOverride: RouteOverride | undefined = (() => {
            const o = p.routeOverride as { cities?: unknown; weights?: unknown } | undefined;
            if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.cities)) return undefined;
            const cities = (o.cities as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 8);
            if (!cities.length) return undefined;
            let weights: Record<string, number> | undefined;
            if (o.weights && typeof o.weights === 'object' && !Array.isArray(o.weights)) {
              const w = Object.fromEntries(
                Object.entries(o.weights as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number')
              );
              if (Object.keys(w).length) weights = w;
            }
            return { cities, ...(weights ? { weights } : {}) };
          })();
          // Restore the source tips (Start Anywhere, round 2 #6) —
          // same validation as the server reply: string values only.
          const restoredSourceTips: Record<string, string> | undefined = (() => {
            if (!p.sourceTips || typeof p.sourceTips !== 'object' || Array.isArray(p.sourceTips)) return undefined;
            const tips = Object.fromEntries(
              Object.entries(p.sourceTips as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string')
            );
            return Object.keys(tips).length ? tips : undefined;
          })();
          // Restore the passport expiry (round 3 #5) — month/year only,
          // validated; a corrupt or foreign value is dropped.
          const restoredExpiry = parsePassportExpiryValue(p.passportExpiry);
          // Restore the landing / departure times (round 4 #3) — 'HH:MM'
          // only, validated the same way.
          const restoredLanding = parseHHMM(p.landingTime);
          const restoredDeparture = parseHHMM(p.departureTime);
          setLastParsed({
            destination: p.destination,
            travelers: p.travelers,
            ...(typeof p.origin === 'string' && p.origin ? { origin: p.origin } : {}),
            ...(typeof p.month === 'number' ? { month: p.month } : {}),
            ...(typeof p.durationDays === 'number' ? { durationDays: p.durationDays } : {}),
            ...(typeof p.routeKey === 'string' && p.routeKey ? { routeKey: p.routeKey } : {}),
            ...(Array.isArray(p.kids) ? { kids: p.kids.filter((k): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6) } : {}),
            ...(restoredOverride ? { routeOverride: restoredOverride } : {}),
            ...(restoredSourceTips ? { sourceTips: restoredSourceTips } : {}),
            ...(restoredExpiry ? { passportExpiry: restoredExpiry } : {}),
            ...(restoredLanding ? { landingTime: restoredLanding } : {}),
            ...(restoredDeparture ? { departureTime: restoredDeparture } : {}),
          });
          onParsed?.({ destination: p.destination, travelers: p.travelers });
          // Restore the bundle (round 2 #7): only when the saved bundle
          // is for THIS trip (same destination, travelers, length) — a
          // bundle from another trip never restores onto this one.
          try {
            const b = localStorage.getItem('fujintrip-bundle');
            if (b) {
              const saved = JSON.parse(b) as { key?: unknown; ids?: unknown };
              const tripKey = bundleKey(p.destination, p.travelers, typeof p.durationDays === 'number' ? p.durationDays : 0);
              if (saved && saved.key === tripKey && Array.isArray(saved.ids)) {
                const ids = saved.ids.filter((i): i is string => typeof i === 'string').slice(0, 12);
                if (ids.length) setChosenLegs(new Set(ids));
              }
            }
          } catch {}
          // Restore the recorded expenses (round 2 #8): only for this
          // trip — the same key as the bundle. A corrupt or foreign
          // record is ignored, never rendered.
          try {
            const e = localStorage.getItem('fujintrip-expenses');
            if (e) {
              const saved = JSON.parse(e) as { key?: unknown; expenses?: unknown };
              const tripKey = bundleKey(p.destination, p.travelers, typeof p.durationDays === 'number' ? p.durationDays : 0);
              if (saved && saved.key === tripKey && Array.isArray(saved.expenses)) {
                const list = (saved.expenses as unknown[]).filter((x): x is Expense => {
                  if (!x || typeof x !== 'object') return false;
                  const o = x as Record<string, unknown>;
                  return typeof o.id === 'string' && typeof o.payer === 'string' && typeof o.amount === 'number' && Array.isArray(o.shares);
                }).slice(0, 50);
                if (list.length) setExpenses(list);
              }
            }
          } catch {}
        }
      }
      const pl = localStorage.getItem('fujintrip-current-plan');
      if (pl) {
        const d = JSON.parse(pl) as { plan?: unknown; choice?: unknown };
        const p = d.plan as Plan | null;
        if (p && typeof p.destination === 'string' && Array.isArray(p.options) && p.options.length === 3 && Array.isArray(p.days)) {
          setPlan(p);
          if (typeof d.choice === 'number' && d.choice >= 0 && d.choice <= 2) setChoice(d.choice);
        }
      }
    } catch {}
    setHydrated(true);
    // Run once on mount — onParsed is Home's setAiTrip, stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (lastParsed) localStorage.setItem('fujintrip-current-trip', JSON.stringify(lastParsed));
      else localStorage.removeItem('fujintrip-current-trip');
    } catch {}
  }, [hydrated, lastParsed]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (plan) localStorage.setItem('fujintrip-current-plan', JSON.stringify({ plan, choice }));
      else localStorage.removeItem('fujintrip-current-plan');
    } catch {}
  }, [hydrated, plan, choice]);
  // Built-in planner replies carry the 3 tier prices too (same as the
  // server fallback) — the reply must have real value before the plan.
  // But NOT while the conversation is still gathering details (guided
  // flow): a reply that asks one question must not also dump three prices.
  const withOptions = (p: { destination: string; travelers: number; reply: string; missing: string[]; needsMore?: boolean; tips?: string[]; kids?: number[]; routeOverride?: RouteOverride; tier?: number }) =>
    p.destination && !p.needsMore ? { ...p, reply: `${p.reply}\n\n${optionsLine(p.destination, p.travelers, { kids: p.kids ?? [] })}` } : p;
  // The price watch for a trip, by its slots — its own past checks feed
  // the trend read in the chat (tripState.priceHistory) and in the
  // "Book now or wait?" box. A trip without a watch has no history, and
  // the chat says so instead of inventing a confidence.
  const watchFor = (dest: string | undefined, travelers: number, origin: string, month: number, days: number) =>
    dest ? watches.find((w) => w.destination === dest && w.travelers === travelers && (w.origin || '') === (origin || '') && w.month === month && w.durationDays === days) : undefined;

  // Apply a parsed server reply to the chat state: the AI's live flag, the
  // trip slots (destination, travelers, origin, month, length, kids, the
  // revised route, the tier) and the reply message itself. Shared by the
  // streaming path and the atomic fallback path so both behave identically.
  const handleParsed = (parsed: ServerParsed, live: boolean, origin: string, month: number, durationDays: number, kids: number[]) => {
    setAiLive(live);
    // Empty destination means an off-topic decline — keep any earlier plan destination.
    if (parsed.destination) {
      // A new destination means a new trip: the old plan no longer applies
      // — clear it so the traveler builds a fresh one for this trip.
      if (lastParsed && parsed.destination !== lastParsed.destination) {
        setPlan(null);
        setChosenLegs(new Set());
        setSelectedLeg(null);
        setExpenses([]);
        setWeatherCheck(null);
      }
      // A revision (routeOverride/tier from this reply) applies to THIS
      // trip; a new destination starts fresh, with no override. A revised
      // route also drops the map legs the traveler had added — a Vienna
      // stay leg means nothing once Vienna is off the route.
      const isNewTrip = lastParsed ? parsed.destination !== lastParsed.destination : false;
      const routeOverrideOut = isNewTrip ? undefined : parsed.routeOverride ?? lastParsed?.routeOverride;
      if (parsed.routeOverride && JSON.stringify(parsed.routeOverride) !== JSON.stringify(lastParsed?.routeOverride)) {
        setChosenLegs(new Set());
        setSelectedLeg(null);
      }
      // Kids' ages: the server's answer wins, else what the page parsed
      // from the conversation, else what the trip already had.
      const kidsOut = parsed.kids?.length ? parsed.kids : kids.length ? kids : lastParsed?.kids ?? [];
      // A tier change from the chat ("make it cheaper") switches the
      // prices the trip card and the map show.
      if (typeof parsed.tier === 'number' && [0, 1, 2].includes(parsed.tier)) setChoice(parsed.tier);
      setLastParsed({
        destination: parsed.destination,
        travelers: parsed.travelers,
        ...(origin ? { origin } : {}),
        ...(month ? { month } : {}),
        ...(durationDays ? { durationDays } : {}),
        ...(routeKeyForDestination(parsed.destination) ? { routeKey: routeKeyForDestination(parsed.destination) } : {}),
        ...(kidsOut.length ? { kids: kidsOut } : {}),
        ...(routeOverrideOut ? { routeOverride: routeOverrideOut } : {}),
        // A new destination starts fresh; a follow-up keeps the source
        // tips from the link the trip started from.
        ...(isNewTrip ? {} : lastParsed?.sourceTips ? { sourceTips: lastParsed.sourceTips } : {}),
      });
      // The price-comparison section below follows the AI's trip.
      onParsed?.({ destination: parsed.destination, travelers: parsed.travelers, ...(kidsOut.length ? { kids: kidsOut } : {}) });
    }
    // Preference profile (round 3 #2): a fresh trip with a profile from
    // before — Fujin says what it is using, so the traveler can correct
    // it. Only on a fresh trip, never mid-conversation, and never on a
    // decline (parsed.destination is empty there).
    const isFreshTrip = !lastParsed || parsed.destination !== lastParsed.destination;
    const profileNote = isFreshTrip && profileLineRef.current ? `\n\n${profileLineRef.current}` : '';
    profileLineRef.current = '';
    setMsgs((m) => [...m, { who: 'ai', text: parsed.reply + profileNote + (parsed.missing.length ? ` To finish the plan I still need: ${parsed.missing.join(', ')}.` : ' Tap Build my plan below.'), tips: parsed.tips }]);
  };

  const send = async (textOverride?: string, statusOverride?: FlightStatusData | null) => {
    const text = (textOverride ?? input).trim();
    if (!text) return;
    // One reply in flight at a time — while Fujin AI is thinking or
    // streaming, the Send button is a Stop button instead.
    if (thinking !== null || streamingText !== null) return;
    setInput('');
    setDietaryNote('');
    // Show your message right away; the AI reply is added when it arrives,
    // so a slow server never looks like the message didn't send.
    setMsgs((m) => [...m, { who: 'user', text }]);
    // Everything the traveler said so far, for the built-in planner when
    // the server can't be reached — same memory the server gets.
    const contextText = [...msgs.filter((m) => m.who === 'user').map((m) => m.text), text].join(' ');
    // The departure city, from everything the traveler said so far — it
    // rides along in tripState so the server never has to ask twice. A
    // bare-city answer ("yes new york") counts too, from this message only.
    const origin = findOrigin(contextText) || findOriginAnswer(text) || lastParsed?.origin || '';
    // The trip-card slots, from everything said so far (month, length) —
    // carried forward like the origin so they survive follow-ups.
    const month = findMonth(contextText) || lastParsed?.month || 0;
    const durationDays = parseDuration(contextText) || lastParsed?.durationDays || 0;
    // Kids' ages, from everything said so far — the pace depends on them,
    // and they ride along in tripState like the origin.
    const kids = parseKidAges(contextText).length ? parseKidAges(contextText) : lastParsed?.kids ?? [];
    // Preference profile (round 3 #2): signals in this message ("direct
    // flights", "street food") join the profile — and the profile line
    // for a new trip is captured BEFORE the merge, so a preference
    // stated just now is never announced as if it were from last time.
    // The merged profile rides in tripState so the server can use it
    // on this very reply.
    const signals = parsePreferenceSignals(text);
    const hasSignals = Object.keys(signals).length > 0;
    if (!hasSignals) profileLineRef.current = profileLine(profile);
    const profileForRequest = hasSignals ? mergeProfile(profile, signals) : profile;
    if (hasSignals) onProfileChange(profileForRequest);
    // Passport expiry (round 3 #5): month/year only, from the
    // traveler's own words ("my passport expires in March 2027") —
    // never the number. It rides along in tripState and persists on
    // the trip so the panel can check it against the return date.
    const expiryFromMsg = parsePassportExpiry(text);
    const passportExpiry = expiryFromMsg ?? lastParsed?.passportExpiry;
    if (expiryFromMsg) setLastParsed((p) => (p ? { ...p, passportExpiry: expiryFromMsg } : p));
    // Arrival-time anchoring (round 4 #3): the landing and departure
    // times, from the traveler's own words ("we land at 7am", "flight
    // home at 10am") — they ride along in tripState like the origin,
    // and persist on the trip so the plan anchors to them.
    const landingFromMsg = parseLandingTime(contextText);
    const landingTime = landingFromMsg ?? lastParsed?.landingTime;
    if (landingFromMsg) setLastParsed((p) => (p ? { ...p, landingTime: landingFromMsg } : p));
    const departureFromMsg = parseDepartureTime(contextText);
    const departureTime = departureFromMsg ?? lastParsed?.departureTime;
    if (departureFromMsg) setLastParsed((p) => (p ? { ...p, departureTime: departureFromMsg } : p));
    // The price watch for this trip, if one exists — its own past checks
    // ride along in tripState so the trend read is from real checks.
    const tripWatch = lastParsed ? watchFor(lastParsed.destination, lastParsed.travelers, lastParsed.origin ?? '', lastParsed.month ?? 0, lastParsed.durationDays ?? 0) : undefined;
    // Typing indicator: shows within 200ms of Send; after 5s with no
    // first chunk it escalates to a status line ("Searching live fares…").
    setThinking('thinking');
    thinkingTimerRef.current = setTimeout(() => setThinking((prev) => (prev === 'thinking' ? 'searching' : prev)), 5000);
    const requestBody = {
      message: text,
      // Conversation history: the last few turns, so the AI remembers
      // the trip instead of treating each message as a fresh
      // conversation (the Nov 10 Europe bug). 10 turns — a long
      // conversation must not lose the trip.
      history: msgs.slice(-10).map((m) => ({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text })),
      // Durable trip memory: the trip already established (destination
      // + travelers + departure city) goes with EVERY request, so it
      // survives history scrolling off the window. On the very first
      // message there is no trip yet — but the profile still rides
      // along, so the first reply already honors what the traveler
      // told us (an empty destination in tripState is ignored).
      ...(lastParsed
        ? { tripState: { ...lastParsed, ...(origin ? { origin } : {}), tier: choice, ...(profileSummary(profileForRequest) ? { preferences: profileForRequest } : {}), ...(passportExpiry ? { passportExpiry } : {}), ...(landingTime ? { landingTime } : {}), ...(departureTime ? { departureTime } : {}), ...(tripWatch && tripWatch.history.length ? { priceHistory: tripWatch.history } : {}) } }
        : profileSummary(profileForRequest)
          ? { tripState: { destination: '', travelers: 2, preferences: profileForRequest } }
          : passportExpiry
            ? { tripState: { destination: '', travelers: 2, passportExpiry } }
            : {}),
      // On-trip mode: tell the server the traveler is already there.
      ...(tripMode && lastParsed ? { tripContext: lastParsed.destination } : {}),
      // Disruption report: the checked flight status rides along so
      // the AI quotes a confirmed status, never a guess (feature 5).
      ...(statusOverride ? { flightStatus: statusOverride } : {}),
    };
    // Parse a server reply (streamed `done` result or atomic JSON) into
    // the shape the chat handles — same validation as before.
    const parseServerReply = (j: Record<string, unknown>): { parsed: ServerParsed; live: boolean } => {
      // A revision from the server arrives as routeStops (+ routeWeights
      // for "more time in a city") and/or a tier change; the fallback
      // path returns routeOverride/tier directly (see below).
      const routeStops = Array.isArray(j.routeStops) ? j.routeStops.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim()).slice(0, 8) : [];
      const routeWeights =
        j.routeWeights && typeof j.routeWeights === 'object' && !Array.isArray(j.routeWeights)
          ? Object.fromEntries(
              Object.entries(j.routeWeights as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
            )
          : undefined;
      const parsed: ServerParsed = { destination: j.destination as string, travelers: typeof j.travelers === 'number' ? j.travelers : 2, reply: j.reply as string, missing: Array.isArray(j.missing) ? j.missing : [], tips: Array.isArray(j.tips) ? j.tips.filter((t: unknown): t is string => typeof t === 'string').slice(0, 3) : [], kids: Array.isArray(j.kids) ? j.kids.filter((k: unknown): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6) : undefined, ...(routeStops.length ? { routeOverride: { cities: routeStops, ...(routeWeights && Object.keys(routeWeights).length ? { weights: routeWeights } : {}) } } : {}), ...(typeof j.tier === 'number' && [0, 1, 2].includes(j.tier) ? { tier: j.tier } : {}) };
      return { parsed, live: j.live === true };
    };
    // Keep the fresh traveler material the server fetched for this trip.
    const keepVoices = (j: Record<string, unknown>) => {
      if (typeof j.voices === 'string' && j.voices && typeof j.voicesDestination === 'string' && j.voicesDestination) {
        setVoices({ destination: j.voicesDestination, text: j.voices, source: typeof j.voicesSource === 'string' ? j.voicesSource : '' });
      }
      // Per-city voices (round 3 #1): validated shape only — a corrupt
      // or foreign value is ignored, never rendered. An empty list means
      // this turn fetched no city voices (single-city trip), so the last
      // per-city material stays.
      if (Array.isArray(j.cityVoices) && j.cityVoices.length) {
        const list = (j.cityVoices as unknown[])
          .filter((c): c is { city: string; voices: { text: string; source: string } } => {
            if (!c || typeof c !== 'object') return false;
            const o = c as Record<string, unknown>;
            return typeof o.city === 'string' && !!o.city && !!o.voices && typeof o.voices === 'object' && typeof (o.voices as Record<string, unknown>).text === 'string';
          })
          .map((c) => ({ city: c.city, text: c.voices.text, source: typeof c.voices.source === 'string' ? c.voices.source : '' }));
        if (list.length) setCityVoices(list);
      }
    };
    // Keep the live fares the server fetched for this trip (or clear
    // them when the fetch ran and failed, so the card falls back). A
    // null/missing liveFares means this turn did not fetch fares at all
    // (a food question, an on-trip question) — the last fares stay, and
    // the card only uses them while they still match its own trip.
    const keepFares = (j: Record<string, unknown>) => {
      if (j.liveFares === null || j.liveFares === undefined) return;
      setLiveFares(parseLiveFares(j.liveFares));
    };
    // Stream first: the reply appears as it arrives. A stopped stream
    // keeps its partial text; any stream failure falls back to the atomic
    // request below (the same reply, in one piece).
    const abort = new AbortController();
    streamAbortRef.current = abort;
    let streamedSoFar = '';
    try {
      const r = await fetch('/api/fujin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, stream: true }),
        signal: abort.signal,
      });
      if (!r.ok || !r.body) throw new Error('stream unavailable');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let doneResult: Record<string, unknown> | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload) continue;
          let ev: { chunk?: string; done?: boolean; result?: Record<string, unknown>; error?: string };
          try {
            ev = JSON.parse(payload) as typeof ev;
          } catch {
            continue;
          }
          if (typeof ev.chunk === 'string') {
            streamedSoFar += ev.chunk;
            setThinking(null);
            setStreamingText(streamedSoFar);
          } else if (ev.done && ev.result) {
            doneResult = ev.result;
          } else if (typeof ev.error === 'string') {
            throw new Error(ev.error);
          }
        }
      }
      stopThinking();
      streamAbortRef.current = null;
      if (doneResult && typeof doneResult.reply === 'string' && typeof doneResult.destination === 'string') {
        keepVoices(doneResult);
        keepFares(doneResult);
        const { parsed, live } = parseServerReply(doneResult);
        handleParsed(parsed, live, origin, month, durationDays, kids);
        return;
      }
      if (streamedSoFar) {
        // The stream ended without a result — keep the partial text.
        setMsgs((m) => [...m, { who: 'ai', text: streamedSoFar + '…' }]);
        return;
      }
      throw new Error('empty stream');
    } catch (err) {
      // A stop is a choice, not a failure: keep whatever arrived and do
      // NOT re-fetch. Anything else falls through to the atomic request.
      stopThinking();
      streamAbortRef.current = null;
      if ((err as Error)?.name === 'AbortError') {
        if (streamedSoFar) setMsgs((m) => [...m, { who: 'ai', text: streamedSoFar + '…' }]);
        return;
      }
    }
    // Live AI first (server route); any failure falls back to the built-in planner.
    let parsed: ServerParsed;
    let live = false;
    try {
      const r = await fetch('/api/fujin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const j = await r.json();
      if (r.ok && typeof j.reply === 'string' && typeof j.destination === 'string') {
        keepVoices(j);
        keepFares(j);
        const out = parseServerReply(j);
        parsed = out.parsed;
        live = out.live;
      } else {
        parsed = withOptions(askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin, lastParsed?.routeOverride, kids.length ? kids : lastParsed?.kids ?? [], choice));
      }
    } catch {
      parsed = withOptions(askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin, lastParsed?.routeOverride, kids.length ? kids : lastParsed?.kids ?? [], choice));
    }
    handleParsed(parsed, live, origin, month, durationDays, kids);
  };

  const build = () => {
    const dest = lastParsed?.destination ?? 'Kyoto';
    const people = lastParsed?.travelers ?? 2;
    // The plan's day cards span the trip length the traveler gave
    // (14 days → 14 day cards), not a fixed 3.
    setPlan(buildPlan(dest, people, lastParsed?.durationDays ?? 3, { kids: lastParsed?.kids ?? [] }));
    // A new plan means new dates — the old weather check no longer applies.
    setWeatherCheck(null);
    setActionMsg('');
  };

  // --- Plan actions -------------------------------------------------------
  // Share: copies a readable plan summary to the clipboard.
  const sharePlan = async () => {
    if (!plan) return;
    const best = plan.options[1];
    const summary = [
      `My FujinTrip plan — ${plan.destination} for ${plan.travelers} traveler${plan.travelers > 1 ? 's' : ''}`,
      `Best value: $${best.total.toLocaleString()} (Flights $${best.flight.toLocaleString()} · Hotel $${best.hotel.toLocaleString()} · Car $${best.car.toLocaleString()} · Activities $${best.activities.toLocaleString()})`,
      `Cheapest: $${plan.options[0].total.toLocaleString()} · Premium: $${plan.options[2].total.toLocaleString()}`,
      'Prices are planning estimates, not live quotes. fujintrip.com',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setActionMsg('Plan copied — paste it to share with your travel companions.');
    } catch {
      // Clipboard API unavailable (old browser / no permission): show the
      // text so the traveler can copy it by hand instead of failing silently.
      setActionMsg(`Copy didn’t work in this browser — here’s the plan to share:\n${summary}`);
    }
  };
  // Book this plan with FujinTrip: a booking request in My Trips (the team
  // follows up). Live booking activates with Duffel live mode — there is
  // no checkout yet, so this is honestly a request, not a booking.
  const bookPlan = () => {
    if (!plan) return;
    const chosen = plan.options[choice];
    onSaveTrip(`${plan.destination} plan — ${chosen.name} $${chosen.total.toLocaleString()}`, 'Booking request — team follows up', plan.destination);
    setActionMsg('Booking request saved to My Trips. Live booking activates with Duffel live mode — for now the FujinTrip team follows up on your request. Once it’s marked booked, your plan PDF is free.');
  };
  // Save as PDF — the $1 rule (firm, Nov 10, 2026): downloading the PDF
  // costs $1 when the traveler has NOT booked with FujinTrip; it is FREE
  // when they booked with us. The server route (/api/plan-download)
  // decides; Stripe is not connected yet, so the $1 path explains that
  // instead of pretending a payment happened. Nothing is charged and the
  // plan stays saved either way.
  const planBooked = plan ? bookedDestinations.includes(plan.destination) : false;
  const requestPdf = async () => {
    if (!plan) return;
    setPdfPay(false);
    setPdfNotice('Checking your download…');
    try {
      const r = await fetch('/api/plan-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: plan.destination, travelers: plan.travelers, booked: planBooked }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.decision === 'free') {
        setPdfNotice('Your guide is free — you booked with us. Your PDF is opening now.');
        window.print();
      } else if (r.ok && j.decision === 'pay_1') {
        // Future: when Stripe is wired the route returns a checkoutUrl and
        // we send the traveler there. Today it is not configured.
        if (typeof j.checkoutUrl === 'string' && j.checkoutUrl) { window.location.href = j.checkoutUrl; return; }
        setPdfNotice('$1 to download the full plan — free if you book with us. The $1 checkout isn’t connected yet: Stripe setup is needed before anyone can pay. Your plan stays saved here — nothing was charged and no PDF was downloaded.');
        setPdfPay(true);
      } else {
        setPdfNotice('Couldn’t check the download right now — your plan is still saved; try again in a moment.');
      }
    } catch {
      setPdfNotice('Couldn’t reach the server to check the download — your plan is still saved; try again in a moment.');
    }
  };
  // Start a new trip: clears the plan and the saved trip, so the next
  // chat starts fresh.
  // Start over: the panel, the map and the chat all go back to the
  // greeting together. Used by the plan view's "Start a new trip" and
  // by the app bar's "My Trips → New trip".
  const resetToGreeting = () => {
    setPlan(null);
    setLastParsed(null);
    setChoice(1);
    setChosenLegs(new Set());
    setSelectedLeg(null);
    setExpenses([]);
    setWeatherCheck(null);
    setTripMode(false);
    setPanelNotice('');
    setPdfNotice('');
    setPdfPay(false);
    setMobileZone('chat');
    setMsgs([{ who: 'ai', text: GREETING }]);
  };
  const startNewTrip = () => {
    resetToGreeting();
    setActionMsg('Started a new trip — ask Fujin AI where to next.');
  };
  // Trip switcher (app bar "My Trips"): switch to a saved trip. The
  // saved entry holds only a destination — the chat, the panel and the
  // map switch together by seeding that destination's route, exactly
  // as a template seed does. A saved search request has no destination
  // and cannot be opened as a trip; the menu disables it. Full
  // per-trip chat history is not stored yet (it needs accounts +
  // Postgres — see files/plan-sync-design.md), so switching starts a
  // fresh conversation for that trip; the old trip stays saved in
  // My Trips as its label.
  const switchToTrip = (t: Trip) => {
    setTripsOpen(false);
    if (!t.destination) return;
    const dest = t.destination;
    const rk = routeKeyForDestination(dest);
    const cities = rk ? ROUTE_STOPS[rk].map((s) => s.city) : [dest];
    setPlan(null);
    setChosenLegs(new Set());
    setSelectedLeg(null);
    setExpenses([]);
    setWeatherCheck(null);
    setPanelNotice('');
    setLastParsed({
      destination: dest,
      travelers: 2,
      ...(rk ? { routeKey: rk } : {}),
      routeOverride: { cities },
    });
    setMobileZone('chat');
    setMsgs([{ who: 'ai', text: `Switched to ${dest}: ${cities.join(' → ')} — for 2 travelers. When are you going, and for how long?` }]);
    onParsed?.({ destination: dest, travelers: 2 });
  };
  // Trip panel edits (app shell): the panel is directly manipulable,
  // but it never keeps its own copy of the math — every edit runs
  // through applyRevision, the same function the chat's revision flow
  // runs on the server, on the same stop list and the same day count
  // the visible card uses. A successful edit updates lastParsed (the
  // one trip state), drops the map legs the traveler had picked (they
  // belonged to the old route, as in handleParsed), and posts the
  // revision's own note into the chat as the confirmation. An
  // impossible edit is refused with one plain line in the panel —
  // never by inventing data, never by silently doing nothing.
  const panelEditStop = (edit: PanelStopEdit) => {
    if (!lastParsed?.destination) return;
    const key = routeKeyForDestination(lastParsed.destination);
    const stops = stopsForRoute(key, lastParsed.routeOverride);
    if (!stops.length) return;
    // The visible card's day count: the built plan uses durationDays
    // (3 when unknown), the live preview assumes 14.
    const days = plan ? lastParsed.durationDays ?? 3 : lastParsed.durationDays ?? 14;
    const currentNights = (city: string) =>
      distributeNightsForStops(stops, days).find((s) => s.city === city)?.nights ?? 0;
    const refuse = (reason: string) => setPanelNotice(reason);
    let revision: Revision | null = null;
    if (edit.kind === 'nights') {
      const current = currentNights(edit.city);
      if (edit.nights === current) return;
      if (edit.nights < current && current <= 1) {
        refuse(`${edit.city} is already 1 night — a stop can't have fewer.`);
        return;
      }
      if (edit.nights > current) {
        const totalNights = Math.max(stops.length, days - 1);
        if (edit.nights > totalNights - (stops.length - 1)) {
          refuse(`Can't give ${edit.city} another night — every other stop is already at 1 night.`);
          return;
        }
      }
      revision = { type: 'nights', city: edit.city, nights: edit.nights };
    } else if (edit.kind === 'remove') {
      if (stops.length < 2) {
        refuse(`Can't remove ${edit.city} — it's the only stop left.`);
        return;
      }
      revision = { type: 'remove', city: edit.city };
    } else {
      const idx = stops.findIndex((s) => s.city === edit.city);
      if (idx === -1) return;
      if (edit.dir === 'up') {
        if (idx === 0) return;
        revision = { type: 'reorder', city: edit.city, before: stops[idx - 1].city };
      } else {
        if (idx === stops.length - 1) return;
        revision = { type: 'reorder', city: edit.city, after: stops[idx + 1].city };
      }
    }
    const applied = revision ? applyRevision(stops, revision, days) : null;
    if (!applied) {
      refuse(`Couldn't change that — the route didn't move.`);
      return;
    }
    setLastParsed({ ...lastParsed, routeOverride: applied.override });
    setChosenLegs(new Set());
    setSelectedLeg(null);
    setPanelNotice('');
    setMsgs((m) => [...m, { who: 'ai', text: applied.note }]);
  };
  // Panel tier: the same choice state the plan view's tier boxes use.
  const panelTier = (i: number) => {
    if (i === choice || ![0, 1, 2].includes(i)) return;
    const names = ['Cheapest', 'Best value', 'Premium'];
    setChoice(i);
    setMsgs((m) => [
      ...m,
      {
        who: 'ai',
        text: plan
          ? `Switched to ${names[i]} — $${plan.options[i].total.toLocaleString()} total for ${plan.travelers} traveler${plan.travelers > 1 ? 's' : ''}.`
          : `Switched to ${names[i]} — the map and trip prices now show the ${names[i]} tier. Build your plan to see the totals.`,
      },
    ]);
  };
  // Panel travelers: the plan re-prices from the same base (buildPlan),
  // and the price comparison below follows through onParsed — the
  // totals never come from a second copy of the math.
  const panelTravelers = (n: number) => {
    if (!lastParsed?.destination) return;
    const next = Math.max(1, Math.min(12, n));
    if (next === lastParsed.travelers) return;
    const dest = lastParsed.destination;
    const days = lastParsed.durationDays ?? 3;
    const kids = lastParsed.kids ?? [];
    const nextPlan = plan ? buildPlan(dest, next, days, { kids }) : null;
    if (nextPlan) setPlan(nextPlan);
    setLastParsed({ ...lastParsed, travelers: next });
    onParsed?.({ destination: dest, travelers: next, ...(kids.length ? { kids } : {}) });
    setMsgs((m) => [
      ...m,
      {
        who: 'ai',
        text: nextPlan
          ? `Now ${next} traveler${next > 1 ? 's' : ''} — ${plan ? plan.options[choice].name : 'Best value'} $${nextPlan.options[choice].total.toLocaleString()} total.`
          : `Now ${next} traveler${next > 1 ? 's' : ''} — build your plan to see the new total.`,
      },
    ]);
  };
  // Panel month: the trip card's dates follow the month through
  // suggestedStart, and the price check / competitor fares refetch
  // from the new dates (their effect keys include lastParsed).
  const panelMonth = (m: number) => {
    if (!lastParsed?.destination || m < 1 || m > 12 || m === lastParsed.month) return;
    setLastParsed({ ...lastParsed, month: m });
    const start = suggestedStart(m).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setMsgs((m2) => [...m2, { who: 'ai', text: `Moved the trip to ${MONTH_NAMES[m - 1]} — it now starts ${start}.` }]);
  };
  // Watch this trip's prices: a real watch now that live fares exist
  // (Duffel test fares). The baseline is the live out+back total from a
  // fresh check — a drop is measured against that, never against the
  // planner estimate, which is static and never moves. Without a live
  // fare yet, the watch is saved with no baseline and waits for one.
  const watchPrice = async () => {
    if (!plan) return;
    const slots = { destination: plan.destination, travelers: plan.travelers, origin: lastParsed?.origin ?? '', month: lastParsed?.month ?? 0, durationDays: lastParsed?.durationDays ?? 0 };
    let baseline: number | null = null;
    if (priceCheck && priceCheck !== 'loading' && priceCheck.live) {
      baseline = priceCheck.liveTotal;
    } else {
      try {
        const r = await fetch('/api/price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slots),
        });
        const j = (await r.json()) as PriceCheckData;
        if (j.live) baseline = j.liveTotal;
      } catch {}
    }
    onWatchPrices({ ...slots, baseline, lastTotal: baseline, history: baseline !== null ? appendObservation([], baseline) : [] });
    setActionMsg(
      baseline !== null
        ? `Watching ${plan.destination} prices — baseline $${baseline.toLocaleString()} for the cheapest live fares out and back (Duffel test fares). We'll tell you in My Trips when they drop below that.`
        : `Watching ${plan.destination} prices — no live fare for this trip yet, so there's no baseline to drop from. The watch is saved in My Trips and starts the moment a live fare appears.`
    );
  };
  // Hold my price: a request for the FujinTrip team, not a guaranteed hold
  // — there is no live inventory to freeze a price against yet.
  const holdPrice = () => {
    if (!plan) return;
    const best = plan.options[1];
    onSaveTrip(`${plan.destination} plan — Best value $${best.total.toLocaleString()}`, 'Price hold requested', plan.destination);
    setActionMsg('Hold requested. This asks the FujinTrip team to hold the Best value price when booking opens — it is a request, not a guaranteed hold yet, because there is no live inventory to freeze it against.');
  };
  // Ask a human: a person reviews the plan before anything is booked.
  const askHuman = () => {
    if (!plan) return;
    onSaveTrip(`${plan.destination} plan — Best value $${plan.options[1].total.toLocaleString()}`, 'Advisor review requested', plan.destination);
    setActionMsg('Sent for a human check. A person reviews this plan before anything is booked — no booking happens until they’ve looked at it.');
  };
  // Curated guide for the current plan's destination (Kyoto only, researched
  // Nov 2026) — the fallback when no live-fetch voices exist for it.
  const guide = plan ? guideFor(plan.destination) : null;
  // Layla-style trip card: map, per-city legs, day-by-day with real
  // sights, and the price comparison. Built from the trip the chat
  // collected (destination, travelers, month, length, origin) — the same
  // numbers the chat quoted, so the card and the chat never disagree.
  const tripCard: TripCard | null = useMemo(
    () =>
      plan
        ? buildTripCard({
            destination: plan.destination,
            travelers: plan.travelers,
            days: lastParsed?.durationDays ?? 3,
            month: lastParsed?.month ?? 0,
            origin: lastParsed?.origin ?? '',
            // The map's price tags show the tier the traveler picked.
            tier: choice,
            kids: lastParsed?.kids ?? [],
            routeOverride: lastParsed?.routeOverride,
            sourceTips: lastParsed?.sourceTips,
            // The same live fares the chat quotes for this trip — the
            // card validates them against its own trip before using them.
            liveFares,
            // Pace guard (round 4 #1): the day cards warn on the days
            // that break the traveler's pace.
            pace: paceFromProfile(profile),
            ...(profile.maxSightsPerDay ? { maxSightsPerDay: profile.maxSightsPerDay } : {}),
            // Arrival-time anchoring (round 4 #3): Day 1 from the
            // landing time, the last day at the airport.
            ...(lastParsed?.landingTime ? { landingTime: lastParsed.landingTime } : {}),
            ...(lastParsed?.departureTime ? { departureTime: lastParsed.departureTime } : {}),
          })
        : null,
    [plan, lastParsed, choice, liveFares, profile]
  );
  // Live map preview (Nov 11, user: "the map doesn't reflect as i'm
  // talking to the ai like lyla"): the map used to appear only after
  // "Build my plan", so while the traveler chatted it stayed empty. Now
  // the map shows the trip as soon as the chat knows a destination —
  // the route, the markers and the price tags update with every turn,
  // and the full plan card takes over once "Build my plan" is tapped.
  // The preview assumes 14 days when the length is not known yet; once
  // the traveler gives it, the preview and the plan use the same length.
  const previewCard: TripCard | null = useMemo(
    () =>
      lastParsed?.destination
        ? buildTripCard({
            destination: lastParsed.destination,
            travelers: lastParsed.travelers,
            days: lastParsed.durationDays ?? 14,
            month: lastParsed.month ?? 0,
            origin: lastParsed.origin ?? '',
            tier: choice,
            kids: lastParsed?.kids ?? [],
            routeOverride: lastParsed?.routeOverride,
            sourceTips: lastParsed?.sourceTips,
            liveFares,
            pace: paceFromProfile(profile),
            ...(profile.maxSightsPerDay ? { maxSightsPerDay: profile.maxSightsPerDay } : {}),
            ...(lastParsed?.landingTime ? { landingTime: lastParsed.landingTime } : {}),
            ...(lastParsed?.departureTime ? { departureTime: lastParsed.departureTime } : {}),
          })
        : null,
    [lastParsed, choice, liveFares, profile]
  );
  const mapCard = tripCard ?? previewCard;
  // Live trip panel (Layla-dynamic round): the map's props are stable
  // references keyed on the card — before, the stops array was rebuilt
  // on every render (every keystroke), so FitBounds re-ran and the map
  // jumped while the traveler typed. Now the card, the map and the
  // totals re-render only when a slot actually changes (destination,
  // route override, nights, travelers, tier — including revisions),
  // and the map glides to the new route instead of snapping.
  const mapStops = useMemo(
    () => (mapCard ? mapCard.stops.filter((s) => CITY_INFO[s.city]).map((s) => ({ city: s.city, lat: CITY_INFO[s.city].lat, lng: CITY_INFO[s.city].lng })) : []),
    [mapCard]
  );
  const mapLegs = useMemo(() => mapCard?.legs ?? [], [mapCard]);
  const comparison = useMemo(
    () => (plan ? cardComparison(plan.destination, plan.travelers, { kids: lastParsed?.kids ?? [] }) : null),
    [plan, lastParsed]
  );
  // Visa & entry panel (competitor learning #3, Sherpa): one row per
  // route country, from the curated visa dataset — US passport, tourism,
  // verified 2026-11-11, with the official source link per country.
  const visaInfos: VisaInfo[] = useMemo(
    () => (plan ? visaForDestination(plan.destination) : []),
    [plan]
  );
  // Best time to travel (competitor learning round 2 #5, Kayak): price
  // + crowds + weather per month for this route, from the curated
  // seasons and the trip card's own typical temperatures.
  const bestTime: BestTime | null = useMemo(
    () => (plan ? bestTimeFor(plan.destination) : null),
    [plan]
  );
  // Book now or wait? (competitor learning #4): the live fares for this
  // exact trip, checked once per trip — the key guards against
  // refetching on every chat turn (lastParsed changes identity each
  // turn, even when the trip hasn't).
  const [priceCheck, setPriceCheck] = useState<PriceCheckData | 'loading' | null>(null);
  const priceCheckKeyRef = useRef('');
  const fetchPriceCheck = async () => {
    if (!plan) return;
    const key = `${plan.destination}|${plan.travelers}|${lastParsed?.origin ?? ''}|${lastParsed?.month ?? 0}|${lastParsed?.durationDays ?? 0}`;
    priceCheckKeyRef.current = key;
    setPriceCheck('loading');
    try {
      // The watch's own past checks ride along, so the response's trend
      // is read from real checks — and the box shows it beside the
      // book-now read.
      const watch = watchFor(plan.destination, plan.travelers, lastParsed?.origin ?? '', lastParsed?.month ?? 0, lastParsed?.durationDays ?? 0);
      const r = await fetch('/api/price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: lastParsed?.origin ?? '', destination: plan.destination, travelers: plan.travelers, month: lastParsed?.month ?? 0, durationDays: lastParsed?.durationDays ?? 0, ...(watch && watch.history.length ? { history: watch.history } : {}) }),
      });
      const j = await r.json();
      if (priceCheckKeyRef.current === key) setPriceCheck(j as PriceCheckData);
    } catch {
      if (priceCheckKeyRef.current === key) setPriceCheck(null);
    }
  };
  useEffect(() => {
    if (!plan) {
      setPriceCheck(null);
      priceCheckKeyRef.current = '';
      return;
    }
    const key = `${plan.destination}|${plan.travelers}|${lastParsed?.origin ?? ''}|${lastParsed?.month ?? 0}|${lastParsed?.durationDays ?? 0}|${watchFor(plan.destination, plan.travelers, lastParsed?.origin ?? '', lastParsed?.month ?? 0, lastParsed?.durationDays ?? 0)?.history.length ?? 0}`;
    if (key === priceCheckKeyRef.current) return;
    void fetchPriceCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, lastParsed, watches]);
  // Competitor fares (Travelpayouts, cached — user chose Nov 12, 2026):
  // the cheapest cached round-trip fare for this exact trip, fetched
  // once per trip like the price check. The column stays honestly empty
  // until a fare comes back with its check date — nothing invented.
  const [competitorFares, setCompetitorFares] = useState<CompetitorFares | null>(null);
  const competitorKeyRef = useRef('');
  useEffect(() => {
    const origin = lastParsed?.origin ?? '';
    const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const depart = tripCard ? isoDay(tripCard.startDate) : '';
    const ret = tripCard ? isoDay(tripCard.endDate) : '';
    if (!plan || !origin || !depart || !ret) {
      setCompetitorFares(null);
      competitorKeyRef.current = '';
      return;
    }
    const key = `${plan.destination}|${plan.travelers}|${origin}|${depart}|${ret}`;
    if (key === competitorKeyRef.current) return;
    competitorKeyRef.current = key;
    const params = new URLSearchParams({ origin, destination: plan.destination, depart, return: ret, travelers: String(plan.travelers) });
    fetch(`/api/competitor-fares?${params}`)
      .then((r) => r.json())
      .then((j) => { if (competitorKeyRef.current === key) setCompetitorFares(j as CompetitorFares); })
      .catch(() => { if (competitorKeyRef.current === key) setCompetitorFares(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, tripCard, lastParsed]);
  // Map inventory (split-screen, Nov 11): the legs the traveler picked
  // from the map's price tags, and the leg whose card is open. A new
  // destination clears the picks — they belonged to the old trip.
  const [chosenLegs, setChosenLegs] = useState<Set<string>>(new Set());
  const [selectedLeg, setSelectedLeg] = useState<TripLeg | null>(null);
  const [legExpanded, setLegExpanded] = useState(false);
  // Full-screen map (Layla-dynamic round): the trip card's map opens as
  // a dialog — same route, numbered stops and price tags, reusing
  // TripMap. Esc closes it; the page behind doesn't scroll while it
  // is open. The inline map stays put — the dialog is a second,
  // larger view, not a replacement.
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    if (!mapOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMapOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [mapOpen]);
  // Emergency (SOS) sheet + check-in timer (emergency-button build):
  // the sheet opens from the panel, the Today view and the map bar —
  // all S1/S2, never the empty S0 screen. The check-in is per trip
  // (same key style as the Today done-toggles); if missed while the
  // app is open, the sheet surfaces once, with the alert ready. It
  // does nothing while the app is closed, and the sheet says so.
  const [sosOpen, setSosOpen] = useState(false);
  const tripCheckInKey = lastParsed ? checkInKeyFor(lastParsed.destination, lastParsed.travelers, lastParsed.durationDays ?? 14) : '';
  const [checkIn, setCheckIn] = useState<CheckIn | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (!tripCheckInKey) { setCheckIn(null); return; }
    try {
      const raw = localStorage.getItem(tripCheckInKey);
      setCheckIn(raw ? parseCheckIn(JSON.parse(raw)) : null);
    } catch { setCheckIn(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tripCheckInKey]);
  useEffect(() => {
    if (!hydrated || !tripCheckInKey) return;
    try {
      if (checkIn) localStorage.setItem(tripCheckInKey, JSON.stringify(checkIn));
      else localStorage.removeItem(tripCheckInKey);
    } catch {}
  }, [hydrated, tripCheckInKey, checkIn]);
  useEffect(() => {
    if (!checkIn || checkIn.surfaced) return;
    const tick = () => {
      if (checkInMissed(checkIn)) {
        setCheckIn((c) => (c && !c.surfaced ? { ...c, surfaced: true } : c));
        setSosOpen(true);
      }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [checkIn]);
  // Add-to-bundle-later (round 2 #7, Expedia One Key): the bundle is the
  // legs the traveler picked, snapshotted from the current card — the
  // total is the exact sum of those legs, and the bundle stays open
  // until the trip's last travel day.
  const bundle = useMemo(
    () => bundleFromLegs(mapCard?.legs ?? [], chosenLegs),
    [mapCard, chosenLegs]
  );
  const bundleEnd = mapCard?.stops[mapCard.stops.length - 1]?.endDate ?? null;
  const lockedUntil = bundleEnd ? bundleLockedUntil(bundleEnd) : '';
  // Bundle persistence: the picked legs survive a reload, keyed by trip;
  // a new trip clears them (send() clears chosenLegs, and this effect
  // then removes the stored bundle).
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (!lastParsed || !chosenLegs.size) { localStorage.removeItem('fujintrip-bundle'); return; }
      localStorage.setItem('fujintrip-bundle', JSON.stringify({ key: bundleKey(lastParsed.destination, lastParsed.travelers, lastParsed.durationDays ?? 0), ids: [...chosenLegs] }));
    } catch {}
  }, [hydrated, lastParsed, chosenLegs]);
  // Chat auto-scroll (Nov 11, user: "the chat doesn't update as i send
  // messages and reply i have to scroll to read"): the messages area
  // scrolls inside the split screen, but nothing scrolled it to the
  // newest message — the traveler had to scroll by hand. Now every new
  // message (theirs, the AI's, or an "Added to your plan" note) scrolls
  // the chat to the bottom.
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [msgs, thinking, streamingText]);
  // Split the trip (round 2 #8): the per-person split of the chosen
  // tier, and the expenses the party records so settle-up can be
  // simplified. No money moves here — the travelers settle up between
  // themselves. Expenses restore per trip, like the bundle.
  const splitPeople = useMemo(
    () => (plan ? passengerTotals(plan.options[choice], plan.travelers, { kids: lastParsed?.kids ?? [] }).people : []),
    [plan, choice, lastParsed]
  );
  const splitTotal = plan ? plan.options[choice].total : 0;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expPayer, setExpPayer] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expShares, setExpShares] = useState<string[]>([]);
  const [expNote, setExpNote] = useState('');
  const settle = useMemo(
    () => (splitPeople.length ? settleUp(expenses, splitPeople.map((p) => p.label)) : { balances: [], payments: [] }),
    [expenses, splitPeople]
  );
  const addExpense = () => {
    const amount = Number(expAmount);
    if (!splitPeople.length || !Number.isFinite(amount) || amount <= 0) return;
    const payer = expPayer || splitPeople[0].label;
    const shares = expShares.length ? expShares.filter((s) => splitPeople.some((p) => p.label === s)) : splitPeople.map((p) => p.label);
    if (!shares.length) return;
    setExpenses((prev) => [...prev, { id: `exp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`, payer, amount: Math.round(amount * 100) / 100, shares, ...(expNote.trim() ? { note: expNote.trim() } : {}) }]);
    setExpAmount('');
    setExpNote('');
    setExpShares([]);
  };
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (!lastParsed || !expenses.length) { localStorage.removeItem('fujintrip-expenses'); return; }
      localStorage.setItem('fujintrip-expenses', JSON.stringify({ key: bundleKey(lastParsed.destination, lastParsed.travelers, lastParsed.durationDays ?? 0), expenses }));
    } catch {}
  }, [hydrated, lastParsed, expenses]);
  // Weather / closure day-swap (round 2 #10): the plan view checks the
  // closures on the trip's dates and the 16-day rain forecast on demand
  // ("Check weather & closures"). The swaps apply to the DISPLAYED card
  // only — the saved plan and the map never change under the traveler.
  type WeatherResult = { swaps: DaySwap[]; closures: { city: string; day: number; date: string; attraction: string; note: string }[]; forecastAvailable: boolean; forecastReason?: string; startDate: string; closuresCheckedAt: string; checkedAt: string };
  const [weatherCheck, setWeatherCheck] = useState<WeatherResult | 'loading' | null>(null);
  const checkWeather = async () => {
    if (!plan || !lastParsed || weatherCheck === 'loading') return;
    setWeatherCheck('loading');
    try {
      const r = await fetch('/api/weather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: plan.destination, travelers: plan.travelers, days: lastParsed.durationDays ?? 3, month: lastParsed.month ?? 0, origin: lastParsed.origin ?? '', kids: lastParsed.kids ?? [], ...(lastParsed.routeOverride ? { routeOverride: lastParsed.routeOverride } : {}) }),
      });
      const j = (await r.json()) as WeatherResult;
      setWeatherCheck(j);
    } catch {
      setWeatherCheck(null);
    }
  };
  const displayCard = useMemo(
    () => (tripCard && weatherCheck && weatherCheck !== 'loading' && weatherCheck.swaps.length ? applySwaps(tripCard, weatherCheck.swaps) : tripCard),
    [tripCard, weatherCheck]
  );
  // Passport-validity check + Schengen 90/180 counter (round 3 #5,
  // Sherpa/IATA, Staywise): expiry month/year only (never the number),
  // checked against each route country's verified rule on the trip's
  // return date. The Schengen counter is "you've used X of 90 days" in
  // the last 180 days, minus this trip's Schengen days.
  const passportChecks: PassportCheck[] = useMemo(
    () => {
      const expiry = lastParsed?.passportExpiry;
      const card = displayCard ?? tripCard;
      if (!expiry || !card) return [];
      return checkPassportValidity(expiry, card.endDate, card.stops.map((s) => s.country));
    },
    [lastParsed, tripCard, displayCard]
  );
  const passportWarn = passportWarningLine(passportChecks);
  const schengenStops = useMemo(
    () => (displayCard ?? tripCard)?.stops.filter((s) => isSchengenCountry(s.country)) ?? [],
    [tripCard, displayCard]
  );
  const schengenTripDays = useMemo(() => {
    const card = displayCard ?? tripCard;
    if (!card || !schengenStops.length) return 0;
    const nights = schengenStops.reduce((a, s) => a + s.nights, 0);
    // Nights at Schengen stops + the departure day when the trip ends
    // in Schengen (a 13-night all-Schengen trip is 14 days in Schengen).
    return nights + (isSchengenCountry(card.stops[card.stops.length - 1].country) ? 1 : 0);
  }, [tripCard, displayCard, schengenStops]);
  const [schengenUsed, setSchengenUsed] = useState(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-schengen-used');
      if (raw !== null) setSchengenUsed(Math.min(90, Math.max(0, Number(raw) || 0)));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('fujintrip-schengen-used', String(schengenUsed)); } catch {}
  }, [schengenUsed]);
  const schengen = schengenRemaining(schengenUsed, schengenTripDays);
  // Pre-departure checklist (round 4 #2): generated from the trip's
  // own facts — passport, visa deadlines, insurance, weather-driven
  // packing, kids' ages, activities. The display card is the source
  // (weather swaps included); ticks persist per trip on this device.
  const checklist = useMemo(() => {
    const card = displayCard ?? tripCard;
    if (!card || !plan) return { items: [] as ChecklistItem[], key: '' };
    return {
      items: buildChecklist({ card, visaInfos, passportExpiry: lastParsed?.passportExpiry, passportChecks }),
      key: checklistKeyFor(card.destination, card.travelers, card.days),
    };
  }, [displayCard, tripCard, plan, visaInfos, lastParsed, passportChecks]);
  // Feasibility guardrail (round 4 #5): the departure-day flags and
  // the chat-vs-card audit for this trip — the plan view shows the
  // same check the chat quotes.
  const feasibility = useMemo(() => {
    const card = displayCard ?? tripCard;
    if (!card) return null;
    const flags = departureDayFlags(card, lastParsed?.departureTime);
    const audit = auditTrip(card);
    return { flags, audit, summary: feasibilitySummary(flags, audit) };
  }, [displayCard, tripCard, lastParsed]);
  // Connection checker (round 4 #5): the traveler's own connection,
  // checked against the rule minimums — 90 min international, 60
  // domestic. The 55-minute default is the report's LAX case.
  const [connMinutes, setConnMinutes] = useState(55);
  const [connIntl, setConnIntl] = useState(false);
  const [connTerminal, setConnTerminal] = useState(false);
  const [connSeparate, setConnSeparate] = useState(false);
  // Swapped-day tags: "city|day" -> the day it swapped with.
  const swappedDays = useMemo(() => {
    const m = new Map<string, number>();
    if (weatherCheck && weatherCheck !== 'loading') {
      for (const s of weatherCheck.swaps) {
        m.set(`${s.city}|${s.fromDay}`, s.toDay);
        m.set(`${s.city}|${s.toDay}`, s.fromDay);
      }
    }
    return m;
  }, [weatherCheck]);
  // Add to plan: the leg joins the trip plan AND the chat — the traveler
  // sees the pick in the conversation, not just on the map. The chat
  // line carries the bundle total and the last day a leg can still be
  // added, so the traveler knows the bundle stays open (round 2 #7).
  const addLegToPlan = (leg: TripLeg) => {
    const next = new Set(chosenLegs).add(leg.id);
    setChosenLegs(next);
    const nextBundle = bundleFromLegs(mapCard?.legs ?? [], next);
    const line = lockedUntil ? ` ${bundleLine(nextBundle, lockedUntil)}` : '';
    setMsgs((m) => [...m, { who: 'ai', text: `Added to your plan: ${leg.label} — from $${leg.price.toLocaleString()}.${line}` }]);
  };
  // Remove a leg from the bundle (round 2 #7): from the plan view's
  // bundle section — the total updates exactly, and the leg can be added
  // again from the map at the same price.
  const removeLegFromBundle = (id: string) => {
    setChosenLegs((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtDateYear = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // Live trip panel (Layla-dynamic round): the Trip Summary remounts
  // — and replays its entrance — only when a trip slot actually
  // changes (destination, travelers, origin, month, length, revised
  // route, tier). The signature is the trip's slots, so a re-render
  // with the same trip (typing, a stream chunk) leaves it still.
  const tripSignature = lastParsed
    ? [lastParsed.destination, lastParsed.travelers, lastParsed.origin ?? '', lastParsed.month ?? 0, lastParsed.durationDays ?? 0, JSON.stringify(lastParsed.routeOverride ?? null), choice].join('|')
    : '';
  // Trip Summary as a persistent, editable card (design #14, Layla): the
  // summary used to live inside a chat bubble, and a revision was a
  // sentence the traveler had to compose. Now the trip is a thing you
  // can see and edit — route with nights, dates, travelers, origin and
  // tier — and tapping a line asks Fujin AI to change that slot (the
  // revision flow confirms what changed and what did not). The nights
  // use the same distribution as the trip card, so the card and the
  // map always agree.
  const summaryRoute = useMemo(() => {
    if (!lastParsed?.destination) return '';
    const key = routeKeyForDestination(lastParsed.destination);
    const days = lastParsed.durationDays ?? 14;
    try {
      if (lastParsed.routeOverride?.cities.length) {
        const stops = stopsForRoute(key, lastParsed.routeOverride);
        return distributeNightsForStops(stops, days).map((l) => `${l.city} ${l.nights}n`).join(' → ');
      }
      if (key) return distributeNights(key, days).map((l) => `${l.city} ${l.nights}n`).join(' → ');
    } catch {}
    return lastParsed.destination;
  }, [lastParsed]);
  const summaryDates = useMemo(() => {
    if (!lastParsed?.month) return 'Not set yet';
    const start = mapCard ? mapCard.startDate : suggestedStart(lastParsed.month);
    const end = mapCard ? mapCard.endDate : start;
    return `${MONTH_NAMES[lastParsed.month - 1]} · ${fmtDate(start)} – ${fmtDate(end)}`;
  }, [lastParsed, mapCard]);
  // Tier radiogroup (design #6): arrows move between the three tiers and
  // select as they go (the ARIA radiogroup pattern); Space/Enter on a
  // focused tier selects it too.
  const tierGroupRef = useRef<HTMLDivElement>(null);
  const tierKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    const group = tierGroupRef.current;
    if (!group) return;
    const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
    const idx = radios.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (idx + 1) % radios.length : (idx - 1 + radios.length) % radios.length;
    radios[next].focus();
    setChoice(next);
  };
  // Chips fill, don't fire (Layla-dynamic round): a chip puts its
  // full prompt in the input and focuses it — the traveler edits, then
  // sends with Send/Enter. Only the "Build my plan" chip still acts
  // immediately (it runs the build, like the button below); the
  // destination-card "Plan this trip" seeding is untouched and still
  // starts the trip. data-fill on the button carries the same text so
  // the behavior is visible (and testable) in the markup.
  const fillChip = (c: Chip) => {
    if (c.action === 'build') { build(); return; }
    setInput(c.text ?? c.label);
    inputRef.current?.focus();
  };
  // Starter + follow-up chips (design #1, NN/g prompt controls): the
  // highest-impact chat element in the 2026 consensus — a first-time
  // visitor can start a trip in one tap instead of inventing a perfect
  // sentence, and the guided flow's questions become one-tap answers.
  // Max 4 visible; the row wraps to two rows so all four are seen
  // (the old one-row scroll clipped the 4th chip). Contextual, never
  // the same static set. A chip FILLS the input (Layla-dynamic round)
  // instead of sending — the traveler edits, then sends; "Build my
  // plan" runs the build action instead.
  type Chip = { label: string; text?: string; action?: 'build' };
  const hasUserMsg = msgs.some((m) => m.who === 'user');
  const lastAi = [...msgs].reverse().find((m) => m.who === 'ai');
  const chips: Chip[] = (() => {
    if (tripMode) {
      return [
        { label: 'Where to eat tonight?', text: 'Where should I eat tonight?' },
        { label: "What's open now?", text: "What's open now near me?" },
        { label: 'How do I get there?', text: 'How do I get there from here?' },
      ];
    }
    if (!hasUserMsg) {
      // M4: three starters — the fourth ("Family of 4, $2,000")
      // duplicated the budget the guided flow asks anyway, and the
      // S0 busy budget (≤10) leaves no room for it.
      return [
        { label: 'Central Europe in January', text: 'Central Europe in January' },
        { label: 'Warm beach in February', text: 'I want a warm beach in February' },
        { label: 'Surprise me', text: 'Surprise me' },
      ];
    }
    const r = lastAi?.text ?? '';
    if (/central europe/i.test(r) && /portugal/i.test(r)) {
      return [
        { label: 'Central Europe', text: 'Central Europe' },
        { label: 'Portugal', text: 'Portugal' },
      ];
    }
    if (/does this sound right/i.test(r)) {
      return [
        { label: 'Looks right', text: 'Looks right — build it' },
        { label: 'Change something', text: 'I want to change something' },
        { label: 'Make it cheaper', text: 'Make it cheaper' },
      ];
    }
    if (/flying from|departure city/i.test(r)) {
      return [
        { label: 'New York', text: 'New York' },
        { label: 'Los Angeles', text: 'Los Angeles' },
        { label: 'Chicago', text: 'Chicago' },
      ];
    }
    if (/when are you going|how long|how many days/i.test(r)) {
      return [
        { label: '2 weeks', text: '2 weeks' },
        { label: '10 days', text: '10 days' },
        { label: 'January', text: 'January' },
        { label: 'July', text: 'July' },
      ];
    }
    if (/how many kids|kids.{0,20}ages/i.test(r)) {
      return [
        { label: '2 kids, ages 4 and 7', text: '2 kids, ages 4 and 7' },
        { label: 'No kids', text: 'No kids, just adults' },
      ];
    }
    if (/budget/i.test(r) && /\?/.test(r)) {
      return [
        { label: '$1,500', text: 'My budget is $1,500' },
        { label: '$2,000', text: 'My budget is $2,000' },
        { label: '$3,000', text: 'My budget is $3,000' },
      ];
    }
    if (lastParsed?.destination) {
      return [
        { label: 'Build my plan', action: 'build' },
        { label: 'Make it cheaper', text: 'Make it cheaper' },
        { label: 'What should I eat there?', text: 'What should I eat there?' },
      ];
    }
    return [
      { label: 'Surprise me', text: 'Surprise me' },
      { label: 'Central Europe', text: 'Central Europe' },
      { label: 'Kyoto, 7 days', text: 'Kyoto for 7 days' },
    ];
  })();
  // N1: per-slot check — when a slot is filled (route, dates,
  // travelers, origin), that line replays the 250ms entrance and shows
  // a ✓ for 1.5s. One line at a time. Gated on hasUserMsg so a
  // restored trip does not flash checks on mount; an empty value is
  // never a fill (the line showing "Not set yet" is not a slot being
  // filled).
  const [filledSlot, setFilledSlot] = useState<'route' | 'dates' | 'travelers' | 'from' | null>(null);
  const prevSlotsRef = useRef({ route: '', dates: '', travelers: 0, from: '' });
  useEffect(() => {
    if (!hasUserMsg) return;
    const cur = {
      route: summaryRoute,
      dates: summaryDates,
      travelers: lastParsed?.travelers ?? 0,
      from: lastParsed?.origin ?? '',
    };
    const prev = prevSlotsRef.current;
    prevSlotsRef.current = cur;
    const changed = (['route', 'dates', 'travelers', 'from'] as const).find((k) => {
      if (cur[k] === prev[k]) return false;
      if (k === 'route' && !cur.route) return false;
      if (k === 'dates' && (cur.dates === 'Not set yet' || !cur.dates)) return false;
      if (k === 'travelers' && !cur.travelers) return false;
      if (k === 'from' && !cur.from) return false;
      return true;
    });
    if (!changed) return;
    setFilledSlot(changed);
    const t = setTimeout(() => setFilledSlot(null), 1500);
    return () => clearTimeout(t);
  }, [hasUserMsg, summaryRoute, summaryDates, lastParsed?.travelers, lastParsed?.origin]);
  return (
    <div>
      {/* App bar (app-shell round, Nov 12): the app's own bar — the
          FujinTrip mark (the slim hero folded into one line, so it
          doesn't push the app down), the "My Trips" switcher, and the
          running trip total + Book. The first viewport IS the app:
          chat | live trip | map, with the marketing sections below. */}
      <div className="appbar">
        <div className="appbar-brand">
          <SafeImg className="fujin-portrait" src={FUJIN_IMG} alt="Wind God by Ogata Korin — Fujin, the Japanese wind god" label="風" />
          <h1 className="appbar-title">FujinTrip</h1>
        </div>
        <div className="appbar-actions">
          <button
            type="button"
            className="ghost appbar-theme"
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
          <div className="mytrips-menu">
            <button type="button" className="ghost appbar-trips" aria-expanded={tripsOpen} aria-haspopup="true" onClick={() => setTripsOpen((o) => !o)}>
              My Trips ▾
            </button>
            {tripsOpen && (
              <>
                <button type="button" className="menu-backdrop" aria-label="Close My Trips menu" onClick={() => setTripsOpen(false)} />
                <div className="mytrips-dropdown" role="menu" aria-label="My Trips — switch trip">
                  <button type="button" role="menuitem" className="menu-new" onClick={() => { setTripsOpen(false); resetToGreeting(); }}>
                    ＋ New trip
                  </button>
                  {trips.length === 0 ? (
                    <p className="menu-note">No trips saved yet — a plan you book or watch will appear here.</p>
                  ) : (
                    trips.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="menuitem"
                        disabled={!t.destination}
                        title={t.destination ? `Switch to ${t.destination}` : 'A search request — no trip to open'}
                        onClick={() => switchToTrip(t)}
                      >
                        <span className="menu-label">{t.label}</span>
                        <span className="menu-sub">
                          {t.status} · {t.date}
                          {lastParsed?.destination === t.destination ? ' · Current' : ''}
                        </span>
                      </button>
                    ))
                  )}
                  <a href="#mytrips" className="menu-all" onClick={() => setTripsOpen(false)}>
                    See all in My Trips ↓
                  </a>
                </div>
              </>
            )}
          </div>
          {/* App bar total + Book (interface round §5): S0 shows neither
              — the first screen is the chat, not a price. S1 shows the
              hint that the total comes with the plan. S2 shows the total
              and the Book button. */}
          {lastParsed?.destination && (
            <span className="appbar-total">
              {plan ? (
                <>
                  <strong>${plan.options[choice].total.toLocaleString()}</strong>
                  <span className="appbar-total-label"> total · {plan.options[choice].name}</span>
                </>
              ) : (
                <span className="appbar-total-label">Build your plan to see the total</span>
              )}
            </span>
          )}
          {plan && (
            <button className="primary appbar-book" onClick={bookPlan} title="Book this plan with FujinTrip">
              Book
            </button>
          )}
        </div>
      </div>
      {/* Split screen (Nov 11) + trip panel (app shell, Nov 12): the
          chat stays still on the left, the trip is a live, editable
          object in the middle, the map fills the right and changes as
          the trip changes — the route and the flights, stays and cars
          as price tags the traveler can click to read more or add to
          the plan. Below 1200px the zones switch one at a time
          (data-zone); above it all three sit side by side. */}
      <div className={`chatmap${uiState === 'S0' ? ' chatmap-s0' : ''}`} data-zone={mobileZone}>
        {/* Zone switcher (narrow screens only — CSS hides it above
            1200px): Chat / Trip / Map. It renders only when ≥2 zones
            exist (M1): at S0 there is only the chat, so there is nothing
            to switch between. At 901–1200px the chat is always visible,
            so the Chat button hides and Trip swaps the map zone for the
            panel; below 900px the active zone is the bottom sheet over
            the map. The Trip button needs a plan, the Map button a
            route — each renders only when its zone exists. */}
        {uiState !== 'S0' && (
          <div className="zonebar" role="tablist" aria-label="Switch app view">
            <button type="button" role="tab" aria-selected={mobileZone === 'chat'} className={`zonebar-btn zonebar-chat${mobileZone === 'chat' ? ' selected' : ''}`} onClick={() => setMobileZone('chat')}>
              Chat
            </button>
            {plan && (
              <button type="button" role="tab" aria-selected={mobileZone === 'trip'} className={`zonebar-btn${mobileZone === 'trip' ? ' selected' : ''}`} onClick={() => setMobileZone('trip')}>
                Trip
              </button>
            )}
            {mapCard && (
              <button type="button" role="tab" aria-selected={mobileZone === 'map'} className={`zonebar-btn${mobileZone === 'map' ? ' selected' : ''}`} onClick={() => setMobileZone('map')}>
                Map
              </button>
            )}
          </div>
        )}
        <div className={`chatcol${tripMode ? ' tripmode-on' : ''}`}>
          {/* Offline banner (community round, design §7): a slim banner
              instead of a dead screen — the saved plan still works
              offline, live fares and chat replies do not. */}
          <OfflineBanner />
          {/* Trip Summary card (design #14): pinned above the messages,
              always visible once the chat knows a destination. Tap a line
              to change that slot; the tier row switches the plan tier
              through the revision flow. */}
          {lastParsed?.destination && (
            <div key={tripSignature} className="tripsummary panel-update" role="group" aria-label="Trip summary — tap a line to change it">
              <div className="tripsummary-title">Your trip</div>
              <button type="button" className={`tripsummary-line${filledSlot === 'route' ? ' slot-filled' : ''}`} disabled={thinking !== null || streamingText !== null} onClick={() => send('I want to change the route')} title="Tap to change the route">
                <span className="tripsummary-label">Route</span>
                <span>{summaryRoute}</span>
                {filledSlot === 'route' && <span className="slot-check" aria-hidden="true">✓</span>}
              </button>
              <button type="button" className={`tripsummary-line${filledSlot === 'dates' ? ' slot-filled' : ''}`} disabled={thinking !== null || streamingText !== null} onClick={() => send('I want to change the dates')} title="Tap to change the dates">
                <span className="tripsummary-label">Dates</span>
                <span>{summaryDates}</span>
                {filledSlot === 'dates' && <span className="slot-check" aria-hidden="true">✓</span>}
              </button>
              <button type="button" className={`tripsummary-line${filledSlot === 'travelers' ? ' slot-filled' : ''}`} disabled={thinking !== null || streamingText !== null} onClick={() => send('I want to change the party size')} title="Tap to change the party size">
                <span className="tripsummary-label">Travelers</span>
                <span>
                  {lastParsed.travelers} traveler{lastParsed.travelers > 1 ? 's' : ''}
                  {lastParsed.kids?.length ? ` · kids ${lastParsed.kids.join(', ')}` : ''}
                </span>
                {filledSlot === 'travelers' && <span className="slot-check" aria-hidden="true">✓</span>}
              </button>
              <button type="button" className={`tripsummary-line${filledSlot === 'from' ? ' slot-filled' : ''}`} disabled={thinking !== null || streamingText !== null} onClick={() => send('I want to change where I fly from')} title="Tap to change the departure city">
                <span className="tripsummary-label">From</span>
                <span>{lastParsed.origin || 'Not set yet'}</span>
                {filledSlot === 'from' && <span className="slot-check" aria-hidden="true">✓</span>}
              </button>
              {/* Tier row (interface round §5): only once a plan exists.
                  At S1 the summary is route/dates/travelers/from only —
                  tier buttons act on a plan, and there is none yet. */}
              {plan && (
                <div className="tripsummary-tiers" role="group" aria-label="Plan tier">
                  {(['Cheapest', 'Best value', 'Premium'] as const).map((name, i) => (
                    <button
                      key={name}
                      type="button"
                      className={`tripsummary-tier ${i === choice ? 'selected' : ''}`}
                      aria-pressed={i === choice}
                      disabled={thinking !== null || streamingText !== null}
                      onClick={() => send(i === 0 ? 'Make it cheaper' : i === 1 ? 'Best value' : 'Upgrade to Premium')}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="chat" ref={chatRef} aria-live="polite" aria-label="Conversation with Fujin AI">
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.who === 'user' ? 'user' : ''}`}>
                {m.who === 'ai' ? <div className={i === 0 && !hasUserMsg ? 'bubble greeting' : 'bubble'}>{formatReply(m.text)}</div> : <span className="bubble">{m.text}</span>}
                {m.who === 'ai' && m.tips && m.tips.length > 0 && (
                  <ul style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0 12px', paddingLeft: 16, textAlign: 'left' }}>
                    {m.tips.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {/* Streaming reply (design #2): the partial reply renders as it
                arrives, so the wait feels like under a second instead of
                3.4s of silence. The typing indicator covers the wait
                before the first chunk — "Searching live fares…" after 5s. */}
            {streamingText !== null && (
              <div className="msg">
                <div className="bubble">{formatReply(streamingText)}</div>
              </div>
            )}
            {thinking !== null && streamingText === null && (
              <div className="msg">
                <div className="bubble">
                  {thinking === 'searching' ? 'Searching live fares…' : 'Fujin is thinking…'}
                  <span className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            )}
          </div>
          {/* Running total (design #8): "In your plan so far" lived in
              .maphints, which is display:none on phones — the one number
              that tells a phone traveler what they have built was hidden
              exactly where it matters most. It now sits in the chat
              panel, visible on every viewport. */}
          {chosenLegs.size > 0 && mapCard && (
            <p className="no-print" style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
              In your plan so far: {chosenLegs.size} of {mapCard.legs.length} items · ${bundleTotal(bundle).toLocaleString()}
            </p>
          )}
          <div className="row">
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={tripMode ? `On your trip in ${lastParsed?.destination ?? '…'} — ask anything…` : 'Try: Bali, 2 travelers, surf and food'} aria-label="Ask Fujin AI" />
            {/* While Fujin AI is thinking or streaming, Send becomes Stop:
                the traveler can cut off a wrong or overlong answer instantly
                and keep the partial text. */}
            <button
              className="primary"
              onClick={() => ((thinking !== null || streamingText !== null) ? streamAbortRef.current?.abort() : send())}
              aria-label={thinking !== null || streamingText !== null ? 'Stop generating' : 'Send'}
            >
              {thinking !== null || streamingText !== null ? 'Stop' : 'Send'}
            </button>
          </div>
          <div className="chips no-print" role="group" aria-label="Quick replies">
            {chips.map((c) => (
              <button key={c.label} type="button" className="chip" disabled={thinking !== null || streamingText !== null} data-fill={c.action === 'build' ? undefined : (c.text ?? c.label)} onClick={() => fillChip(c)}>
                {c.label}
              </button>
            ))}
          </div>
          {/* Dietary slot at intake (round 3 #3, Layla/Triply): one tap
              sets the dietary need for this trip and the profile — food
              answers respect it from the next reply. Shown until it is
              set (or dismissed), and only before the plan is built:
              intake, not a permanent row. It stays OFF the first paint
              (M4) — the S0 screen is the greeting, the input and 3
              chips — and appears once the traveler has said something. */}
          {!profile.dietary && !dietaryDismissed && !plan && hasUserMsg && (
            <div className="chips no-print" role="group" aria-label="Dietary needs" style={{ paddingTop: 2 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center' }}>Any dietary needs?</span>
              {DIETARY_OPTIONS.slice(0, dietaryMore ? undefined : 4).map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className="chip"
                  onClick={() => {
                    onProfileChange({ ...profile, dietary: d.value });
                    setDietaryNote(
                      d.value === 'none'
                        ? 'Noted — no dietary needs.'
                        : `Noted — ${d.label.toLowerCase()}. Food suggestions will respect this; menus are not checked, so ask the restaurant.`
                    );
                  }}
                >
                  {d.label}
                </button>
              ))}
              {!dietaryMore && DIETARY_OPTIONS.length > 4 && (
                <button type="button" className="chip" onClick={() => setDietaryMore(true)}>
                  More…
                </button>
              )}
              <button type="button" className="chip" aria-label="Hide dietary question" onClick={() => setDietaryDismissed(true)}>✕</button>
            </div>
          )}
          {dietaryNote && <p className="no-print" style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 0' }}>{dietaryNote}</p>}
          {/* One trust line under the input (design §2.2): the
              no-hidden-margin line used to repeat here, in the plan
              section and in the footer — it now lives once, near the
              prices in the plan section and in the footer. */}
          <p className="selling">Gathers everything into one plan · Customized for you · Verify before you book</p>
          {aiLive !== null && <p className="no-print" style={{ fontSize: 12, color: 'var(--muted)' }}>{aiLive ? 'Fujin AI is live.' : 'Fujin AI is offline — using the built-in planner.'}</p>}
          <p className="no-print" style={{ marginTop: 16 }}>
            {/* Progressive reveal (M4/S0 budget): "Build my plan" with
                no trip yet builds a Kyoto default the traveler never
                asked for — it appears once the traveler has said
                something (or a trip is restored), when there is a trip
                to build. A restored trip still shows it. */}
            {(lastParsed || hasUserMsg) && (<><button className="primary" onClick={build}>Build my plan</button>{' '}</>)}
            {lastParsed && (
              <button className="ghost" onClick={() => setTripMode((m) => !m)}>
                {tripMode ? `✓ On-trip mode on — ${lastParsed.destination}` : 'Take this plan on your trip'}
              </button>
            )}
          </p>
          {/* "Prefer forms?" (interface round M2): the 8-tab bar is gone.
              The chat is the way in; the search forms live behind this
              one quiet disclosure — a text button, not a tab — and open
              inline, in the chat column, instead of swapping the page. */}
          <div className="no-print" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="forms-toggle"
              aria-expanded={formsOpen}
              onClick={() => setFormsOpen((o) => !o)}
            >
              Prefer forms? Search flights, hotels, cruises…
            </button>
            {formsOpen && (
              <div className="forms-panel">
                <div className="row" style={{ alignItems: 'center', marginBottom: 4 }}>
                  <label htmlFor="forms-category" style={{ fontSize: 13, fontWeight: 600 }}>What are you looking for?</label>
                  <select id="forms-category" value={formTab} onChange={(e) => setFormTab(e.target.value as Tab)} aria-label="Search category" style={{ flex: '0 0 auto' }}>
                    {TABS.filter((t) => t !== 'Fujin AI').map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
                <SearchForm tab={formTab} onSave={(label) => onSaveTrip(label, 'Request saved')} />
              </div>
            )}
          </div>
          {/* Start Anywhere (competitor learning round 2 #6, Mindtrip):
              paste a link to a travel article, or paste the text of
              one — the trip is drafted from the places it names. */}
          <div className="no-print" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8, background: 'var(--card)' }}>
            <strong style={{ fontSize: 13 }}>Start from a link</strong>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 8px' }}>Paste a link to a travel article, or paste the text of one — I’ll draft the trip from the places it names, with the notes from your link on each stop. (Screenshots and PDF files can’t be read yet — paste a web link or the text instead.)</p>
            <div className="row">
              <input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startFromLink()} placeholder="Paste a link or article text" aria-label="Link or text to start a trip from" />
              <button className="ghost" onClick={startFromLink} disabled={!linkInput.trim() || linkBusy}>{linkBusy ? 'Reading…' : 'Start from this'}</button>
            </div>
          </div>
          {tripMode && lastParsed && (
            <div className="ontrip-wrap no-print">
              {/* Today on your trip (community round, design §7): the plan
                  in the traveler's pocket — Now/Next first, the day's
                  timeline, the essentials strip, the day's map, and the
                  offline + share controls. The on-trip chat input is
                  directly above, so Fujin AI is one tap away from today. */}
              {mapCard && (
                <TodayView
                  card={mapCard}
                  destination={lastParsed.destination}
                  travelers={lastParsed.travelers}
                  days={lastParsed.durationDays ?? 14}
                  month={lastParsed.month ?? 0}
                  origin={lastParsed.origin ?? ''}
                  choice={choice}
                  onSos={() => setSosOpen(true)}
                  onFindDinner={() => {
                    void fetchTonightPlaces();
                    setTimeout(() => document.getElementById('tonight-near-you')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
                  }}
                />
              )}
              <p className="plan-muted">On-trip mode for {lastParsed.destination}: short, right-now answers — where to eat tonight, what’s open, how to get there. (WhatsApp delivery comes later — it needs a business number.)</p>
              {/* Check my flight (competitor learning #5, TripIt Pro /
                  Romie / Layla): live status, gate + baggage, and the
                  "my flight was cancelled" path to rebooking options. */}
              <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8, background: 'var(--card)' }}>
                <strong style={{ fontSize: 13 }}>Check my flight</strong>
                <div className="row" style={{ marginTop: 8 }}>
                  <input value={flightNo} onChange={(e) => setFlightNo(e.target.value)} placeholder="Flight number, e.g. UAL123" aria-label="Flight number" style={{ textTransform: 'uppercase' }} />
                  <input type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} aria-label="Departure date" />
                  <button className="ghost" onClick={checkFlight} disabled={!flightNo.trim() || !flightDate || flightStatus === 'loading'}>
                    {flightStatus === 'loading' ? 'Checking…' : 'Check status'}
                  </button>
                </div>
                {flightStatus && flightStatus !== 'loading' && flightStatus.live && (
                  <div style={{ marginTop: 10, fontSize: 13, textAlign: 'left' }}>
                    <strong>
                      {flightStatus.flight} — {flightStatus.cancellationConfirmed ? 'Cancelled (confirmed)' : flightStatus.status}
                      {typeof flightStatus.delayedMinutes === 'number' && flightStatus.delayedMinutes > 0 ? ` · delayed ${flightStatus.delayedMinutes} min` : ''}
                      {flightStatus.diverted ? ' · diverted' : ''}
                    </strong>
                    {(flightStatus.origin?.city || flightStatus.destination?.city) && (
                      <p style={{ margin: '4px 0' }}>
                        {flightStatus.origin?.city || flightStatus.origin?.iata}{flightStatus.origin?.name ? ` (${flightStatus.origin.name})` : ''} → {flightStatus.destination?.city || flightStatus.destination?.iata}{flightStatus.destination?.name ? ` (${flightStatus.destination.name})` : ''}
                      </p>
                    )}
                    <p style={{ margin: '4px 0' }}>
                      Departs {flightStatus.scheduledDeparture ? new Date(flightStatus.scheduledDeparture).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                      {flightStatus.estimatedDeparture && flightStatus.estimatedDeparture !== flightStatus.scheduledDeparture ? ` (now ${new Date(flightStatus.estimatedDeparture).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})` : ''}
                      {' · '}Arrives {flightStatus.scheduledArrival ? new Date(flightStatus.scheduledArrival).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                      {flightStatus.estimatedArrival && flightStatus.estimatedArrival !== flightStatus.scheduledArrival ? ` (now ${new Date(flightStatus.estimatedArrival).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})` : ''}
                    </p>
                    <p style={{ margin: '4px 0', color: 'var(--muted)' }}>
                      {flightStatus.terminalOrigin ? `Terminal ${flightStatus.terminalOrigin}` : ''}
                      {flightStatus.gateOrigin ? ` · gate ${flightStatus.gateOrigin}` : ''}
                      {flightStatus.terminalDestination || flightStatus.gateDestination ? ` · arrival ${flightStatus.terminalDestination ? `terminal ${flightStatus.terminalDestination}` : ''}${flightStatus.terminalDestination && flightStatus.gateDestination ? ', ' : ''}${flightStatus.gateDestination ? `gate ${flightStatus.gateDestination}` : ''}` : ''}
                      {flightStatus.baggageClaim ? ` · baggage claim ${flightStatus.baggageClaim}` : ''}
                    </p>
                    {flightStatus.cancellationUnconfirmed && flightStatus.cancellationNote && (
                      <p style={{ margin: '4px 0', color: '#b45309' }}>{flightStatus.cancellationNote}</p>
                    )}
                    {(() => { const hint = leaveNow(flightStatus); return hint ? <p style={{ margin: '4px 0', fontWeight: 600 }}>{hint}</p> : null; })()}
                  </div>
                )}
                {flightStatus && flightStatus !== 'loading' && !flightStatus.live && (
                  <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>{flightStatus.message ?? 'Live flight status isn’t available for this flight right now.'}</p>
                )}
                <button className="ghost" style={{ marginTop: 10 }} onClick={reportCancellation}>
                  ✈ My flight was cancelled — what are my options?
                </button>
              </div>
              {/* Tonight near you (competitor learning round 2 #4): the 3
                  places open now in the city the traveler is in — name,
                  price band, open-now, walk time, dish and one Wikivoyage
                  quote. Fetched on demand; a place whose hours cannot be
                  verified says so, never guessed open. */}
              <div id="tonight-near-you" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8, background: 'var(--card)' }}>
                <strong style={{ fontSize: 13 }}>Tonight near you</strong>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="ghost" onClick={fetchTonightPlaces} disabled={tonight === 'loading'}>
                    {tonight === 'loading' ? 'Finding places open now…' : `Where to eat tonight in ${foodCity}?`}
                  </button>
                </div>
                {tonight && tonight !== 'loading' && tonight.places.length > 0 && (
                  <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', fontSize: 13, textAlign: 'left' }}>
                    {tonight.places.map((p) => (
                      <li key={p.name} style={{ marginBottom: 10 }}>
                        <strong>{p.name}</strong>
                        {p.priceBand ? ` · ${p.priceBand}` : ''} · {p.openNow === true ? 'Open now' : p.openNow === false ? 'Closed now' : 'Hours not verified'}
                        {p.walkMinutes ? ` · about ${p.walkMinutes}-min walk from the city center (estimate)` : ''}
                        {p.dish ? <div style={{ marginTop: 2 }}>{p.dish}</div> : null}
                        {p.quote ? <div style={{ marginTop: 2, color: 'var(--muted)' }}>Wikivoyage says: “{p.quote}”</div> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {tonight && tonight !== 'loading' && tonight.places.length === 0 && (
                  <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>I couldn&apos;t confirm anywhere open tonight in {foodCity} — the guide has no Eat listings I could verify. Try asking Fujin AI, or check back later.</p>
                )}
              </div>
            </div>
          )}
        </div>
        {/* Live trip panel (app shell + interface round §5, M1): the
            middle zone — the itinerary as an editable timeline, fed by
            the same trip card and plan the map and the plan view use.
            It renders only when a plan exists; its "No trip yet" empty
            state is gone — at S0/S1 there is no panel at all. */}
        {plan && (
          <TripPanel
            card={mapCard}
            plan={plan}
            choice={choice}
            onTier={panelTier}
            travelers={lastParsed?.travelers ?? 2}
            onTravelers={panelTravelers}
            month={lastParsed?.month ?? 0}
            onMonth={panelMonth}
            bestTime={lastParsed?.destination ? bestTimeFor(lastParsed.destination) : null}
            kids={lastParsed?.kids ?? []}
            onEditStop={panelEditStop}
            notice={panelNotice}
            onBuild={build}
            onBook={bookPlan}
            busy={thinking !== null || streamingText !== null}
            onSos={() => setSosOpen(true)}
          />
        )}
        {/* Map zone (interface round §5, M1): renders only when the
            trip has a route — at S0 there is no map, no placeholder, no
            "Open the map" button. The zone appears with the destination. */}
        {mapCard && (
          <div className="mapcol no-print panel-update">
            <>
              <div className="mapdialog-bar" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{mapCard.stops.length} stop{mapCard.stops.length !== 1 ? 's' : ''} · {mapCard.legs.length} price tags</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SosButton compact onOpen={() => setSosOpen(true)} />
                  <button type="button" className="ghost" onClick={() => setMapOpen(true)} aria-label="Open the full-screen map" style={{ minHeight: 44 }}>
                    ⤢ Open the map
                  </button>
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <TripMap
                  stops={mapStops}
                  legs={mapLegs}
                  selectedLegId={selectedLeg?.id ?? null}
                  onSelectLeg={(leg) => {
                    setSelectedLeg(leg);
                    setLegExpanded(false);
                  }}
                  addedLegIds={[...chosenLegs]}
                  dark={theme === 'dark'}
                />
              </div>
              {selectedLeg && (
                <div className="legcard">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <strong>
                      {selectedLeg.icon} {selectedLeg.label}
                    </strong>
                    <button className="ghost" aria-label="Close" onClick={() => setSelectedLeg(null)} style={{ padding: '6px 12px', minHeight: 44, minWidth: 44 }}>
                      ×
                    </button>
                  </div>
                  <p>
                    from <strong>${selectedLeg.price.toLocaleString()}</strong> · {selectedLeg.detail}
                  </p>
                  {selectedLeg.fareClass && (
                    <p style={{ fontSize: 13, margin: '4px 0' }}>
                      <b>Fare class:</b> {selectedLeg.fareClass}
                    </p>
                  )}
                  {selectedLeg.terms && (
                    <p className="plan-note">{selectedLeg.terms}</p>
                  )}
                  {(selectedLeg.kind === 'flight' || selectedLeg.kind === 'transport') && (
                    <KnowHowBlock entries={[selectedLeg.knowHow, selectedLeg.knowHowExtra]} />
                  )}
                  {legExpanded && <p style={{ fontSize: 14 }}>{selectedLeg.more}</p>}
                  <div className="row">
                    <button className="ghost" onClick={() => setLegExpanded((e) => !e)}>
                      {legExpanded ? 'Show less' : 'Read more'}
                    </button>
                    {chosenLegs.has(selectedLeg.id) ? (
                      <button className="ghost" disabled>
                        ✓ Added to your plan
                      </button>
                    ) : (
                      <button className="primary" onClick={() => addLegToPlan(selectedLeg)}>
                        Add to plan
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="maphints">
                {!selectedLeg && (
                  <p className="maphint">Click a price tag on the map to see the flight, stay or car — then read more or add it to your plan.</p>
                )}
              </div>
              {/* Full-screen map dialog (Layla-dynamic round): the same
                  route, numbered stops and price tags, on the whole
                  screen. The inline map stays mounted behind it — the
                  dialog is a second, larger view, not a replacement —
                  and it only mounts while open. Esc closes it. */}
              {mapOpen && (
                <div className="mapdialog panel-update" role="dialog" aria-modal="true" aria-label={`Full-screen map — ${mapCard.title}`}>
                  <div className="mapdialog-bar">
                    <strong>{mapCard.title}</strong>
                    <button type="button" className="ghost" onClick={() => setMapOpen(false)} autoFocus aria-label="Close the full-screen map" style={{ minHeight: 44 }}>
                      × Close
                    </button>
                  </div>
                  <div className="mapdialog-map">
                    <TripMap
                      stops={mapStops}
                      legs={mapLegs}
                      selectedLegId={selectedLeg?.id ?? null}
                      onSelectLeg={(leg) => {
                        setSelectedLeg(leg);
                        setLegExpanded(false);
                      }}
                      addedLegIds={[...chosenLegs]}
                      dark={theme === 'dark'}
                    />
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 0' }}>Click a price tag to read more or add it to your plan — the same tags as on the map beside the chat. Esc closes this view.</p>
                </div>
              )}
            </>
          </div>
        )}
      </div>
      {plan && (
        <div className="plan-print" style={{ marginTop: 20 }}>
          <h3>Your {plan.destination} plan — pick one</h3>
          {tripCard && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: '4px 0' }}>{tripCard.title}</h3>
              <p className="plan-note">
                {tripCard.days} days · {tripCard.stops.length} {tripCard.stops.length > 1 ? 'cities' : 'city'} · {tripCard.experiences} experiences · {tripCard.hotels} {tripCard.hotels > 1 ? 'stays' : 'stay'} · {tripCard.transports} transports
              </p>
              {tripCard.familyNote && (
                <p style={{ fontSize: 14, margin: '8px 0', background: 'var(--accent-soft)', border: '1px solid #ead9c8', borderRadius: 10, padding: '10px 14px' }}>
                  <strong>Family pace</strong> — {tripCard.familyNote}
                </p>
              )}
              <p className="plan-line">
                <strong>{fmtDateYear(tripCard.startDate)} – {fmtDateYear(tripCard.endDate)}</strong>{' '}
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>(Suggested dates — change anytime.)</span>
              </p>
              <p style={{ fontSize: 14, margin: '8px 0' }}>{tripCard.routeLine}</p>
              {/* The map lives in the split screen above — it shows the
                  route and the price tags there, not inside the plan. */}
              <p className="print-only plan-muted">Map: {tripCard.routeLine}</p>
              <div className="plan-box">
                <strong style={{ fontSize: 14 }}>Top improvement for your budget</strong>
                <p className="plan-line">{tripCard.budgetTip}</p>
              </div>
              {/* The stops render from the display card (round 2 #10):
                  when a weather/closure swap applies, the two days'
                  activities exchange places — the dates stay put. */}
              {(displayCard ?? tripCard).stops.map((stop, si) => (
                <Expandable
                  key={stop.city}
                  className="plan-section"
                  defaultOpen={si === 0}
                  summary={
                    <>
                      <strong>Days {stop.days[0]?.day ?? si + 1}{stop.days.length > 1 ? `-${stop.days[stop.days.length - 1].day}` : ''} · {fmtDate(stop.startDate)} – {fmtDate(stop.endDate)} · {stop.city}</strong>
                      {' '}· {stop.nights} night{stop.nights > 1 ? 's' : ''} · stay from ${stop.stayEstimate.toLocaleString()}
                    </>
                  }
                >
                  <p style={{ margin: '4px 0' }}>{stop.intro}</p>
                  {/* Start Anywhere (round 2 #6): the sentence from the
                      traveler's own link that named this stop — kept with
                      the plan so the trip remembers where it came from. */}
                  {stop.sourceTip && (
                    <p className="plan-note">From your link: “{stop.sourceTip}”</p>
                  )}
                  {/* Stay + transport rows expand inline (Layla-dynamic
                      round — Layla's hotel cards expand the same way):
                      the summary carries the price, the detail carries
                      the nights, the mode and the honest note. The
                      transport row shows the travel day — no per-leg
                      duration exists in the data (only one prose mention,
                      Prague → Vienna "about 4 hours"), so no hours are
                      invented; live times arrive with live inventory. */}
                  <Expandable
                    className="plan-row"
                    summary={
                      <>
                        {stop.transportIn.mode} · {fmtDate(stop.startDate)} · {stop.transportIn.from} → {stop.city} · from ${stop.transportIn.price.toLocaleString()} <span style={{ color: 'var(--muted)' }}>{si === 0 && (displayCard ?? tripCard).flight.out.live ? `(Duffel test fare — ${(displayCard ?? tripCard).flight.out.airline})` : '(estimate)'}</span>
                      </>
                    }
                  >
                    <p className="plan-line">Mode: {stop.transportIn.mode} · {stop.transportIn.from} → {stop.city}</p>
                    {si === 0 && (displayCard ?? tripCard).flight.out.live ? (
                      <p className="plan-line">Travel day: {fmtDate(stop.startDate)} · {(displayCard ?? tripCard).flight.out.airline} ${stop.transportIn.price.toLocaleString()} (Duffel test fare, {stop.transportIn.from} → {stop.city})</p>
                    ) : (
                      <p className="plan-line">Travel day: {fmtDate(stop.startDate)} · from ${stop.transportIn.price.toLocaleString()} (planning estimate)</p>
                    )}
                    {si === 0 && (displayCard ?? tripCard).flight.out.live ? (
                      <p className="plan-note">Duffel test fare — fetched from Duffel, not a live quote and not bookable yet. Real bookable fares need Duffel live mode.</p>
                    ) : (
                      <p className="plan-note">Live times arrive with live inventory — until then this is a planning estimate, not a live quote.</p>
                    )}
                    {/* Arrival-time anchoring (round 4 #3): Day 1 starts
                        from the landing time — set it here or tell Fujin
                        in the chat ("we land at 7am"). */}
                    {si === 0 && (
                      <div style={{ marginTop: 6 }}>
                        <label style={{ fontSize: 13 }}>
                          When does your flight land?{' '}
                          <input type="time" value={lastParsed?.landingTime ?? ''} onChange={(e) => { const v = e.target.value; setLastParsed((p) => (p ? { ...p, ...(v ? { landingTime: v } : { landingTime: undefined }) } : p)); }} aria-label="Landing time" />
                        </label>
                        <p className="plan-line" style={{ marginTop: 4 }}>{(displayCard ?? tripCard).arrival.line}</p>
                      </div>
                    )}
                    <KnowHowBlock entries={[stop.transportIn.knowHow, stop.transportIn.knowHowExtra]} />
                  </Expandable>
                  <Expandable
                    className="plan-row"
                    summary={
                      <>
                        Stay from ${stop.stayEstimate.toLocaleString()} · {stop.nights} night{stop.nights > 1 ? 's' : ''} <span style={{ color: 'var(--muted)' }}>(planning estimate)</span>
                      </>
                    }
                  >
                    <p className="plan-line">{stop.nights} night{stop.nights > 1 ? 's' : ''} in {stop.city} · hostel / guesthouse estimate from ${stop.stayEstimate.toLocaleString()}</p>
                    <p className="plan-note">Planning estimate — real named stays with ratings arrive with a hotel supplier (Expedia / Duffel Stays). Nothing is booked until you confirm it.</p>
                    {/* Forgotten costs (round 4 #4): the fee warning on
                        the stay — the resort fee / tourist tax is never
                        in the plan total, so the leg says so. */}
                    <p className="plan-note">{(displayCard ?? tripCard).forgotten.feeWarning}</p>
                  </Expandable>
                  <p style={{ fontSize: 14, margin: '8px 0 4px' }}><b>Itinerary</b></p>
                  {stop.days.map((d) => (
                    <Expandable
                      key={d.day}
                      className="plan-row plan-day"
                      summary={
                        <>
                          Day {d.day} · {fmtDate(d.date)} · {d.experiences} experiences — {d.title}
                          {swappedDays.get(`${stop.city}|${d.day}`) ? ` ↔ swapped with Day ${swappedDays.get(`${stop.city}|${d.day}`)}` : ''}
                        </>
                      }
                    >
                      <p className="plan-line">{d.experiences} experience{d.experiences !== 1 ? 's' : ''} planned — {d.title}</p>
                      {/* Pace guard (round 4 #1): a day over the
                          traveler's pace says so on its own card, with
                          the count, the max and the choice. */}
                      {d.paceWarning ? <p className="plan-line" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>⚠️ {d.paceWarning}</p> : null}
                      {d.weatherF ? <p className="plan-line">Typical high {d.weatherF}°F in {MONTH_NAMES[d.date.getMonth()]} — a seasonal average, not a forecast.</p> : null}
                      {swappedDays.get(`${stop.city}|${d.day}`) ? <p className="plan-line">Swapped with Day {swappedDays.get(`${stop.city}|${d.day}`)} by the weather / closure check.</p> : null}
                    </Expandable>
                  ))}
                </Expandable>
              ))}
              {/* Weather / closure day-swap (round 2 #10): the Plan
                  updates box — what changed and why, with the check
                  dates. The button runs the check on demand. */}
              <div className="plan-section">
                <strong>Plan updates — weather &amp; closures</strong>
                {weatherCheck === null && (
                  <div style={{ marginTop: 8 }}>
                    <p className="plan-note">Checks the closures on your dates (Louvre, Uffizi, Vatican Museums) and the 16-day rain forecast — and swaps a day when one is closed or rainy.</p>
                    <button className="ghost" onClick={checkWeather}>Check weather &amp; closures</button>
                  </div>
                )}
                {weatherCheck === 'loading' && (
                  <p className="plan-line">Checking weather &amp; closures…</p>
                )}
                {weatherCheck && weatherCheck !== 'loading' && (
                  <div style={{ marginTop: 8 }}>
                    {weatherCheck.swaps.length ? (
                      weatherCheck.swaps.map((s, i) => (
                        <p key={i} className="plan-line">
                          {s.type === 'closure' ? 'Closed' : 'Rain'} — Day {s.fromDay} (“{s.fromTitle}”) swaps with Day {s.toDay} (“{s.toTitle}”) in {s.city}: {s.reason}
                        </p>
                      ))
                    ) : (
                      <p className="plan-line">Nothing needs to move — no closures on your dates, and no rainy outdoor day.</p>
                    )}
                    {!weatherCheck.forecastAvailable && (
                      <p className="plan-note">
                        {weatherCheck.forecastReason === 'too_far'
                          ? `Weather forecast not available yet — your trip starts ${weatherCheck.startDate}, more than 16 days out.`
                          : weatherCheck.forecastReason === 'past'
                            ? `Weather forecast not available — your trip starts ${weatherCheck.startDate}, which has already passed.`
                            : 'The weather forecast could not be loaded just now — the closures above are still checked.'}
                      </p>
                    )}
                    <p className="plan-note">Closure rules checked {weatherCheck.closuresCheckedAt} · forecast from Open-Meteo, checked {new Date(weatherCheck.checkedAt).toLocaleString()}.</p>
                    <button className="ghost" onClick={checkWeather}>Check again</button>
                  </div>
                )}
              </div>
              {/* Add-to-bundle-later (round 2 #7): the legs picked from
                  the map, with the exact total and the last day a leg
                  can still be added at the same bundled price. */}
              {bundle.legs.length > 0 && (
                <div className="plan-section">
                  <strong>Your bundle — {bundle.legs.length} item{bundle.legs.length > 1 ? 's' : ''} · ${bundleTotal(bundle).toLocaleString()}</strong>
                  {lockedUntil && (
                    <p className="plan-note">Locked until {lockedUntil} — you can add your hotel, car or activities any time before then, at the same bundled price.</p>
                  )}
                  {bundle.legs.map((leg) => (
                    <p key={leg.id} className="plan-line">
                      {leg.label} · ${leg.price.toLocaleString()}{' '}
                      <button className="ghost" onClick={() => removeLegFromBundle(leg.id)}>Remove</button>
                    </p>
                  ))}
                </div>
              )}
              {/* Split the trip (round 2 #8): per-person + total for the
                  chosen tier, and the expense record with the simplified
                  settle-up. No money moves here — the travelers settle
                  up between themselves. */}
              {plan && plan.travelers > 1 && (
                <div className="plan-section">
                  <strong>Split the trip — {plan.options[choice].name}</strong>
                  <p className="plan-line">
                    {splitPeople.map((p) => `${p.label} $${p.total.toLocaleString()}`).join(' · ')} — ${splitTotal.toLocaleString()} total for {plan.travelers} travelers.
                  </p>
                  <p className="plan-note">Record who paid what on the trip — FujinTrip works out who owes whom. No money moves here; settle up between yourselves.</p>
                  <div className="row" style={{ marginTop: 8 }}>
                    <select value={expPayer || splitPeople[0]?.label || ''} onChange={(e) => setExpPayer(e.target.value)} aria-label="Who paid">
                      {splitPeople.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                    </select>
                    <input type="number" min="0.01" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="Amount ($)" aria-label="Amount in dollars" />
                    <input value={expNote} onChange={(e) => setExpNote(e.target.value)} placeholder="What was it? (optional)" aria-label="What the expense was for" />
                    <button className="ghost" onClick={addExpense} disabled={!expAmount || Number(expAmount) <= 0}>Add expense</button>
                  </div>
                  <p style={{ fontSize: 13, margin: '8px 0 4px' }}>Shared by (leave all ticked to split evenly):</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
                    {splitPeople.map((p) => (
                      <label key={p.label}>
                        <input type="checkbox" checked={expShares.length === 0 || expShares.includes(p.label)} onChange={(e) => setExpShares((prev) => {
                          const all = splitPeople.map((q) => q.label);
                          const base = prev.length ? prev : all;
                          return e.target.checked ? [...new Set([...base, p.label])] : base.filter((s) => s !== p.label);
                        })} /> {p.label}
                      </label>
                    ))}
                  </div>
                  {expenses.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {expenses.map((e) => (
                        <p key={e.id} className="plan-line">
                          {e.payer} paid ${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{e.note ? ` — ${e.note}` : ''} · split between {e.shares.join(', ')}{' '}
                          <button className="ghost" onClick={() => setExpenses((prev) => prev.filter((x) => x.id !== e.id))}>Remove</button>
                        </p>
                      ))}
                      <p style={{ fontSize: 14, margin: '8px 0 4px' }}><b>Settle up</b></p>
                      {settle.payments.length ? (
                        settle.payments.map((s, i) => <p key={i} style={{ fontSize: 14, margin: '3px 0' }}>{settlementLine(s)}</p>)
                      ) : (
                        <p className="plan-line">All settled — nobody owes anyone.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <Expandable
                className="plan-section"
                summary={
                  <>
                    {tripCard.returnTransport.mode} · {fmtDate(tripCard.endDate)} · {tripCard.stops[tripCard.stops.length - 1].city} → {tripCard.origin || 'your city'} · from ${tripCard.returnTransport.price.toLocaleString()} <span style={{ color: 'var(--muted)' }}>{tripCard.flight.back.live ? `(Duffel test fare — ${tripCard.flight.back.airline})` : '(estimate)'}</span>
                  </>
                }
              >
                <p className="plan-line">Mode: ✈️ Flight · {tripCard.stops[tripCard.stops.length - 1].city} → {tripCard.origin || 'your city'}</p>
                {tripCard.flight.back.live ? (
                  <p className="plan-line">Travel day: {fmtDate(tripCard.endDate)} · {tripCard.flight.back.airline} ${tripCard.returnTransport.price.toLocaleString()} (Duffel test fare, {tripCard.stops[tripCard.stops.length - 1].city} → {tripCard.origin || 'your city'})</p>
                ) : (
                  <p className="plan-line">Travel day: {fmtDate(tripCard.endDate)} · from ${tripCard.returnTransport.price.toLocaleString()} (planning estimate)</p>
                )}
                {tripCard.flight.back.live ? (
                  <p className="plan-note">Duffel test fare — fetched from Duffel, not a live quote and not bookable yet. Real bookable fares need Duffel live mode.</p>
                ) : (
                  <p className="plan-note">Live times arrive with live inventory — until then this is a planning estimate, not a live quote.</p>
                )}
                {/* Arrival-time anchoring (round 4 #3): the last day ends
                    at the airport — set the departure time and the plan
                    tells you when to leave for it. */}
                <div style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 13 }}>
                    When does your flight home leave?{' '}
                    <input type="time" value={lastParsed?.departureTime ?? ''} onChange={(e) => { const v = e.target.value; setLastParsed((p) => (p ? { ...p, ...(v ? { departureTime: v } : { departureTime: undefined }) } : p)); }} aria-label="Departure time" />
                  </label>
                  <p className="plan-line" style={{ marginTop: 4 }}>{tripCard.departure.line}</p>
                </div>
                <KnowHowBlock entries={[tripCard.returnTransport.knowHow]} />
              </Expandable>
              {/* Live fares, reconciled (finish-the-web-version round):
                  the card's flight legs are the Duffel test fares the
                  chat quoted — one total with them, the planning
                  estimate beside it, and the service fee on its own
                  line. The comparison table below stays planner-based
                  (FujinTrip vs booking separately); this line is what
                  keeps the two from looking like three different
                  totals. */}
              {(displayCard ?? tripCard).flight.live && (
                <p className="plan-note" style={{ marginTop: 12 }}>
                  ✈️ Flights on this trip use the same Duffel test fares as the chat —{' '}
                  {(displayCard ?? tripCard).flight.out.live ? `${(displayCard ?? tripCard).flight.out.airline} $${(displayCard ?? tripCard).flight.out.price.toLocaleString()} out (test fare)` : `$${(displayCard ?? tripCard).flight.out.price.toLocaleString()} out (planning estimate)`}{' '}
                  ·{' '}
                  {(displayCard ?? tripCard).flight.back.live ? `${(displayCard ?? tripCard).flight.back.airline} $${(displayCard ?? tripCard).flight.back.price.toLocaleString()} back (test fare)` : `$${(displayCard ?? tripCard).flight.back.price.toLocaleString()} back (planning estimate)`}.{' '}
                  Total with live fares ${(displayCard ?? tripCard).total.toLocaleString()} (planning estimate ${(displayCard ?? tripCard).plannerTotal.toLocaleString()}) · + ${(displayCard ?? tripCard).flight.serviceFee.toLocaleString()} service fee per flight order, shown separately at checkout, never hidden in the fare. Test fares are not live quotes and not bookable yet.
                </p>
              )}
              {comparison && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Our rate vs other options</h3>
                  <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--line)' }}>
                        <th style={{ padding: '6px 0' }}></th>
                        <th style={{ padding: '6px 0' }}>FujinTrip — Best value</th>
                        <th style={{ padding: '6px 0' }}>Booking separately</th>
                        <th style={{ padding: '6px 0' }}>Other sites (cached)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>Flights</td><td>${comparison.best.flight.toLocaleString()}</td><td>${comparison.separate.flight.toLocaleString()}</td><td rowSpan={4} style={{ verticalAlign: 'top' }}>{competitorFares?.available ? (<><div><strong>Flights from ${competitorFares.total?.toLocaleString()}</strong>{competitorFares.travelers > 1 ? ` for ${competitorFares.travelers} travelers` : ''}</div><div style={{ color: 'var(--muted)' }}>${competitorFares.farePerTraveler?.toLocaleString()} per traveler, round trip{competitorFares.airline ? ` · ${competitorFares.airline}` : ''}{typeof competitorFares.stops === 'number' ? ` · ${competitorFares.stops === 0 ? 'nonstop' : `${competitorFares.stops} stop${competitorFares.stops > 1 ? 's' : ''}`}` : ''} · {competitorFares.originIata} → {competitorFares.destIata}</div><div style={{ color: 'var(--muted)' }}>{competitorFares.label}</div><div style={{ color: 'var(--muted)' }}>Flights only — no cached hotel, car or activity comparison yet.</div></>) : (<span style={{ color: 'var(--muted)' }}>{competitorFares ? competitorFares.label : 'Cached competitor fares for this trip will appear here once the trip has a departure city — labeled with the date they were checked. Nothing invented in the meantime.'}</span>)}</td></tr>
                      <tr><td>Hotels</td><td>${comparison.best.hotel.toLocaleString()}</td><td>${comparison.separate.hotel.toLocaleString()}</td></tr>
                      <tr><td>Car</td><td>${comparison.best.car.toLocaleString()}</td><td>${comparison.separate.car.toLocaleString()}</td></tr>
                      <tr><td>Activities</td><td>${comparison.best.activities.toLocaleString()}</td><td>${comparison.separate.activities.toLocaleString()}</td></tr>
                      <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}><td>Total</td><td>${comparison.best.total.toLocaleString()}</td><td>${comparison.separate.total.toLocaleString()}</td></tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 14, margin: '8px 0' }}>
                    You save <strong>${comparison.save.toLocaleString()} (~{comparison.savePercent}%)</strong> with FujinTrip vs booking each leg separately. Prices are planning estimates, not live quotes.
                  </p>
                </div>
              )}
              {/* Forgotten costs (round 4 #4): the real trip total —
                  the plan total plus the labeled estimate lines for
                  the categories travelers forget (food, local
                  transport, bags, resort/tourist tax, tips, SIM,
                  insurance, transfers). */}
              {tripCard && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>The real trip total — what it actually costs</h3>
                  <p className="plan-line">Plan total ({['Cheapest', 'Best value', 'Premium'][choice]}): <strong>${(displayCard ?? tripCard).total.toLocaleString()}</strong> — flights, stays, transport between cities and activities.</p>
                  {(displayCard ?? tripCard).forgotten.lines.map((l) => (
                    <p key={l.id} className="plan-line">{l.label}: ${l.amount.toLocaleString()} <span style={{ color: 'var(--muted)' }}>({l.note})</span></p>
                  ))}
                  <p className="plan-line" style={{ fontWeight: 700, borderTop: '2px solid var(--line)', paddingTop: 6 }}>
                    Real trip total: about ${((displayCard ?? tripCard).total + (displayCard ?? tripCard).forgotten.total).toLocaleString()} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(planning estimates — the lines above are estimates, not live quotes)</span>
                  </p>
                  <p className="plan-note">{(displayCard ?? tripCard).forgotten.feeWarning}</p>
                </div>
              )}
              {/* Feasibility guardrail (round 4 #5, S half): the
                  departure-day flags and the chat-vs-card audit for
                  this trip, plus a connection checker for the
                  traveler's own connection. The M half (per-airport
                  MCT data, transit-visa check) is still to come. */}
              {feasibility && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Feasibility checks</h3>
                  <p className="plan-line">{feasibility.summary}</p>
                  {feasibility.flags.map((f, i) => (
                    <p key={i} className="plan-line" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>⚠️ {f}</p>
                  ))}
                  {!feasibility.audit.ok && feasibility.audit.issues.map((issue, i) => (
                    <p key={i} className="plan-line" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>⚠️ {issue.message}</p>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    <strong style={{ fontSize: 14 }}>Check a connection</strong>
                    <p className="plan-note">The minimum is 90 minutes international, 60 domestic — the rule version of minimum connection time. Real per-airport MCT data is still to come.</p>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 13 }}>
                        Minutes between flights{' '}
                        <input type="number" min={0} max={600} value={connMinutes} onChange={(e) => setConnMinutes(Math.max(0, Number(e.target.value) || 0))} aria-label="Minutes between flights" style={{ width: 72 }} />
                      </label>
                      <label style={{ fontSize: 13 }}>
                        <input type="checkbox" checked={connIntl} onChange={(e) => setConnIntl(e.target.checked)} /> International
                      </label>
                      <label style={{ fontSize: 13 }}>
                        <input type="checkbox" checked={connTerminal} onChange={(e) => setConnTerminal(e.target.checked)} /> Terminal change
                      </label>
                      <label style={{ fontSize: 13 }}>
                        <input type="checkbox" checked={connSeparate} onChange={(e) => setConnSeparate(e.target.checked)} /> Separate tickets
                      </label>
                    </div>
                    {(() => {
                      const c = checkConnection({ minutes: connMinutes, international: connIntl, terminalChange: connTerminal, separateTicket: connSeparate });
                      return c.ok ? (
                        <p className="plan-line">That connection is fine — {connMinutes} minutes meets the {connIntl ? 90 : 60}-minute minimum.</p>
                      ) : (
                        c.flags.map((f, i) => <p key={i} className="plan-line" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>⚠️ {f}</p>)
                      );
                    })()}
                  </div>
                </div>
              )}
              {visaInfos.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Visa &amp; entry requirements</h3>
                  <p className="plan-note">
                    {VISA_PASSPORT_NOTE} Checked {VISA_LAST_CHECKED} — check before you book.
                  </p>
                  {visaInfos.map((v) => (
                    <div key={v.country} style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 0' }}>
                      <strong style={{ fontSize: 14 }}>{v.country}</strong>
                      <p className="plan-line">{v.visa}</p>
                      <p className="plan-line"><b>Passport:</b> {v.passport}</p>
                      {v.notes.map((n) => (
                        <p key={n} className="plan-line">{n}</p>
                      ))}
                      <p style={{ fontSize: 13, margin: '4px 0' }}>
                        Official source: <a href={v.sourceUrl} target="_blank" rel="noreferrer">{v.source}</a>
                      </p>
                    </div>
                  ))}
                  {/* Passport-validity check + Schengen 90/180 counter
                      (round 3 #5): expiry month/year only — never the
                      number, never stored anywhere else. The check runs
                      against each route country's verified rule on the
                      trip's return date. */}
                  <div style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 0' }}>
                    <strong style={{ fontSize: 14 }}>Passport validity check</strong>
                    <p className="plan-line">When does your passport expire? Month and year only — never the passport number.</p>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <select aria-label="Passport expiry month" value={lastParsed?.passportExpiry?.month ?? ''} onChange={(e) => { const m = Number(e.target.value); setLastParsed((p) => (p ? { ...p, ...(m ? { passportExpiry: { month: m, year: p.passportExpiry?.year ?? new Date().getFullYear() + 1 } } : { passportExpiry: undefined } ) } : p)); }}>
                        <option value="">Month</option>
                        {MONTH_NAMES.map((n, i) => (<option key={n} value={i + 1}>{n}</option>))}
                      </select>
                      <select aria-label="Passport expiry year" value={lastParsed?.passportExpiry?.year ?? ''} onChange={(e) => { const y = Number(e.target.value); setLastParsed((p) => (p ? { ...p, ...(y ? { passportExpiry: { month: p.passportExpiry?.month ?? 1, year: y } } : { passportExpiry: undefined } ) } : p)); }}>
                        <option value="">Year</option>
                        {Array.from({ length: 15 }, (_, i) => new Date().getFullYear() + i).map((y) => (<option key={y} value={y}>{y}</option>))}
                      </select>
                    </div>
                    {lastParsed?.passportExpiry && passportChecks.length > 0 && (
                      <>
                        {passportWarn ? (
                          <p className="plan-line" style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{passportWarn}</p>
                        ) : (
                          <p className="plan-line">Your passport is valid for every country on this trip, with margin. {passportChecks.map((c) => c.note).filter(Boolean).join(' ')}</p>
                        )}
                        {passportChecks.filter((c) => c.status === 'unknown').map((c) => (
                          <p key={c.country} className="plan-line">No verified validity rule for {c.country} — check before you go.</p>
                        ))}
                      </>
                    )}
                  </div>
                  {schengenStops.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--line-soft)', padding: '10px 0' }}>
                      <strong style={{ fontSize: 14 }}>Schengen 90/180 counter</strong>
                      <p className="plan-line">US citizens can spend 90 days in Schengen in any 180-day period, counted across all Schengen countries together. This trip spends about {schengenTripDays} day{schengenTripDays === 1 ? '' : 's'} in Schengen.</p>
                      <label style={{ fontSize: 14 }}>
                        Days you&apos;ve already used in Schengen in the last 180 days:{' '}
                        <input type="number" min={0} max={90} value={schengenUsed} onChange={(e) => setSchengenUsed(Math.min(90, Math.max(0, Number(e.target.value) || 0)))} aria-label="Schengen days already used" style={{ width: 72 }} />
                      </label>
                      <p className="plan-line">
                        You&apos;ve used {schengen.used} of 90 days{schengen.trip ? `, this trip takes ${schengen.trip} more` : ''} — <strong>{schengen.over ? `over by ${-schengen.remaining} day${schengen.remaining === -1 ? '' : 's'} — shorten the trip or shift it` : `${schengen.remaining} day${schengen.remaining === 1 ? '' : 's'} left after this trip`}</strong>.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* Pre-departure checklist (round 4 #2): generated from
                  this trip — passport, visa deadlines, insurance,
                  weather-driven packing, kids' ages, activities. */}
              {checklist.items.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Before you go — checklist</h3>
                  <Checklist items={checklist.items} storageKey={checklist.key} />
                </div>
              )}
              {/* Solo mode (round 3 #4): the supplement named, the
                  workaround, the social options, and the safety Q&A —
                  shown only for 1 traveler. No place is labeled safe. */}
              {plan.travelers === 1 && (
                <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
                  <strong style={{ fontSize: 14 }}>Traveling solo</strong>
                  <p className="plan-line">{soloLine()}</p>
                  <p className="plan-line"><b>Is it safe to travel alone here?</b> FujinTrip doesn&apos;t label places safe or unsafe — check the latest official travel advice for your destination before you go, and stick to well-lit main streets at night.</p>
                  <p className="plan-line"><b>What if something goes wrong?</b> Your emergency contact is {emergencyContact.name ? `${emergencyContact.name}${emergencyContact.phone ? ` — ${emergencyContact.phone}` : ''}` : 'not set yet — add one in My Trips below'}; on the trip, on-trip mode has the flight-status check and the FujinTrip team follows up on booking requests.</p>
                </div>
              )}
              {/* Best time to travel (competitor learning round 2 #5,
                  Kayak): the 12-month strip for this route — price band,
                  crowds and typical temperatures per month, with the best
                  month starred and the trip's own month outlined. Typical
                  season, not live prices. */}
              {plan && bestTime && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Best time to travel</h3>
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    {bestTime.months.map((m) => {
                      const isBest = m.month === bestTime.bestMonth;
                      const isTrip = lastParsed?.month === m.month;
                      const bg = m.season === 'peak' ? '#c2410c' : m.season === 'shoulder' ? '#f0f0ee' : '#e8eef7';
                      const color = m.season === 'peak' ? '#fff' : '#111';
                      return (
                        <div
                          key={m.month}
                          title={`${MONTH_NAMES[m.month - 1]} — ${m.season} season, ${m.crowds} crowds, ${m.price} prices${m.tempLow !== null && m.tempHigh !== null ? `, typically ${m.tempLow}–${m.tempHigh}°C` : ''}`}
                          style={{
                            flex: 1,
                            background: bg,
                            color,
                            borderRadius: 8,
                            padding: '8px 0',
                            textAlign: 'center',
                            fontSize: 12,
                            fontWeight: 600,
                            outline: isTrip ? '2px solid #0a0a0a' : 'none',
                            outlineOffset: 1,
                          }}
                        >
                          {MONTH_NAMES[m.month - 1].slice(0, 1)}
                          {isBest ? ' ★' : ''}
                        </div>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0' }}>
                    <span style={{ background: '#c2410c', color: '#fff', borderRadius: 4, padding: '0 6px' }}>Peak</span>{' '}
                    <span style={{ background: '#f0f0ee', borderRadius: 4, padding: '0 6px' }}>Shoulder</span>{' '}
                    <span style={{ background: '#e8eef7', borderRadius: 4, padding: '0 6px' }}>Low</span>{' '}
                    ★ best month · outlined = your month
                  </p>
                  <p className="plan-line">
                    <strong>Best month to go: {MONTH_NAMES[bestTime.bestMonth - 1]}</strong> — {bestTime.bestNote};{' '}
                    {bestTime.months[bestTime.bestMonth - 1].crowds} crowds, {bestTime.months[bestTime.bestMonth - 1].price} prices
                    {bestTime.months[bestTime.bestMonth - 1].tempLow !== null && bestTime.months[bestTime.bestMonth - 1].tempHigh !== null
                      ? `, typically ${bestTime.months[bestTime.bestMonth - 1].tempLow}–${bestTime.months[bestTime.bestMonth - 1].tempHigh}°C across ${bestTime.cities.join(', ')}`
                      : ''}
                    .
                  </p>
                  {lastParsed?.month && lastParsed.month !== bestTime.bestMonth && (
                    <p className="plan-line">
                      Your month ({MONTH_NAMES[lastParsed.month - 1]}) is {bestTime.months[lastParsed.month - 1].season} season —{' '}
                      {bestTime.months[lastParsed.month - 1].crowds} crowds, {bestTime.months[lastParsed.month - 1].price} prices
                      {bestTime.months[lastParsed.month - 1].tempLow !== null && bestTime.months[lastParsed.month - 1].tempHigh !== null
                        ? `, typically ${bestTime.months[lastParsed.month - 1].tempLow}–${bestTime.months[lastParsed.month - 1].tempHigh}°C`
                        : ''}
                      .
                    </p>
                  )}
                  <p className="plan-note">Typical season — not live prices, not a weather forecast.</p>
                </div>
              )}
              {plan && (
                <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
                  <strong style={{ fontSize: 14 }}>Book now or wait?</strong>
                  {priceCheck === 'loading' && <p className="plan-line">Checking the live fares for this trip…</p>}
                  {priceCheck && priceCheck !== 'loading' && priceCheck.live && (
                    <>
                      <p className="plan-line">{priceCheck.line}</p>
                      {priceCheck.trend && priceCheck.trend.line ? (
                        <p className="plan-line">{priceCheck.trend.line}</p>
                      ) : (
                        <p className="plan-note">No price history yet — watch this trip&apos;s prices and we&apos;ll show whether the fares are drifting up or down.</p>
                      )}
                      <p className="plan-note">
                        Cheapest live fares: {priceCheck.out[0] ? `${priceCheck.out[0].airline} $${priceCheck.out[0].price.toLocaleString()} out` : 'no outbound fare'} · {priceCheck.back[0] ? `${priceCheck.back[0].airline} $${priceCheck.back[0].price.toLocaleString()} back` : 'no return fare'} · {priceCheck.departDate} → {priceCheck.returnDate}. Live Duffel fares (test fares in test mode).
                      </p>
                    </>
                  )}
                  {priceCheck && priceCheck !== 'loading' && !priceCheck.live && (
                    <p className="plan-line">
                      Live fares aren&apos;t available for this trip yet{priceCheck.reason === 'missing_slots' ? ' — we still need the departure city and dates' : ' — no live fare was returned'} — the plan&apos;s flight budget is ${priceCheck.plannerFlight.toLocaleString()} (estimate). Watch the price and we&apos;ll tell you when a live fare drops.
                    </p>
                  )}
                  <p style={{ margin: '8px 0 0' }}>
                    <button className="ghost" onClick={watchPrice}>Watch this trip&apos;s prices</button>{' '}
                    <button className="ghost" onClick={() => { priceCheckKeyRef.current = ''; void fetchPriceCheck(); }}>Check again</button>
                  </p>
                </div>
              )}
              <p style={{ fontSize: 15, margin: '12px 0 0' }}>
                From <strong>${plan.options[choice].total.toLocaleString()}</strong> total ({plan.options[choice].name}){' '}
                <button className="primary no-print" onClick={bookPlan} style={{ marginLeft: 8 }}>Book</button>
              </p>
            </div>
          )}
          <div className="compare" style={{ marginTop: 12 }} role="radiogroup" aria-label="Choose your plan tier" ref={tierGroupRef} onKeyDown={tierKeys}>
            {plan.options.map((o, i) => (
              <div
                key={o.name}
                className={`box tier ${i === choice ? 'best chosen' : ''}`}
                role="radio"
                aria-checked={i === choice}
                aria-label={`${o.name} — $${o.total.toLocaleString()} total`}
                tabIndex={0}
                onClick={() => setChoice(i)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setChoice(i);
                  }
                }}
              >
                {i === choice && (
                  <span className="tier-check" aria-hidden="true">
                    ✓
                  </span>
                )}
                <strong>{o.name}</strong>
                {i === 1 && <span className="tier-badge">★ Best value</span>}
                <p className="tier-price">${o.total.toLocaleString()}</p>
                <table><tbody>
                  <tr><td>Flights</td><td>${o.flight}</td></tr>
                  <tr><td>Hotel</td><td>${o.hotel}</td></tr>
                  <tr><td>Car</td><td>${o.car}</td></tr>
                  <tr><td>Activities</td><td>${o.activities}</td></tr>
                </tbody></table>
                <p className="plan-muted">{fareClassForTier(i).name} — {fareClassForTier(i).includes.join(', ')}{fareClassForTier(i).excludes.length ? `; ${fareClassForTier(i).excludes.join(', ')}` : ''}</p>
                <p className="plan-muted">{o.note}</p>
              </div>
            ))}
          </div>
          <p className="notice">Planning estimates — not a live quote. Prices come from suppliers once connected; we never invent live fares.</p>
          <p className="print-only">Your choice: {plan.options[choice].name} — ${plan.options[choice].total.toLocaleString()} for {plan.travelers} traveler{plan.travelers > 1 ? 's' : ''}. Also available: {plan.options.map((o, i) => (i === choice ? null : `${o.name} $${o.total.toLocaleString()}`)).filter(Boolean).join(' · ')}.</p>
          <div className="row no-print" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={sharePlan}>Share plan</button>
            <button className="ghost" onClick={requestPdf}>{planBooked ? 'Save as PDF — free, you booked with us' : 'Save as PDF — $1 (free if you book)'}</button>
            <button className="ghost" onClick={bookPlan}>Book this plan with FujinTrip</button>
            <button className="ghost" onClick={watchPrice}>Watch this price</button>
            <button className="ghost" onClick={holdPrice}>Hold my price</button>
            <button className="ghost" onClick={askHuman}>Ask a human to check this plan</button>
            <button className="ghost" onClick={startNewTrip}>Start a new trip</button>
          </div>
          {actionMsg && <p className="no-print" style={{ fontSize: 13, color: '#111', whiteSpace: 'pre-line' }}>{actionMsg}</p>}
          {pdfNotice && (
            <div className="no-print" style={{ fontSize: 13, color: '#111', marginTop: 8 }}>
              <p style={{ margin: '4px 0' }}>{pdfNotice}</p>
              {pdfPay && (
                <p style={{ margin: '4px 0' }}>
                  <button className="ghost" onClick={bookPlan}>Book this plan with FujinTrip</button>{' '}
                  <button className="ghost" onClick={() => { setPdfNotice(''); setPdfPay(false); }}>Dismiss</button>
                </p>
              )}
            </div>
          )}
          {/* Day by day now lives in the trip card above (real sight names
          per city); the generic template days were redundant. */}
          <h3 style={{ marginTop: 24 }}>How to book</h3>
          <p style={{ fontSize: 14 }}>Book the <strong>{plan.options[choice].name}</strong> plan — ${plan.options[choice].total.toLocaleString()} for {plan.travelers} traveler{plan.travelers > 1 ? 's' : ''} — with FujinTrip. One booking, one price; no bouncing between booking sites. Prices are planning estimates, not live quotes.</p>
          <ul style={{ fontSize: 14 }}>
            <li style={{ marginBottom: 8 }}><strong>Flights:</strong> booked with FujinTrip — your fare is passed through at cost, plus our service fee shown separately at checkout.</li>
            <li style={{ marginBottom: 8 }}><strong>Hotels:</strong> booked with FujinTrip — the team confirms your stay with the hotel.</li>
            <li style={{ marginBottom: 8 }}><strong>Car rental:</strong> booked with FujinTrip — picked up at the airport or your hotel.</li>
            <li><strong>Activities:</strong> booked with FujinTrip — tickets and guides confirmed before you travel.</li>
          </ul>
          <p><button className="primary no-print" onClick={bookPlan}>Book this plan with FujinTrip</button></p>
          <p className="print-only">To book: save a booking request in My Trips on fujintrip.com — the FujinTrip team follows up. Live booking activates with Duffel live mode. https://fujintrip.com</p>
          <p className="notice">A booking request — the team follows up; live booking activates with Duffel live mode. Nothing is booked on another site.</p>
          <h3 style={{ marginTop: 24 }}>What travelers say</h3>
          {cityVoices.length > 0 && ((displayCard ?? tripCard)?.stops ?? []).some((s) => cityVoices.some((cv) => cv.city === s.city)) ? (
            <div>
              <p className="plan-muted">From real traveler guides, per city — never invented reviews. Source: Wikivoyage traveler guide, fetched live.</p>
              {((displayCard ?? tripCard)?.stops ?? [])
                .filter((s) => cityVoices.some((cv) => cv.city === s.city))
                .map((s) => {
                  const cv = cityVoices.find((x) => x.city === s.city)!;
                  return (
                    <div key={s.city} style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 14, margin: '4px 0' }}><strong>{s.city}</strong></p>
                      {cv.text ? (
                        cv.text.split('\n').filter((l) => l.trim()).map((line, i) => (
                          <p key={i} style={{ fontSize: 14, margin: '2px 0' }}>{line}</p>
                        ))
                      ) : (
                        <p style={{ fontSize: 14, color: 'var(--muted)', margin: '2px 0' }}>No traveler tips for {s.city} yet.</p>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : voices && voices.destination === plan.destination ? (
            <div>
              <p className="plan-muted">From real traveler guides — never invented reviews. Source: {voices.source || 'Wikivoyage traveler guide, fetched live'}.</p>
              {voices.text.split('\n').filter((l) => l.trim()).map((line, i) => (
                <p key={i} style={{ fontSize: 14 }}>{line}</p>
              ))}
            </div>
          ) : guide ? (
            <div>
              <p className="plan-muted">From researched traveler guides — real dishes and places, never invented reviews. Source: {guide.source}.</p>
              <p><b>Dishes to know:</b></p>
              <ul>{guide.dishes.map((d) => <li key={d}>{d}</li>)}</ul>
              <p><b>Named places:</b></p>
              <ul>{guide.places.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : (
            <p>No traveler notes fetched for {plan.destination} yet — ask Fujin AI about it in the chat and fresh notes will be pulled in live.</p>
          )}
          {/* Travelers from this trip (community round, design §6): only
              human-approved posts on verified trips appear here — the
              highest-trust surface. An empty strip is an honest
              invitation, never filled with invented posts. */}
          <div style={{ marginTop: 16 }}>
            <ReelsStrip destination={plan.destination} onPost={() => onShareReel?.(plan.destination)} />
          </div>
          <h3>Money-saving tips</h3>
          <ul>{plan.tips.map((t) => <li key={t}>{t}</li>)}</ul>
          <p className="plan-muted">Travellers liked: {plan.liked.join(' · ')} — Book it all with FujinTrip, one booking, one price.</p>
          {/* Spacer so the sticky bar never covers the last lines of the
              plan while the traveler reads them. */}
          <div className="no-print" style={{ height: 64 }} aria-hidden="true" />
        </div>
      )}
      {/* Sticky bottom bar (design #3): the plan's total + one Book action,
          visible while the traveler reads the plan — on a phone it is the
          one thumb, one action that ends the page. */}
      {plan && (
        <div className="stickybar no-print" role="region" aria-label="Plan total and booking">
          <span className="total">
            <strong>${plan.options[choice].total.toLocaleString()}</strong> total · {plan.options[choice].name} · {plan.travelers} traveler{plan.travelers > 1 ? 's' : ''}
          </span>
          <button className="primary" onClick={bookPlan}>Book</button>
        </div>
      )}
      {/* Emergency sheet (emergency-button build): mounts only while
          open — at S0 it is never in the tree. */}
      {sosOpen && mapCard && lastParsed && (
        <EmergencySheet
          open={sosOpen}
          onClose={() => setSosOpen(false)}
          countries={mapCard.stops.map((s) => s.country)}
          destination={lastParsed.destination}
          routeLine={mapCard.stops.map((s) => s.city).join(' → ')}
          travelers={lastParsed.travelers}
          days={lastParsed.durationDays ?? mapCard.days}
          datesLine={`${fmtDate(mapCard.startDate)}–${fmtDate(mapCard.endDate)}`}
          origin={lastParsed.origin ?? ''}
          contact={emergencyContact}
          embassy={embassyNumber}
          onEmbassyChange={onEmbassyChange}
          checkIn={checkIn}
          onSetCheckIn={(due) => setCheckIn({ due, surfaced: false })}
          onClearCheckIn={() => setCheckIn(null)}
        />
      )}
    </div>
  );
}

function SearchForm({ tab, onSave }: { tab: Tab; onSave: (label: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [who, setWho] = useState('2 travelers');
  const [result, setResult] = useState('');
  const submit = async () => {
    // Empty fields must not silently become JFK→LHR (design §2.2): a
    // traveler who taps Search without typing gets a fare for a route
    // they never asked about. Ask for the route instead — nothing is
    // saved and nothing is searched until the route is given.
    if (tab === 'Flights' && !from.trim() && !to.trim()) {
      setResult('Add the route first — where are you flying from, and to where?');
      return;
    }
    const label = `${tab}: ${from || 'Anywhere'} → ${to || 'Anywhere'} · ${date || 'Flexible'} · ${who}`;
    onSave(label);
    if (tab === 'Flights') {
      try {
        const r = await fetch('/api/duffel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: from || 'JFK', destination: to || 'LHR', date, travelers: 2 }) });
        const j = await r.json();
        setResult(`${j.label} — from $${j.offers?.[0]?.price ?? '—'} ${j.offers?.[0] ? `(${j.live ? 'live fare' : 'estimate'})` : ''} Saved to My Trips.`);
      } catch { setResult('Saved to My Trips as a request.'); }
    } else {
      setResult('Saved to My Trips as a request — we’ll match it to live suppliers once connected.');
    }
  };
  return (
    <div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" aria-label="From" />
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To / destination" aria-label="Destination" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Travelers"><option>1 traveler</option><option>2 travelers</option><option>3 travelers</option><option>4 travelers</option><option>Family (5+)</option></select>
        <button className="primary" onClick={submit}>Search {tab}</button>
      </div>
      {result && <p style={{ marginTop: 12 }}>{result}</p>}
      <p className="notice">Searches are saved as requests. Prices are planning estimates until live suppliers are connected.</p>
    </div>
  );
}

export default function Home() {
  const [trips, setTrips] = useState<Trip[]>([]);
  // Theme (interface round §6): the discovery map follows the same
  // theme as the trip map — the Chat hook owns the toggle, this hook
  // just listens (lib/theme.ts dispatches on every change).
  const [theme] = useTheme();
  // Preference profile (round 3 #2): stated preferences, carried across
  // trips on this device (localStorage, no accounts). Validated on load
  // so a corrupt or foreign value never reaches the chat.
  const [profile, setProfile] = useState<TravelerProfile>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-profile');
      if (raw) setProfile(parseProfile(JSON.parse(raw)));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('fujintrip-profile', JSON.stringify(profile)); } catch {} }, [profile]);
  // Emergency contact (round 3 #4, solo mode): name + phone, on this
  // device only — shown on solo trip cards, editable in My Trips.
  const [emergencyContact, setEmergencyContact] = useState<{ name: string; phone: string }>({ name: '', phone: '' });
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-emergency-contact');
      if (raw) {
        const c = JSON.parse(raw) as { name?: unknown; phone?: unknown };
        setEmergencyContact({ name: typeof c.name === 'string' ? c.name.slice(0, 80) : '', phone: typeof c.phone === 'string' ? c.phone.slice(0, 40) : '' });
      }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('fujintrip-emergency-contact', JSON.stringify(emergencyContact)); } catch {} }, [emergencyContact]);
  // Embassy / consulate number (emergency-button build): the
  // traveler's own number, typed in My Trips — never looked up,
  // never invented. Stored on this device only, like the contact.
  const [embassyNumber, setEmbassyNumber] = useState('');
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-embassy-number');
      if (raw) setEmbassyNumber(raw.slice(0, 40));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('fujintrip-embassy-number', embassyNumber); } catch {} }, [embassyNumber]);
  // Price watches (competitor learning #4): a drop is measured against
  // the live fare when the watch started — never against the planner
  // estimate. Stored in localStorage, like the trips.
  const [watches, setWatches] = useState<PriceWatch[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-watches');
      if (raw) setWatches(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('fujintrip-watches', JSON.stringify(watches)); } catch {} }, [watches]);
  const addWatch = (w: Omit<PriceWatch, 'id' | 'baselineAt' | 'lastCheckedAt'>) => {
    setWatches((all) => {
      // One watch per trip — the existing one keeps its baseline.
      if (all.some((x) => x.destination === w.destination && x.origin === w.origin && x.month === w.month && x.durationDays === w.durationDays && x.travelers === w.travelers)) return all;
      return [{ id: String(Date.now()), ...w, baselineAt: new Date().toISOString(), lastCheckedAt: w.lastTotal !== null ? new Date().toISOString() : null }, ...all];
    });
  };
  const checkWatch = async (id: string) => {
    const w = watches.find((x) => x.id === id);
    if (!w) return;
    try {
      const r = await fetch('/api/price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: w.origin, destination: w.destination, travelers: w.travelers, month: w.month, durationDays: w.durationDays, ...(w.history.length ? { history: w.history } : {}) }),
      });
      const j = (await r.json()) as PriceCheckData;
      setWatches((all) =>
        all.map((x) => {
          if (x.id !== id) return x;
          // A watch with no baseline yet starts the moment a live fare
          // appears — the first live fare becomes the baseline, and the
          // first observation in the history. Every later live check
          // appends to the history (deduped — the same total on the same
          // day adds nothing), so the trend is read from real checks.
          if (x.baseline === null && j.live) {
            return { ...x, baseline: j.liveTotal, baselineAt: new Date().toISOString(), lastTotal: j.liveTotal, lastCheckedAt: new Date().toISOString(), history: appendObservation([], j.liveTotal) };
          }
          return { ...x, history: j.live ? appendObservation(x.history, j.liveTotal) : x.history, lastTotal: j.live ? j.liveTotal : x.lastTotal, lastCheckedAt: new Date().toISOString() };
        })
      );
    } catch {}
  };
  // The trip Fujin AI most recently understood — the price-comparison
  // section below follows it. Null until the user chats: Kyoto example.
  const [aiTrip, setAiTrip] = useState<{ destination: string; travelers: number; kids?: number[] } | null>(null);
  const cmp = useMemo(() => comparisonFor(aiTrip?.destination ?? 'Kyoto', aiTrip?.travelers ?? 2, { kids: aiTrip?.kids ?? [] }), [aiTrip]);
  const [loc, setLoc] = useState('default');
  const [locName, setLocName] = useState('');
  const [geoStatus, setGeoStatus] = useState('Use your location, or pick a city below — we only use it to show nearby trips.');
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-trips');
      if (raw) setTrips(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('fujintrip-trips', JSON.stringify(trips)); } catch {} }, [trips]);
  const saveTrip = (label: string, status = 'Request saved', destination?: string) => setTrips((t) => [{ id: String(Date.now()), label, status, date: new Date().toLocaleDateString(), ...(destination ? { destination } : {}) }, ...t]);
  // Destination cards as trip cards (design #13): what is inside the
  // trip (counts), the route's cities, and the all-in Best value total
  // for 2 travelers, 3 days — computed from the same trip card and
  // planner as the plan view, so the card and the chat never disagree.
  // A destination the card builder cannot price renders the old card.
  const cardInfo = useMemo(() => {
    const info: Record<string, { cities: string[]; experiences: number; hotels: number; transports: number; total: number } | null> = {};
    // The discovery map's destinations need card info too — "Plan this
    // trip" from a map pin must seed the chat with the route's cities,
    // not the bare destination name (design #15 + #13, one flow).
    const names = [...new Set([
      ...GLOBAL_DESTINATIONS.map((d) => d.name),
      ...HIDDEN_GEMS.map((d) => d.name),
      ...discoveryDestinations().map((d) => d.destination),
    ])];
    for (const name of names) {
      try {
        const c = buildTripCard({ destination: name, travelers: 2, days: 3, month: 0, origin: '' });
        if (!c) {
          info[name] = null;
          continue;
        }
        info[name] = { cities: c.stops.map((s) => s.city), experiences: c.experiences, hotels: c.hotels, transports: c.transports, total: buildPlan(name, 2, 3).options[1].total };
      } catch {
        info[name] = null;
      }
    }
    return info;
  }, []);
  // "Plan this trip": seeds the chat with the card's route, and scrolls
  // the traveler to the chat.
  // "Make it yours" is the same seed, plus the chat input takes focus
  // — the traveler lands in the app with the cursor ready to
  // personalize the template ("make it cheaper", "3 nights in Prague").
  const [chatSeed, setChatSeed] = useState<{ destination: string; cities: string[] } | null>(null);
  const planThisTrip = (name: string, focusInput = false) => {
    const info = cardInfo[name];
    setChatSeed({ destination: name, cities: info?.cities ?? [name] });
    document.getElementById('fujin-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focusInput) {
      setTimeout(() => window.dispatchEvent(new Event('fujintrip:focus-chat')), 650);
    }
  };
  // "Where to go" discovery map (design #15): the pins, and the selected
  // trip whose essentials the panel shows. The first pin is selected on
  // load so the panel is never an empty "tap a pin" box.
  const discovery = useMemo(() => discoveryDestinations(), []);
  const [discoveryKey, setDiscoveryKey] = useState<string | null>(null);
  const selectedDiscovery: DiscoveryEntry | null =
    discovery.find((d) => d.key === discoveryKey) ?? discovery[0] ?? null;
  // A shared plan or reel link (/?plan=<destination>) seeds the chat
  // with that trip — the stranger who taps a shared link lands in the
  // chat with the route ready, not on a blank page. Once per load.
  const planParamUsedRef = useRef(false);
  useEffect(() => {
    if (planParamUsedRef.current) return;
    const q = new URLSearchParams(window.location.search).get('plan');
    if (!q) return;
    planParamUsedRef.current = true;
    planThisTrip(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Travelers' reels composer (community round, design §6): opened from
  // the trip-card strip, the feed, or a booked trip in My Trips ("Share
  // how it went" — the Booking.com 48h-after-return timing, adapted:
  // the prompt appears on any booked trip).
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDest, setComposerDest] = useState('');
  const openComposer = (destination?: string) => {
    setComposerDest(destination ?? '');
    setComposerOpen(true);
    document.getElementById('reel-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Destinations with a trip marked "Booked with FujinTrip" — those plans
  // download as PDF free; every other plan costs $1 (see /api/plan-download).
  const bookedDestinations = trips.filter((t) => t.status === 'Booked with FujinTrip' && t.destination).map((t) => t.destination as string);
  const useGeo = () => {
    if (!navigator.geolocation) { setGeoStatus('Geolocation is not available in this browser — pick a city below.'); return; }
    setGeoStatus('Asking for your location…');
    navigator.geolocation.getCurrentPosition(
      () => { setGeoStatus('Location found — showing trips near you.'); setLoc('default'); },
      () => setGeoStatus('Location was declined — pick a city below instead.'),
      { timeout: 8000 }
    );
  };
  const local = useMemo(() => LOCAL_TRIPS[loc] ?? LOCAL_TRIPS.default, [loc]);
  // Template library (interface round S2): every destination the
  // planner knows — the 21 discovery entries (17 routes + Bali, St.
  // George, Tacoma, Hilo) plus the 5 standalone photo destinations
  // the discovery map does not pin (Santorini, Kyoto, Caribbean,
  // Maldives, Paris). One card shape: photo (or the fallback
  // gradient), tag pill, one title line, the route line when there is
  // more than one stop, one counts line (stays · transports · from $X
  // total · Best value · 2 travelers · planning estimate), "Make it
  // yours" primary + a quiet "Plan this trip" text link. A count that
  // does not exist in the data is omitted from the line, never
  // guessed. Paginated 12/page; the filter pills carry real counts
  // from these 26 names.
  type LibraryEntry = {
    key: string;
    name: string;
    country?: string;
    tag: string;
    photos: string[];
    routeLine?: string;
    stays: number | null;
    transports: number | null;
    total: number | null;
  };
  const libraryEntries = useMemo<LibraryEntry[]>(() => {
    const imageByName = new Map<string, string>([
      ...GLOBAL_DESTINATIONS.map((d) => [d.name, d.image] as const),
      ...HIDDEN_GEMS.map((d) => [d.name, d.image] as const),
    ]);
    const entries: LibraryEntry[] = [];
    for (const e of discovery) {
      const stopPhotos = [...new Set(e.stops.map((s) => s.city).map((c) => imageByName.get(c)).filter((x): x is string => Boolean(x)))];
      const own = imageByName.get(e.destination);
      entries.push({
        key: e.key,
        name: e.destination,
        tag: e.tag,
        photos: own ? [own] : stopPhotos,
        routeLine: e.stops.length > 1 ? e.stops.map((s) => s.city).join(' → ') : undefined,
        stays: e.stays,
        transports: e.transports,
        total: e.price,
      });
    }
    for (const d of GLOBAL_DESTINATIONS) {
      if (discovery.some((e) => e.destination === d.name)) continue;
      const info = cardInfo[d.name];
      entries.push({
        key: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: d.name,
        country: d.country,
        tag: d.tag,
        photos: [d.image],
        routeLine: (info?.cities.length ?? 0) > 1 ? info?.cities.join(' → ') : undefined,
        stays: info?.hotels ?? null,
        transports: info?.transports ?? null,
        total: info?.total ?? null,
      });
    }
    return entries;
  }, [discovery, cardInfo]);
  // Template filters (Layla-dynamic round): layla.ai's template library
  // has category pills — ours filter the library the same way, with
  // honest categories from lib/tripCategories (each card's own
  // itinerary) and real counts. Categories with no cards get no pill,
  // so a filter can never lead to an empty grid.
  const [packageFilter, setPackageFilter] = useState<PackageFilter>('All');
  const [packagePage, setPackagePage] = useState(1);
  const packageNames = useMemo(() => libraryEntries.map((e) => e.name), [libraryEntries]);
  const packageFilterCounts = useMemo(() => categoryCounts(packageNames), [packageNames]);
  const shownPackages = useMemo(() => filterByCategory(packageNames, packageFilter), [packageNames, packageFilter]);
  const shownEntries = useMemo(() => libraryEntries.filter((e) => shownPackages.includes(e.name)), [libraryEntries, shownPackages]);
  const LIBRARY_PAGE_SIZE = 12;
  const libraryPageCount = Math.max(1, Math.ceil(shownEntries.length / LIBRARY_PAGE_SIZE));
  const libraryPage = Math.min(packagePage, libraryPageCount);
  const pageEntries = shownEntries.slice((libraryPage - 1) * LIBRARY_PAGE_SIZE, libraryPage * LIBRARY_PAGE_SIZE);
  const setLibraryFilter = (f: PackageFilter) => {
    setPackageFilter(f);
    setPackagePage(1);
  };
  const countsLineFor = (e: LibraryEntry): string => {
    const parts: string[] = [];
    if (e.stays !== null) parts.push(`${e.stays} stay${e.stays !== 1 ? 's' : ''}`);
    if (e.transports !== null) parts.push(`${e.transports} transports`);
    if (e.total !== null) parts.push(`from $${e.total.toLocaleString()} total`);
    parts.push('Best value · 2 travelers · planning estimate');
    return parts.join(' · ');
  };
  return (
    <div>
      <a href="#fujin-chat" className="skip-link">Skip to chat</a>
      {/* Chat-first shell (Nov 12 layout rebuild; app shell Nov 12;
          interface round M2 — the 8-tab bar is gone): the chat section
          is full-bleed — header and chat panel span the viewport, and
          the chat + trip panel + map fill the first screen. The slim
          hero was folded into the app bar (the mark + one-line tagline),
          so it no longer pushes the app down. The content sections
          below stay in the capped .wrap. */}
      <div className="chat-shell">
        <div className="panel chat-panel" id="fujin-chat">
          <Chat onParsed={setAiTrip} onSaveTrip={saveTrip} onWatchPrices={addWatch} bookedDestinations={bookedDestinations} watches={watches} seed={chatSeed} onSeedUsed={() => setChatSeed(null)} onShareReel={(d) => openComposer(d)} trips={trips} profile={profile} onProfileChange={setProfile} emergencyContact={emergencyContact} embassyNumber={embassyNumber} onEmbassyChange={setEmbassyNumber} />
        </div>
        {composerOpen && (
          <div className="panel" id="reel-composer">
            <ReelComposer trips={trips} prefillDestination={composerDest} onPosted={() => {}} onClose={() => setComposerOpen(false)} />
          </div>
        )}
      </div>
      <main className="wrap">

        <section>
          <h2>Global packages, in one plan</h2>
          <p className="sub">Flights, hotels, car rental, sightseeing and more — gathered into a single customized trip, not seven separate bookings. {libraryEntries.length} trips to make yours.</p>
          <div className="filter-pills" role="group" aria-label="Filter packages by kind">
            <button type="button" className={`chip${packageFilter === 'All' ? ' selected' : ''}`} aria-pressed={packageFilter === 'All'} onClick={() => setLibraryFilter('All')}>
              All ({packageNames.length})
            </button>
            {packageFilterCounts.map(({ category, count }) => (
              <button key={category} type="button" className={`chip${packageFilter === category ? ' selected' : ''}`} aria-pressed={packageFilter === category} onClick={() => setLibraryFilter(category as TripCategory)}>
                {category} ({count})
              </button>
            ))}
          </div>
          <div className="grid">
            {pageEntries.map((e) => (
              <article className="card" key={e.key}>
                <PhotoCarousel photos={e.photos} alt={e.name} />
                <div className="body"><span className="pill">{e.tag}</span><h3>{e.name}{e.country ? `, ${e.country}` : ''}</h3>
                  {e.routeLine && (
                    <p className="plan-muted">{e.routeLine}</p>
                  )}
                  <p className="plan-muted">{countsLineFor(e)}</p>
                  <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="primary" onClick={() => planThisTrip(e.name, true)} title="Load this trip into the app and start personalizing it">Make it yours</button>
                    <button type="button" className="textlink" onClick={() => planThisTrip(e.name)}>Plan this trip</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {libraryPageCount > 1 && (
            <div className="pagination" role="group" aria-label="Template pages">
              <button type="button" className="ghost" disabled={libraryPage === 1} onClick={() => setPackagePage(libraryPage - 1)} style={{ minHeight: 44 }}>
                ← Previous
              </button>
              {Array.from({ length: libraryPageCount }, (_, i) => (
                <button key={i + 1} type="button" className={`chip${libraryPage === i + 1 ? ' selected' : ''}`} aria-pressed={libraryPage === i + 1} onClick={() => setPackagePage(i + 1)}>
                  {i + 1}
                </button>
              ))}
              <button type="button" className="ghost" disabled={libraryPage === libraryPageCount} onClick={() => setPackagePage(libraryPage + 1)} style={{ minHeight: 44 }}>
                Next →
              </button>
              <span className="page-label">Page {libraryPage} of {libraryPageCount}</span>
            </div>
          )}
        </section>

        {/* "Where to go" discovery map (design #15): the destinations
            FujinTrip can plan, as price bubbles on a world map. Tap a
            bubble — or a chip below the map — to see what the trip
            includes; "Plan this trip" is the same flow as the
            destination cards (design #13), so the chat seeds with the
            route's cities. Prices are the planner's Best value totals
            for 2 travelers — planning estimates, never live quotes. */}
        <section>
          <h2>Where to go — explore the map</h2>
          <p className="sub">Not sure where? Tap a price bubble to see what the trip includes, then plan it in the chat. Prices are planning estimates from FujinTrip’s price table, Best value for 2 travelers — not live quotes.</p>
          <div className="discover">
            <div className="discover-map">
              <DiscoveryMap pins={discovery} selectedKey={selectedDiscovery?.key ?? null} onSelect={(e) => setDiscoveryKey(e.key)} dark={theme === 'dark'} />
            </div>
            {selectedDiscovery && (
              <article className="card discover-panel">
                <div className="body">
                  <span className="pill">{selectedDiscovery.tag}</span>
                  <h3>{selectedDiscovery.destination}</h3>
                  <p>{routeLineFor(selectedDiscovery.stops)}</p>
                  <p className="plan-muted">{selectedDiscovery.days} days · {selectedDiscovery.nights} nights · {selectedDiscovery.experiences} experiences · {selectedDiscovery.stays} stay{selectedDiscovery.stays !== 1 ? 's' : ''} · {selectedDiscovery.transports} transports</p>
                  <p className="plan-muted">Best month to go: {MONTH_NAMES[selectedDiscovery.bestMonth - 1]} — {selectedDiscovery.bestNote}. Typical season, not live prices.</p>
                  {selectedDiscovery.price !== null ? (
                    <>
                      <p className="price">{discoveryPriceLabel(selectedDiscovery)}</p>
                      <p className="plan-muted">Best value · 2 travelers · planning estimate</p>
                    </>
                  ) : (
                    <p className="plan-muted">No planning estimate for this one yet — ask Fujin AI and it will price it.</p>
                  )}
                  <button className="primary" onClick={() => planThisTrip(selectedDiscovery.destination)}>Plan this trip</button>{' '}
                  <button className="ghost" onClick={() => planThisTrip(selectedDiscovery.destination, true)} title="Load this trip into the app and start personalizing it">Make it yours</button>
                </div>
              </article>
            )}
          </div>
          <div className="discover-chips" role="group" aria-label="Browse destinations">
            {discovery.map((d) => (
              <button key={d.key} className={`ghost discover-chip${selectedDiscovery?.key === d.key ? ' selected' : ''}`} aria-pressed={selectedDiscovery?.key === d.key} onClick={() => setDiscoveryKey(d.key)}>
                {d.destination}{d.price !== null ? ` · $${d.price.toLocaleString()}` : ''}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Near you</h2>
          <p className="sub">Local trips that cost little — enjoy local activities for less, based on where you are.</p>
          <p><button className="ghost" onClick={useGeo}>Use my location</button>{' '}
            <select value={loc} onChange={(e) => { setLoc(e.target.value); setLocName(e.target.value); }} aria-label="Pick a city">
              <option value="default">Pick a city…</option><option value="New York">New York</option><option value="Los Angeles">Los Angeles</option>
            </select></p>
          <p className="plan-muted">{geoStatus}{locName && locName !== 'default' ? ` Showing trips near ${locName}.` : ''}</p>
          <div className="grid">{local.map((l) => (<article className="card" key={l.name}><div className="body"><span className="pill">{l.distance}</span><h3>{l.name}</h3><p>{l.activity}</p><p className="price">{l.price}</p></div></article>))}</div>
        </section>

        <section>
          <h2>Hidden gems — trending, not yet crowded</h2>
          <p className="sub">The highest-trending US destinations, explored properly — with a full plan, not just a photo.</p>
          <div className="grid">
            {HIDDEN_GEMS.map((d) => (
              <article className="card" key={d.name}>
                <SafeImg src={d.image} alt={d.name} label={d.name} />
                <div className="body"><span className="pill">{d.tag}</span><h3>{d.name}, {d.country}</h3><p>{d.blurb}</p><p style={{ fontSize: 13 }}>{d.trend}</p>
                  {cardInfo[d.name] && (
                    <>
                      <p className="plan-muted">{cardInfo[d.name]?.experiences} experience{cardInfo[d.name]?.experiences !== 1 ? 's' : ''} · {cardInfo[d.name]?.hotels} stay · {cardInfo[d.name]?.transports} transports</p>
                      <p className="price">from ${cardInfo[d.name]?.total.toLocaleString()} total</p>
                      <p className="plan-muted">Best value · 2 travelers · 3 days · planning estimate</p>
                    </>
                  )}
                  {!cardInfo[d.name] && <p className="price">{d.priceFrom}</p>}
                  <details>
                    <summary>See the days</summary>
                    <ul style={{ fontSize: 13, paddingLeft: 18 }}>{d.itinerary.map((s) => <li key={s}>{s}</li>)}</ul>
                  </details>
                  <button className="primary" onClick={() => planThisTrip(d.name)}>Plan this trip</button>{' '}
                  <button className="ghost" onClick={() => planThisTrip(d.name, true)} title="Load this trip into the app and start personalizing it">Make it yours</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Ad slot: below the fold, content area only. Dormant until AdSense is configured. */}
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_BELOW_GEMS ?? ''} />

        <section>
          <h2>Travelers&apos; reels</h2>
          <p className="sub">Photos and short reels from travelers who took the trip — verified trips only on the trip cards, shareable to social media.</p>
          <ReelsFeed onPost={() => openComposer()} />
          <p style={{ marginTop: 12 }}>
            <a href="/reels">See all travelers’ reels →</a>
          </p>
        </section>

        <section>
          <h2>How much do you actually save?</h2>
          <p className="sub">{aiTrip ? `Your ${cmp.destination} trip for ${cmp.travelers} traveler${cmp.travelers > 1 ? 's' : ''} — the same trip, booked two ways.` : 'An example Kyoto trip — the same trip, booked two ways.'}</p>
          {aiTrip && (
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
              Updated from your Fujin AI chat.{' '}
              <button className="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => setAiTrip(null)}>Back to the Kyoto example</button>
            </p>
          )}
          <div className="compare">
            <div className="box best"><strong>FujinTrip — Best value</strong><p style={{ fontSize: 30, margin: '8px 0' }}>${cmp.best.total.toLocaleString()}</p><table><tbody><tr><td>Flights</td><td>${cmp.best.flight.toLocaleString()}</td></tr><tr><td>Hotel</td><td>${cmp.best.hotel.toLocaleString()}</td></tr><tr><td>Car</td><td>${cmp.best.car.toLocaleString()}</td></tr><tr><td>Sightseeing</td><td>${cmp.best.activities.toLocaleString()}</td></tr></tbody></table></div>
            <div className="box"><strong>Booking each leg separately</strong><p style={{ fontSize: 30, margin: '8px 0' }}>${cmp.separate.total.toLocaleString()}</p><table><tbody><tr><td>Flights</td><td>${cmp.separate.flight.toLocaleString()}</td></tr><tr><td>Hotel</td><td>${cmp.separate.hotel.toLocaleString()}</td></tr><tr><td>Car</td><td>${cmp.separate.car.toLocaleString()}</td></tr><tr><td>Sightseeing</td><td>${cmp.separate.activities.toLocaleString()}</td></tr></tbody></table></div>
          </div>
          <p><strong>You save ${cmp.save.toLocaleString()} — about {cmp.savePercent}%.</strong></p>
          <p style={{ fontSize: 14, color: '#111' }}>No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
          <p className="notice">Illustrative planning estimates — not a live quote. Live prices come from suppliers once connected.</p>
        </section>

        <section>
          <h2>How FujinTrip works</h2>
          <p className="sub">Tell Fujin AI where you want to go. It gathers flights, hotels, cars and sightseeing into one plan — Cheapest, Best value, Premium — and you book it all with FujinTrip.</p>
          <h2 style={{ marginTop: 28 }} id="mytrips">My Trips</h2>
          <p className="plan-muted">“Mark as booked” is set by you or the FujinTrip team when a booking request is confirmed — it is not a live booking. A booked trip’s plan PDF is free; other plans cost $1 to download.</p>
          {trips.length === 0 ? <p style={{ color: 'var(--muted)' }}>No trips saved yet — tell Fujin AI where to go and it will appear here.</p> : (
            <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
              {trips.map((t) => (<li key={t.id}><span>{t.label} · {t.status} · {t.date}</span><span>{t.destination && t.status !== 'Booked with FujinTrip' && (<><button className="ghost" onClick={() => setTrips((x) => x.map((y) => (y.id === t.id ? { ...y, status: 'Booked with FujinTrip' } : y)))}>Mark as booked</button>{' '}</>)}<button className="ghost" onClick={() => setTrips((x) => x.filter((y) => y.id !== t.id))}>Delete</button>{t.destination && t.status === 'Booked with FujinTrip' && (<>{' '}<button className="ghost" onClick={() => openComposer(t.destination)}>Share how it went</button></>)}</span></li>))}
            </ul>
          )}
          <h3 style={{ marginTop: 20 }}>Your travel preferences</h3>
          <p className="plan-muted">What you tell Fujin here carries across trips — on this device, no account. Only what you picked or said in the chat is ever used; nothing is guessed. Tap a chip again to clear it.</p>
          {profileSummary(profile) ? (
            <p style={{ fontSize: 14 }}>Now using: <strong>{profileSummary(profile)}</strong></p>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--muted)' }}>Nothing set yet — pick below, or just tell Fujin in the chat (“direct flights”, “street food”).</p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }} role="group" aria-label="Flight preference">
            <button type="button" className={`chip${profile.flightStyle === 'direct' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, flightStyle: profile.flightStyle === 'direct' ? undefined : 'direct' })}>Direct flights</button>
            <button type="button" className={`chip${profile.flightStyle === 'cheapest' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, flightStyle: profile.flightStyle === 'cheapest' ? undefined : 'cheapest' })}>Cheapest flights</button>
            <button type="button" className={`chip${profile.seat === 'window' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, seat: profile.seat === 'window' ? undefined : 'window' })}>Window seat</button>
            <button type="button" className={`chip${profile.seat === 'aisle' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, seat: profile.seat === 'aisle' ? undefined : 'aisle' })}>Aisle seat</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }} role="group" aria-label="Food and pace preference">
            <button type="button" className={`chip${profile.foodStyle === 'street' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, foodStyle: profile.foodStyle === 'street' ? undefined : 'street' })}>Street food</button>
            <button type="button" className={`chip${profile.foodStyle === 'local' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, foodStyle: profile.foodStyle === 'local' ? undefined : 'local' })}>Local spots</button>
            <button type="button" className={`chip${profile.foodStyle === 'fine' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, foodStyle: profile.foodStyle === 'fine' ? undefined : 'fine' })}>Fine dining</button>
            <button type="button" className={`chip${profile.pace === 'slow' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, pace: profile.pace === 'slow' ? undefined : 'slow' })}>Slow pace</button>
            <button type="button" className={`chip${profile.pace === 'relaxed' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, pace: profile.pace === 'relaxed' ? undefined : 'relaxed' })}>Relaxed pace</button>
            <button type="button" className={`chip${profile.pace === 'fast' ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, pace: profile.pace === 'fast' ? undefined : 'fast' })}>Fast pace</button>
            <button type="button" className={`chip${profile.localGemsOnly ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, localGemsOnly: profile.localGemsOnly ? undefined : true })}>Local gems only</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }} role="group" aria-label="Dietary needs">
            {DIETARY_OPTIONS.map((d) => (
              <button key={d.value} type="button" className={`chip${profile.dietary === d.value ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, dietary: profile.dietary === d.value ? undefined : d.value })}>{d.label}</button>
            ))}
          </div>
          {/* Pace guard (round 4 #1): the energy slots — latest start,
              max sights a day, and the nap window for families. The
              day cards warn when a day breaks the pace you set here. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }} role="group" aria-label="Pace and energy">
            <label style={{ fontSize: 13 }}>
              Start no earlier than{' '}
              <select aria-label="Earliest start time" value={profile.latestStart ?? ''} onChange={(e) => setProfile({ ...profile, latestStart: e.target.value || undefined })}>
                <option value="">Any time</option>
                {['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'].map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Max sights a day{' '}
              <input type="number" min={1} max={10} value={profile.maxSightsPerDay ?? ''} onChange={(e) => { const n = Number(e.target.value); setProfile({ ...profile, maxSightsPerDay: n >= 1 && n <= 10 ? n : undefined }); }} placeholder="6" aria-label="Maximum main sights per day" style={{ width: 56 }} />
            </label>
            <button type="button" className={`chip${profile.napWindow ? ' selected' : ''}`} onClick={() => setProfile({ ...profile, napWindow: profile.napWindow ? undefined : true })}>Nap window after lunch</button>
          </div>
          <h3 style={{ marginTop: 20 }}>Emergency contact</h3>
          <p className="plan-muted">For solo trips — who should be reached if something goes wrong? Stored on this device only, shown on your solo trip cards.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input value={emergencyContact.name} onChange={(e) => setEmergencyContact({ ...emergencyContact, name: e.target.value })} placeholder="Name" aria-label="Emergency contact name" />
            <input value={emergencyContact.phone} onChange={(e) => setEmergencyContact({ ...emergencyContact, phone: e.target.value })} placeholder="Phone" aria-label="Emergency contact phone" />
          </div>
          <h3 style={{ marginTop: 20 }}>Embassy / consulate</h3>
          <p className="plan-muted">Your embassy or consulate&apos;s number for the country you&apos;re visiting — yours to type in, saved on this device only. The SOS sheet can call it.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input value={embassyNumber} onChange={(e) => setEmbassyNumber(e.target.value)} placeholder="Embassy number" aria-label="Embassy or consulate phone number" />
          </div>
          <h3 style={{ marginTop: 20 }}>Price watches</h3>
          <p className="plan-muted">A watch measures the live fare against the fare when you started watching. When it drops below that, it shows here. Live fares are Duffel test fares in test mode; the plan&apos;s own prices are estimates and never move, so they are never the baseline.</p>
          {watches.length === 0 ? <p style={{ color: 'var(--muted)' }}>No price watches yet. Build a plan in the chat, then tap “Watch this trip&apos;s prices”.</p> : (
            <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
              {watches.map((w) => {
                const dropped = w.baseline !== null && w.lastTotal !== null && w.lastTotal < w.baseline ? w.baseline - w.lastTotal : 0;
                // The trend read of this watch's own past checks — a humble
                // sentence with a low/medium confidence, never a forecast.
                const trend = trendLine(w.history);
                return (
                  <li key={w.id}>
                    <span>
                      {w.destination} · {w.travelers} traveler{w.travelers > 1 ? 's' : ''} · from {w.origin || '—'}{' · '}
                      {w.baseline !== null ? `watching from $${w.baseline.toLocaleString()}` : 'no live fare yet — waiting for one'}
                      {w.lastTotal !== null ? ` · now $${w.lastTotal.toLocaleString()}` : ''}
                      {dropped > 0 ? ` · ↓ Price dropped $${dropped.toLocaleString()} since you started watching` : ''}
                      {w.lastCheckedAt ? ` · checked ${new Date(w.lastCheckedAt).toLocaleDateString()}` : ''}
                      {trend.line ? <><br />{trend.line}</> : ''}
                    </span>
                    <span>
                      <button className="ghost" onClick={() => void checkWatch(w.id)}>Check now</button>{' '}
                      <button className="ghost" onClick={() => setWatches((x) => x.filter((y) => y.id !== w.id))}>Remove</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Ad slot: above the footer, content area only. Dormant until AdSense is configured. */}
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_FOOTER ?? ''} />
      </main>
      <footer>
        <div className="wrap">
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Travel globally, act locally. Named for Fujin, Japan’s wind god.</p>
          <p>No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
          <p>Fujin artwork: Ogata Korin, Wind God, c.1700 (public domain). Photo credits in the destination cards are from Unsplash / Wikimedia Commons.</p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
          <p><a href="/privacy">Privacy Policy</a></p>
        </div>
      </footer>
    </div>
  );
}
