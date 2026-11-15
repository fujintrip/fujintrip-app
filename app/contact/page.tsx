import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact — FujinTrip',
  description: 'How to reach the FujinTrip team.',
};

export default function Contact() {
  return (
    <div>
      <header><div className="wrap topbar"><div><div className="logo">Fujin<span>Trip</span></div><div className="tag">Ride the wind. Pay less. · fujintrip.com</div></div><div className="tag">Quality + affordable prices</div></div></header>
      <main className="wrap">
        <section>
          <h1>Contact us</h1>
          <p className="sub">Email is the fastest way to reach us.</p>
          <p>
            Email us at <a href="mailto:fujintrip@gmail.com">fujintrip@gmail.com</a>.
          </p>
          <p>If your question is about a trip, include your destination and dates so we can answer it properly. For questions about prices, accounts or the plan PDF, our <a href="/faq">FAQ</a> may already have the answer.</p>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <p><strong>FujinTrip</strong> — Ride the wind. Pay less. Named for Fujin, Japan&rsquo;s wind god.</p>
          <p><a href="/">Back to FujinTrip</a> · <a href="/privacy">Privacy Policy</a></p>
          <p>Prices on this site are planning estimates unless marked live. fujintrip.com</p>
        </div>
      </footer>
    </div>
  );
}
