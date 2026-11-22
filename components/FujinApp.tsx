'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, assignPhotos, CITY_PHOTOS } from '../lib/data';
import { discoveryDestinations } from '../lib/discovery';
import { buildPlan } from '../lib/planner';
import { buildTripCard } from '../lib/tripCard';
import { appendObservation, trendLine } from '../lib/duffel';
import { HOME_TABS, type HomeTabId } from '../lib/homeTabs';
import {
  type SearchQuery,
  searchQueryToParams,
} from '../lib/searchPlaces';
import { DIETARY_OPTIONS, parseProfile, profileSummary, type TravelerProfile } from '../lib/preferences';
import { useTheme } from '../lib/theme';
import { mergeOfferNeeded, readMergeRecord, recordMerge, type MergeRecord } from '../lib/auth';
import { AccountButton, useAccount } from '../components/AccountGate';
import { SignInButton, SignUpButton } from '@clerk/nextjs';
import AdSlot from '../components/AdSlot';
import PhotoCarousel from '../components/PhotoCarousel';
import ReelsFeed from '../components/ReelsFeed';
import ReelComposer from '../components/ReelComposer';
import ShareMenu from '../components/ShareMenu';
import { sharePathFor, shareTextFor } from '../lib/share';
import SiteHeader from './SiteHeader';
import SearchWidget from './SearchWidget';
import SearchResults from './SearchResults';
import PackagesSection, { TripOfTheWeekFeature } from './PackagesSection';
import { ContinueBar, ContinueStrip, HowItWorksSection, LOCAL_VOICES_PLACES, LocalVoicesTeaser } from './HomeSections';
import { featuredPackages, tripOfTheWeek, type LivePackageFare, type Package } from '../lib/packages';
import { isSavedDetail, packageSavedKey, savedDetailLine, tripSavedKey, type SavedDetail } from '../lib/savedTrips';
import { alertIsDrop, evaluatePriceAlert, isPriceAlert, priceAlertLine, PRICE_ALERTS_STORAGE_KEY, type PriceAlert } from '../lib/priceAlerts';
import { Chat, SafeImg, type PriceCheckData, type PriceWatch, type Trip } from './FujinChat';
import { Icon } from './icons';

// Seed handoff: the /chat page consumes this once on mount so the
// chat greets with the route ready, then drops it. Direction v3:
// the homepage no longer writes a seed — a destination card prefills
// the search widget instead; only the chat variant (and its ?plan=
// link) still seeds through here.
const CHAT_SEED_KEY = 'fujintrip-chat-seed';
const PENDING_MESSAGE_KEY = 'fujintrip-pending-message';

