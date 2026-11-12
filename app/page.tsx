'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, LOCAL_TRIPS, TABS, type Tab } from '../lib/data';
import { askFujin, buildPlan, comparisonFor, fareClassForTier, findMonth, findOrigin, findOriginAnswer, optionsLine, parseDuration, parseKidAges, routeKeyForDestination, ROUTE_STOPS, type Plan, type RouteOverride } from '../lib/planner';
import { buildTripCard, cardComparison, CITY_INFO, type TripCard, type TripLeg } from '../lib/tripCard';
import { appendObservation, trendLine, type TrendObservation } from '../lib/duffel';
import type { TonightResult } from '../lib/food';
import { visaForDestination, VISA_LAST_CHECKED, VISA_PASSPORT_NOTE, type VisaInfo } from '../lib/visa';
import { guideFor } from '../lib/localGuides';
import AdSlot from '../components/AdSlot';

// Trip map (Leaflet) is client-only — it needs window, so it loads
// without server rendering.
const TripMap = dynamic(() => import('../components/TripMap'), { ssr: false });

type Trip = { id: string; label: string; status: string; date: string; destination?: string };

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
function SafeImg({ src, alt, label, className }: { src: string; alt: string; label: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`img-fallback ${className ?? ''}`} role="img" aria-label={alt}>
        <span>{label}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />;
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

function Chat({ onParsed, onSaveTrip, onWatchPrices, bookedDestinations, watches }: { onParsed?: (t: { destination: string; travelers: number; kids?: number[] }) => void; onSaveTrip: (label: string, status: string, destination?: string) => void; onWatchPrices: (w: Omit<PriceWatch, 'id' | 'baselineAt' | 'lastCheckedAt'>) => void; bookedDestinations: string[]; watches: PriceWatch[] }) {
  const [msgs, setMsgs] = useState<{ who: string; text: string; tips?: string[] }[]>([{ who: 'ai', text: 'Hi, I’m Fujin AI. Tell me where you want to go, for how many people — I’ll gather flights, hotels, cars and sightseeing into one plan, in Cheapest / Best value / Premium.' }]);
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState(1);
  const [lastParsed, setLastParsed] = useState<{ destination: string; travelers: number; origin?: string; month?: number; durationDays?: number; routeKey?: string; kids?: number[]; routeOverride?: RouteOverride } | null>(null);
  const [aiLive, setAiLive] = useState<boolean | null>(null);
  // Fresh traveler material fetched live for the last chat destination
  // (route returns it as `voices`) — feeds the "What travelers say" block.
  const [voices, setVoices] = useState<Voices>(null);
  // On-trip mode: the traveler is already at the destination and wants
  // short, right-now local answers. WhatsApp delivery is a later step
  // (needs a business number) — this mode works in the chat today.
  const [tripMode, setTripMode] = useState(false);
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
  // "Leave now" hint for a flight that is still on the ground and
  // departs within 4 hours — general advice, not a per-flight fact.
  const leaveNow = (s: FlightStatusData): string | null => {
    if (!s.live || s.cancellationConfirmed || s.actualDeparture || !s.estimatedDeparture) return null;
    const mins = Math.round((new Date(s.estimatedDeparture).getTime() - Date.now()) / 60000);
    if (mins < 0 || mins > 240) return null;
    return `Departs in ${mins < 60 ? `${mins} minutes` : `${Math.floor(mins / 60)}h ${mins % 60}m`} — if you're not at the airport yet, leave now: most airlines close check-in an hour before departure.`;
  };
  // Confirmation line for the plan actions below (share / watch / hold / human).
  const [actionMsg, setActionMsg] = useState('');
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
        const p = JSON.parse(t) as { destination?: unknown; travelers?: unknown; origin?: unknown; month?: unknown; durationDays?: unknown; routeKey?: unknown; kids?: unknown; routeOverride?: unknown };
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
          setLastParsed({
            destination: p.destination,
            travelers: p.travelers,
            ...(typeof p.origin === 'string' && p.origin ? { origin: p.origin } : {}),
            ...(typeof p.month === 'number' ? { month: p.month } : {}),
            ...(typeof p.durationDays === 'number' ? { durationDays: p.durationDays } : {}),
            ...(typeof p.routeKey === 'string' && p.routeKey ? { routeKey: p.routeKey } : {}),
            ...(Array.isArray(p.kids) ? { kids: p.kids.filter((k): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6) } : {}),
            ...(restoredOverride ? { routeOverride: restoredOverride } : {}),
          });
          onParsed?.({ destination: p.destination, travelers: p.travelers });
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

  const send = async (textOverride?: string, statusOverride?: FlightStatusData | null) => {
    const text = (textOverride ?? input).trim();
    if (!text) return;
    setInput('');
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
    // The price watch for this trip, if one exists — its own past checks
    // ride along in tripState so the trend read is from real checks.
    const tripWatch = lastParsed ? watchFor(lastParsed.destination, lastParsed.travelers, lastParsed.origin ?? '', lastParsed.month ?? 0, lastParsed.durationDays ?? 0) : undefined;
    // Live AI first (server route); any failure falls back to the built-in planner.
    let parsed: { destination: string; travelers: number; reply: string; missing: string[]; tips?: string[]; kids?: number[]; routeOverride?: RouteOverride; tier?: number };
    let live = false;
    try {
      const r = await fetch('/api/fujin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          // Conversation history: the last few turns, so the AI remembers
          // the trip instead of treating each message as a fresh
          // conversation (the Nov 10 Europe bug). 10 turns — a long
          // conversation must not lose the trip.
          history: msgs.slice(-10).map((m) => ({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text })),
          // Durable trip memory: the trip already established (destination
          // + travelers + departure city) goes with EVERY request, so it
          // survives history scrolling off the window.
          ...(lastParsed ? { tripState: { ...lastParsed, ...(origin ? { origin } : {}), tier: choice, ...(tripWatch && tripWatch.history.length ? { priceHistory: tripWatch.history } : {}) } } : {}),
          // On-trip mode: tell the server the traveler is already there.
          ...(tripMode && lastParsed ? { tripContext: lastParsed.destination } : {}),
          // Disruption report: the checked flight status rides along so
          // the AI quotes a confirmed status, never a guess (feature 5).
          ...(statusOverride ? { flightStatus: statusOverride } : {}),
        }),
      });
      const j = await r.json();
      if (r.ok && typeof j.reply === 'string' && typeof j.destination === 'string') {
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
        parsed = { destination: j.destination, travelers: typeof j.travelers === 'number' ? j.travelers : 2, reply: j.reply, missing: Array.isArray(j.missing) ? j.missing : [], tips: Array.isArray(j.tips) ? j.tips.filter((t: unknown): t is string => typeof t === 'string').slice(0, 3) : [], kids: Array.isArray(j.kids) ? j.kids.filter((k: unknown): k is number => typeof k === 'number' && k >= 0 && k <= 17).slice(0, 6) : undefined, ...(routeStops.length ? { routeOverride: { cities: routeStops, ...(routeWeights && Object.keys(routeWeights).length ? { weights: routeWeights } : {}) } } : {}), ...(typeof j.tier === 'number' && [0, 1, 2].includes(j.tier) ? { tier: j.tier } : {}) };
        live = j.live === true;
        // Keep the fresh traveler material the server fetched for this trip.
        if (typeof j.voices === 'string' && j.voices && typeof j.voicesDestination === 'string' && j.voicesDestination) {
          setVoices({ destination: j.voicesDestination, text: j.voices, source: typeof j.voicesSource === 'string' ? j.voicesSource : '' });
        }
      } else {
        parsed = withOptions(askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin, lastParsed?.routeOverride, kids.length ? kids : lastParsed?.kids ?? [], choice));
      }
    } catch {
      parsed = withOptions(askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin, lastParsed?.routeOverride, kids.length ? kids : lastParsed?.kids ?? [], choice));
    }
    setAiLive(live);
    // Empty destination means an off-topic decline — keep any earlier plan destination.
    if (parsed.destination) {
      // A new destination means a new trip: the old plan no longer applies
      // — clear it so the traveler builds a fresh one for this trip.
      if (lastParsed && parsed.destination !== lastParsed.destination) {
        setPlan(null);
        setChosenLegs(new Set());
        setSelectedLeg(null);
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
      });
      // The price-comparison section below follows the AI's trip.
      onParsed?.({ destination: parsed.destination, travelers: parsed.travelers, ...(kidsOut.length ? { kids: kidsOut } : {}) });
    }
    setMsgs((m) => [...m, { who: 'ai', text: parsed.reply + (parsed.missing.length ? ` To finish the plan I still need: ${parsed.missing.join(', ')}.` : ' Tap Build my plan below.'), tips: parsed.tips }]);
  };
  const build = () => {
    const dest = lastParsed?.destination ?? 'Kyoto';
    const people = lastParsed?.travelers ?? 2;
    // The plan's day cards span the trip length the traveler gave
    // (14 days → 14 day cards), not a fixed 3.
    setPlan(buildPlan(dest, people, lastParsed?.durationDays ?? 3, { kids: lastParsed?.kids ?? [] }));
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
  const startNewTrip = () => {
    setPlan(null);
    setLastParsed(null);
    setChoice(1);
    setPdfNotice('');
    setPdfPay(false);
    setActionMsg('Started a new trip — ask Fujin AI where to next.');
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
          })
        : null,
    [plan, lastParsed, choice]
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
          })
        : null,
    [lastParsed, choice]
  );
  const mapCard = tripCard ?? previewCard;
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
  // Map inventory (split-screen, Nov 11): the legs the traveler picked
  // from the map's price tags, and the leg whose card is open. A new
  // destination clears the picks — they belonged to the old trip.
  const [chosenLegs, setChosenLegs] = useState<Set<string>>(new Set());
  const [selectedLeg, setSelectedLeg] = useState<TripLeg | null>(null);
  const [legExpanded, setLegExpanded] = useState(false);
  const chosenTotal = useMemo(
    () => (mapCard ? mapCard.legs.filter((l) => chosenLegs.has(l.id)).reduce((s, l) => s + l.price, 0) : 0),
    [mapCard, chosenLegs]
  );
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
  }, [msgs]);
  // Add to plan: the leg joins the trip plan AND the chat — the traveler
  // sees the pick in the conversation, not just on the map.
  const addLegToPlan = (leg: TripLeg) => {
    setChosenLegs((prev) => new Set(prev).add(leg.id));
    setMsgs((m) => [...m, { who: 'ai', text: `Added to your plan: ${leg.label} — from $${leg.price.toLocaleString()}.` }]);
  };
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtDateYear = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div>
      {/* Split screen (Nov 11): the chat stays still on the left, the map
          fills the right half and changes as the trip changes — the route
          and the flights, stays and cars as price tags the traveler can
          click to read more or add to the plan. */}
      <div className="chatmap">
        <div className="chatcol">
          <div className="chat" ref={chatRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.who === 'user' ? 'user' : ''}`}>
                {m.who === 'ai' ? <div className="bubble">{formatReply(m.text)}</div> : <span className="bubble">{m.text}</span>}
                {m.who === 'ai' && m.tips && m.tips.length > 0 && (
                  <ul style={{ fontSize: 13, color: '#666', margin: '6px 0 0 12px', paddingLeft: 16, textAlign: 'left' }}>
                    {m.tips.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div className="row">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={tripMode ? `On your trip in ${lastParsed?.destination ?? '…'} — ask where to eat tonight…` : 'Try: Bali, 2 travelers, surf and food, next spring, $2,000'} aria-label="Ask Fujin AI" />
            <button className="primary" onClick={() => send()}>Send</button>
          </div>
          <p className="selling">Gathers everything into one plan · Customized for you · Verify before you book</p>
          <p className="selling">No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
          {aiLive !== null && <p className="no-print" style={{ fontSize: 12, color: '#666' }}>{aiLive ? 'Fujin AI is live.' : 'Fujin AI is offline — using the built-in planner.'}</p>}
          <p className="no-print" style={{ marginTop: 16 }}>
            <button className="primary" onClick={build}>Build my plan</button>{' '}
            {lastParsed && (
              <button className="ghost" onClick={() => setTripMode((m) => !m)}>
                {tripMode ? `✓ On-trip mode on — ${lastParsed.destination}` : 'Take this plan on your trip'}
              </button>
            )}
          </p>
          {tripMode && lastParsed && (
            <div className="no-print" style={{ marginTop: 8 }}>
              <p style={{ fontSize: 13, color: '#666' }}>On-trip mode for {lastParsed.destination}: short, right-now answers — where to eat tonight, what’s open, how to get there. (WhatsApp delivery comes later — it needs a business number.)</p>
              {/* Check my flight (competitor learning #5, TripIt Pro /
                  Romie / Layla): live status, gate + baggage, and the
                  "my flight was cancelled" path to rebooking options. */}
              <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: 12, marginTop: 8, background: '#fff' }}>
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
                    <p style={{ margin: '4px 0', color: '#666' }}>
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
                  <p style={{ marginTop: 10, fontSize: 13, color: '#666' }}>{flightStatus.message ?? 'Live flight status isn’t available for this flight right now.'}</p>
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
              <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, padding: 12, marginTop: 8, background: '#fff' }}>
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
                        {p.quote ? <div style={{ marginTop: 2, color: '#666' }}>Wikivoyage says: “{p.quote}”</div> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {tonight && tonight !== 'loading' && tonight.places.length === 0 && (
                  <p style={{ marginTop: 10, fontSize: 13, color: '#666' }}>I couldn&apos;t confirm anywhere open tonight in {foodCity} — the guide has no Eat listings I could verify. Try asking Fujin AI, or check back later.</p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mapcol no-print">
          {mapCard ? (
            <>
              <div style={{ flex: 1, minHeight: 0 }}>
                <TripMap
                  stops={mapCard.stops
                    .filter((s) => CITY_INFO[s.city])
                    .map((s) => ({ city: s.city, lat: CITY_INFO[s.city].lat, lng: CITY_INFO[s.city].lng }))}
                  legs={mapCard.legs}
                  selectedLegId={selectedLeg?.id ?? null}
                  onSelectLeg={(leg) => {
                    setSelectedLeg(leg);
                    setLegExpanded(false);
                  }}
                  addedLegIds={[...chosenLegs]}
                />
              </div>
              {selectedLeg && (
                <div className="legcard">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <strong>
                      {selectedLeg.icon} {selectedLeg.label}
                    </strong>
                    <button className="ghost" aria-label="Close" onClick={() => setSelectedLeg(null)} style={{ padding: '2px 10px' }}>
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
                    <p style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>{selectedLeg.terms}</p>
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
                {chosenLegs.size > 0 && (
                  <p className="maphint">
                    In your plan so far: {chosenLegs.size} of {mapCard.legs.length} items · ${chosenTotal.toLocaleString()} — the full plan is below.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="map-placeholder">
              <p>
                <strong>Your trip map</strong>
              </p>
              <p>Tell Fujin AI where you want to go, then build the plan — the map fills in with your route, and the flights, stays and cars appear as price tags you can click.</p>
            </div>
          )}
        </div>
      </div>
      {plan && (
        <div className="plan-print" style={{ marginTop: 20 }}>
          <h3>Your {plan.destination} plan — pick one</h3>
          {tripCard && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: '4px 0' }}>{tripCard.title}</h3>
              <p style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>
                {tripCard.days} days · {tripCard.stops.length} {tripCard.stops.length > 1 ? 'cities' : 'city'} · {tripCard.experiences} experiences · {tripCard.hotels} {tripCard.hotels > 1 ? 'stays' : 'stay'} · {tripCard.transports} transports
              </p>
              {tripCard.familyNote && (
                <p style={{ fontSize: 14, margin: '8px 0', background: '#fff1e8', border: '1px solid #ead9c8', borderRadius: 10, padding: '10px 14px' }}>
                  <strong>Family pace</strong> — {tripCard.familyNote}
                </p>
              )}
              <p style={{ fontSize: 14, margin: '4px 0' }}>
                <strong>{fmtDateYear(tripCard.startDate)} – {fmtDateYear(tripCard.endDate)}</strong>{' '}
                <span style={{ color: '#666', fontSize: 13 }}>(Suggested dates — change anytime.)</span>
              </p>
              <p style={{ fontSize: 14, margin: '8px 0' }}>{tripCard.routeLine}</p>
              {/* The map lives in the split screen above — it shows the
                  route and the price tags there, not inside the plan. */}
              <p className="print-only" style={{ fontSize: 13, color: '#666' }}>Map: {tripCard.routeLine}</p>
              <div style={{ background: '#f7f7f5', border: '1px solid #e8e8e6', borderRadius: 10, padding: '10px 14px', marginTop: 12 }}>
                <strong style={{ fontSize: 14 }}>Top improvement for your budget</strong>
                <p style={{ fontSize: 14, margin: '4px 0' }}>{tripCard.budgetTip}</p>
              </div>
              {tripCard.stops.map((stop, si) => (
                <div key={stop.city} style={{ borderTop: '1px solid #f0f0ee', padding: '12px 0' }}>
                  <strong>Days {stop.days[0]?.day ?? si + 1}{stop.days.length > 1 ? `-${stop.days[stop.days.length - 1].day}` : ''} · {fmtDate(stop.startDate)} – {fmtDate(stop.endDate)} · {stop.city}</strong>
                  <p style={{ margin: '4px 0' }}>{stop.intro}</p>
                  <p style={{ fontSize: 14, margin: '4px 0' }}>
                    <b>Arrive:</b> {stop.transportIn.mode} {stop.transportIn.from} → {stop.city} · from ${stop.transportIn.price.toLocaleString()} <span style={{ color: '#666' }}>(estimate)</span>
                  </p>
                  <p style={{ fontSize: 14, margin: '4px 0' }}>
                    <b>Stay:</b> {stop.nights} night{stop.nights > 1 ? 's' : ''} · hostel / guesthouse estimate from ${stop.stayEstimate.toLocaleString()} <span style={{ color: '#666' }}>(planning estimate — real named stays arrive with a hotel supplier)</span>
                  </p>
                  <p style={{ fontSize: 14, margin: '8px 0 4px' }}><b>Itinerary</b></p>
                  {stop.days.map((d) => (
                    <p key={d.day} style={{ fontSize: 14, margin: '3px 0' }}>
                      Day {d.day} · {fmtDate(d.date)}{d.weatherF ? ` · ${d.weatherF}°F typical` : ''} · {d.experiences} experiences — {d.title}
                    </p>
                  ))}
                </div>
              ))}
              <div style={{ borderTop: '1px solid #f0f0ee', padding: '12px 0' }}>
                <p style={{ fontSize: 14, margin: '4px 0' }}>
                  <b>Depart:</b> ✈️ Flight {tripCard.stops[tripCard.stops.length - 1].city} → {tripCard.origin || 'your city'} · from ${tripCard.returnTransport.price.toLocaleString()} <span style={{ color: '#666' }}>(estimate)</span>
                </p>
              </div>
              {comparison && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Our rate vs other options</h3>
                  <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid #e8e8e6' }}>
                        <th style={{ padding: '6px 0' }}></th>
                        <th style={{ padding: '6px 0' }}>FujinTrip — Best value</th>
                        <th style={{ padding: '6px 0' }}>Booking separately</th>
                        <th style={{ padding: '6px 0' }}>Other sites (live)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>Flights</td><td>${comparison.best.flight.toLocaleString()}</td><td>${comparison.separate.flight.toLocaleString()}</td><td rowSpan={4} style={{ verticalAlign: 'top', color: '#666' }}>Live competitor rates arrive with live fares — no live fare feed is connected yet, so we show nothing invented here.</td></tr>
                      <tr><td>Hotels</td><td>${comparison.best.hotel.toLocaleString()}</td><td>${comparison.separate.hotel.toLocaleString()}</td></tr>
                      <tr><td>Car</td><td>${comparison.best.car.toLocaleString()}</td><td>${comparison.separate.car.toLocaleString()}</td></tr>
                      <tr><td>Activities</td><td>${comparison.best.activities.toLocaleString()}</td><td>${comparison.separate.activities.toLocaleString()}</td></tr>
                      <tr style={{ borderTop: '2px solid #e8e8e6', fontWeight: 700 }}><td>Total</td><td>${comparison.best.total.toLocaleString()}</td><td>${comparison.separate.total.toLocaleString()}</td></tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 14, margin: '8px 0' }}>
                    You save <strong>${comparison.save.toLocaleString()} (~{comparison.savePercent}%)</strong> with FujinTrip vs booking each leg separately. Prices are planning estimates, not live quotes.
                  </p>
                </div>
              )}
              {visaInfos.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Visa &amp; entry requirements</h3>
                  <p style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>
                    {VISA_PASSPORT_NOTE} Checked {VISA_LAST_CHECKED} — check before you book.
                  </p>
                  {visaInfos.map((v) => (
                    <div key={v.country} style={{ borderTop: '1px solid #f0f0ee', padding: '10px 0' }}>
                      <strong style={{ fontSize: 14 }}>{v.country}</strong>
                      <p style={{ fontSize: 14, margin: '4px 0' }}>{v.visa}</p>
                      <p style={{ fontSize: 14, margin: '4px 0' }}><b>Passport:</b> {v.passport}</p>
                      {v.notes.map((n) => (
                        <p key={n} style={{ fontSize: 14, margin: '4px 0' }}>{n}</p>
                      ))}
                      <p style={{ fontSize: 13, margin: '4px 0' }}>
                        Official source: <a href={v.sourceUrl} target="_blank" rel="noreferrer">{v.source}</a>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {plan && (
                <div style={{ marginTop: 16, background: '#f7f7f5', border: '1px solid #e8e8e6', borderRadius: 10, padding: '10px 14px' }}>
                  <strong style={{ fontSize: 14 }}>Book now or wait?</strong>
                  {priceCheck === 'loading' && <p style={{ fontSize: 14, margin: '4px 0' }}>Checking the live fares for this trip…</p>}
                  {priceCheck && priceCheck !== 'loading' && priceCheck.live && (
                    <>
                      <p style={{ fontSize: 14, margin: '4px 0' }}>{priceCheck.line}</p>
                      {priceCheck.trend && priceCheck.trend.line ? (
                        <p style={{ fontSize: 14, margin: '4px 0' }}>{priceCheck.trend.line}</p>
                      ) : (
                        <p style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>No price history yet — watch this trip&apos;s prices and we&apos;ll show whether the fares are drifting up or down.</p>
                      )}
                      <p style={{ fontSize: 13, color: '#666', margin: '4px 0' }}>
                        Cheapest live fares: {priceCheck.out[0] ? `${priceCheck.out[0].airline} $${priceCheck.out[0].price.toLocaleString()} out` : 'no outbound fare'} · {priceCheck.back[0] ? `${priceCheck.back[0].airline} $${priceCheck.back[0].price.toLocaleString()} back` : 'no return fare'} · {priceCheck.departDate} → {priceCheck.returnDate}. Live Duffel fares (test fares in test mode).
                      </p>
                    </>
                  )}
                  {priceCheck && priceCheck !== 'loading' && !priceCheck.live && (
                    <p style={{ fontSize: 14, margin: '4px 0' }}>
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
          <div className="compare" style={{ marginTop: 12 }}>
            {plan.options.map((o, i) => (
              <div key={o.name} className={`box ${i === choice ? 'best chosen' : ''}`} onClick={() => setChoice(i)} style={{ cursor: 'pointer' }}>
                <strong>{o.name}{i === 1 ? ' ★ Best value' : ''}</strong>
                <p style={{ fontSize: 26, margin: '8px 0' }}>${o.total.toLocaleString()}</p>
                <table><tbody>
                  <tr><td>Flights</td><td>${o.flight}</td></tr>
                  <tr><td>Hotel</td><td>${o.hotel}</td></tr>
                  <tr><td>Car</td><td>${o.car}</td></tr>
                  <tr><td>Activities</td><td>${o.activities}</td></tr>
                </tbody></table>
                <p style={{ fontSize: 13, color: '#666' }}>{fareClassForTier(i).name} — {fareClassForTier(i).includes.join(', ')}{fareClassForTier(i).excludes.length ? `; ${fareClassForTier(i).excludes.join(', ')}` : ''}</p>
                <p style={{ fontSize: 13, color: '#666' }}>{o.note}</p>
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
          {voices && voices.destination === plan.destination ? (
            <div>
              <p style={{ fontSize: 13, color: '#666' }}>From real traveler guides — never invented reviews. Source: {voices.source || 'Wikivoyage traveler guide, fetched live'}.</p>
              {voices.text.split('\n').filter((l) => l.trim()).map((line, i) => (
                <p key={i} style={{ fontSize: 14 }}>{line}</p>
              ))}
            </div>
          ) : guide ? (
            <div>
              <p style={{ fontSize: 13, color: '#666' }}>From researched traveler guides — real dishes and places, never invented reviews. Source: {guide.source}.</p>
              <p><b>Dishes to know:</b></p>
              <ul>{guide.dishes.map((d) => <li key={d}>{d}</li>)}</ul>
              <p><b>Named places:</b></p>
              <ul>{guide.places.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : (
            <p>No traveler notes fetched for {plan.destination} yet — ask Fujin AI about it in the chat and fresh notes will be pulled in live.</p>
          )}
          <h3>Money-saving tips</h3>
          <ul>{plan.tips.map((t) => <li key={t}>{t}</li>)}</ul>
          <p style={{ fontSize: 13, color: '#666' }}>Travellers liked: {plan.liked.join(' · ')} — Book it all with FujinTrip, one booking, one price.</p>
        </div>
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
  const [tab, setTab] = useState<Tab>('Fujin AI');
  const [trips, setTrips] = useState<Trip[]>([]);
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
  return (
    <div>
      <header><div className="wrap topbar"><div><div className="logo">Fujin<span>Trip</span></div><div className="tag">Ride the wind. Pay less. · fujintrip.com</div></div><div className="tag">Quality + affordable prices</div></div></header>
      <main className="wrap">
        <section className="hero">
          <SafeImg className="fujin-portrait" src={FUJIN_IMG} alt="Wind God by Ogata Korin — Fujin, the Japanese wind god" label="風" />
          <h1>One complete plan. Cheapest, Best value, or Premium.</h1>
          <p>Ask Fujin AI once — flights, hotels, cars and sightseeing, all booked with FujinTrip.</p>
        </section>

        <div className="tabs" role="tablist" aria-label="Search">
          {TABS.map((t) => (<button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>))}
        </div>
        <div className="panel">
          {tab === 'Fujin AI' ? <Chat onParsed={setAiTrip} onSaveTrip={saveTrip} onWatchPrices={addWatch} bookedDestinations={bookedDestinations} watches={watches} /> : <SearchForm tab={tab} onSave={saveTrip} />}
        </div>

        <section>
          <h2>Global packages, in one plan</h2>
          <p className="sub">Flights, hotels, car rental, sightseeing and more — gathered into a single customized trip, not seven separate bookings.</p>
          <div className="grid">
            {GLOBAL_DESTINATIONS.map((d) => (
              <article className="card" key={d.name}>
                <SafeImg src={d.image} alt={d.name} label={d.name} />
                <div className="body"><span className="pill">{d.tag}</span><h3>{d.name}, {d.country}</h3><p>{d.blurb}</p><p className="price">{d.priceFrom}</p><button className="ghost" onClick={() => saveTrip(`${d.name} package — request saved`)}>Add to My Trips</button></div>
              </article>
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
          <p style={{ fontSize: 13, color: '#666' }}>{geoStatus}{locName && locName !== 'default' ? ` Showing trips near ${locName}.` : ''}</p>
          <div className="grid">{local.map((l) => (<article className="card" key={l.name}><div className="body"><span className="pill">{l.distance}</span><h3>{l.name}</h3><p>{l.activity}</p><p className="price">{l.price}</p></div></article>))}</div>
        </section>

        <section>
          <h2>Hidden gems — trending, not yet crowded</h2>
          <p className="sub">The highest-trending US destinations, explored properly — with a full plan, not just a photo.</p>
          <div className="grid">
            {HIDDEN_GEMS.map((d) => (
              <article className="card" key={d.name}>
                <SafeImg src={d.image} alt={d.name} label={d.name} />
                <div className="body"><span className="pill">{d.tag}</span><h3>{d.name}, {d.country}</h3><p>{d.blurb}</p><p style={{ fontSize: 13 }}>{d.trend}</p><p className="price">{d.priceFrom}</p><ul style={{ fontSize: 13, paddingLeft: 18 }}>{d.itinerary.map((s) => <li key={s}>{s}</li>)}</ul><button className="ghost" onClick={() => saveTrip(`${d.name} hidden gem — request saved`)}>Plan this trip</button></div>
              </article>
            ))}
          </div>
        </section>

        {/* Ad slot: below the fold, content area only. Dormant until AdSense is configured. */}
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_BELOW_GEMS ?? ''} />

        <section>
          <h2>How much do you actually save?</h2>
          <p className="sub">{aiTrip ? `Your ${cmp.destination} trip for ${cmp.travelers} traveler${cmp.travelers > 1 ? 's' : ''} — the same trip, booked two ways.` : 'An example Kyoto trip — the same trip, booked two ways.'}</p>
          {aiTrip && (
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 16px' }}>
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
          <h2 style={{ marginTop: 28 }}>My Trips</h2>
          <p style={{ fontSize: 13, color: '#666' }}>“Mark as booked” is set by you or the FujinTrip team when a booking request is confirmed — it is not a live booking. A booked trip’s plan PDF is free; other plans cost $1 to download.</p>
          {trips.length === 0 ? <p style={{ color: '#666' }}>No trips saved yet. Search above, or add a destination — it will appear here as a request you can turn into a plan.</p> : (
            <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
              {trips.map((t) => (<li key={t.id}><span>{t.label} · {t.status} · {t.date}</span><span>{t.destination && t.status !== 'Booked with FujinTrip' && (<><button className="ghost" onClick={() => setTrips((x) => x.map((y) => (y.id === t.id ? { ...y, status: 'Booked with FujinTrip' } : y)))}>Mark as booked</button>{' '}</>)}<button className="ghost" onClick={() => setTrips((x) => x.filter((y) => y.id !== t.id))}>Delete</button></span></li>))}
            </ul>
          )}
          <h3 style={{ marginTop: 20 }}>Price watches</h3>
          <p style={{ fontSize: 13, color: '#666' }}>A watch measures the live fare against the fare when you started watching. When it drops below that, it shows here. Live fares are Duffel test fares in test mode; the plan&apos;s own prices are estimates and never move, so they are never the baseline.</p>
          {watches.length === 0 ? <p style={{ color: '#666' }}>No price watches yet. Build a plan in the chat, then tap “Watch this trip&apos;s prices”.</p> : (
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
