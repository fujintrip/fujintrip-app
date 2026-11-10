import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — FujinTrip',
  description: 'How FujinTrip handles your searches, saved trips, cookies and advertising.',
};

export default function Privacy() {
  return (
    <div>
      <header><div className="wrap topbar"><div><div className="logo">Fujin<span>Trip</span></div><div className="tag">Ride the wind. Pay less. · fujintrip.com</div></div><div className="tag">Quality + affordable prices</div></div></header>
      <main className="wrap">
        <section>
          <h1>Privacy Policy</h1>
          <p className="sub">Last updated: November 2026.</p>
          <p>FujinTrip is a travel planning and booking site at fujintrip.com. This policy explains, in plain words, what we collect and what we do with it. We do not sell your personal information.</p>

          <h2 style={{ marginTop: 28 }}>What we collect</h2>
          <p><strong>Searches.</strong> When you search for flights, hotels, cars or other trips, we use the details you entered (where, when, how many travellers) to look up options. Flight searches are sent to our flight supplier (Duffel) to look up fares — only the trip details you entered, nothing else about you.</p>
          <p><strong>My Trips.</strong> Trips you save are stored in your own browser (local storage on your device). We do not receive or store them on our servers.</p>
          <p><strong>Location.</strong> Only if you tap &ldquo;Use my location&rdquo; do we ask your browser for your location, and only to show trips near you. We do not store it or send it anywhere.</p>
          <p><strong>Contact.</strong> If you contact us, we keep only what you send us, to answer you.</p>

          <h2 style={{ marginTop: 28 }}>Cookies and local storage</h2>
          <p>My Trips uses your browser&rsquo;s local storage, not cookies. We do not set advertising cookies while advertising is off (see below). If we add analytics later, this policy will say so.</p>

          <h2 style={{ marginTop: 28 }}>Third-party advertising (Google AdSense)</h2>
          <p>Advertising on FujinTrip is currently <strong>off</strong>. No advertising cookies are set and no ad network receives your data from this site.</p>
          <p>When advertising is switched on, we plan to show ads through Google AdSense. Google and its partners may then use cookies to show ads based on your visits to this and other sites. You can opt out of personalised advertising at any time in your <a href="https://adssettings.google.com">Google Ads Settings</a> or at <a href="https://optout.aboutads.info">aboutads.info/choices</a>. Google&rsquo;s own handling of that data is covered by <a href="https://policies.google.com/privacy">Google&rsquo;s Privacy Policy</a>.</p>

          <h2 style={{ marginTop: 28 }}>Booking with suppliers</h2>
          <p>When you book through a supplier (an airline, hotel, car rental company or activity provider), only the details needed for that booking are shared with that supplier, so they can fulfil it. Each supplier has its own privacy policy for what it does with those details.</p>

          <h2 style={{ marginTop: 28 }}>Your choices</h2>
          <p>You can delete your saved trips at any time from My Trips, or by clearing your browser&rsquo;s local storage for fujintrip.com. You can opt out of personalised ads using the links above. You can use the site without an account — we do not ask you to create one.</p>

          <h2 style={{ marginTop: 28 }}>Changes to this policy</h2>
          <p>If we start collecting anything new — for example, accounts, payments or analytics — we will update this page and change the date above before it takes effect.</p>

          <h2 style={{ marginTop: 28 }}>Contact</h2>
          <p>FujinTrip — fujintrip.com. Contact details will be added here once booking is live.</p>
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
