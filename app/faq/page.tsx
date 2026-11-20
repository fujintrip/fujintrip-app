import type { Metadata } from 'next';
import { duffelMode } from '../../lib/duffel';

export const metadata: Metadata = {
  title: 'FAQ — FujinTrip',
  description: 'Frequently asked questions about FujinTrip: prices, accounts, the plan PDF, and cancellation.',
};

export default function Faq() {
  return (
    <div>
      <header><div className="wrap topbar"><div><div className="logo">Fujin<span>Trip</span></div><div className="tag">Ride the wind. Pay less. · fujintrip.com</div></div><div className="tag">Quality + affordable prices</div></div></header>
      <main className="wrap">
        <section>
          <h1>Frequently asked questions</h1>
          <p className="sub">Short answers, drawn from how the site actually works today.</p>

          <h2 style={{ marginTop: 28 }} id="pricing">Are the prices on FujinTrip live?</h2>
          <p>Prices marked &ldquo;planning estimate&rdquo; are estimates from our planner, not live quotes. {duffelMode() === 'live' ? 'Flight searches show live fares from our flight supplier (Duffel) — real-time prices, labeled with their source.' : 'Flight searches show fares from our flight supplier (Duffel) — currently in test mode, and the page labels them as test fares, not live bookable quotes.'} Fares shown from other sites are cached and labeled with when they were checked, never presented as live.</p>

          <h2 style={{ marginTop: 28 }}>Do I need an account?</h2>
          <p>No — browsing and searching are free without an account. Saving a search or downloading a plan as a PDF needs a free account: sign in with an email link, no password. Your saved trips are stored in your browser on this device for now.</p>

          <h2 style={{ marginTop: 28 }}>Why does downloading my plan cost $1?</h2>
          <p>Downloading your full plan as a PDF is free when you book your trip with FujinTrip, and $1 when you don&rsquo;t book with us. The plan itself — prices, options and the day-by-day itinerary — is always free to read in the chat and on the trip page.</p>

          <h2 style={{ marginTop: 28 }}>What does FujinTrip cover?</h2>
          <p>Flights, stays, car rental, attractions, cruises, buses and taxis — plus the AI planner (&ldquo;Plan with AI&rdquo; in the header) that builds the whole trip into one day-by-day plan.</p>

          <h2 style={{ marginTop: 28 }} id="cancellation">How do I cancel?</h2>
          <p>FujinTrip doesn&rsquo;t take bookings yet, so there is nothing to cancel here — searches are planning estimates and nothing is charged. When booking opens, each fare&rsquo;s cancellation terms will be shown before you pay.</p>

          <h2 style={{ marginTop: 28 }}>How do I contact you?</h2>
          <p>Email us at <a href="mailto:fujintrip@gmail.com">fujintrip@gmail.com</a> — see our <a href="/contact">contact page</a>.</p>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Named for Fujin, Japan&rsquo;s wind god.</p>
          <p><a href="/">Back to FujinTrip</a> · <a href="/privacy">Privacy Policy</a></p>
        </div>
      </footer>
    </div>
  );
}
