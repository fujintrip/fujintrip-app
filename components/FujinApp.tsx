'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, LOCAL_TRIPS } from '../lib/data';
import { discoveryDestinations, discoveryPriceLabel, routeLineFor, type DiscoveryEntry } from '../lib/discovery';
import { buildPlan, comparisonFor, MONTH_NAMES } from '../lib/planner';
import { buildTripCard } from '../lib/tripCard';
import { categoryCounts, filterByCategory, type PackageFilter, type TripCategory } from '../lib/tripCategories';
import { heroSuggestions, seedForDestination, type HeroSuggestion } from '../lib/heroSearch';
import { appendObservation, trendLine } from '../lib/duffel';
import type { HomeTabId } from '../lib/homeTabs';
import { DIETARY_OPTIONS, parseProfile, profileSummary, type TravelerProfile } from '../lib/preferences';
import { useTheme } from '../lib/theme';
import { mergeOfferNeeded, readMergeRecord, recordMerge, type MergeRecord } from '../lib/auth';
import { AccountButton, useAccount } from '../components/AccountGate';
import { SignInButton, SignUpButton } from '@clerk/nextjs';
import AdSlot from '../components/AdSlot';
import PhotoCarousel from '../components/PhotoCarousel';
import ReelsFeed from '../components/ReelsFeed';
import ReelComposer from '../components/ReelComposer';
import HomeTabs from './HomeTabs';
import { Chat, HERO_PHOTO, SafeImg, type PriceCheckData, type PriceWatch, type Trip } from './FujinChat';

// Discovery map (design #15) — same client-only pattern as the trip map.
const DiscoveryMap = dynamic(() => import('../components/DiscoveryMap'), {
  ssr: false,
  loading: () => (
    <div className="map-skeleton" aria-label="Loading the map">
      <div className="skeleton" style={{ flex: 1, borderRadius: 16 }} />
      <p style={{ fontSize: 13, color: '#666', margin: 0 }}>Loading the map…</p>
    </div>
  ),
});

// Seed handoff (TripAdvisor homepage build): the homepage writes a
// seed here and navigates to /chat; the /chat page consumes it once
// on mount so the chat greets with the route ready, then drops it.
const CHAT_SEED_KEY = 'fujintrip-chat-seed';
const PENDING_MESSAGE_KEY = 'fujintrip-pending-message';

// The seven things you can book (direction v2, Nov 13): the tabs
// below the hero are the category entry now — the hero's chip row is
// gone, and the booking section is the HomeTabs component (tabs +
// SearchForm + results + Start from a link).

