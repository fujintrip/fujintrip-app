'use client';
// Fujin AI chat — rebuilt from scratch (Nov 24, 2026). The old chat
// was one 3,300-line file that rendered everything at once (app bar,
// chat, trip summary, map, trip panel, plan document, on-trip tools,
// forms, link import) — the traveler called it "very crowded and hard
// to understand what to do". This is a fresh start, same engine
// underneath (POST /api/fujin streaming + askFujin fallback +
// buildPlan client-side), Layla's structure, Fujin's own look.
//
// Layout: split screen — chat column left, visual canvas right.
// The chat column is ONLY a chat (greeting, messages, one input, one
// chip row). The canvas carries the trip: Trip Summary, then the plan
// artefact (timeline, day strip, stays, tiers, one Book action).
// On-trip tools, forms and link import left the chat entirely.
// One next step at all times; chips answer only the current question,
// one category per row; the plan is confirmed before it is built;
// dates are never invented (month + length in the summary, suggested
// start labelled as such in the plan).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { CITY_PHOTOS, GLOBAL_DESTINATIONS } from '../lib/data';
import { askFujin, buildPlan, findMonth, findOrigin, findOriginAnswer, MONTH_NAMES, parseDuration, parseKidAges, routeKeyForDestination, stopsForRoute, tripDays, type Plan, type RouteOverride } from '../lib/planner';
import { buildTripCard, cardComparison, CITY_INFO, suggestedStart, type TripCard } from '../lib/tripCard';
import { parseLiveFares, type LiveFares } from '../lib/duffel';
import { mergeProfile, parsePreferenceSignals, profileLine, profileSummary, type TravelerProfile } from '../lib/preferences';
import { parsePassportExpiry, parsePassportExpiryValue } from '../lib/passport';
import { parseHHMM, parseLandingTime, parseDepartureTime } from '../lib/arrival';
import { paceFromProfile } from '../lib/pace';
import { interfaceState } from '../lib/interface';
import { useTheme } from '../lib/theme';
import { gateDecision } from '../lib/auth';
import { AccountButton, SavePdfGateNotice, useAccount } from '../components/AccountGate';
import PlanPdfPayment from '../components/PlanPdfPayment';
import type { SavedDetail } from '../lib/savedTrips';
import type { TrendObservation } from '../lib/duffel';

// The map (MapLibre GL JS + OpenFreeMap) is client-only — it needs
// window, so it loads without server rendering. While the chunk
// loads, a map-shaped skeleton shows instead of a blank area.
const TripMap = dynamic(() => import('../components/TripMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
      <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Loading the map…</p>
    </div>
  ),
});

// A saved trip or fare: a trip entry in My Trips ('fujintrip-trips')
// carries its saved detail when it came from a Save button — source,
// price kind, totals, route, dates, when the price was checked.
export type Trip = { id: string; label: string; status: string; date: string; destination?: string; accountId?: string; saved?: SavedDetail };

// The shape of a parsed server reply (streamed `done` result or atomic
// JSON) — shared by the streaming path and the atomic fallback path.
type ServerParsed = { destination: string; travelers: number; reply: string; missing: string[]; tips?: string[]; kids?: number[]; routeOverride?: RouteOverride; tier?: number };

// Whole-trip price check (competitor learning #4): the /api/price-check
// response, and a price watch. A watch measures a DROP against the
// live fare when the watch started (the baseline) — never against the
// planner estimate, which is static and never moves.
type PriceCheckOffer = { airline: string; price: number; currency: string; stops: number; duration: string };
export type PriceCheckData = {
  live: boolean;
  mode?: 'test' | 'live';
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
  trend?: { confidence: 'none' | 'low' | 'medium'; line: string };
};
export type PriceWatch = {
  id: string;
  destination: string;
  travelers: number;
  origin: string;
  month: number;
  durationDays: number;
  baseline: number | null;
  baselineAt: string;
  lastTotal: number | null;
  lastCheckedAt: string | null;
  history: TrendObservation[];
};

// Local copy of the Ogata Korin Wind God (public domain). Served
// locally; credit stays in the footer.
export const FUJIN_IMG = '/images/fujin-wind-god.jpg';

// Image with a graceful fallback: a failed image never shows a broken
// icon — it becomes a soft gray placeholder with the destination name.
// While it loads, a warm shimmer tile with the name shows instead of a
// blank space. The not-yet-loaded image is hidden with opacity, NEVER
// with display:none (defect, Nov 14 2026): a lazy image that is
// display:none has no layout box, so it never intersects the viewport,
// so the browser never fetches it. The mount effect below closes the
// cached-image race: if the img is already complete, trust its
// naturalWidth.
export function SafeImg({ src, alt, label, className, loading }: { src: string; alt: string; label: string; className?: string; loading?: 'lazy' | 'eager' }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) setLoaded(true);
    else setFailed(true);
  }, []);
  if (failed) {
    return (
      <div className={`img-fallback ${className ?? ''}`} role="img" aria-label={alt}>
        <span>{label}</span>
      </div>
    );
  }
  return (
    <div className="safeimg" style={{ position: 'relative' }}>
      {!loaded && (
        <div className={`img-loading skeleton ${className ?? ''}`} style={{ position: 'absolute', inset: 0 }} role="img" aria-label={alt}>
          <span>{label}</span>
        </div>
      )}
      <img ref={imgRef} src={src} alt={alt} loading={loading ?? 'lazy'} className={className} style={loaded ? undefined : { opacity: 0 }} onError={() => setFailed(true)} onLoad={() => setLoaded(true)} />
    </div>
  );
}

// Render an AI reply as readable formatted text. The model writes
// markdown (bold, bullets, headings), and a plain-text bubble shows it
// as a wall of asterisks. Small safe renderer — no HTML parsing, React
// escapes all text, so no injection risk. User messages stay plain text.
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

