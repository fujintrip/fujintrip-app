'use client';
import { useEffect, useMemo, useState } from 'react';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, LOCAL_TRIPS, TABS, type Tab } from '../lib/data';
import { askFujin, buildPlan, comparisonFor, type Plan } from '../lib/planner';
import { guideFor } from '../lib/localGuides';
import AdSlot from '../components/AdSlot';

type Trip = { id: string; label: string; status: string; date: string };
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

function Chat({ onParsed, onSaveTrip }: { onParsed?: (t: { destination: string; travelers: number }) => void; onSaveTrip: (label: string, status: string) => void }) {
  const [msgs, setMsgs] = useState<{ who: string; text: string; tips?: string[] }[]>([{ who: 'ai', text: 'Hi, I’m Fujin AI. Tell me where you want to go, for how many people — I’ll gather flights, hotels, cars and sightseeing into one plan, in Cheapest / Best value / Premium.' }]);
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState(1);
  const [lastParsed, setLastParsed] = useState<{ destination: string; travelers: number } | null>(null);
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
          // conversation (the Nov 10 Europe bug).
          history: msgs.slice(-6).map((m) => ({ role: m.who === 'user' ? 'user' : 'assistant', content: m.text })),
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
        parsed = askFujin(contextText);
      }
    } catch {
      parsed = askFujin(contextText);
    }
    setAiLive(live);
    // Empty destination means an off-topic decline — keep any earlier plan destination.
    if (parsed.destination) {
      setLastParsed({ destination: parsed.destination, travelers: parsed.travelers });
      // The price-comparison section below follows the AI's trip.
      onParsed?.({ destination: parsed.destination, travelers: parsed.travelers });
    }
    setMsgs((m) => [...m, { who: 'ai', text: parsed.reply + (parsed.missing.length ? ` To finish the plan I still need: ${parsed.missing.join(', ')}.` : ' Tap Build my plan below.'), tips: parsed.tips }]);
  };
  const build = () => {
    const dest = lastParsed?.destination ?? 'Kyoto';
    const people = lastParsed?.travelers ?? 2;
    setPlan(buildPlan(dest, people, 3));
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
  // PDF: the browser print dialog, with a print stylesheet that prints
  // only the plan (see globals.css). No extra dependency.
  const printPlan = () => window.print();
  // Watch this price: the whole-package price-drop alert. Honest label —
  // planner prices are static estimates, so no alert can fire until live
  // fares connect; the watch is saved now and switches on then.
  const watchPrice = () => {
    if (!plan) return;
    const best = plan.options[1];
    onSaveTrip(`${plan.destination} plan — Best value $${best.total.toLocaleString()}`, 'Price watch — alerts start when live fares connect');
    setActionMsg('Watching this price. You’ll be alerted when the whole trip price drops — alerts switch on once live fares are connected; planner prices don’t move until then.');
  };
  // Hold my price: a request for the FujinTrip team, not a guaranteed hold
  // — there is no live inventory to freeze a price against yet.
  const holdPrice = () => {
    if (!plan) return;
    const best = plan.options[1];
    onSaveTrip(`${plan.destination} plan — Best value $${best.total.toLocaleString()}`, 'Price hold requested');
    setActionMsg('Hold requested. This asks the FujinTrip team to hold the Best value price when booking opens — it is a request, not a guaranteed hold yet, because there is no live inventory to freeze it against.');
  };
  // Ask a human: a person reviews the plan before anything is booked.
  const askHuman = () => {
    if (!plan) return;
    onSaveTrip(`${plan.destination} plan — Best value $${plan.options[1].total.toLocaleString()}`, 'Advisor review requested');
    setActionMsg('Sent for a human check. A person reviews this plan before anything is booked — no booking happens until they’ve looked at it.');
  };
  // Curated guide for the current plan's destination (Kyoto only, researched
  // Nov 2026) — the fallback when no live-fetch voices exist for it.
  const guide = plan ? guideFor(plan.destination) : null;
  return (
    <div>
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who === 'user' ? 'user' : ''}`}>
            <span className="bubble">{m.text}</span>
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
      <p className="selling">No margin on top, no hidden fees — FujinTrip earns commission from suppliers, never by marking up your price.</p>
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
          <div className="compare" style={{ marginTop: 12 }}>
            {plan.options.map((o, i) => (
              <div key={o.name} className={`box ${i === choice ? 'best' : ''}`} onClick={() => setChoice(i)} style={{ cursor: 'pointer' }}>
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
          <div className="row no-print" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={sharePlan}>Share plan</button>
            <button className="ghost" onClick={printPlan}>Save as PDF</button>
            <button className="ghost" onClick={watchPrice}>Watch this price</button>
            <button className="ghost" onClick={holdPrice}>Hold my price</button>
            <button className="ghost" onClick={askHuman}>Ask a human to check this plan</button>
          </div>
          {actionMsg && <p className="no-print" style={{ fontSize: 13, color: '#1f5c4d', whiteSpace: 'pre-line' }}>{actionMsg}</p>}
          <h3 style={{ marginTop: 24 }}>Day by day</h3>
          {plan.days.map((d) => (
            <div key={d.day} style={{ borderTop: '1px solid #f0ead6', padding: '12px 0' }}>
              <strong>Day {d.day} — {d.title}</strong>
              <p><b>Morning:</b> {d.morning}<br /><b>Afternoon:</b> {d.afternoon}<br /><b>Evening:</b> {d.evening}<br /><b>Transport:</b> {d.transport} · <b>Stay:</b> {d.stay}</p>
            </div>
          ))}
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
          <p style={{ fontSize: 13, color: '#6b655a' }}>Travellers liked: {plan.liked.join(' · ')} — Verify with review links and hotel websites before you book.</p>
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
  const saveTrip = (label: string, status = 'Request saved') => setTrips((t) => [{ id: String(Date.now()), label, status, date: new Date().toLocaleDateString() }, ...t]);
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
          <p>Ask Fujin AI once — flights, hotels, cars and sightseeing, with links to reviews and hotel websites.</p>
        </section>

        <div className="tabs" role="tablist" aria-label="Search">
          {TABS.map((t) => (<button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>))}
        </div>
        <div className="panel">
          {tab === 'Fujin AI' ? <Chat onParsed={setAiTrip} onSaveTrip={saveTrip} /> : <SearchForm tab={tab} onSave={saveTrip} />}
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
          <p style={{ fontSize: 14, color: '#1f5c4d' }}>No margin on top, no hidden fees — FujinTrip earns commission from suppliers, never by marking up your price.</p>
          <p className="notice">Illustrative planning estimates — not a live quote. Live prices come from suppliers once connected.</p>
        </section>

        <section>
          <h2>How FujinTrip works</h2>
          <p className="sub">Tell Fujin AI where you want to go. It gathers flights, hotels, cars and sightseeing into one plan — Cheapest, Best value, Premium — with links to reviews and hotel websites so you can verify before you book.</p>
          <h2 style={{ marginTop: 28 }}>My Trips</h2>
          {trips.length === 0 ? <p style={{ color: '#6b655a' }}>No trips saved yet. Search above, or add a destination — it will appear here as a request you can turn into a plan.</p> : (
            <ul className="mytrips" style={{ listStyle: 'none', padding: 0 }}>
              {trips.map((t) => (<li key={t.id}><span>{t.label} · {t.status} · {t.date}</span><span><button className="ghost" onClick={() => setTrips((x) => x.filter((y) => y.id !== t.id))}>Delete</button></span></li>))}
            </ul>
          )}
        </section>

        {/* Ad slot: above the footer, content area only. Dormant until AdSense is configured. */}
        <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ABOVE_FOOTER ?? ''} />
      </main>
      <footer>
        <div className="wrap">
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Travel globally, act locally. Named for Fujin, Japan’s wind god.</p>
          <p>No margin on top, no hidden fees — FujinTrip earns commission from suppliers, never by marking up your price.</p>
          <p>Fujin artwork: Ogata Korin, Wind God, c.1700 (public domain). Photo credits in the destination cards are from Unsplash / Wikimedia Commons.</p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
          <p><a href="/privacy">Privacy Policy</a></p>
        </div>
      </footer>
    </div>
  );
}