export default function FujinApp({ variant, initialTab }: { variant: 'home' | 'chat'; initialTab?: HomeTabId }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const router = useRouter();
  // Theme (interface round §6): the discovery map follows the same
  // theme as the trip map — the Chat hook owns the toggle, this hook
  // just listens (lib/theme.ts dispatches on every change).
  const [theme, setTheme] = useTheme();
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
  // section below follows it, and the homepage tabs use it too (the
  // Flights tab fetches live fares for this trip). Null until the user
  // chats: Kyoto example.
  const [aiTrip, setAiTrip] = useState<{ destination: string; travelers: number; kids?: number[]; origin?: string; month?: number; durationDays?: number } | null>(null);
  // The comparison section below follows the trip Fujin AI most
  // recently understood. The chat lives on /chat now, so read the
  // persisted trip (the chat writes it on every change) instead of
  // waiting for a chat on this page.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-current-trip');
      if (!raw) return;
      const p = JSON.parse(raw) as { destination?: unknown; travelers?: unknown; kids?: unknown; origin?: unknown; month?: unknown; durationDays?: unknown };
      if (typeof p.destination !== 'string' || typeof p.travelers !== 'number') return;
      setAiTrip({
        destination: p.destination,
        travelers: p.travelers,
        ...(Array.isArray(p.kids) ? { kids: p.kids.filter((k): k is number => typeof k === 'number').slice(0, 6) } : {}),
        ...(typeof p.origin === 'string' && p.origin.trim() ? { origin: p.origin.trim() } : {}),
        ...(typeof p.month === 'number' && p.month >= 1 && p.month <= 12 ? { month: Math.floor(p.month) } : {}),
        ...(typeof p.durationDays === 'number' && p.durationDays >= 2 ? { durationDays: Math.floor(p.durationDays) } : {}),
      });
    } catch {}
  }, []);
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
  // Free-account gate (Clerk, Nov 14 2026) — the one-tap merge
  // (plan-sync-design.md §3): on first sign-in, My Trips offers to
  // move the localStorage trips to the account. The server sync that
  // makes them appear on other devices is the NEXT build — the merge
  // only records the link on this device (each trip stamped with the
  // account id + a merge record per account), and the UI says so.
  const account = useAccount();
  const [mergeRecord, setMergeRecord] = useState<MergeRecord | null>(null);
  useEffect(() => {
    if (!account.userId) { setMergeRecord(null); return; }
    try { setMergeRecord(readMergeRecord(account.userId, localStorage)); } catch { setMergeRecord(null); }
  }, [account.userId]);
  const doMerge = () => {
    if (!account.userId) return;
    const record = recordMerge(account.userId, trips.map((t) => t.id), localStorage);
    const userId = account.userId;
    setTrips((x) => x.map((t) => ({ ...t, accountId: userId })));
    setMergeRecord(record);
  };
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
  const [chatSeed, setChatSeed] = useState<{ destination: string; cities: string[]; sourceTips?: Record<string, string> } | null>(null);
  // Homepage hero (TripAdvisor build): the one question + one box.
  // A typed destination rides to /chat as a pending message; a
  // suggestion pick (commit 4) seeds the trip directly instead.
  const [heroInput, setHeroInput] = useState('');
  // Hero suggestions (commit 4): the dropdown over the places
  // FujinTrip already knows. Picking one seeds /chat with the
  // route; Enter with no pick sends the typed text as a message.
  const [heroOpen, setHeroOpen] = useState(false);
  const [heroActive, setHeroActive] = useState(-1);
  const heroBoxRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => heroSuggestions(heroInput), [heroInput]);
  const pickSuggestion = (s: HeroSuggestion) => {
    const seed = seedForDestination(s.name) ?? { destination: s.name, cities: s.cities };
    setHeroOpen(false);
    seedChat(seed.destination, undefined, seed.cities);
  };
  const heroKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setHeroOpen(true);
      setHeroActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setHeroOpen(true);
      setHeroActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setHeroOpen(false);
      setHeroActive(-1);
    } else if (e.key === 'Enter' && heroActive >= 0 && suggestions[heroActive]) {
      e.preventDefault();
      pickSuggestion(suggestions[heroActive]);
    }
  };
  // Close the suggestions when the traveler clicks elsewhere.
  useEffect(() => {
    if (!heroOpen) return;
    const onDown = (e: MouseEvent) => {
      if (heroBoxRef.current && !heroBoxRef.current.contains(e.target as Node)) setHeroOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [heroOpen]);
  const submitHeroSearch = () => {
    const text = heroInput.trim();
    if (!text) return;
    try { localStorage.setItem(PENDING_MESSAGE_KEY, text); } catch {}
    router.push('/chat');
  };
  // The chat lives on /chat now — a template, pin or shared link hands
  // its seed over through localStorage and navigates there. Same seed
  // shape the chat already understands: destination + ordered cities.
  const seedChat = (name: string, sourceTips?: Record<string, string>, cities?: string[]) => {
    const info = cardInfo[name];
    try {
      localStorage.setItem(CHAT_SEED_KEY, JSON.stringify({ destination: name, cities: cities ?? info?.cities ?? [name], ...(sourceTips ? { sourceTips } : {}) }));
    } catch {}
    router.push('/chat');
  };
  const planThisTrip = (name: string, focusInput = false) => {
    // From the homepage the chat is a different page — hand the seed
    // over and go there. On /chat itself the chat is right here, so the
    // old seed-and-scroll still applies (shared links, ?plan=).
    if (variant === 'home') {
      seedChat(name);
      return;
    }
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
  // Seed handoff, /chat side: consume the seed the homepage wrote
  // (once — a reload must not re-seed the same trip) and hand it to
  // the chat, which greets with the route ready.
  useEffect(() => {
    if (variant !== 'chat') return;
    try {
      const raw = localStorage.getItem(CHAT_SEED_KEY);
      if (!raw) return;
      localStorage.removeItem(CHAT_SEED_KEY);
      const s = JSON.parse(raw) as { destination?: unknown; cities?: unknown; sourceTips?: unknown };
      if (typeof s.destination !== 'string' || !Array.isArray(s.cities)) return;
      const cities = s.cities.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()).slice(0, 8);
      if (!cities.length) return;
      const sourceTips = s.sourceTips && typeof s.sourceTips === 'object' && !Array.isArray(s.sourceTips)
        ? Object.fromEntries(Object.entries(s.sourceTips as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
        : undefined;
      setChatSeed({ destination: s.destination, cities, ...(sourceTips && Object.keys(sourceTips).length ? { sourceTips } : {}) });
    } catch {}
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
  // The reels composer panel — opened from the trip-card strip, the
  // feed, or a booked trip in My Trips. It lives in both variants:
  // on /chat under the app, on the homepage at the top of the page.
  const composerPanel = composerOpen && (
    <div className="panel" id="reel-composer">
      <ReelComposer trips={trips} prefillDestination={composerDest} onPosted={() => {}} onClose={() => setComposerOpen(false)} />
    </div>
  );
  return (
    <div>
      {variant === 'chat' ? (
        <a href="#fujin-chat" className="skip-link">Skip to chat</a>
      ) : (
        <a href="#packages" className="skip-link">Skip to destinations</a>
      )}
      {/* Chat-first shell (Nov 12 layout rebuild; app shell Nov 12;
          interface round M2 — the 8-tab bar is gone): the chat section
          is full-bleed — header and chat panel span the viewport, and
          the chat + trip panel + map fill the first screen. The slim
          hero was folded into the app bar (the mark + one-line tagline),
          so it no longer pushes the app down. The content sections
          below stay in the capped .wrap. */}
      {variant === 'chat' && (
        <div className="chat-shell">
          <div className="panel chat-panel" id="fujin-chat">
            <Chat onParsed={setAiTrip} onSaveTrip={saveTrip} onWatchPrices={addWatch} bookedDestinations={bookedDestinations} watches={watches} seed={chatSeed} onSeedUsed={() => setChatSeed(null)} onShareReel={(d) => openComposer(d)} trips={trips} profile={profile} onProfileChange={setProfile} emergencyContact={emergencyContact} embassyNumber={embassyNumber} onEmbassyChange={setEmbassyNumber} />
          </div>
        </div>
      )}
      {composerPanel}
      {variant === 'home' && (
        <header className="topbar">
          <a href="/" className="logo">Fujin<span>Trip</span></a>
          <nav className="topbar-nav">
            <a href="#mytrips" className="ghost-link">My Trips</a>
            {/* Free-account gate (Clerk, Nov 14 2026): nothing renders
                here until the Clerk keys are set. */}
            <AccountButton />
            <button type="button" className="ghost" aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
          </nav>
        </header>
      )}
      {variant === 'home' && (
        <section className="hero-ta">
          <div className="hero-ta-copy">
            <h1>Where to?</h1>
            <p className="hero-ta-sub">One trip, one plan — flights, stays, cars and sightseeing gathered for you.</p>
            <div className="hero-ta-searchbox" ref={heroBoxRef}>
              <form className="hero-ta-search" role="search" onSubmit={(e) => { e.preventDefault(); submitHeroSearch(); }}>
                <input value={heroInput} onChange={(e) => { setHeroInput(e.target.value); setHeroOpen(true); setHeroActive(-1); }} onFocus={() => setHeroOpen(true)} onKeyDown={heroKeyDown} placeholder="Places to go, things to do, hotels…" aria-label="Where to?" autoComplete="off" role="combobox" aria-expanded={heroOpen && suggestions.length > 0} aria-controls="hero-suggestions" aria-activedescendant={heroActive >= 0 && suggestions[heroActive] ? `hero-sugg-${heroActive}` : undefined} />
                <button type="submit" className="primary">Search</button>
              </form>
              {heroOpen && suggestions.length > 0 && (
                <ul className="hero-suggestions" id="hero-suggestions" role="listbox" aria-label="Destinations">
                  {suggestions.map((s, i) => (
                    <li key={s.name} id={`hero-sugg-${i}`} role="option" aria-selected={i === heroActive} className={i === heroActive ? 'active' : undefined}>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }} onMouseEnter={() => setHeroActive(i)}>
                        <strong>{s.name}</strong>
                        <span>{s.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* The one AI entry point on the homepage (direction v2):
                a big button under the search box, straight to /chat.
                The header "Ask Fujin AI" link is gone — two ways to
                reach the same chat was TripAdvisor's mistake. */}
            <a href="/chat" className="ai-hero-btn">Build full plan with AI →</a>
          </div>
          <figure className="hero-ta-photo">
            <SafeImg src={HERO_PHOTO} alt="Torii gates at Fushimi Inari, Kyoto" label="Kyoto" loading="eager" />
          </figure>
        </section>
      )}
      {variant === 'home' && (
        <HomeTabs
          initialTab={initialTab ?? 'flights'}
          trip={aiTrip}
          onSaveTrip={(label) => saveTrip(label, 'Request saved')}
          onPlanTrip={planThisTrip}
          onSeedChat={seedChat}
        />
      )}
      {variant === 'home' && (
      <main className="wrap">

        <section id="packages">
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
          {/* Free account (Clerk, Nov 14 2026) — sign-in lives in My
              Trips, not in the chat: accounts come AFTER the traveler
              has a plan worth saving, and browsing, the tabs and the
              chat are never gated. */}
          <div className="box" style={{ marginBottom: 16 }}>
            {!account.configured ? (
              <>
                <strong>Free account — sign-in isn&apos;t set up yet</strong>
                <p className="plan-muted">A free account saves your trips so they follow you to other devices. Sign-in isn&apos;t connected yet — the site owner adds the Clerk keys first. Until then your trips stay saved on this device only, and everything else works as normal.</p>
              </>
            ) : !account.signedIn ? (
              <>
                <strong>Save your trips to a free account</strong>
                <p className="plan-muted">Sign in with a magic link (no password) and your trips move to your account. Browsing, the tabs and the chat stay free either way.</p>
                <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <SignInButton mode="modal">
                    <button type="button" className="primary">Sign in with a magic link</button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button type="button" className="ghost">Create a free account</button>
                  </SignUpButton>
                </p>
              </>
            ) : (
              <>
                <strong>Signed in{account.email ? ` as ${account.email}` : ''}</strong>
                {mergeRecord ? (
                  <p className="plan-muted">Your {mergeRecord.tripIds.length} trip{mergeRecord.tripIds.length === 1 ? '' : 's'} on this device {mergeRecord.tripIds.length === 1 ? 'is' : 'are'} linked to your account. They&apos;ll appear on your other devices once cross-device sync lands — for now they&apos;re still saved on this device.</p>
                ) : mergeOfferNeeded({ signedIn: account.signedIn, userId: account.userId, tripCount: trips.length, merged: false }) ? (
                  <>
                    <p className="plan-muted">You have {trips.length} trip{trips.length === 1 ? '' : 's'} saved on this device. Move {trips.length === 1 ? 'it' : 'them'} to your account in one tap.</p>
                    <p><button type="button" className="primary" onClick={doMerge}>Move my trips to my account</button></p>
                  </>
                ) : (
                  <p className="plan-muted">No trips saved on this device yet — tell Fujin AI where to go and they&apos;ll appear here.</p>
                )}
              </>
            )}
          </div>
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
      )}
      {variant === 'home' && (
      <footer>
        <div className="wrap">
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Travel globally, act locally. Named for Fujin, Japan’s wind god.</p>
          <p>No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
          <p>Fujin artwork: Ogata Korin, Wind God, c.1700 (public domain). Photo credits in the destination cards are from Unsplash / Wikimedia Commons.</p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
          <p><a href="/privacy">Privacy Policy</a></p>
        </div>
      </footer>
      )}
    </div>
  );
}