// The S0 canvas photo: Kyoto, from the verified pool in lib/data.ts —
// never a hardcoded URL. The same photo backs the Kyoto destination
// card, so it renders on both pages.
const S0_PHOTO = GLOBAL_DESTINATIONS.find((d) => d.name === 'Kyoto')?.image ?? null;

// A destination's photo, from the verified pool only: the first route
// stop's city photo, else the destination's own card photo. Null when
// the pool has none — the canvas renders a name tile instead of
// inventing a URL.
function photoForDestination(destination: string, firstCity?: string): string | null {
  if (firstCity && CITY_PHOTOS[firstCity]) return CITY_PHOTOS[firstCity];
  const own = GLOBAL_DESTINATIONS.find((d) => d.name === destination)?.image;
  if (own) return own;
  if (firstCity) {
    const byCity = GLOBAL_DESTINATIONS.find((d) => d.name === firstCity)?.image;
    if (byCity) return byCity;
  }
  return null;
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

type LastParsed = {
  destination: string;
  travelers: number;
  origin?: string;
  month?: number;
  durationDays?: number;
  routeKey?: string;
  kids?: number[];
  routeOverride?: RouteOverride;
  sourceTips?: Record<string, string>;
  passportExpiry?: { month: number; year: number };
  landingTime?: string;
  departureTime?: string;
};

export function Chat({ onParsed, onSaveTrip, onWatchPrices, bookedDestinations, watches, seed, onSeedUsed, onShareReel, trips, profile, onProfileChange, emergencyContact, embassyNumber, onEmbassyChange }: { onParsed?: (t: { destination: string; travelers: number; kids?: number[] }) => void; onSaveTrip: (label: string, status: string, destination?: string) => void; onWatchPrices: (w: Omit<PriceWatch, 'id' | 'baselineAt' | 'lastCheckedAt'>) => void; bookedDestinations: string[]; watches: PriceWatch[]; seed?: { destination: string; cities: string[]; sourceTips?: Record<string, string> } | null; onSeedUsed?: () => void; onShareReel?: (destination: string) => void; trips: Trip[]; profile: TravelerProfile; onProfileChange: (p: TravelerProfile) => void; emergencyContact: { name: string; phone: string }; embassyNumber: string; onEmbassyChange: (v: string) => void }) {
  // The opening line — also the line a "New trip" resets to.
  const GREETING = 'Tell me where. I’ll plan the rest.';
  const [msgs, setMsgs] = useState<{ who: string; text: string; tips?: string[] }[]>([{ who: 'ai', text: GREETING }]);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState(1);
  const [lastParsed, setLastParsed] = useState<LastParsed | null>(null);
  // The last reply's missing list — the chips answer ONLY this
  // question, one category per row, never mixed.
  const [lastMissing, setLastMissing] = useState<string[]>([]);
  // Typing indicator + streaming: the indicator shows within 200ms of
  // Send; after 5s with no first chunk it escalates to a status line
  // ("Searching live fares…"). While the reply streams, Send becomes
  // Stop (AbortController) and the partial text is kept if stopped.
  const [thinking, setThinking] = useState<'thinking' | 'searching' | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live Duffel fares for the current trip (route returns them as
  // `liveFares`) — the plan card shows these same fares, so the chat
  // and the card never quote different flight prices. Null means no
  // live fares: the card falls back to the planner estimate.
  const [liveFares, setLiveFares] = useState<LiveFares | null>(null);
  // The plan artefact's selected day (day strip). Resets on build.
  const [selectedDay, setSelectedDay] = useState(1);
  // The confirm card is dismissed for this trip once the traveler
  // chooses "Change something" — it returns when the slots change.
  const [confirmDismissed, setConfirmDismissed] = useState(false);
  // "My Trips" menu in the app bar.
  const [tripsOpen, setTripsOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  // Confirmation line for the plan actions in the canvas.
  const [actionMsg, setActionMsg] = useState('');
  // PDF download state: the $1 rule is decided by the server route.
  const [pdfNotice, setPdfNotice] = useState('');
  const [pdfPay, setPdfPay] = useState(false);
  const [pdfClientSecret, setPdfClientSecret] = useState('');
  const [pdfPaymentIntentId, setPdfPaymentIntentId] = useState('');
  // Free-account gate (Clerk, Nov 14 2026): saving / downloading a
  // plan needs a free account. The chat itself is never gated — this
  // state only decides whether tapping "Save as PDF" shows the sign-in
  // prompt instead of the download. The prompt clears itself once the
  // traveler signs in.
  const account = useAccount();
  const [pdfGate, setPdfGate] = useState(false);
  useEffect(() => { if (account.signedIn) setPdfGate(false); }, [account.signedIn]);
  // Preference profile: the "Using what you told me last time…" line,
  // captured BEFORE this message's own signals are merged.
  const profileLineRef = useRef('');

  const stopThinking = () => {
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    thinkingTimerRef.current = null;
    setThinking(null);
    setStreamingText(null);
  };

  // Options stay in memory: the in-progress trip and built plan survive
  // a reload (localStorage) until the traveler requests the plan or
  // starts a new trip. Restored once on mount; writes wait until
  // restore is done so the mount-time nulls don't wipe the saved values.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const t = localStorage.getItem('fujintrip-current-trip');
      if (t) {
        const p = JSON.parse(t) as { destination?: unknown; travelers?: unknown; origin?: unknown; month?: unknown; durationDays?: unknown; routeKey?: unknown; kids?: unknown; routeOverride?: unknown; sourceTips?: unknown; passportExpiry?: unknown; landingTime?: unknown; departureTime?: unknown };
        if (typeof p.destination === 'string' && typeof p.travelers === 'number') {
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
          const restoredSourceTips: Record<string, string> | undefined = (() => {
            if (!p.sourceTips || typeof p.sourceTips !== 'object' || Array.isArray(p.sourceTips)) return undefined;
            const tips = Object.fromEntries(
              Object.entries(p.sourceTips as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string')
            );
            return Object.keys(tips).length ? tips : undefined;
          })();
          const restoredExpiry = parsePassportExpiryValue(p.passportExpiry);
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
        }
      }
      const pl = localStorage.getItem('fujintrip-current-plan');
      if (pl) {
        const d = JSON.parse(pl) as { plan?: unknown; choice?: unknown };
        const pp = d.plan as Plan | null;
        if (pp && typeof pp.destination === 'string' && Array.isArray(pp.options) && pp.options.length === 3 && Array.isArray(pp.days)) {
          setPlan(pp);
          if (typeof d.choice === 'number' && d.choice >= 0 && d.choice <= 2) setChoice(d.choice);
        }
      }
    } catch {}
    setHydrated(true);
    // Run once on mount — onParsed is Home's setAiTrip, stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A message typed before reaching the chat — the homepage hero
  // search writes it, /chat consumes it once on mount and sends it,
  // so the chat opens with the question already asked. The key is
  // removed BEFORE sending, so a re-render can never send the same
  // message twice.
  const pendingSentRef = useRef(false);
  useEffect(() => {
    if (pendingSentRef.current) return;
    pendingSentRef.current = true;
    try {
      const raw = localStorage.getItem('fujintrip-pending-message');
      if (!raw) return;
      localStorage.removeItem('fujintrip-pending-message');
      if (typeof raw === 'string' && raw.trim()) send(raw.trim());
    } catch {}
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
  // Keep the latest message in view.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, streamingText, thinking]);

  // Apply a parsed server reply to the chat state: the AI's live flag,
  // the trip slots and the reply message itself. Shared by the
  // streaming path and the atomic fallback path so both behave
  // identically. The reply is shown exactly as the server wrote it —
  // the chat never appends a missing list or a "tap Build" line; the
  // canvas shows what is still needed instead.
  const handleParsed = (parsed: ServerParsed, origin: string, month: number, durationDays: number, kids: number[]) => {
    setLastMissing(Array.isArray(parsed.missing) ? parsed.missing : []);
    if (parsed.destination) {
      if (lastParsed && parsed.destination !== lastParsed.destination) {
        setPlan(null);
        setLiveFares(null);
        setConfirmDismissed(false);
        setSelectedDay(1);
      }
      const isNewTrip = lastParsed ? parsed.destination !== lastParsed.destination : false;
      const routeOverrideOut = isNewTrip ? undefined : parsed.routeOverride ?? lastParsed?.routeOverride;
      const kidsOut = parsed.kids?.length ? parsed.kids : kids.length ? kids : lastParsed?.kids ?? [];
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
        ...(isNewTrip ? {} : lastParsed?.sourceTips ? { sourceTips: lastParsed.sourceTips } : {}),
      });
      onParsed?.({ destination: parsed.destination, travelers: parsed.travelers, ...(kidsOut.length ? { kids: kidsOut } : {}) });
    }
    const isFreshTrip = !lastParsed || parsed.destination !== lastParsed.destination;
    const profileNote = isFreshTrip && profileLineRef.current ? `\n\n${profileLineRef.current}` : '';
    profileLineRef.current = '';
    setMsgs((m) => [...m, { who: 'ai', text: parsed.reply + profileNote, tips: parsed.tips }]);
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text) return;
    // One reply in flight at a time — while Fujin AI is thinking or
    // streaming, the Send button is a Stop button instead.
    if (thinking !== null || streamingText !== null) return;
    setInput('');
    setMsgs((m) => [...m, { who: 'user', text }]);
    // Everything the traveler said so far, for the built-in planner when
    // the server can't be reached — same memory the server gets.
    const contextText = [...msgs.filter((m) => m.who === 'user').map((m) => m.text), text].join(' ');
    const origin = findOrigin(contextText) || findOriginAnswer(text) || lastParsed?.origin || '';
    const month = findMonth(contextText) || lastParsed?.month || 0;
    const durationDays = parseDuration(contextText) || lastParsed?.durationDays || 0;
    const kids = parseKidAges(contextText).length ? parseKidAges(contextText) : lastParsed?.kids ?? [];
    // Preference signals in this message ("direct flights", "street
    // food") join the profile — and the profile line for a new trip is
    // captured BEFORE the merge, so a preference stated just now is
    // never announced as if it were from last time.
    const signals = parsePreferenceSignals(text);
    const hasSignals = Object.keys(signals).length > 0;
    if (!hasSignals) profileLineRef.current = profileLine(profile);
    const profileForRequest = hasSignals ? mergeProfile(profile, signals) : profile;
    if (hasSignals) onProfileChange(profileForRequest);
    const expiryFromMsg = parsePassportExpiry(text);
    const passportExpiry = expiryFromMsg ?? lastParsed?.passportExpiry;
    if (expiryFromMsg) setLastParsed((p) => (p ? { ...p, passportExpiry: expiryFromMsg } : p));
    const landingFromMsg = parseLandingTime(contextText);
    const landingTime = landingFromMsg ?? lastParsed?.landingTime;
    if (landingFromMsg) setLastParsed((p) => (p ? { ...p, landingTime: landingFromMsg } : p));
    const departureFromMsg = parseDepartureTime(contextText);
    const departureTime = departureFromMsg ?? lastParsed?.departureTime;
    if (departureFromMsg) setLastParsed((p) => (p ? { ...p, departureTime: departureFromMsg } : p));
    const tripWatch = lastParsed ? watches.find((w) => w.destination === lastParsed.destination && w.travelers === lastParsed.travelers && (w.origin || '') === (lastParsed.origin || '') && w.month === (lastParsed.month ?? 0) && w.durationDays === (lastParsed.durationDays ?? 0)) : undefined;
    setThinking('thinking');
    thinkingTimerRef.current = setTimeout(() => setThinking((prev) => (prev === 'thinking' ? 'searching' : prev)), 5000);
    const requestBody = {
      message: text,
      // Conversation history: the last 10 turns, so the AI remembers
      // the trip instead of treating each message as a fresh
      // conversation. A long conversation must not lose the trip.
      history: msgs.slice(-10).map((m) => ({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text })),
      // Durable trip memory: the trip already established goes with
      // EVERY request, so it survives history scrolling off the window.
      ...(lastParsed
        ? { tripState: { ...lastParsed, ...(origin ? { origin } : {}), tier: choice, ...(profileSummary(profileForRequest) ? { preferences: profileForRequest } : {}), ...(passportExpiry ? { passportExpiry } : {}), ...(landingTime ? { landingTime } : {}), ...(departureTime ? { departureTime } : {}), ...(tripWatch && tripWatch.history.length ? { priceHistory: tripWatch.history } : {}) } }
        : profileSummary(profileForRequest)
          ? { tripState: { destination: '', travelers: 2, preferences: profileForRequest } }
          : passportExpiry
            ? { tripState: { destination: '', travelers: 2, passportExpiry } }
            : {}),
    };
    const parseServerReply = (j: Record<string, unknown>): { parsed: ServerParsed; live: boolean } => {
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
    // Keep the live fares the server fetched for this trip (or clear
    // them when the fetch ran and failed, so the card falls back). A
    // null/missing liveFares means this turn did not fetch fares at all
    // — the last fares stay.
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
        keepFares(doneResult);
        const { parsed } = parseServerReply(doneResult);
        handleParsed(parsed, origin, month, durationDays, kids);
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
    try {
      const r = await fetch('/api/fujin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const j = await r.json();
      if (r.ok && typeof j.reply === 'string' && typeof j.destination === 'string') {
        keepFares(j);
        const out = parseServerReply(j);
        parsed = out.parsed;
      } else {
        parsed = askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin, lastParsed?.routeOverride, kids.length ? kids : lastParsed?.kids ?? [], choice);
      }
    } catch {
      parsed = askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin, lastParsed?.routeOverride, kids.length ? kids : lastParsed?.kids ?? [], choice);
    }
    handleParsed(parsed, origin, month, durationDays, kids);
  };

  const stopStream = () => {
    streamAbortRef.current?.abort();
  };

  // Build the plan (one action, in the canvas, when the slots are
  // filled). The plan's day cards span the trip length the traveler
  // gave (14 days → 14 day cards), not a fixed 3 — and when no length
  // was given, tripDays() supplies the same 14-day default the summary
  // shows, so the built plan can never disagree with its own summary.
  const build = () => {
    const dest = lastParsed?.destination ?? 'Kyoto';
    const people = lastParsed?.travelers ?? 2;
    setPlan(buildPlan(dest, people, tripDays(lastParsed?.durationDays), { kids: lastParsed?.kids ?? [] }));
    setSelectedDay(1);
    setConfirmDismissed(false);
    setActionMsg('');
  };

  // Book: the ONE book action. A booking request saved to My Trips —
  // live booking activates with Duffel live mode; for now the
  // FujinTrip team follows up on the request. Once it is marked
  // booked, the plan PDF is free.
  const bookPlan = () => {
    if (!plan) return;
    const chosen = plan.options[choice];
    onSaveTrip(`${plan.destination} plan — ${chosen.name} $${chosen.total.toLocaleString()}`, 'Booking request — team follows up', plan.destination);
    setActionMsg('Booking request saved to My Trips. Live booking activates with Duffel live mode — for now the FujinTrip team follows up on your request. Once it’s marked booked, your plan PDF is free.');
  };

  // Save as PDF — the $1 rule (firm, Nov 10, 2026): downloading the
  // PDF costs $1 when the traveler has NOT booked with FujinTrip; it
  // is FREE when they booked with us. The server route
  // (/api/plan-download) decides; in Stripe test mode the $1 case
  // returns a PaymentIntent confirmed on this page via Elements.
  // Without a Stripe key the $1 path explains that instead of
  // pretending a payment happened. Nothing is charged and the plan
  // stays saved either way.
  const planBooked = plan ? bookedDestinations.includes(plan.destination) : false;
  const requestPdf = async () => {
    if (!plan) return;
    if (gateDecision(account) !== 'allowed') {
      setPdfGate(true);
      setPdfNotice('');
      setPdfPay(false);
      return;
    }
    setPdfPay(false);
    setPdfClientSecret('');
    setPdfPaymentIntentId('');
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
        if (typeof j.paymentIntentClientSecret === 'string' && j.paymentIntentClientSecret) {
          setPdfClientSecret(j.paymentIntentClientSecret);
          setPdfPaymentIntentId(typeof j.paymentIntentId === 'string' ? j.paymentIntentId : '');
          setPdfNotice('$1 to download the full plan — free if you book with us. Pay $1 below (test mode).');
          setPdfPay(true);
          return;
        }
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
  // After the traveler confirms the $1 in Elements, the server
  // verifies the payment before the PDF opens — the client never
  // decides on its own.
  const confirmPdfPayment = async (paymentIntentId: string) => {
    if (!plan) return;
    setPdfNotice('Verifying your $1 payment…');
    try {
      const r = await fetch('/api/plan-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: plan.destination, travelers: plan.travelers, booked: false, paymentIntentId }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.decision === 'paid') {
        setPdfClientSecret('');
        setPdfPaymentIntentId('');
        setPdfPay(false);
        setPdfNotice('$1 received — your PDF is opening now. Thank you.');
        window.print();
      } else {
        setPdfNotice('The $1 payment was not confirmed for this plan — no PDF was downloaded. Try again, or book the plan and the PDF is free.');
      }
    } catch {
      setPdfNotice('Couldn’t verify the payment right now — your plan is still saved; try again in a moment.');
    }
  };

  // Start a new trip: the plan, the slots and the chat all go back to
  // the greeting together.
  const resetToGreeting = () => {
    setPlan(null);
    setLastParsed(null);
    setLastMissing([]);
    setLiveFares(null);
    setChoice(1);
    setSelectedDay(1);
    setConfirmDismissed(false);
    setActionMsg('');
    setPdfNotice('');
    setPdfPay(false);
    setPdfGate(false);
    setMsgs([{ who: 'ai', text: GREETING }]);
  };
  const startNewTrip = () => {
    resetToGreeting();
    setActionMsg('Started a new trip — ask Fujin AI where to next.');
  };

  // Trip switcher (app bar "My Trips"): switch to a saved trip. The
  // saved entry holds only a destination — the chat switches by seeding
  // that destination's route, exactly as a template seed does.
  const switchToTrip = (t: Trip) => {
    if (!t.destination) return;
    setTripsOpen(false);
    setPlan(null);
    setLiveFares(null);
    setLastMissing([]);
    setConfirmDismissed(false);
    setSelectedDay(1);
    setLastParsed({
      destination: t.destination,
      travelers: 2,
      ...(routeKeyForDestination(t.destination) ? { routeKey: routeKeyForDestination(t.destination) } : {}),
    });
    setMsgs((m) => [...m, { who: 'ai', text: `Let's plan ${t.destination} — when are you going, and for how long?` }]);
  };

  // Seed handoff: a destination card's "Plan this trip" (or a shared
  // plan link) seeds the chat with the route ready, then drops it.
  const seedKeyRef = useRef('');
  useEffect(() => {
    if (!seed) return;
    const key = JSON.stringify(seed);
    if (seedKeyRef.current === key) return;
    seedKeyRef.current = key;
    const cities = seed.cities.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()).slice(0, 8);
    if (!cities.length) return;
    setPlan(null);
    setLiveFares(null);
    setLastMissing([]);
    setConfirmDismissed(false);
    setLastParsed({
      destination: seed.destination,
      travelers: 2,
      ...(routeKeyForDestination(seed.destination) ? { routeKey: routeKeyForDestination(seed.destination) } : {}),
      routeOverride: { cities },
      ...(seed.sourceTips ? { sourceTips: seed.sourceTips } : {}),
    });
    onParsed?.({ destination: seed.destination, travelers: 2 });
    setMsgs((m) => [...m, { who: 'ai', text: `Let's plan ${seed.destination}: ${cities.join(' → ')} — for 2 travelers. When are you going, and for how long?` }]);
    onSeedUsed?.();
    // Run on the seed only — onParsed/onSeedUsed are Home's stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  // "Make it yours" (app shell): a template button below the fold asks
  // for the chat input to take focus, so the traveler can start
  // personalizing the seeded trip right away.
  useEffect(() => {
    const onFocusChat = () => inputRef.current?.focus();
    window.addEventListener('fujintrip:focus-chat', onFocusChat);
    return () => window.removeEventListener('fujintrip:focus-chat', onFocusChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interface state (interface round §2/§5): S0 no trip, S1 destination
  // known, S2 plan built. The canvas gates on it — nothing renders
  // before its data exists.
  const uiState = interfaceState({ lastParsed, plan });
  const hasUserMsg = msgs.some((m) => m.who === 'user');
  const busy = thinking !== null || streamingText !== null;

  // The trip slots, from everything said so far. The summary shows the
  // month + length, never an invented exact date — the traveler said
  // "March", the summary says "March · 14 days", not a day number.
  const days = tripDays(lastParsed?.durationDays);
  const routeCities = lastParsed?.destination
    ? stopsForRoute(lastParsed.routeKey ?? routeKeyForDestination(lastParsed.destination) ?? '', lastParsed.routeOverride).map((s) => s.city)
    : [];
  const summaryRoute = routeCities.length ? routeCities.join(' → ') : lastParsed?.destination ?? '';
  const summaryDates = lastParsed?.month ? `${MONTH_NAMES[lastParsed.month - 1]} · ${days} days` : 'Not set yet';
  const summaryTravelers = lastParsed?.travelers ? `${lastParsed.travelers} traveler${lastParsed.travelers > 1 ? 's' : ''}${lastParsed.kids?.length ? ` · kids ${lastParsed.kids.join(', ')}` : ''}` : 'Not set yet';
  const summaryFrom = lastParsed?.origin || 'Not set yet';
  // The slots are filled when the trip has a destination, a party, a
  // departure city, a month and a length. Budget, pace and kids' ages
  // are preferences, not blockers — the plan builds without them.
  const slotsFilled = !!lastParsed?.destination && !!lastParsed.travelers && !!lastParsed.origin && !!lastParsed.month && !!lastParsed.durationDays;
  const missingSlots = [
    ...(lastParsed?.destination ? [] : ['destination']),
    ...(lastParsed?.origin ? [] : ['departure city']),
    ...(lastParsed?.month ? [] : ['dates']),
    ...(lastParsed?.durationDays ? [] : ['length']),
  ];

  // Chips fill, don't fire: a chip puts its full prompt in the input
  // and focuses it — the traveler edits, then sends with Send/Enter.
  // Only "Build my plan" acts immediately. One question, one row: the
  // chips answer the FIRST hard missing item only (budget and pace are
  // soft — they never drive the row). Dates and durations are never
  // mixed in one row.
  type Chip = { label: string; text?: string; action?: 'build' };
  const fillChip = (c: Chip) => {
    if (c.action === 'build') { build(); return; }
    setInput(c.text ?? c.label);
    inputRef.current?.focus();
  };
  const chips: Chip[] = (() => {
    if (!hasUserMsg) {
      return [
        { label: 'Central Europe in January', text: 'Central Europe in January' },
        { label: 'Warm beach in February', text: 'I want a warm beach in February' },
        { label: 'Surprise me', text: 'Surprise me' },
      ];
    }
    const firstHard = lastMissing.find((m) => !/budget|pace/i.test(m)) ?? '';
    if (/destination/i.test(firstHard)) {
      return [
        { label: 'Central Europe', text: 'Central Europe' },
        { label: 'Portugal', text: 'Portugal' },
        { label: 'Kyoto', text: 'Kyoto' },
      ];
    }
    if (/departure city|origin/i.test(firstHard)) {
      return [
        { label: 'New York', text: 'New York' },
        { label: 'Los Angeles', text: 'Los Angeles' },
        { label: 'Chicago', text: 'Chicago' },
      ];
    }
    if (/dates|month/i.test(firstHard)) {
      return [
        { label: 'January', text: 'January' },
        { label: 'March', text: 'March' },
        { label: 'July', text: 'July' },
      ];
    }
    if (/duration|days|long/i.test(firstHard)) {
      return [
        { label: '7 days', text: '7 days' },
        { label: '10 days', text: '10 days' },
        { label: '2 weeks', text: '2 weeks' },
      ];
    }
    if (/travelers|party|how many/i.test(firstHard)) {
      return [
        { label: 'Just me', text: 'Just me, 1 traveler' },
        { label: '2 travelers', text: '2 travelers' },
        { label: '4 travelers', text: '4 travelers' },
      ];
    }
    if (/kids/i.test(firstHard)) {
      return [
        { label: '2 kids, ages 4 and 7', text: '2 kids, ages 4 and 7' },
        { label: 'No kids, just adults', text: 'No kids, just adults' },
      ];
    }
    if (/budget/i.test(firstHard)) {
      return [
        { label: '$1,500', text: 'My budget is $1,500' },
        { label: '$2,000', text: 'My budget is $2,000' },
        { label: '$3,000', text: 'My budget is $3,000' },
      ];
    }
    if (/pace/i.test(firstHard)) {
      return [
        { label: 'Slow and relaxed', text: 'Slow and relaxed' },
        { label: 'Food and culture', text: 'Food and culture' },
        { label: 'Adventure', text: 'Adventure' },
      ];
    }
    if (slotsFilled && !plan) {
      return [
        { label: 'Build my plan', action: 'build' },
        { label: 'Make it cheaper', text: 'Make it cheaper' },
      ];
    }
    if (plan) {
      return [
        { label: 'Make it cheaper', text: 'Make it cheaper' },
        { label: 'What should I eat there?', text: 'What should I eat there?' },
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

  // The trip card: the plan artefact's data. Built from the trip the
  // chat collected — the same numbers the chat quoted, so the card and
  // the chat never disagree. Before the plan is built, a preview card
  // from the same slots drives the map, so the map shows the trip as
  // soon as the chat knows a destination.
  const cardOpts = (tier: number) => ({
    destination: lastParsed!.destination,
    travelers: lastParsed!.travelers,
    days: tripDays(lastParsed?.durationDays),
    month: lastParsed?.month ?? 0,
    origin: lastParsed?.origin ?? '',
    tier,
    kids: lastParsed?.kids ?? [],
    routeOverride: lastParsed?.routeOverride,
    sourceTips: lastParsed?.sourceTips,
    liveFares,
    pace: paceFromProfile(profile),
    ...(profile.maxSightsPerDay ? { maxSightsPerDay: profile.maxSightsPerDay } : {}),
    ...(lastParsed?.landingTime ? { landingTime: lastParsed.landingTime } : {}),
    ...(lastParsed?.departureTime ? { departureTime: lastParsed.departureTime } : {}),
  });
  const tripCard: TripCard | null = useMemo(
    () => (plan && lastParsed ? buildTripCard(cardOpts(choice)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, lastParsed, choice, liveFares, profile]
  );
  const previewCard: TripCard | null = useMemo(
    () => (lastParsed?.destination && !plan ? buildTripCard(cardOpts(choice)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastParsed, plan, choice, liveFares, profile]
  );
  const mapCard = tripCard ?? previewCard;
  const mapStops = useMemo(
    () => (mapCard ? mapCard.stops.filter((s) => CITY_INFO[s.city]).map((s) => ({ city: s.city, lat: CITY_INFO[s.city].lat, lng: CITY_INFO[s.city].lng })) : []),
    [mapCard]
  );
  const mapLegs = useMemo(() => mapCard?.legs ?? [], [mapCard]);
  const comparison = useMemo(
    () => (plan ? cardComparison(plan.destination, plan.travelers, { kids: lastParsed?.kids ?? [] }) : null),
    [plan, lastParsed]
  );
  // The canvas photo: the first stop's photo from the verified pool.
  const canvasPhoto = lastParsed?.destination ? photoForDestination(lastParsed.destination, routeCities[0]) : null;
  const chosen = plan ? plan.options[choice] : null;
  const stayLegs = (tripCard?.legs ?? []).filter((l) => l.kind === 'stay');
  const moveLegs = (tripCard?.legs ?? []).filter((l) => l.kind === 'transport' || l.kind === 'car');
  const selectedDayPlan = plan && selectedDay >= 1 && selectedDay <= plan.days.length ? plan.days[selectedDay - 1] : null;
  // The suggested start is the planner's suggestion (first Monday of
  // the month), labelled as such — never presented as dates the
  // traveler picked.
  const suggestedStartLabel = lastParsed?.month ? fmtDate(suggestedStart(lastParsed.month)) : null;

  return (
    <div>
      {/* App bar: the app's own bar — the FujinTrip mark, the theme
          toggle, the free-account button and the My Trips switcher.
          No "Plan with AI" pill here (you are already on the chat)
          and no total or Book in the bar — the Book action lives in
          the canvas, with the plan. */}
      <div className="appbar no-print">
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
          <AccountButton />
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
                  <a href="/account" className="menu-all" onClick={() => setTripsOpen(false)}>
                    See all in My Trips ↓
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`chat-split chat-${uiState.toLowerCase()}`} data-state={uiState}>
        {/* Chat column — ONLY a chat: greeting, messages, one input,
            one chip row. Nothing else competes for attention. */}
        <section className="chatcol no-print" aria-label="Chat with Fujin AI">
          <div className="chat" ref={chatRef}>
            {msgs.map((m, i) => (
              <div key={i} className="msg">
                {i === 0 && m.who === 'ai' ? (
                  <div className="bubble greeting">{m.text}</div>
                ) : (
                  <div className={`bubble ${m.who}`}>{m.who === 'ai' ? formatReply(m.text) : m.text}</div>
                )}
                {m.tips && m.tips.length > 0 && (
                  <div className="msg-tips">
                    {m.tips.map((t, j) => (
                      <p key={j}>{t}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {streamingText !== null && (
              <div className="msg">
                <div className="bubble streaming">{formatReply(streamingText)}</div>
              </div>
            )}
            {thinking !== null && (
              <div className="thinking-status" role="status">
                {thinking === 'searching' ? 'Searching live fares…' : 'Thinking…'}
              </div>
            )}
          </div>
          <div className="chips" role="group" aria-label="Quick replies">
            {chips.map((c) => (
              <button key={c.label} type="button" className="chip" disabled={busy} data-fill={c.action === 'build' ? undefined : (c.text ?? c.label)} onClick={() => fillChip(c)}>
                {c.label}
              </button>
            ))}
          </div>
          <form
            className="hero-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Try: Bali, 2 travelers, surf and food" aria-label="Message Fujin AI" />
            {busy ? (
              <button type="button" className="primary" onClick={stopStream}>
                Stop
              </button>
            ) : (
              <button type="submit" className="primary">
                {hasUserMsg ? 'Send' : 'Start planning'}
              </button>
            )}
          </form>
          <p className="chat-hint">One trip, one plan — flights, stay, car and activities. All-in, no hidden fees.</p>
        </section>

        {/* Canvas — the trip lives here, not under the chat. */}
        <aside className="canvas" aria-label="Your trip">
          {uiState === 'S0' && (
            <div className="canvas-welcome">
              {S0_PHOTO ? (
                <div className="s0-photo">
                  <SafeImg src={S0_PHOTO} alt="Yasaka pagoda street at sunset, Kyoto" label="Kyoto" className="s0-photo-img" loading="eager" />
                </div>
              ) : null}
              <h2>Your trip will appear here.</h2>
              <p>Tell Fujin where you want to go — it asks one question at a time and builds one plan: flights, stay, car and activities, in Cheapest, Best value and Premium.</p>
            </div>
          )}
          {uiState !== 'S0' && (
            <>
              {/* Trip Summary — one place to see (and change) the trip. */}
              <div className="canvas-card summary-card no-print">
                {canvasPhoto ? (
                  <div className="summary-photo">
                    <SafeImg src={canvasPhoto} alt={lastParsed!.destination} label={lastParsed!.destination} className="summary-photo-img" />
                  </div>
                ) : null}
                <h2>{lastParsed!.destination}</h2>
                <div className="summary-rows">
                  <button type="button" className="summary-line" disabled={busy} onClick={() => send('I want to change the route')} title="Tap to change the route">
                    <span className="summary-key">Route</span>
                    <span className="summary-val">{summaryRoute || 'Not set yet'}</span>
                  </button>
                  <button type="button" className="summary-line" disabled={busy} onClick={() => send('I want to change the dates')} title="Tap to change the dates">
                    <span className="summary-key">Dates</span>
                    <span className="summary-val">{summaryDates}</span>
                  </button>
                  <button type="button" className="summary-line" disabled={busy} onClick={() => send('I want to change the party size')} title="Tap to change the party size">
                    <span className="summary-key">Travelers</span>
                    <span className="summary-val">{summaryTravelers}</span>
                  </button>
                  <button type="button" className="summary-line" disabled={busy} onClick={() => send('I want to change where I fly from')} title="Tap to change the departure city">
                    <span className="summary-key">From</span>
                    <span className="summary-val">{summaryFrom}</span>
                  </button>
                </div>
                {!slotsFilled && missingSlots.length > 0 && <p className="summary-missing">Still need: {missingSlots.join(', ')}.</p>}
              </div>

              {/* Confirm before building — the slots are filled, so the
                  traveler checks the summary once, then builds. */}
              {slotsFilled && !plan && !confirmDismissed && (
                <div className="canvas-card confirm-card no-print">
                  <h3>Does this look right?</h3>
                  <p>
                    {summaryRoute} · {summaryDates} · {summaryTravelers} · from {summaryFrom}
                  </p>
                  <div className="confirm-actions">
                    <button type="button" className="primary" onClick={build}>
                      Looks right — build my plan
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setConfirmDismissed(true);
                        send('I want to change something');
                      }}
                    >
                      Change something
                    </button>
                  </div>
                </div>
              )}

              {/* The map, from the moment the chat knows a destination —
                  the preview card drives it before the plan is built. */}
              {mapCard && mapStops.length > 0 && (
                <div className="canvas-card map-card no-print">
                  <TripMap stops={mapStops} legs={mapLegs} dark={theme === 'dark'} />
                </div>
              )}

              {/* The plan artefact — route timeline, day strip, stays,
                  tiers, one Book action. This is also the printed plan. */}
              {plan && tripCard && chosen && (
                <div className="canvas-card plan-card plan-print">
                  <div className="plan-head">
                    <h2>{plan.destination}</h2>
                    <p className="plan-route">{tripCard.routeLine}</p>
                    <p className="plan-total">
                      <strong>
                        {chosen.name} ${tripCard.total.toLocaleString()}
                      </strong>{' '}
                      total for {plan.travelers} traveler{plan.travelers > 1 ? 's' : ''}
                    </p>
                    <p className="fare-label">
                      {tripCard.flight.live
                        ? 'Live fares — cheapest out and back for this trip.'
                        : 'Planning estimates — flight prices are estimates until live fares are fetched.'}
                    </p>
                    {suggestedStartLabel && <p className="plan-dates">Suggested start: {suggestedStartLabel} — change it any time.</p>}
                  </div>
                  <div className="compare" role="group" aria-label="Choose your tier">
                    {plan.options.map((o, i) => (
                      <button key={o.name} type="button" className={`box${i === choice ? ' chosen' : ''}`} aria-pressed={i === choice} onClick={() => setChoice(i)}>
                        <strong>{o.name}</strong>
                        <span>${o.total.toLocaleString()}</span>
                        <span className="box-note">{o.note}</span>
                      </button>
                    ))}
                  </div>
                  <div className="timeline">
                    <h3>Your route</h3>
                    {tripCard.stops.map((s) => (
                      <div key={s.city} className="timeline-stop">
                        <strong>
                          {s.city}
                          {s.country ? `, ${s.country}` : ''}
                        </strong>
                        <span>
                          {s.nights} night{s.nights !== 1 ? 's' : ''}
                        </span>
                        <span>{s.intro}</span>
                        <span>
                          {s.transportIn.mode} from {s.transportIn.from} · ${s.transportIn.price.toLocaleString()}
                        </span>
                      </div>
                    ))}
                    <p className="timeline-return">
                      Return: {tripCard.returnTransport.mode} from {tripCard.returnTransport.from} · ${tripCard.returnTransport.price.toLocaleString()}
                    </p>
                  </div>
                  <div className="day-strip" role="group" aria-label="Days">
                    {plan.days.map((d) => (
                      <button key={d.day} type="button" className={d.day === selectedDay ? 'day-btn chosen' : 'day-btn'} aria-pressed={d.day === selectedDay} onClick={() => setSelectedDay(d.day)}>
                        Day {d.day}
                      </button>
                    ))}
                  </div>
                  {selectedDayPlan && (
                    <div className="day-detail">
                      <h3>
                        Day {selectedDayPlan.day} — {selectedDayPlan.title}
                      </h3>
                      <p>
                        <strong>Morning:</strong> {selectedDayPlan.morning}
                      </p>
                      <p>
                        <strong>Afternoon:</strong> {selectedDayPlan.afternoon}
                      </p>
                      <p>
                        <strong>Evening:</strong> {selectedDayPlan.evening}
                      </p>
                      <p>{selectedDayPlan.stay}</p>
                      <p>{selectedDayPlan.transport}</p>
                    </div>
                  )}
                  <div className="flight-block">
                    <h3>Flights</h3>
                    <p>
                      Out: {tripCard.flight.out.airline} · ${tripCard.flight.out.price.toLocaleString()}
                      {tripCard.flight.out.live ? ' (live)' : ' (estimate)'}
                    </p>
                    <p>
                      Back: {tripCard.flight.back.airline} · ${tripCard.flight.back.price.toLocaleString()}
                      {tripCard.flight.back.live ? ' (live)' : ' (estimate)'}
                    </p>
                    <p>
                      Between cities: ${tripCard.flight.intercity.price.toLocaleString()}
                      {tripCard.flight.intercity.live ? ' (live)' : ' (estimate)'}
                    </p>
                    <p>Service fee: ${tripCard.flight.serviceFee.toLocaleString()}</p>
                  </div>
                  {stayLegs.length > 0 && (
                    <div className="stay-cards">
                      <h3>Where you stay</h3>
                      {stayLegs.map((l) => (
                        <div key={l.id} className="stay-card">
                          <strong>Stay in {l.city}</strong>
                          <span>${l.price.toLocaleString()}</span>
                          <span>{l.detail}</span>
                          {l.terms && <span>{l.terms}</span>}
                          {l.feeWarning && <span>{l.feeWarning}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {moveLegs.length > 0 && (
                    <div className="move-list">
                      <h3>Getting around</h3>
                      {moveLegs.map((l) => (
                        <p key={l.id}>
                          {l.label} — {l.detail} · ${l.price.toLocaleString()}
                        </p>
                      ))}
                    </div>
                  )}
                  {comparison && (
                    <p className="comparison-line">
                      Booking each part separately would cost ${comparison.separate.total.toLocaleString()} — this plan saves you ${comparison.save.toLocaleString()} ({comparison.savePercent}
                      %).
                    </p>
                  )}
                  <div className="plan-actions no-print">
                    <button type="button" className="primary" onClick={bookPlan}>
                      Book — {chosen.name} ${chosen.total.toLocaleString()}
                    </button>
                    <button type="button" className="ghost" onClick={requestPdf}>
                      Save as PDF {planBooked ? '(free — you booked)' : '($1)'}
                    </button>
                    <button type="button" className="ghost" onClick={startNewTrip}>
                      Start a new trip
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {pdfGate && (
        <div className="no-print">
          <SavePdfGateNotice onDismiss={() => setPdfGate(false)} />
        </div>
      )}
      {pdfPay && pdfClientSecret && (
        <div className="no-print">
          <PlanPdfPayment
            clientSecret={pdfClientSecret}
            onPaid={(intentId) => confirmPdfPayment(intentId || pdfPaymentIntentId)}
            onCancel={() => {
              setPdfPay(false);
              setPdfClientSecret('');
            }}
          />
        </div>
      )}
      {pdfNotice && (
        <p className="pdf-notice no-print" role="status">
          {pdfNotice}
        </p>
      )}
      {actionMsg && (
        <p className="action-msg no-print" role="status">
          {actionMsg}
        </p>
      )}
    </div>
  );
}