// UX direction, Nov 19 2026 — P1-1, section plan rebuilt Nov 21
// (round 2, P0-4): the homepage is six bands (header, hero + search,
// Trip of the week, Ready-made trips, Destinations with the hidden
// gems folded in as a labelled row, Plan/Book/Follow, Community only
// when non-empty, footer). The category tiles and the per-category
// landing shelf are cut — the header nav and the widget tabs are the
// category entry points, and a ?tab= link switches the widget tab,
// nothing more.
export default function FujinApp({ variant, initialTab, initialSearch }: { variant: 'home' | 'chat' | 'account'; initialTab?: HomeTabId; initialSearch?: SearchQuery | null }) {
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
  // Price alerts (roadmap, Nov 21 2026 — F5): the traveler sets an
  // alert on a LIVE Ignav fare, and My Trips re-checks it when the
  // traveler opens the account page — no background cron, no email,
  // no account. A drop is measured against the fare price when the
  // alert was created; 20% or more is flagged as a drop. Stored in
  // localStorage, like the trips and the watches. This is a separate
  // system from the older price watches above: those measure a
  // trip's Duffel price-check total, while alerts watch one live
  // Ignav fare — the two baselines must never be mixed.
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRICE_ALERTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) setAlerts(parsed.filter(isPriceAlert));
      }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(PRICE_ALERTS_STORAGE_KEY, JSON.stringify(alerts)); } catch {} }, [alerts]);
  const addAlert = (alert: PriceAlert) => {
    setAlerts((all) => {
      // One alert per trip — the existing one keeps its baseline.
      if (all.some((x) => x.key === alert.key)) return all;
      return [alert, ...all];
    });
  };
  const removeAlert = (key: string) => setAlerts((all) => all.filter((x) => x.key !== key));
  // One re-check of one alert: the same live Ignav search the fare
  // came from, cheapest itinerary now against the baseline. A
  // search with no live fare leaves the last known price in place
  // and says the check found nothing.
  const checkAlert = async (key: string) => {
    const a = alerts.find((x) => x.key === key);
    if (!a) return;
    try {
      const r = await fetch('/api/ignav-fares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripType: a.tripType,
          origin: a.from,
          destination: a.to,
          depart: a.depart,
          ...(a.tripType === 'roundtrip' ? { return: a.return } : {}),
          travelers: a.travelers,
          cabin: a.cabin,
        }),
      });
      const j = (await r.json()) as { live?: boolean; itineraries?: { price?: number }[] };
      const prices = Array.isArray(j.itineraries)
        ? j.itineraries.map((it) => it.price).filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
        : [];
      const cheapest = prices.length ? Math.min(...prices) : null;
      const now = new Date().toISOString();
      setAlerts((all) => all.map((x) => (x.key === key ? evaluatePriceAlert(x, j.live ? cheapest : null, now) : x)));
    } catch {
      setAlerts((all) => all.map((x) => (x.key === key ? evaluatePriceAlert(x, null, new Date().toISOString()) : x)));
    }
  };
  // Re-check the alerts when the traveler opens My Trips — once per
  // mount, never in the background: the checks run only while the
  // account page is open, and only for alerts the traveler set.
  const alertsCheckedRef = useRef(false);
  useEffect(() => {
    if (variant !== 'account' || alertsCheckedRef.current || alerts.length === 0) return;
    alertsCheckedRef.current = true;
    for (const a of alerts) void checkAlert(a.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, alerts]);
  // The keys already in My Trips — fare cards read this so "Alert
  // set ✓" survives a reload, not just the click.
  const alertKeys = useMemo(() => new Set(alerts.map((a) => a.key)), [alerts]);
  // Direction v3: the homepage no longer follows the chat trip — it
  // is a search-and-browse site now, and the comparison section that
  // read the persisted trip is gone. The setter stays: the chat
  // variant still reports its parsed trip through onParsed.
  const [, setAiTrip] = useState<{ destination: string; travelers: number; kids?: number[]; origin?: string; month?: number; durationDays?: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-trips');
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          // Saved trips & fares (roadmap, Nov 21 2026 — F1): a corrupt
          // or foreign `saved` detail is stripped, never rendered —
          // the trip itself stays, only the bad detail goes.
          setTrips(
            parsed.filter((t): t is Trip => Boolean(t) && typeof t === 'object' && typeof (t as Trip).id === 'string' && typeof (t as Trip).label === 'string').map((t) => {
              const trip = t as Trip;
              if (trip.saved !== undefined && !isSavedDetail(trip.saved)) {
                const { saved: _bad, ...rest } = trip;
                void _bad;
                return rest;
              }
              return trip;
            }),
          );
        }
      }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('fujintrip-trips', JSON.stringify(trips)); } catch {} }, [trips]);
  // Saved trips & fares (roadmap, Nov 21 2026 — F1): a save carries
  // its structured detail, and the key dedupes — saving the same fare
  // twice adds nothing, so My Trips never shows the same fare twice.
  const saveTrip = (label: string, status = 'Request saved', destination?: string, saved?: SavedDetail) => setTrips((t) => {
    if (saved && t.some((x) => x.saved?.key === saved.key)) return t;
    return [{ id: String(Date.now()), label, status, date: new Date().toLocaleDateString(), ...(destination ? { destination } : {}), ...(saved ? { saved } : {}) }, ...t];
  });
  // The keys already in My Trips — fare cards and package cards read
  // this so "Saved ✓" survives a reload, not just the click.
  const savedKeys = useMemo(() => new Set(trips.filter((t) => t.saved).map((t) => (t.saved as SavedDetail).key)), [trips]);
  // A fare saved from the results: the structured detail goes to My
  // Trips with the search label, status 'Saved fare'.
  const saveFareDetail = (label: string, detail: SavedDetail) => saveTrip(label, 'Saved fare', detail.destination, detail);
  // A package saved from a card: the price is the card's own
  // packagePrice — a live fare keeps its supplier as the source, an
  // estimate reads 'FujinTrip planner'.
  const savePackageDetail = (pkg: Package, price: { perTraveler: number; label: string; source: string | null }) => {
    const source = price.source ? price.source.split(' · checked ')[0] : 'FujinTrip planner';
    const detail: SavedDetail = {
      key: packageSavedKey(pkg.destination, price.perTraveler),
      kind: 'package',
      destination: pkg.destination,
      source,
      priceKind: price.source ? 'live' : 'estimate',
      total: price.perTraveler * 2,
      perTraveler: price.perTraveler,
      travelers: 2,
      route: pkg.stops.join(' → '),
      checkedAt: new Date().toISOString(),
    };
    saveTrip(`${pkg.destination} · from $${price.perTraveler.toLocaleString()} per traveler`, 'Saved trip', pkg.destination, detail);
  };
  // A destination saved from a Popular / hidden-gem card: the Best
  // value total for 2 travelers, a planning estimate.
  const saveDestination = (destination: string, total: number) => {
    const perTraveler = Math.round(total / 2);
    const detail: SavedDetail = {
      key: tripSavedKey(destination, perTraveler),
      kind: 'trip',
      destination,
      source: 'FujinTrip planner',
      priceKind: 'estimate',
      total,
      perTraveler,
      travelers: 2,
      checkedAt: new Date().toISOString(),
    };
    saveTrip(`${destination} · from $${perTraveler.toLocaleString()} per traveler`, 'Saved trip', destination, detail);
  };
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
  // Visible reels on the homepage (audit round, Nov 17, 2026):
  // null while the feed is still loading, then the count — the
  // Travelers' stories section hides while the feed is empty, so
  // the homepage never shows a "No reels yet" box. Posting the
  // first reel still works from My Trips ("Share how it went") and
  // from the chat.
  const [reelsCount, setReelsCount] = useState<number | null>(null);
  // Hotelbeds Bundle package fares (Nov 21, 2026): the homepage's
  // ready-made trips read their fares from GET /api/packages once on
  // mount — the Bundle packaging search behind it (sandbox test
  // data, labeled as such on the card). The fetch never blocks the
  // first render: cards show the planner estimate until the fares
  // arrive, and a failed fetch leaves the estimates in place. The
  // server caches Bundle searches for 6h, so repeat loads cost no
  // upstream calls.
  const [packageFares, setPackageFares] = useState<LivePackageFare[] | null>(null);
  useEffect(() => {
    if (variant !== 'home') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/packages');
        const j = (await r.json()) as { liveFares?: unknown };
        if (!cancelled && Array.isArray(j.liveFares)) setPackageFares(j.liveFares as LivePackageFare[]);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [variant]);
  // Direction v3 search (Nov 14, 2026): the hero search widget owns
  // the tab; a submitted search renders results below the hero; a
  // destination card prefills the widget. The homepage no longer
  // seeds the chat — the chat lives at /chat behind the header
  // button, and the homepage never writes the seed keys.
  const [widgetTab, setWidgetTab] = useState<HomeTabId>(initialTab ?? 'flights');
  const [search, setSearch] = useState<SearchQuery | null>(initialSearch ?? null);
  // "Continue where you left off" (interface round, Nov 16 2026 —
  // P0 #2): the last submitted search, on this device only. The
  // strip reads it on mount; a corrupt or foreign value is dropped,
  // never rendered.
  const [lastSearch, setLastSearch] = useState<SearchQuery | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fujintrip-last-search');
      if (!raw) return;
      const q = JSON.parse(raw) as Partial<SearchQuery>;
      if (q && typeof q === 'object' && HOME_TABS.some((t) => t.id === q.tab)) setLastSearch(q as SearchQuery);
    } catch {}
  }, []);
  // A shared deep link followed while already on the page (or Back)
  // changes initialSearch without remounting — the results follow the
  // link instead of the stale search from the first load. A bare
  // ?tab= link carries no search, so it never clears the results a
  // tab switch leaves in place; and the widget's own submit writes
  // the same query back, so that round-trip is a no-op here.
  const initialSearchKey = initialSearch ? searchQueryToParams(initialSearch) : '';
  useEffect(() => {
    if (!initialSearch) return;
    if (search && searchQueryToParams(search) === initialSearchKey) return;
    setSearch(initialSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearchKey]);
  const [prefill, setPrefill] = useState<{ destination: string; nonce: number; query?: SearchQuery } | null>(null);
  // My Trips progressive disclosure (interface round, Nov 16 2026 —
  // P1 #20): the trips list shows the first 5 until the traveler
  // asks for the rest, so the section stops dominating the page.
  const [showAllTrips, setShowAllTrips] = useState(false);
  const selectCategory = (id: HomeTabId) => {
    setWidgetTab(id);
    try { router.replace(`/?tab=${id}`, { scroll: false }); } catch {}
    document.getElementById('search-widget')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changeTab = (id: HomeTabId) => {
    setWidgetTab(id);
    try { router.replace(`/?tab=${id}`, { scroll: false }); } catch {}
  };
  const handleSearchSubmit = (q: SearchQuery) => {
    setSearch(q);
    setLastSearch(q);
    try { localStorage.setItem('fujintrip-last-search', JSON.stringify(q)); } catch {}
    setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // Resume a search from the continue strip: the results render
  // again and the widget prefills with the destination, so the
  // traveler can edit it rather than retyping it.
  const resumeSearch = (q: SearchQuery) => {
    setSearch(q);
    if (q.dest) setPrefill({ destination: q.dest, nonce: Date.now() });
    setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // "Edit search" (rendered-check fix, Nov 21 2026): scrolling to
  // the widget was not enough — the widget kept whatever the
  // traveler last typed, which can drift from the search the
  // results were built from (a resumed search, a deep link
  // followed mid-session), and its tab could show another
  // category's form. So Edit restores the CURRENT search into
  // the widget (full query, not just the destination), switches
  // the widget to the search's tab, scrolls to it, and focuses
  // the first field so the form is visibly open for editing.
  const editSearch = () => {
    if (!search) return;
    setWidgetTab(search.tab);
    setPrefill({ destination: search.dest || search.to || '', nonce: Date.now(), query: search });
    document.getElementById('search-widget')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('#search-widget input')?.focus({ preventScroll: true });
    }, 350);
  };

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
  // A shared plan or reel link (/?plan=<destination>) seeds the chat
  // with that trip — the stranger who taps a shared link lands in the
  // chat with the route ready, not on a blank page. Once per load.
  const planParamUsedRef = useRef(false);
  useEffect(() => {
    if (planParamUsedRef.current) return;
    const q = new URLSearchParams(window.location.search).get('plan');
    if (!q) return;
    planParamUsedRef.current = true;
    if (variant === 'home') {
      // Direction v3: a shared link (?plan=<destination>) prefills
      // the search widget on the homepage now — it no longer seeds
      // the chat.
      setPrefill({ destination: q, nonce: Date.now() });
    } else {
      planThisTrip(q);
    }
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
  // Template library (interface round S2): every destination the
  // planner knows — the 21 discovery entries (17 routes + Bali, St.
  // George, Tacoma, Hilo) plus the 5 standalone photo destinations
  // the discovery map does not pin (Santorini, Kyoto, Caribbean,
  // Maldives, Paris). One card shape: photo (or the fallback
  // gradient), tag pill, one title line, the route line when there is
  // more than one stop, one counts line (stays · transports · from $X
  // total · Best value · 2 travelers · planning estimate). Direction
  // v3 (spec section 1d), rebuilt Nov 21 (UX direction round 2,
  // P0-4): the library is "Popular destinations" now — 6 cards, no
  // expander, no filter pills, no pagination. A card shows the tag, the name, and the
  // Best value total per traveler; a count that does not exist in the
  // data is omitted from the line, never guessed.
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
  // Dedup (UX direction, Nov 19 2026 — P0-7): no destination
  // appears in more than one homepage band. The featured packages,
  // the hidden gems, 'Europe' and the Local Voices places each have
  // a band of their own, so Popular destinations (built from this
  // list) skips them all. (The deals band is gone — P1-1 — so its
  // trips are free to appear in Popular again.)
  const homeBandNames = useMemo(
    () =>
      new Set([
        ...featuredPackages().map((p) => p.destination),
        ...HIDDEN_GEMS.map((g) => g.name),
        'Europe',
        ...LOCAL_VOICES_PLACES,
      ]),
    []
  );
  // One-photo-per-destination (UX direction, Nov 19 2026 — P2-4):
  // the homepage's photo assignment for every card on the page —
  // featured packages, hidden gems, Local Voices places, Popular
  // destinations — in claim order (see lib/data.ts assignPhotos).
  // The same map feeds PackagesSection, the gems, the voices and
  // the library entries below, so no photo URL appears on two
  // homepage cards. A card whose photo was claimed elsewhere gets
  // an empty list and renders the labeled fallback.
  const homepagePhotos = useMemo(() => {
    const cards: Array<{ key: string; destination: string; stopCities?: string[]; ownPhoto?: string | null }> = [];
    for (const p of featuredPackages()) {
      cards.push({ key: `pkg:${p.id}`, destination: p.destination, stopCities: p.stops });
    }
    for (const g of HIDDEN_GEMS) {
      cards.push({ key: `gem:${g.name}`, destination: g.name, ownPhoto: g.image });
    }
    for (const place of LOCAL_VOICES_PLACES) {
      cards.push({ key: `voice:${place}`, destination: place });
    }
    for (const e of discovery) {
      if (homeBandNames.has(e.destination)) continue;
      cards.push({ key: `popular:${e.destination}`, destination: e.destination, stopCities: e.stops.map((s) => s.city) });
    }
    for (const d of GLOBAL_DESTINATIONS) {
      if (discovery.some((e) => e.destination === d.name)) continue;
      if (homeBandNames.has(d.name)) continue;
      cards.push({ key: `popular:${d.name}`, destination: d.name });
    }
    return assignPhotos(cards);
  }, [discovery, homeBandNames]);
  const libraryEntries = useMemo<LibraryEntry[]>(() => {
    const entries: LibraryEntry[] = [];
    for (const e of discovery) {
      if (homeBandNames.has(e.destination)) continue;
      entries.push({
        key: e.key,
        name: e.destination,
        tag: e.tag,
        photos: homepagePhotos.get(`popular:${e.destination}`) ?? [],
        routeLine: e.stops.length > 1 ? e.stops.map((s) => s.city).join(' → ') : undefined,
        stays: e.stays,
        transports: e.transports,
        total: e.price,
      });
    }
    for (const d of GLOBAL_DESTINATIONS) {
      if (discovery.some((e) => e.destination === d.name)) continue;
      if (homeBandNames.has(d.name)) continue;
      const info = cardInfo[d.name];
      entries.push({
        key: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: d.name,
        country: d.country,
        tag: d.tag,
        photos: homepagePhotos.get(`popular:${d.name}`) ?? [],
        routeLine: (info?.cities.length ?? 0) > 1 ? info?.cities.join(' → ') : undefined,
        stays: info?.hotels ?? null,
        transports: info?.transports ?? null,
        total: info?.total ?? null,
      });
    }
    return entries;
  }, [discovery, cardInfo, homeBandNames, homepagePhotos]);
  // Direction v3 (spec section 1d), rebuilt Nov 21 (UX direction
  // round 2, P0-4): "Popular destinations" is six cards, no
  // expander — the first six of the library, with the hidden gems
  // folded in below as a labelled row in the same section. The
  // price line is the Best value plan total per traveler (the total
  // in the entry is the 2-traveler total); a card with no planner
  // total shows no price line, never a guessed one.
  // Popular destinations is the library itself (UX direction,
  // Nov 19 2026 — P0-7): the dedup against the featured packages,
  // the hidden gems, 'Europe' and the Local Voices places already
  // happens in homeBandNames above, so no destination appears in
  // two bands. The category shelf is gone (P1-1) — a ?tab= link
  // switches the widget tab, nothing more.
  const popularEntries = libraryEntries;
  const visibleEntries = popularEntries.slice(0, 6);
  // This week's trip (Clean & trusted, Nov 22 2026): the white
  // hero carries no photo — the search is the hero. The week's
  // trip photo fronts the Trip-of-the-week feature row below.
  const weekTrip = tripOfTheWeek();
  // The reels composer panel — opened from the trip-card strip, the
  // feed, or a booked trip in My Trips. It lives in both variants:
  // on /chat under the app, on the homepage at the top of the page.
  const composerPanel = composerOpen && (
    <div className="panel" id="reel-composer">
      <ReelComposer trips={trips} prefillDestination={composerDest} onPosted={() => {}} onClose={() => setComposerOpen(false)} />
    </div>
  );
  // Trip overview figures (Clean & trusted, Nov 22 2026): sums and
  // counts from this device's saved trips only — a trip without a
  // saved total contributes nothing, never a guess. The progress
  // bar fills with the share of saved trips booked. An empty My
  // Trips shows an empty bar.
  const savedTotals = trips.filter((t) => t.saved && typeof t.saved.total === 'number');
  const plannedTotal = savedTotals.reduce((sum, t) => sum + (t.saved?.total ?? 0), 0);
  const bookedCount = trips.filter((t) => t.status === 'Booked with FujinTrip').length;
  const bookedPct = trips.length === 0 ? 0 : Math.round((bookedCount / trips.length) * 100);
  // My Trips body (UX direction, Nov 19 2026 — P1-1): the
  // account page's content — trips, free-account box, preferences,
  // emergency contact, embassy number and price watches. It renders
  // directly on /account, never collapsed behind a homepage
  // <details> anymore.
  const myTripsBody = (
    <>
          {/* Trip overview (Clean & trusted, Nov 22 2026): a clean
              white budget card with a simple progress bar, then a
              2×2 grid of white overview cards with thin circular
              icons and bold numbers. */}
          <div className="trip-overview">
            <div className="budget-card">
              <div className="budget-card-top">
                <div>
                  <p className="budget-label">Planned total</p>
                  <p className="budget-total">${plannedTotal.toLocaleString()}</p>
                  <p className="budget-sub">
                    {savedTotals.length === 0
                      ? 'No saved trip totals yet — save a fare or a trip and it totals here.'
                      : `${savedTotals.length} saved trip${savedTotals.length === 1 ? '' : 's'} · planning estimates`}
                  </p>
                </div>
                <span className="budget-icon" aria-hidden="true"><Icon name="tag" size={20} /></span>
              </div>
              <div className="progress" role="img" aria-label={`${bookedCount} of ${trips.length} trips booked`}>
                <div className="progress-fill" style={{ width: `${bookedPct}%` }} />
              </div>
              <p className="budget-foot">{trips.length === 0 ? 'No trips saved yet.' : `${bookedCount} of ${trips.length} trip${trips.length === 1 ? '' : 's'} booked`}</p>
            </div>
            <div className="overview-grid">
              <div className="overview-card">
                <span className="overview-icon" aria-hidden="true"><Icon name="bookmark" size={18} /></span>
                <p className="overview-label">Saved trips</p>
                <p className="overview-num">{trips.length}</p>
              </div>
              <div className="overview-card">
                <span className="overview-icon" aria-hidden="true"><Icon name="tag" size={18} /></span>
                <p className="overview-label">Price alerts</p>
                <p className="overview-num">{alerts.length}</p>
              </div>
              <div className="overview-card">
                <span className="overview-icon" aria-hidden="true"><Icon name="clock" size={18} /></span>
                <p className="overview-label">Price watches</p>
                <p className="overview-num">{watches.length}</p>
              </div>
              <div className="overview-card">
                <span className="overview-icon" aria-hidden="true"><Icon name="check" size={18} /></span>
                <p className="overview-label">Booked</p>
                <p className="overview-num">{bookedCount}</p>
              </div>
            </div>
          </div>
          {/* Free account (Clerk, Nov 14 2026) — sign-in lives in My
              Trips, not in the chat: accounts come AFTER the traveler
              has a plan worth saving, and browsing, the tabs and the
              chat are never gated. */}
          <div className="box" style={{ marginBottom: 16 }}>
            {!account.configured ? (
              <>
                <strong>Free account — sign-in isn&apos;t set up yet</strong>
                <p className="plan-muted">A free account saves your trips so they follow you to other devices. Sign-in isn&apos;t available yet — until then your trips stay saved on this device only, and everything else works as normal.</p>
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
            <>
              <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
                {(showAllTrips ? trips : trips.slice(0, 5)).map((t) => (<li key={t.id}><span>{t.label} · {t.status} · {t.date}{t.saved && (<><br /><span className="plan-muted">{savedDetailLine(t.saved)}</span></>)}</span><span>{t.destination && t.status !== 'Booked with FujinTrip' && (<><button className="ghost" onClick={() => setTrips((x) => x.map((y) => (y.id === t.id ? { ...y, status: 'Booked with FujinTrip' } : y)))}>Mark as booked</button>{' '}</>)}<button className="ghost" onClick={() => setTrips((x) => x.filter((y) => y.id !== t.id))}>Delete</button>{t.destination && t.status === 'Booked with FujinTrip' && (<>{' '}<button className="ghost" onClick={() => openComposer(t.destination)}>Share how it went</button></>)}</span></li>))}
              </ul>
              {trips.length > 5 && (
                <p style={{ marginTop: 8 }}>
                  <button type="button" className="ghost" onClick={() => setShowAllTrips((s) => !s)}>
                    {showAllTrips ? 'Show fewer trips' : `Show all ${trips.length} trips (${trips.length - 5} more)`}
                  </button>
                </p>
              )}
            </>
          )}
          {/* Price alerts (roadmap, Nov 21 2026 — F5): live Ignav
              fares only, set by the traveler on a fare card. The
              re-check runs when My Trips opens — no background
              checks, no emails. A drop of 20% or more against the
              price when the alert was set is flagged. */}
          <h2 style={{ marginTop: 24 }}>Price alerts</h2>
          {alerts.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No price alerts yet. On a live Ignav fare, tap “Set price alert” and we’ll watch it for you here.</p>
          ) : (
            <>
              <p className="plan-muted">We check each alert again when you open My Trips — no emails, no background checks. A drop of 20% or more against the price when you set the alert is flagged.</p>
              <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
                {alerts.map((a) => (
                  <li key={a.key}>
                    <span>
                      {priceAlertLine(a)}
                      {alertIsDrop(a) && (<><br /><strong>Price dropped 20% or more</strong></>)}
                    </span>
                    <span>
                      <button type="button" className="ghost" onClick={() => void checkAlert(a.key)}>Check now</button>{' '}
                      <button type="button" className="ghost" onClick={() => removeAlert(a.key)}>Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* Progressive disclosure (interface round, Nov 16 2026 —
              P1 #20): the preferences, emergency contact, embassy
              number and price watches sit behind <details> so the
              section stops dominating the homepage. The content is
              still in the page — collapsed, not removed. */}
          <details>
            <summary><span className="details-heading">Your travel preferences</span></summary>
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
          </details>
          <details>
            <summary><span className="details-heading">Emergency contact</span></summary>
            <p className="plan-muted">For solo trips — who should be reached if something goes wrong? Stored on this device only, shown on your solo trip cards.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input value={emergencyContact.name} onChange={(e) => setEmergencyContact({ ...emergencyContact, name: e.target.value })} placeholder="Name" aria-label="Emergency contact name" />
            <input value={emergencyContact.phone} onChange={(e) => setEmergencyContact({ ...emergencyContact, phone: e.target.value })} placeholder="Phone" aria-label="Emergency contact phone" />
          </div>
          </details>
          <details>
            <summary><span className="details-heading">Embassy / consulate</span></summary>
            <p className="plan-muted">Your embassy or consulate&apos;s number for the country you&apos;re visiting — yours to type in, saved on this device only. The SOS sheet can call it.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input value={embassyNumber} onChange={(e) => setEmbassyNumber(e.target.value)} placeholder="Embassy number" aria-label="Embassy or consulate phone number" />
          </div>
          </details>
          <details>
            <summary><span className="details-heading">Price watches</span></summary>
            <p className="plan-muted">A watch measures the live fare against the fare when you started watching. When it drops below that, it shows here. The plan&apos;s own prices are estimates and never move, so they are never the baseline.</p>
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
          </details>
    </>
  );

  return (
    <div>
      {variant === 'chat' ? (
        <a href="#fujin-chat" className="skip-link">Skip to chat</a>
      ) : variant === 'account' ? (
        <a href="#mytrips" className="skip-link">Skip to My Trips</a>
      ) : (
        <a href="#destinations" className="skip-link">Skip to destinations</a>
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
      {variant !== 'chat' && (
        <SiteHeader
          theme={theme}
          onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          onSelectCategory={selectCategory}
          myTripsHref="/account"
        />
      )}
      {/* White hero (Clean & trusted, Nov 22 2026): the search IS
          the hero — white canvas, one question, one line, and AI as
          a quiet text link, not a button. The trust line lives
          inside the hero now, not as a standalone strip. No photo,
          no scrim, no pills, no cycler. */}
      {variant === 'home' && (
        <section className="hero-booking">
          <div className="wrap hero-booking-inner">
            <p className="hero-booking-eyebrow">Named for Fujin, Japan’s wind god — ride the wind, pay less.</p>
            <h1>Where to?</h1>
            <p className="hero-booking-sub">One trip, one price, one plan — flights, stay, car and activities included. All-in, no hidden fees.</p>
            <SearchWidget
              tab={widgetTab}
              onTabChange={changeTab}
              initialSearch={initialSearch ?? null}
              prefill={prefill}
              onSubmit={handleSearchSubmit}
            />
            <p className="hero-ai-link">
              Not sure yet? <a href="/chat">Ask Fujin AI →</a>
            </p>
            <p className="hero-trust">All-in prices · No hidden fees · Compare prices from different sources</p>
          </div>
        </section>
      )}
      {/* Continue where you left off (UX direction round 2, Nov 21
          2026 — P0-4): one thin line under the hero, never a band.
          The full strip lives on /account. Hidden while a search is
          active — a results page is results only. */}
      {variant === 'home' && !search && (
        <ContinueBar
          trips={trips}
          watches={watches}
          lastSearch={lastSearch}
          onResumeSearch={resumeSearch}
        />
      )}
      {variant === 'home' && search && (
        <div className="wrap">
          <SearchResults
            query={search}
            dark={theme === 'dark'}
            onSaveSearch={(label) => saveTrip(label, 'Request saved')}
            onSaveFare={saveFareDetail}
            savedKeys={savedKeys}
            onSetAlert={addAlert}
            alertKeys={alertKeys}
            onEditSearch={editSearch}
            onClearSearch={() => setSearch(null)}
          />
        </div>
      )}
      {variant === 'home' && (
      <main className="wrap">
        {/* UX direction, Nov 19 2026 — P1-1, section plan rebuilt
            Nov 21 (round 2, P0-4): Hero → Trip of the week →
            Ready-made trips → Destinations (hidden gems as a
            labelled row) → Plan, Book, Follow → Community only when
            non-empty → footer. A search turns this into a
            results-only page — the browse sections hide while
            results are showing, so a flight search is not buried
            under the whole homepage. "Clear search" in the results
            bar brings the browse sections back. My Trips lives on
            /account now, not on the homepage. */}
        {!search && (
        <>
        <TripOfTheWeekFeature photo={homepagePhotos.get(`pkg:${weekTrip.id}`)?.[0] ?? null} savedKeys={savedKeys} onSavePackage={savePackageDetail} liveFares={packageFares} />

        <PackagesSection photosById={homepagePhotos} savedKeys={savedKeys} onSavePackage={savePackageDetail} liveFares={packageFares} />

        <section id="destinations" className="home-section">
          <p className="eyebrow">Where to go</p>
          <h2>Popular destinations</h2>
          <p className="sub">Open a trip to see the plan — Best value per traveler.</p>
          <div className="grid">
            {visibleEntries.map((e) => {
              // Saved trips & fares (roadmap, Nov 21 2026 — F1): the
              // total is captured in a const so the narrowing survives
              // into the Save button's closure.
              const total = e.total;
              const perTraveler = total !== null ? Math.round(total / 2) : null;
              const saved = perTraveler !== null && savedKeys.has(tripSavedKey(e.name, perTraveler));
              return (
              <article className="card dest-card" key={e.key}>
                <PhotoCarousel photos={e.photos} alt={e.name} />
                <div className="body">
                  {/* Clean & trusted (Nov 22, 2026): the name + from-price
                      sit in the white body below the photo — never
                      overlaid on it. One price per card. */}
                  <h3><Icon name="pin" size={18} /> {e.name}{e.country ? `, ${e.country}` : ''}</h3>
                  {total !== null && (
                    <p className="result-price">from ${Math.round(total / 2).toLocaleString()} <span className="plan-muted">per traveler</span></p>
                  )}
                  <div className="card-top">
                    <span className="pill">{e.tag}</span>
                    <ShareMenu url={sharePathFor('destination', e.name)} text={shareTextFor('destination', e.name)} buttonClassName="linklike" />
                  </div>
                  {total !== null ? (
                    <p className="plan-muted">Best value · 2 travelers</p>
                  ) : (
                    <p className="plan-muted">No estimate for this one yet</p>
                  )}
                  <a className="primary" href={`/destination/${encodeURIComponent(e.name)}`}>View trip</a>
                  {total !== null && perTraveler !== null && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                      disabled={saved}
                      onClick={() => saveDestination(e.name, total)}
                    >
                      {saved ? 'Saved ✓' : '♥ Save'}
                    </button>
                  )}
                </div>
              </article>
              );
            })}
          </div>
          {/* Hidden gems, folded into the Destinations band (UX
              direction round 2, Nov 21 2026 — P0-4): a labelled row
              in the same section, same card, same grid — not its
              own band. */}
          <div className="gems-row">
            <p className="eyebrow">Hidden gems</p>
            <h3>Three US places worth the detour</h3>
            <p className="sub">Explored properly, with a full plan, not just a photo.</p>
            <div className="grid">
              {HIDDEN_GEMS.map((d) => {
              const gemPhoto = homepagePhotos.get(`gem:${d.name}`)?.[0] ?? null;
              return (
              <article className="card dest-card" key={d.name}>
                <div>
                  {gemPhoto ? (
                    <SafeImg src={gemPhoto} alt={d.name} label={d.name} />
                  ) : (
                    <div className="img-fallback" role="img" aria-label={d.name}>
                      <span>{d.name}</span>
                    </div>
                  )}
                </div>
                <div className="body">
                  {/* Clean & trusted (Nov 22, 2026): name + price in
                      the white body, never overlaid on the photo. */}
                  <h3><Icon name="pin" size={18} /> {d.name}, {d.country}</h3>
                  {cardInfo[d.name]?.total !== undefined && cardInfo[d.name]?.total !== null && (
                    <p className="result-price">from ${Math.round((cardInfo[d.name]?.total ?? 0) / 2).toLocaleString()} <span className="plan-muted">per traveler</span></p>
                  )}
                  <div className="card-top">
                    <span className="pill">{d.tag}</span>
                    <ShareMenu url={sharePathFor('destination', d.name)} text={shareTextFor('destination', d.name)} buttonClassName="linklike" />
                  </div>
                  <p>{d.blurb}</p><p style={{ fontSize: 13 }}>{d.trend}</p>
                  {cardInfo[d.name] && (
                    <>
                      <p className="plan-muted">{cardInfo[d.name]?.experiences} experience{cardInfo[d.name]?.experiences !== 1 ? 's' : ''} · {cardInfo[d.name]?.hotels} stay · {cardInfo[d.name]?.transports} transports</p>
                      <p className="plan-muted">Best value · 2 travelers · 3 days</p>
                    </>
                  )}
                  <details>
                    <summary>See the days</summary>
                    <ul style={{ fontSize: 13, paddingLeft: 18 }}>{d.itinerary.map((s) => <li key={s}>{s}</li>)}</ul>
                  </details>
                  <a className="primary" href={`/destination/${encodeURIComponent(d.name)}`}>View trip</a>
                  {cardInfo[d.name]?.total !== undefined && cardInfo[d.name]?.total !== null && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                      disabled={savedKeys.has(tripSavedKey(d.name, Math.round((cardInfo[d.name]?.total ?? 0) / 2)))}
                      onClick={() => saveDestination(d.name, cardInfo[d.name]?.total ?? 0)}
                    >
                      {savedKeys.has(tripSavedKey(d.name, Math.round((cardInfo[d.name]?.total ?? 0) / 2))) ? 'Saved ✓' : '♥ Save'}
                    </button>
                  )}
                </div>
              </article>
              );
            })}
            </div>
          </div>
        </section>

        <HowItWorksSection />

        {/* Community, merged (UX direction, Nov 19 2026 — P1-1):
            Travelers' stories + Local voices in one band. The reels
            part hides while the feed is empty; the voices are curated
            content, so the band itself always has something to show. */}
        <section className="home-section" aria-label="Community">
          <LocalVoicesTeaser
            photoByPlace={new Map(LOCAL_VOICES_PLACES.map((p) => [p, homepagePhotos.get(`voice:${p}`)?.[0] ?? null]))}
          />
          {/* Community (UX direction round 2, Nov 21 2026 — P0-4):
              the reels part hides only once the feed reports zero.
              reelsCount starts null while the feed loads, so the
              band renders server-side (heading, links, feed shell)
              and stays — the checked-in seed (lib/reelsSeed.ts)
              means the deployed feed is never empty, so the band
              no longer flashes and vanishes on live the way it did
              when data/reels.json never reached the deploy. A
              genuinely empty feed (every post deleted) still hides
              the band, never a "No reels yet" box. */}
          {reelsCount !== 0 && (
            <div style={{ marginTop: 32 }}>
              <h3>Travelers&apos; stories{reelsCount !== null ? ` · ${reelsCount} reel${reelsCount === 1 ? '' : 's'}` : ''}</h3>
              <p className="sub">Photos and short reels from travelers who took the trip — verified trips only on the trip cards, shareable to social media.</p>
              <ReelsFeed onPost={() => openComposer()} onCount={setReelsCount} />
              <p style={{ marginTop: 12 }}>
                <a href="/community">Visit the Community →</a>{' '}
                <a href="/reels">See all travelers’ reels →</a>
              </p>
            </div>
          )}
        </section>

        {/* Ad slot: below the fold, content area only. Dormant until AdSense is configured. */}
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_BELOW_GEMS ?? ''} />
        </>
        )}

        {/* Ad slot: above the footer, content area only. Dormant until AdSense is configured. */}
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_FOOTER ?? ''} />
      </main>
      )}
      {variant === 'account' && (
      <main className="wrap">
        {/* My Trips lives here now (UX direction, Nov 19 2026 —
            P1-1): the trips, preferences, emergency contact, embassy
            number and price watches are an account page, not a
            homepage band. The full continue strip lives here too
            (round 2, Nov 21 — P0-4): resuming a search from /account
            routes home with the search params, and the homepage
            re-runs it. */}
        <ContinueStrip
          trips={trips}
          watches={watches}
          lastSearch={lastSearch}
          onResumeSearch={(q) => router.push(`/?${searchQueryToParams(q)}`)}
          onGoToTrips={() => router.push('/account')}
        />
        <section>
          <h1 id="mytrips">My Trips</h1>
          <p className="sub">Your saved trips, travel preferences, emergency contact and price watches.</p>
          {myTripsBody}
        </section>
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_FOOTER ?? ''} />
      </main>
      )}
      {variant !== 'chat' && (
      <footer>
        <div className="wrap">
          <div className="footer-cols">
            <div className="footer-col">
              <h3>Book</h3>
              <ul>
                {HOME_TABS.map((t) => (
                  <li key={t.id}>
                    <a href={`/?tab=${t.id}`}>{t.label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="footer-col">
              <h3>Company</h3>
              <ul>
                <li>
                  <a href="/about">About</a>
                </li>
                <li>
                  <a href="/community">Community</a>
                </li>
                <li>
                  <a href="/contact">Contact</a>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h3>Help</h3>
              <ul>
                <li>
                  <a href="/faq">FAQ</a>
                </li>
                <li>
                  <a href="/faq#cancellation">Cancellation</a>
                </li>
                <li>
                  <a href="/privacy">Privacy Policy</a>
                </li>
              </ul>
            </div>
            <div className="footer-col">
              <h3>Account</h3>
              <ul>
                <li>
                  <a href="/account">My Trips</a>
                </li>
                {/* Sign in (UX direction, Nov 19 2026 — P0-6): the
                    link only renders once Clerk is configured — a
                    dead "Sign in" that lands on "isn't set up yet"
                    is worse than no link. The plan-PDF gate in
                    FujinChat stays as-is. */}
                {account.configured && (
                  <li>
                    <a href="/sign-in">Sign in</a>
                  </li>
                )}
              </ul>
            </div>
          </div>
          {/* Footer destinations (audit round, Nov 17, 2026 — gap
              13): one link per destination, to its guide page. The
              hub used to repeat all 7 category links under every
              destination — 42 identical links — while the Book
              column already links the 7 categories once. */}
          <div className="footer-hub" aria-label="Top destinations">
            {discovery.slice(0, 6).map((d) => (
              <span key={d.key} className="footer-hub-dest">
                <a href={`/destination/${encodeURIComponent(d.destination)}`}>{d.destination}</a>
              </span>
            ))}
          </div>
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Travel globally, act locally.</p>
          <p>No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
          <p>Fujin artwork: Ogata Korin, Wind God, c.1700 (public domain). Photo credits in the destination cards are from Unsplash / Wikimedia Commons.</p>
        </div>
      </footer>
      )}
    </div>
  );
}
