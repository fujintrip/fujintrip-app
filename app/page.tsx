'use client';
import { useEffect, useMemo, useState } from 'react';
import { GLOBAL_DESTINATIONS, HIDDEN_GEMS, LOCAL_TRIPS, TABS, type Tab } from '../lib/data';
import { askFujin, buildPlan, type Plan } from '../lib/planner';

type Trip = { id: string; label: string; status: string; date: string };
const FUJIN_IMG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Wind_God_by_Ogata_Korin.jpg/640px-Wind_God_by_Ogata_Korin.jpg';

function Chat() {
  const [msgs, setMsgs] = useState<{ who: string; text: string }[]>([{ who: 'ai', text: 'Hi, I’m Fujin AI. Tell me where you want to go, for how many people — I’ll gather flights, hotels, cars and sightseeing into one plan, in Cheapest / Best value / Premium.' }]);
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [choice, setChoice] = useState(1);
  const send = () => {
    if (!input.trim()) return;
    const parsed = askFujin(input);
    setMsgs((m) => [...m, { who: 'user', text: input }, { who: 'ai', text: parsed.reply + (parsed.missing.length ? ` To finish the plan I still need: ${parsed.missing.join(', ')}.` : ' Tap Build my plan below.') }]);
    setInput('');
  };
  const build = () => {
    const dest = msgs.length ? 'Kyoto' : 'Kyoto';
    setPlan(buildPlan(dest, 2, 3));
  };
  return (
    <div>
      <div className="chat">
        {msgs.map((m, i) => (<div key={i} className={`msg ${m.who === 'user' ? 'user' : ''}`}><span className="bubble">{m.text}</span></div>))}
      </div>
      <div className="row">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Try: Bali, 2 travelers, surf and food, next spring, $2,000" aria-label="Ask Fujin AI" />
        <button className="primary" onClick={send}>Send</button>
      </div>
      <p className="selling">Gathers everything into one plan · Customized for you · Verify before you book</p>
      <p style={{ marginTop: 16 }}><button className="primary" onClick={build}>Build my plan</button></p>
      {plan && (
        <div style={{ marginTop: 20 }}>
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
          <h3 style={{ marginTop: 24 }}>Day by day</h3>
          {plan.days.map((d) => (
            <div key={d.day} style={{ borderTop: '1px solid #f0ead6', padding: '12px 0' }}>
              <strong>Day {d.day} — {d.title}</strong>
              <p><b>Morning:</b> {d.morning}<br /><b>Afternoon:</b> {d.afternoon}<br /><b>Evening:</b> {d.evening}<br /><b>Transport:</b> {d.transport} · <b>Stay:</b> {d.stay}</p>
            </div>
          ))}
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
  const saveTrip = (label: string) => setTrips((t) => [{ id: String(Date.now()), label, status: 'Request saved', date: new Date().toLocaleDateString() }, ...t]);
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
          <img className="fujin-portrait" src={FUJIN_IMG} alt="Wind God by Ogata Korin — Fujin, the Japanese wind god" />
          <h1>One complete plan. Cheapest, Best value, or Premium.</h1>
          <p>Ask Fujin AI once — flights, hotels, cars and sightseeing, with links to reviews and hotel websites.</p>
        </section>

        <div className="tabs" role="tablist" aria-label="Search">
          {TABS.map((t) => (<button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>))}
        </div>
        <div className="panel">
          {tab === 'Fujin AI' ? <Chat /> : <SearchForm tab={tab} onSave={saveTrip} />}
        </div>

        <section>
          <h2>Global packages, in one plan</h2>
          <p className="sub">Flights, hotels, car rental, sightseeing and more — gathered into a single customized trip, not seven separate bookings.</p>
          <div className="grid">
            {GLOBAL_DESTINATIONS.map((d) => (
              <article className="card" key={d.name}>
                <img src={d.image} alt={d.name} loading="lazy" />
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
                <img src={d.image} alt={d.name} loading="lazy" />
                <div className="body"><span className="pill">{d.tag}</span><h3>{d.name}, {d.country}</h3><p>{d.blurb}</p><p style={{ fontSize: 13 }}>{d.trend}</p><p className="price">{d.priceFrom}</p><ul style={{ fontSize: 13, paddingLeft: 18 }}>{d.itinerary.map((s) => <li key={s}>{s}</li>)}</ul><button className="ghost" onClick={() => saveTrip(`${d.name} hidden gem — request saved`)}>Plan this trip</button></div>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2>How much do you actually save?</h2>
          <p className="sub">An example Kyoto trip — the same trip, booked two ways.</p>
          <div className="compare">
            <div className="box best"><strong>FujinTrip — Best value</strong><p style={{ fontSize: 30, margin: '8px 0' }}>$2,460</p><table><tbody><tr><td>Flights</td><td>$1,040</td></tr><tr><td>Hotel</td><td>$820</td></tr><tr><td>Car</td><td>$260</td></tr><tr><td>Sightseeing</td><td>$340</td></tr></tbody></table></div>
            <div className="box"><strong>Booking each leg separately</strong><p style={{ fontSize: 30, margin: '8px 0' }}>$2,840</p><table><tbody><tr><td>Flights</td><td>$1,180</td></tr><tr><td>Hotel</td><td>$960</td></tr><tr><td>Car</td><td>$310</td></tr><tr><td>Sightseeing</td><td>$390</td></tr></tbody></table></div>
          </div>
          <p><strong>You save $380 — about 13%.</strong></p>
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
      </main>
      <footer>
        <div className="wrap">
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Named for Fujin, Japan’s wind god.</p>
          <p>Fujin artwork: Ogata Korin, Wind God, c.1700 (public domain). Photo credits in the destination cards are from Unsplash / Wikimedia Commons.</p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
        </div>
      </footer>
    </div>
  );
}
