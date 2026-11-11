'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, LOCAL_TRIPS, TABS, type Tab } from '../lib/data';
import { askFujin, buildPlan, comparisonFor, findMonth, findOrigin, findOriginAnswer, optionsLine, parseDuration, routeKeyForDestination, type Plan } from '../lib/planner';
import { buildTripCard, cardComparison, CITY_INFO, type TripCard } from '../lib/tripCard';
import { guideFor } from '../lib/localGuides';
import AdSlot from '../components/AdSlot';

// Trip map (Leaflet) is client-only — it needs window, so it loads
// without server rendering.
const TripMap = dynamic(() => import('../components/TripMap'), { ssr: false });

type Trip = { id: string; label: string; status: string; date: string; destination?: string };
type Voices = { destination: string; text: string; source: string } | null;
// Local copy of the Ogata Korin Wind God (public domain) — the Wikimedia
// Commons URL this used to point at 404s (the file is not on Commons under
// that name), so the portrait never loaded. Served locally now; credit stays
// in the footer.
const FUJIN_IMG = '/images/fujin-wind-god.jpg';

// Image with a graceful fallback: a failed image never shows a broken
// icon — it becomes a gold/jade placeholder with the destination name.
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

function Chat({ onParsed, onSaveTrip, bookedDestinations }: { onParsed?: (t: { destination: string; travelers: number }) => void; onSaveTrip: (label: string, status: string, destination?: string) => void; bookedDestinations: string[] }) {
  const [msgs, setMsgs] = useState<{ who: string; text: string; tips?: string[] }[]>([{ who: 'ai', text: 'Hi, I’m Fujin AI. Tell me where you want to go, for how many people — I’ll gather flights, hotels, cars and sightseeing into one plan, in Cheapest / Best value / Premium.' }]);
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState(1);
  const [lastParsed, setLastParsed] = useState<{ destination: string; travelers: number; origin?: string; month?: number; durationDays?: number; routeKey?: string } | null>(null);
  const [aiLive, setAiLive] = useState<boolean | null>(null);
  // Fresh traveler material fetched live for the last chat destination
  // (route returns it as `voices`) — feeds the "What travelers say" block.
  const [voices, setVoices] = useState<Voices>(null);
  // On-trip mode: the traveler is already at the destination and wants
  // short, right-now local answers. WhatsApp delivery is a later step
  // (needs a business number) — this mode works in the chat today.
  const [tripMode, setTripMode] = useState(false);
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
        const p = JSON.parse(t) as { destination?: unknown; travelers?: unknown; origin?: unknown; month?: unknown; durationDays?: unknown; routeKey?: unknown };
        if (typeof p.destination === 'string' && typeof p.travelers === 'number') {
          setLastParsed({
            destination: p.destination,
            travelers: p.travelers,
            ...(typeof p.origin === 'string' && p.origin ? { origin: p.origin } : {}),
            ...(typeof p.month === 'number' ? { month: p.month } : {}),
            ...(typeof p.durationDays === 'number' ? { durationDays: p.durationDays } : {}),
            ...(typeof p.routeKey === 'string' && p.routeKey ? { routeKey: p.routeKey } : {}),
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
  const withOptions = (p: { destination: string; travelers: number; reply: string; missing: string[]; needsMore?: boolean; tips?: string[] }) =>
    p.destination && !p.needsMore ? { ...p, reply: `${p.reply}\n\n${optionsLine(p.destination, p.travelers)}` } : p;
  const send = async () => {
    const text = input.trim();
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
    // Live AI first (server route); any failure falls back to the built-in planner.
    let parsed: { destination: string; travelers: number; reply: string; missing: string[]; tips?: string[] };
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
          ...(lastParsed ? { tripState: { ...lastParsed, ...(origin ? { origin } : {}) } } : {}),
          // On-trip mode: tell the server the traveler is already there.
          ...(tripMode && lastParsed ? { tripContext: lastParsed.destination } : {}),
        }),
      });
      const j = await r.json();
      if (r.ok && typeof j.reply === 'string' && typeof j.destination === 'string') {
        parsed = { destination: j.destination, travelers: typeof j.travelers === 'number' ? j.travelers : 2, reply: j.reply, missing: Array.isArray(j.missing) ? j.missing : [], tips: Array.isArray(j.tips) ? j.tips.filter((t: unknown): t is string => typeof t === 'string').slice(0, 3) : [] };
        live = j.live === true;
        // Keep the fresh traveler material the server fetched for this trip.
        if (typeof j.voices === 'string' && j.voices && typeof j.voicesDestination === 'string' && j.voicesDestination) {
          setVoices({ destination: j.voicesDestination, text: j.voices, source: typeof j.voicesSource === 'string' ? j.voicesSource : '' });
        }
      } else {
        parsed = withOptions(askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin));
      }
    } catch {
      parsed = withOptions(askFujin(contextText, lastParsed?.travelers ?? 2, lastParsed?.destination ?? '', text, origin));
    }
    setAiLive(live);
    // Empty destination means an off-topic decline — keep any earlier plan destination.
    if (parsed.destination) {
      // A new destination means a new trip: the old plan no longer applies
      // — clear it so the traveler builds a fresh one for this trip.
      if (lastParsed && parsed.destination !== lastParsed.destination) setPlan(null);
      setLastParsed({
        destination: parsed.destination,
        travelers: parsed.travelers,
        ...(origin ? { origin } : {}),
        ...(month ? { month } : {}),
        ...(durationDays ? { durationDays } : {}),
        ...(routeKeyForDestination(parsed.destination) ? { routeKey: routeKeyForDestination(parsed.destination) } : {}),
      });
      // The price-comparison section below follows the AI's trip.
      onParsed?.({ destination: parsed.destination, travelers: parsed.travelers });
    }
    setMsgs((m) => [...m, { who: 'ai', text: parsed.reply + (parsed.missing.length ? ` To finish the plan I still need: ${parsed.missing.join(', ')}.` : ' Tap Build my plan below.'), tips: parsed.tips }]);
  };
  const build = () => {
    const dest = lastParsed?.destination ?? 'Kyoto';
    const people = lastParsed?.travelers ?? 2;
    // The plan's day cards span the trip length the traveler gave
    // (14 days → 14 day cards), not a fixed 3.
    setPlan(buildPlan(dest, people, lastParsed?.durationDays ?? 3));
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
  // Watch this price: the whole-package price-drop alert. Honest label —
  // planner prices are static estimates, so no alert can fire until live
  // fares connect; the watch is saved now and switches on then.
  const watchPrice = () => {
    if (!plan) return;
    const best = plan.options[1];
    onSaveTrip(`${plan.destination} plan — Best value $${best.total.toLocaleString()}`, 'Price watch — alerts start when live fares connect', plan.destination);
    setActionMsg('Watching this price. You’ll be alerted when the whole trip price drops — alerts switch on once live fares are connected; planner prices don’t move until then.');
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
          })
        : null,
    [plan, lastParsed]
  );
  const comparison = useMemo(
    () => (plan ? cardComparison(plan.destination, plan.travelers) : null),
    [plan]
  );
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtDateYear = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div>
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who === 'user' ? 'user' : ''}`}>
            {m.who === 'ai' ? <div className="bubble">{formatReply(m.text)}</div> : <span className="bubble">{m.text}</span>}
            {m.who === 'ai' && m.tips && m.tips.length > 0 && (
              <ul style={{ fontSize: 13, color: '#6b655a', margin: '6px 0 0 12px', paddingLeft: 16, textAlign: 'left' }}>
                {m.tips.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={tripMode ? `On your trip in ${lastParsed?.destination ?? '…'} — ask where to eat tonight…` : 'Try: Bali, 2 travelers, surf and food, next spring, $2,000'} aria-label="Ask Fujin AI" />
        <button className="primary" onClick={send}>Send</button>
      </div>
      <p className="selling">Gathers everything into one plan · Customized for you · Verify before you book</p>
      <p className="selling">No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
      {aiLive !== null && <p className="no-print" style={{ fontSize: 12, color: '#6b655a' }}>{aiLive ? 'Fujin AI is live.' : 'Fujin AI is offline — using the built-in planner.'}</p>}
      <p className="no-print" style={{ marginTop: 16 }}>
        <button className="primary" onClick={build}>Build my plan</button>{' '}
        {lastParsed && (
          <button className="ghost" onClick={() => setTripMode((m) => !m)}>
            {tripMode ? `✓ On-trip mode on — ${lastParsed.destination}` : 'Take this plan on your trip'}
          </button>
        )}
      </p>
      {tripMode && lastParsed && (
        <p className="no-print" style={{ fontSize: 13, color: '#6b655a' }}>On-trip mode for {lastParsed.destination}: short, right-now answers — where to eat tonight, what’s open, how to get there. (WhatsApp delivery comes later — it needs a business number.)</p>
      )}
      {plan && (
        <div className="plan-print" style={{ marginTop: 20 }}>
          <h3>Your {plan.destination} plan — pick one</h3>
          {tripCard && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: '4px 0' }}>{tripCard.title}</h3>
              <p style={{ fontSize: 13, color: '#6b655a', margin: '4px 0' }}>
                {tripCard.days} days · {tripCard.stops.length} {tripCard.stops.length > 1 ? 'cities' : 'city'} · {tripCard.experiences} experiences · {tripCard.hotels} {tripCard.hotels > 1 ? 'stays' : 'stay'} · {tripCard.transports} transports
              </p>
              <p style={{ fontSize: 14, margin: '4px 0' }}>
                <strong>{fmtDateYear(tripCard.startDate)} – {fmtDateYear(tripCard.endDate)}</strong>{' '}
                <span style={{ color: '#6b655a', fontSize: 13 }}>(Suggested dates — change anytime.)</span>
              </p>
              <p style={{ fontSize: 14, margin: '8px 0' }}>{tripCard.routeLine}</p>
              <div className="no-print">
                <TripMap
                  stops={tripCard.stops
                    .filter((s) => CITY_INFO[s.city])
                    .map((s) => ({ city: s.city, lat: CITY_INFO[s.city].lat, lng: CITY_INFO[s.city].lng }))}
                />
              </div>
              <p className="print-only" style={{ fontSize: 13, color: '#6b655a' }}>Map: {tripCard.routeLine}</p>
              <div style={{ background: '#f7f3e3', border: '1px solid #e8e0c8', borderRadius: 10, padding: '10px 14px', marginTop: 12 }}>
                <strong style={{ fontSize: 14 }}>Top improvement for your budget</strong>
                <p style={{ fontSize: 14, margin: '4px 0' }}>{tripCard.budgetTip}</p>
              </div>
              {tripCard.stops.map((stop, si) => (
                <div key={stop.city} style={{ borderTop: '1px solid #f0ead6', padding: '12px 0' }}>
                  <strong>Days {stop.days[0]?.day ?? si + 1}{stop.days.length > 1 ? `-${stop.days[stop.days.length - 1].day}` : ''} · {fmtDate(stop.startDate)} – {fmtDate(stop.endDate)} · {stop.city}</strong>
                  <p style={{ margin: '4px 0' }}>{stop.intro}</p>
                  <p style={{ fontSize: 14, margin: '4px 0' }}>
                    <b>Arrive:</b> {stop.transportIn.mode} {stop.transportIn.from} → {stop.city} · from ${stop.transportIn.price.toLocaleString()} <span style={{ color: '#6b655a' }}>(estimate)</span>
                  </p>
                  <p style={{ fontSize: 14, margin: '4px 0' }}>
                    <b>Stay:</b> {stop.nights} night{stop.nights > 1 ? 's' : ''} · hostel / guesthouse estimate from ${stop.stayEstimate.toLocaleString()} <span style={{ color: '#6b655a' }}>(planning estimate — real named stays arrive with a hotel supplier)</span>
                  </p>
                  <p style={{ fontSize: 14, margin: '8px 0 4px' }}><b>Itinerary</b></p>
                  {stop.days.map((d) => (
                    <p key={d.day} style={{ fontSize: 14, margin: '3px 0' }}>
                      Day {d.day} · {fmtDate(d.date)}{d.weatherF ? ` · ${d.weatherF}°F typical` : ''} · {d.experiences} experiences — {d.title}
                    </p>
                  ))}
                </div>
              ))}
              <div style={{ borderTop: '1px solid #f0ead6', padding: '12px 0' }}>
                <p style={{ fontSize: 14, margin: '4px 0' }}>
                  <b>Depart:</b> ✈️ Flight {tripCard.stops[tripCard.stops.length - 1].city} → {tripCard.origin || 'your city'} · from ${tripCard.returnTransport.price.toLocaleString()} <span style={{ color: '#6b655a' }}>(estimate)</span>
                </p>
              </div>
              {comparison && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '4px 0' }}>Our rate vs other options</h3>
                  <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid #e8e0c8' }}>
                        <th style={{ padding: '6px 0' }}></th>
                        <th style={{ padding: '6px 0' }}>FujinTrip — Best value</th>
                        <th style={{ padding: '6px 0' }}>Booking separately</th>
                        <th style={{ padding: '6px 0' }}>Other sites (live)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>Flights</td><td>${comparison.best.flight.toLocaleString()}</td><td>${comparison.separate.flight.toLocaleString()}</td><td rowSpan={4} style={{ verticalAlign: 'top', color: '#6b655a' }}>Live competitor rates arrive with live fares — no live fare feed is connected yet, so we show nothing invented here.</td></tr>
                      <tr><td>Hotels</td><td>${comparison.best.hotel.toLocaleString()}</td><td>${comparison.separate.hotel.toLocaleString()}</td></tr>
                      <tr><td>Car</td><td>${comparison.best.car.toLocaleString()}</td><td>${comparison.separate.car.toLocaleString()}</td></tr>
                      <tr><td>Activities</td><td>${comparison.best.activities.toLocaleString()}</td><td>${comparison.separate.activities.toLocaleString()}</td></tr>
                      <tr style={{ borderTop: '2px solid #e8e0c8', fontWeight: 700 }}><td>Total</td><td>${comparison.best.total.toLocaleString()}</td><td>${comparison.separate.total.toLocaleString()}</td></tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 14, margin: '8px 0' }}>
                    You save <strong>${comparison.save.toLocaleString()} (~{comparison.savePercent}%)</strong> with FujinTrip vs booking each leg separately. Prices are planning estimates, not live quotes.
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
                <p style={{ fontSize: 13, color: '#6b655a' }}>{o.note}</p>
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
          {actionMsg && <p className="no-print" style={{ fontSize: 13, color: '#1f5c4d', whiteSpace: 'pre-line' }}>{actionMsg}</p>}
          {pdfNotice && (
            <div className="no-print" style={{ fontSize: 13, color: '#1f5c4d', marginTop: 8 }}>
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
              <p style={{ fontSize: 13, color: '#6b655a' }}>From real traveler guides — never invented reviews. Source: {voices.source || 'Wikivoyage traveler guide, fetched live'}.</p>
              {voices.text.split('\n').filter((l) => l.trim()).map((line, i) => (
                <p key={i} style={{ fontSize: 14 }}>{line}</p>
              ))}
            </div>
          ) : guide ? (
            <div>
              <p style={{ fontSize: 13, color: '#6b655a' }}>From researched traveler guides — real dishes and places, never invented reviews. Source: {guide.source}.</p>
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
          <p style={{ fontSize: 13, color: '#6b655a' }}>Travellers liked: {plan.liked.join(' · ')} — Book it all with FujinTrip, one booking, one price.</p>
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
  // The trip Fujin AI most recently understood — the price-comparison
  // section below follows it. Null until the user chats: Kyoto example.
  const [aiTrip, setAiTrip] = useState<{ destination: string; travelers: number } | null>(null);
  const cmp = useMemo(() => comparisonFor(aiTrip?.destination ?? 'Kyoto', aiTrip?.travelers ?? 2), [aiTrip]);
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
          {tab === 'Fujin AI' ? <Chat onParsed={setAiTrip} onSaveTrip={saveTrip} bookedDestinations={bookedDestinations} /> : <SearchForm tab={tab} onSave={saveTrip} />}
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
          <p style={{ fontSize: 13, color: '#6b655a' }}>{geoStatus}{locName && locName !== 'default' ? ` Showing trips near ${locName}.` : ''}</p>
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
            <p style={{ fontSize: 13, color: '#6b655a', margin: '0 0 16px' }}>
              Updated from your Fujin AI chat.{' '}
              <button className="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => setAiTrip(null)}>Back to the Kyoto example</button>
            </p>
          )}
          <div className="compare">
            <div className="box best"><strong>FujinTrip — Best value</strong><p style={{ fontSize: 30, margin: '8px 0' }}>${cmp.best.total.toLocaleString()}</p><table><tbody><tr><td>Flights</td><td>${cmp.best.flight.toLocaleString()}</td></tr><tr><td>Hotel</td><td>${cmp.best.hotel.toLocaleString()}</td></tr><tr><td>Car</td><td>${cmp.best.car.toLocaleString()}</td></tr><tr><td>Sightseeing</td><td>${cmp.best.activities.toLocaleString()}</td></tr></tbody></table></div>
            <div className="box"><strong>Booking each leg separately</strong><p style={{ fontSize: 30, margin: '8px 0' }}>${cmp.separate.total.toLocaleString()}</p><table><tbody><tr><td>Flights</td><td>${cmp.separate.flight.toLocaleString()}</td></tr><tr><td>Hotel</td><td>${cmp.separate.hotel.toLocaleString()}</td></tr><tr><td>Car</td><td>${cmp.separate.car.toLocaleString()}</td></tr><tr><td>Sightseeing</td><td>${cmp.separate.activities.toLocaleString()}</td></tr></tbody></table></div>
          </div>
          <p><strong>You save ${cmp.save.toLocaleString()} — about {cmp.savePercent}%.</strong></p>
          <p style={{ fontSize: 14, color: '#1f5c4d' }}>No hidden margin on fares — the airline fare is passed through at cost. Our service fee is shown separately at checkout, so you always see fare + fee before you pay.</p>
          <p className="notice">Illustrative planning estimates — not a live quote. Live prices come from suppliers once connected.</p>
        </section>

        <section>
          <h2>How FujinTrip works</h2>
          <p className="sub">Tell Fujin AI where you want to go. It gathers flights, hotels, cars and sightseeing into one plan — Cheapest, Best value, Premium — and you book it all with FujinTrip.</p>
          <h2 style={{ marginTop: 28 }}>My Trips</h2>
          <p style={{ fontSize: 13, color: '#6b655a' }}>“Mark as booked” is set by you or the FujinTrip team when a booking request is confirmed — it is not a live booking. A booked trip’s plan PDF is free; other plans cost $1 to download.</p>
          {trips.length === 0 ? <p style={{ color: '#6b655a' }}>No trips saved yet. Search above, or add a destination — it will appear here as a request you can turn into a plan.</p> : (
            <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
              {trips.map((t) => (<li key={t.id}><span>{t.label} · {t.status} · {t.date}</span><span>{t.destination && t.status !== 'Booked with FujinTrip' && (<><button className="ghost" onClick={() => setTrips((x) => x.map((y) => (y.id === t.id ? { ...y, status: 'Booked with FujinTrip' } : y)))}>Mark as booked</button>{' '}</>)}<button className="ghost" onClick={() => setTrips((x) => x.filter((y) => y.id !== t.id))}>Delete</button></span></li>))}
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
