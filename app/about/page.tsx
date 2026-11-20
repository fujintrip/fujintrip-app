import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — FujinTrip',
  description: 'What FujinTrip is: a one-stop travel platform for flights, stays, cars, tours, cruises, buses and taxis, with an AI planner.',
};

export default function About() {
  return (
    <div>
      <header><div className="wrap topbar"><div><div className="logo">Fujin<span>Trip</span></div><div className="tag">Ride the wind. Pay less. · fujintrip.com</div></div><div className="tag">Quality + affordable prices</div></div></header>
      <main className="wrap">
        <section>
          <h1>About FujinTrip</h1>
          <p className="sub">Named for Fujin, Japan&rsquo;s wind god — ride the wind, pay less.</p>
          <p>FujinTrip is a one-stop travel platform: flights, stays, car rental, attractions, cruises, buses and taxis in one place, with an AI assistant that gathers them into a full day-by-day travel plan.</p>
          <p>The idea is simple. A traveler should be able to plan a trip, book it, and follow the plan on the trip — without juggling seven websites and without hidden fees. Prices marked as planning estimates are estimates from our planner; live fares are labeled with their source and when they were checked.</p>
          <p>Our standard is quality plus affordable prices, even if that means less profit. No hidden margin on fares — the airline fare is passed through at cost, and our service fee is shown separately at checkout, so you always see fare plus fee before you pay.</p>
          <p>The artwork on the site is Ogata Korin&rsquo;s Wind God, c.1700 (public domain).</p>
          <p>
            Questions? See our <a href="/faq">FAQ</a> or <a href="/contact">contact us</a>.
          </p>
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
