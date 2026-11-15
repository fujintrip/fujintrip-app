// Dev-server smoke tests — run the app and hit the real routes.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/dev-server.test.mjs
// (Starts `next dev` on port 3106, waits for it, runs the checks, kills
// the server by port pid. A stale .next after `npm run build` breaks
// `next dev`, so the suite removes it first.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildTripCard } from '../lib/tripCard.ts';
import { snapshotFor } from '../lib/today.ts';

const PORT = 3106;
const BASE = `http://127.0.0.1:${PORT}`;
let dev = null;

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('dev server did not come up');
}

before(async () => {
  execSync('rm -rf .next', { cwd: process.cwd(), stdio: 'ignore' });
  dev = spawn('npm', ['run', 'dev', '--', '-p', String(PORT)], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  await waitForServer();
});

after(async () => {
  if (dev) {
    dev.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try {
      execSync(`fuser -k ${PORT}/tcp`, { stdio: 'ignore' });
    } catch {}
  }
});

test('homepage 200 renders the brand but no chat panel — the chat lives on /chat now', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('FujinTrip'), 'homepage renders the brand');
  // The service-worker registration lives in the client JS bundle (the
  // component renders null), so the HTML check is for the worker route
  // itself — see the next test.
  assert.ok(!html.includes('fujin-chat'), 'the chat panel is not on the homepage anymore');
  assert.ok(!html.includes('chat-shell'), 'the chat shell is not on the homepage anymore');
});

test('chat page 200 and renders the chat panel', async () => {
  const r = await fetch(`${BASE}/chat`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('FujinTrip'), 'chat page renders the brand');
  assert.ok(html.includes('fujin-chat'), 'chat page renders the chat panel');
});

test('homepage: white hero + search widget with 7 tabs, destinations, trust strip, exactly one Plan with AI pill, no results before a search', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  // White hero with the one question — no background photo, no
  // rotator, no dots (Nov 15, 2026: the photo background is gone).
  assert.ok(html.includes('Where to?'), 'hero asks Where to?');
  assert.ok(!html.includes('hero-rotator'), 'no hero rotator');
  assert.ok(!html.includes('hero-dots'), 'no hero dot indicators');
  assert.ok(!html.includes('hero-booking-photo'), 'no hero photo container');
  // The search widget: 7 category tabs switch the SEARCH FORM.
  assert.equal((html.match(/role="tab"/g) || []).length, 7, '7 widget tabs');
  for (const label of ['Stays', 'Flights', 'Car rental', 'Attractions', 'Cruises', 'Buses', 'Taxis']) {
    assert.ok(html.includes(label), `widget tab ${label} renders`);
  }
  // Flights first: the first window is airline booking (Nov 15 2026)
  // — the Flights tab comes before Stays in the served HTML.
  assert.ok(html.indexOf('Flights') < html.indexOf('Stays'), 'Flights tab precedes Stays');
  // Flights is the default form (airline booking is the first window,
  // Nov 15 2026); the honest line sits under the button.
  assert.ok(html.includes('Search flights'), 'the Flights search form renders by default');
  assert.ok(html.includes('All-in prices. No hidden fees. Planning estimates until live suppliers connect.'), 'the widget honesty line renders');
  // Exactly ONE AI entry point on the site — the header pill.
  assert.equal((html.match(/Plan with AI/g) || []).length, 1, 'exactly one Plan with AI pill');
  assert.equal((html.match(/Build full plan with AI/g) || []).length, 0, 'no big AI button under the hero');
  assert.equal((html.match(/Ask Fujin AI/g) || []).length, 0, 'no Ask Fujin AI link');
  assert.equal((html.match(/Book now/g) || []).length, 0, 'no Book now anywhere');
  assert.ok(html.includes('href="/chat"'), 'the AI pill leads to /chat');
  // Trust strip (spec 1c): three honest lines, no invented numbers.
  assert.ok(html.includes('All-in prices — the price you see is the price you pay'), 'trust: all-in prices');
  assert.ok(html.includes('No hidden fees — our flight service fee is shown separately at checkout'), 'trust: no hidden fees');
  assert.ok(html.includes('Compare prices from different sources'), 'trust: compare prices');
  // Browse sections below the hero.
  assert.ok(html.includes('Popular destinations'), 'Popular destinations renders');
  assert.ok(html.includes('What do you need for your trip?'), 'category tiles render');
  assert.ok(html.includes('Weekend trips near you'), 'Near you renders');
  assert.ok(html.includes('Featured hidden gems'), 'hidden gems render');
  assert.ok(html.includes("Travelers' stories"), 'community stories render');
  assert.ok(html.includes('Show more destinations'), 'the destinations expander renders');
  assert.ok(html.includes('per traveler'), 'destination cards carry a per-traveler price line');
  // NO results before a search — the results shell renders only after
  // the widget submits (direction v3: results-on-load is gone). The
  // package cards DO have their own "Save this search" (see the
  // restructure test below) — what must not render is the results UI.
  assert.ok(!html.includes('Planning estimates from FujinTrip'), 'no results honesty header before a search');
  assert.ok(!html.includes('result-body'), 'no result cards before a search');
  assert.ok(!html.includes('Checking live fares'), 'no live-fares loading state before a search');
  // The chat shell, panel and map live on /chat only.
  assert.ok(!html.includes('fujin-chat'), 'no chat panel on the homepage');
  assert.ok(!html.includes('chat-shell'), 'no chat shell on the homepage');
  assert.ok(!html.includes('trippanel'), 'no trip panel on the homepage');
  assert.ok(!html.includes('mapcol'), 'no map column on the homepage');
  // The old homepage is gone: no hero-to-chat seeding, no link box.
  assert.ok(!html.includes('Start from a link'), 'no Start from a link section');
  assert.ok(!html.includes('Paste a link or article text'), 'no link box');
  assert.ok(html.includes('My Trips'), 'My Trips stays on the homepage');
});

test('homepage hero is white: no background photo, no rotation, headline + sub + widget render', async () => {
  const r = await fetch(`${BASE}/`);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  // The hero is the theme surface itself — no photo markup anywhere
  // in the hero section, and no rotation machinery in the HTML.
  assert.ok(html.includes('hero-booking'), 'hero section renders');
  assert.ok(html.includes('Where to?'), 'hero headline renders');
  assert.ok(html.includes('Flights, stays, cars, tours and more'), 'hero sub renders');
  assert.ok(!html.includes('hero-rotator'), 'no rotator in the hero');
  assert.ok(!html.includes('hero-slide'), 'no rotator slides');
  assert.ok(!html.includes('hero-dots'), 'no dot indicators');
  assert.ok(!html.includes('hero-dot'), 'no dot buttons');
  assert.ok(!html.includes('aria-label="Show Kyoto photo"'), 'no Kyoto dot');
  assert.ok(!html.includes('aria-label="Show Prague photo"'), 'no Prague dot');
  // The Kyoto photo still renders on the homepage — but only as the
  // Kyoto destination card, not as a hero background.
  assert.ok(html.includes('photo-1493976040374-85c8e12f0c0e'), 'Kyoto card photo still renders');
});

test('footer pages: /about, /faq and /contact are real pages, and the footer links to them (defect, Nov 15 2026)', async () => {
  const home = await (await fetch(`${BASE}/`)).text();
  for (const href of ['href="/about"', 'href="/contact"', 'href="/faq"', 'href="/faq#cancellation"']) {
    assert.ok(home.includes(href), `homepage footer links ${href}`);
  }
  const about = await fetch(`${BASE}/about`);
  assert.equal(about.status, 200);
  const aboutHtml = await about.text();
  assert.ok(aboutHtml.includes('About FujinTrip'), 'About page renders');
  assert.ok(aboutHtml.includes('one-stop travel platform'), 'About says what FujinTrip is');
  const faq = await fetch(`${BASE}/faq`);
  assert.equal(faq.status, 200);
  const faqHtml = (await faq.text()).replace(/&#x27;/g, "'");
  assert.ok(faqHtml.includes('Frequently asked questions'), 'FAQ page renders');
  assert.ok(faqHtml.includes('id="cancellation"'), 'FAQ has the cancellation anchor the footer links to');
  assert.ok(faqHtml.includes('take bookings yet'), 'cancellation answer is honest — no bookings yet');
  assert.ok(faqHtml.includes('fujintrip@gmail.com'), 'FAQ points at the real mailbox');
  const contact = await fetch(`${BASE}/contact`);
  assert.equal(contact.status, 200);
  const contactHtml = await contact.text();
  assert.ok(contactHtml.includes('Contact us'), 'Contact page renders');
  assert.ok(contactHtml.includes('mailto:fujintrip@gmail.com'), 'Contact links the real mailbox');
});

test('tabs: ?tab=flights shows the Flights form, still no results before a search', async () => {
  const r = await fetch(`${BASE}/?tab=flights`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Search flights'), 'the Flights search form renders');
  assert.ok(!html.includes('Search stays'), 'the Stays form waits for its tab');
  assert.ok(!html.includes('Planning estimates from FujinTrip'), 'no results before a search');
  // The package cards have their own "Save this search" — what must
  // not render is the results UI (see the restructure test).
  assert.ok(!html.includes('result-body'), 'no result cards before a search');
});

test('search deep link: flights with dates renders the results shell — budget, loading states, per-route estimates, honesty labels', async () => {
  const r = await fetch(`${BASE}/?tab=flights&from=New%20York&to=Central%20Europe&depart=2027-01-04&return=2027-01-17&travelers=2`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes('Planning estimates from FujinTrip'), 'the results honesty header renders');
  assert.ok(html.includes('Plan flight budget'), 'the planner flight budget line renders');
  assert.ok(html.includes('$1,512'), 'the Central Europe flight budget is $1,512 for 2 travelers');
  assert.ok(html.includes('Checking live fares'), 'the live-fares fetch shows its loading state');
  // The competitor column starts client-side (its state is 'idle'
  // until the effect fires), so its heading is not in the SSR HTML —
  // the API-level test below covers its honest empty state.
  assert.ok(!html.includes('Other sites (cached)'), 'the competitor column waits for the client fetch');
  assert.ok(html.includes('Flights by destination — planning estimates'), 'the per-route flight estimates render');
  assert.ok(html.includes('from $756 per traveler'), 'Central Europe flights from $756 per traveler');
  assert.ok(html.includes('planning estimate'), 'the estimates are labeled');
  assert.ok(html.includes('Save this search'), 'the primary action is Save this search');
  assert.ok(!html.includes('Book now'), 'no Book now in the results');
});

test('search deep link: a Business-cabin flight search labels the planner budget as the economy estimate (defect, Nov 15 2026)', async () => {
  // The planner budget is an economy figure — on a Business search
  // the line must say so instead of printing a $630 economy budget
  // next to business fares. The figure itself is unchanged.
  const r = await fetch(`${BASE}/?tab=flights&from=New%20York&to=Central%20Europe&depart=2027-01-04&return=2027-01-17&travelers=2&cabin=Business`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes('Plan flight budget (economy estimate)'), 'the Business search names the economy estimate');
  assert.ok(html.includes('$1,512'), 'the figure is still the economy budget');
});

test('search deep link: stays with dates renders per-destination rows with Best value labels and the map toggle', async () => {
  const r = await fetch(`${BASE}/?tab=hotels&dest=Central%20Europe&depart=2027-01-04&return=2027-01-17&guests=2&rooms=1`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Planning estimates from FujinTrip'), 'the results honesty header renders');
  assert.ok(html.includes('from $594 per traveler'), 'Central Europe stays from $594 per traveler');
  assert.ok(html.includes('Best value · planning estimate'), 'the rows are labeled planning estimates');
  assert.ok(html.includes('Show on map'), 'the Stays map toggle renders');
  assert.ok(html.includes('Save this search'), 'the primary action is Save this search');
});

test('search deep link: flights with off-suggested dates shows the SEARCHED dates in the heading (live defect, Nov 14 2026)', async () => {
  // The live check searched Jan 15–22 and got a heading dated Jan 4–11
  // — the planner's suggested start — because the heading derived its
  // dates from suggestedStart instead of the search. The heading must
  // carry the searched dates.
  const r = await fetch(`${BASE}/?tab=flights&from=New%20York&to=Central%20Europe&depart=2027-01-15&return=2027-01-22&travelers=2`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes('2027-01-15 – 2027-01-22'), 'the heading shows the searched Jan 15–22 dates');
  assert.ok(!html.includes('2027-01-04 – 2027-01-11'), 'the heading never shows the suggested Jan 4–11 dates for this search');
  assert.ok(html.includes('Plan flight budget'), 'the planner flight budget line still renders');
  // The map toggle (defect, Nov 14 2026): the live flights results
  // page had no "map" at all — the toggle existed only on Stays.
  assert.ok(html.includes('Show on map'), 'the flights results keep the map toggle, like Stays');
  // The stray "Book-now read" paragraph (defect, Nov 14 2026): it
  // read as stray copy on the results page. The API still returns
  // the line — the chat's trip card uses it — but results never show it.
  assert.ok(!html.includes('Book-now read:'), 'no Book-now read paragraph on the results page');
});

test('search deep link: flights offers Shortest first and Earliest departure sorts (Flights section build, Nov 15 2026)', async () => {
  // The sort re-orders the live fare lists, not just the estimate
  // rows — so the options have to exist on the flights results.
  const r = await fetch(`${BASE}/?tab=flights&from=New%20York&to=Central%20Europe&depart=2027-01-15&return=2027-01-22&travelers=2`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Shortest first'), 'the Shortest first sort is offered');
  assert.ok(html.includes('Earliest departure'), 'the Earliest departure sort is offered');
  assert.ok(html.includes('Best value first'), 'Best value first stays');
  assert.ok(html.includes('Cheapest first'), 'Cheapest first stays');
});

test('search deep link: flights with past dates falls back to flexible dates (Flights section build, Nov 15 2026)', async () => {
  // A shared link from last year is a stale link: the past dates
  // drop in the parser, the search falls back to the planner's
  // suggested dates, and the results still render — the page never
  // shows fares for dates that have already passed. The raw dates
  // still sit in Next.js's embedded router payload (framework
  // plumbing, not content), so the check strips <script> blocks and
  // asserts on the visible page.
  const r = await fetch(`${BASE}/?tab=flights&from=New%20York&to=Central%20Europe&depart=2020-01-04&return=2020-01-17&travelers=2`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(!visible.includes('2020-01-04'), 'the past departure never appears in visible content');
  assert.ok(!visible.includes('2020-01-17'), 'the past return never appears in visible content');
  assert.ok(visible.includes('aria-label="Departure date" value=""'), 'the Depart field is empty, not pre-filled with a past date');
  assert.ok(visible.includes('aria-label="Return date" value=""'), 'the Return field is empty, not pre-filled with a past date');
  assert.ok(html.includes('Plan flight budget'), 'the results still render with the planner budget');
  assert.ok(html.includes('Save this search'), 'the primary action is still Save this search');
});

test('search deep link: cruises renders the honest not-broken-out note and full-trip totals', async () => {
  const r = await fetch(`${BASE}/?tab=cruises&dest=Central%20Europe&month=1&travelers=2`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes("aren't broken out"), 'the gap is named');
  assert.ok(html.includes('Full trip · planning estimate'), 'the rows say they are full-trip totals');
  assert.ok(html.includes('from $1,800 per traveler'), 'Central Europe full trip $1,800 per traveler');
  assert.ok(html.includes('Save this search'), 'the primary action is Save this search');
});

test('tabs: ?tab=bogus falls back to Flights', async () => {
  const r = await fetch(`${BASE}/?tab=bogus`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Search flights'), 'a bad tab param falls back to Flights');
  assert.ok(!html.includes('Search stays'), 'the Stays form waits for its tab');
});

test('tabs: ?tab=hotels still lands on Stays — deep links override the Flights default', async () => {
  const r = await fetch(`${BASE}/?tab=hotels`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Search stays'), 'the Stays search form renders for ?tab=hotels');
  assert.ok(!html.includes('Search flights'), 'the Flights form waits for its tab');
});

test('chat page: renders the chat panel and exactly one Plan with AI pill', async () => {
  const r = await fetch(`${BASE}/chat`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('fujin-chat'), 'chat page renders the chat panel');
  assert.equal((html.match(/Plan with AI/g) || []).length, 1, 'exactly one Plan with AI pill on /chat');
});

test('tabs: price-check without a key is honestly empty (the API the Flights tab calls)', async () => {
  const r = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14 }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.live, false);
  assert.equal(j.reason, 'no_key');
  assert.deepEqual(j.out, []);
  assert.deepEqual(j.back, []);
  assert.equal(j.plannerFlight, 1512, 'the plan flight budget still stands');
  assert.equal(j.destCity, 'Prague');
  assert.equal(j.departDate, '2027-01-04');
  assert.equal(j.returnDate, '2027-01-17');
});

test('tabs: price-check with explicit searched dates checks THOSE dates, not the planner suggestion', async () => {
  const r = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 8, depart: '2027-01-15', return: '2027-01-22' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.live, false);
  assert.equal(j.departDate, '2027-01-15', 'the checked depart is the searched date');
  assert.equal(j.returnDate, '2027-01-22', 'the checked return is the searched date');
  // Junk dates fall back to the planner suggestion, never crash.
  const bad = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14, depart: 'soon', return: 'later' }),
  });
  assert.equal(bad.status, 200);
  const bj = await bad.json();
  assert.equal(bj.departDate, '2027-01-04');
  assert.equal(bj.returnDate, '2027-01-17');
});

test('tabs: price-check carries the picked cabin and the Duffel mode (the Flights tab wiring)', async () => {
  // The Cabin select used to stop at the UI: the Offer Request always
  // asked for economy, so a Business search returned economy fares.
  // The check now echoes the cabin it asked Duffel for, and the mode
  // the configured key implies — test here (no key in this env).
  const r = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14, cabin: 'Business' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.live, false);
  assert.equal(j.reason, 'no_key');
  assert.equal(j.cabin, 'business', 'the Business cabin travels through to the check');
  assert.equal(j.mode, 'test', 'no key means test mode');
  // A junk cabin falls back to economy, never crashes the check.
  const bad = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14, cabin: 'Rocket' }),
  });
  assert.equal(bad.status, 200);
  const bj = await bad.json();
  assert.equal(bj.cabin, 'economy', 'a junk cabin falls back to economy');
  assert.equal(bj.mode, 'test');
});

test('tabs: one-way price-check asks for the outbound slice only — no return is fetched or invented', async () => {
  const r = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripType: 'oneway', origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 8, depart: '2027-01-15', cabin: 'Economy' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.tripType, 'oneway');
  assert.equal(j.live, false);
  assert.equal(j.reason, 'no_key');
  assert.deepEqual(j.out, []);
  assert.deepEqual(j.back, [], 'a one-way check has no return list');
  assert.equal(j.returnDate, '', 'a one-way check has no return date');
  assert.equal(j.departDate, '2027-01-15', 'the checked depart is the searched date');
  assert.deepEqual(j.legs, []);
  // A one-way call with no depart falls back to the planner suggestion, never crashes.
  const nodate = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripType: 'oneway', origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14 }),
  });
  assert.equal(nodate.status, 200);
  const nj = await nodate.json();
  assert.equal(nj.tripType, 'oneway');
  assert.equal(nj.departDate, '2027-01-04');
  assert.equal(nj.returnDate, '');
});

test('tabs: multi-city price-check runs one one-way request per leg', async () => {
  const r = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tripType: 'multicity',
      legs: [
        { origin: 'New York', destination: 'London', date: '2027-01-15' },
        { origin: 'London', destination: 'Paris', date: '2027-01-20' },
      ],
      travelers: 2,
      cabin: 'Economy',
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.tripType, 'multicity');
  assert.equal(j.live, false);
  assert.equal(j.legs.length, 2, 'one entry per leg');
  assert.equal(j.legs[0].origin, 'New York');
  assert.equal(j.legs[0].destination, 'London');
  assert.equal(j.legs[0].destCity, 'London');
  assert.equal(j.legs[0].date, '2027-01-15');
  assert.equal(j.legs[0].live, false);
  assert.equal(j.legs[0].reason, 'no_key');
  assert.deepEqual(j.legs[0].out, []);
  assert.equal(j.legs[1].destCity, 'Paris');
  assert.equal(j.departDate, '2027-01-15', 'the trip starts on leg 1');
  assert.equal(j.returnDate, '2027-01-20', 'the trip ends on the last leg');
  assert.equal(j.liveTotal, 0, 'no fare on any leg, no combined total');
  // Fewer than 2 clean legs is not a multi-city search — honestly empty.
  const one = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripType: 'multicity', legs: [{ origin: 'New York', destination: 'London', date: '2027-01-15' }], travelers: 2 }),
  });
  assert.equal(one.status, 200);
  const oj = await one.json();
  assert.equal(oj.live, false);
  assert.equal(oj.reason, 'missing_slots');
  assert.deepEqual(oj.legs, []);
});

test('tabs: round-trip price-check still carries tripType roundtrip and no legs', async () => {
  const r = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14 }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.tripType, 'roundtrip', 'a call with no tripType is a round-trip');
  assert.deepEqual(j.legs, []);
  // A junk tripType falls back to round-trip, never crashes the check.
  const junk = await fetch(`${BASE}/api/price-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripType: 'teleport', origin: 'New York', destination: 'Central Europe', travelers: 2, month: 1, durationDays: 14 }),
  });
  assert.equal(junk.status, 200);
  const jj = await junk.json();
  assert.equal(jj.tripType, 'roundtrip');
  assert.equal(jj.live, false);
});

test('tabs: the Flights form offers all three trip types in the rendered page', async () => {
  const r = await fetch(`${BASE}/?tab=flights`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('Round-trip'), 'the form offers round-trip');
  assert.ok(html.includes('One-way'), 'the form offers one-way');
  assert.ok(html.includes('Multi-city'), 'the form offers multi-city');
  assert.ok(html.includes('Trip type'), 'the trip-type control is labeled');
});

test('service worker serves with the cache version', async () => {
  const r = await fetch(`${BASE}/sw.js`);
  assert.equal(r.status, 200);
  const js = await r.text();
  assert.ok(js.includes('fujintrip-v1'), 'worker carries the cache version');
  assert.ok(js.includes('/api/reels/media/'), 'worker caches reel media, not live API routes');
});

test('plan-share: invalid snapshot is rejected, valid one round-trips', async () => {
  const bad = await fetch(`${BASE}/api/plan-share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 9, destination: 'Kyoto' }),
  });
  assert.equal(bad.status, 400);

  const card = buildTripCard({ destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York' });
  assert.ok(card);
  const snap = snapshotFor(card, { destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York', choice: 1 });
  const created = await fetch(`${BASE}/api/plan-share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snap),
  });
  assert.equal(created.status, 200);
  const { id, url } = await created.json();
  assert.ok(typeof id === 'string' && id.length >= 6, 'share id returned');
  assert.equal(url, `/plan/${id}`);

  const fetched = await fetch(`${BASE}/api/plan-share?id=${encodeURIComponent(id)}`);
  assert.equal(fetched.status, 200);
  const back = await fetched.json();
  assert.equal(back.destination, 'Kyoto');
  assert.equal(back.card.title, card.title);

  const missing = await fetch(`${BASE}/api/plan-share?id=nope123`);
  assert.equal(missing.status, 404);
});

test('shared plan page renders the trip without a login wall', async () => {
  const card = buildTripCard({ destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York' });
  const snap = snapshotFor(card, { destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York', choice: 1 });
  const created = await fetch(`${BASE}/api/plan-share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snap),
  });
  const { id } = await created.json();
  const page = await fetch(`${BASE}/plan/${id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Kyoto'), 'shared page shows the destination');
  assert.ok(html.includes('Plan this trip'), 'shared page offers the plan-this-trip path');
  assert.ok(!html.toLowerCase().includes('sign in to view'), 'no login wall on a shared plan');

  const gone = await fetch(`${BASE}/plan/does-not-exist`);
  assert.equal(gone.status, 404);
});

// --- Travelers' reels (community round, design §6) ----------------------
// Full flow against the live routes: upload a generated 1×1 PNG, create
// a post, read it in the feed and on its own page, check the OG share
// target, check the wrong-token edit is rejected, then report it three
// times and confirm it leaves the feed. The reported post is cleaned up
// by the report flow itself (under_review — hidden from the feed).
test('reels: upload, post, feed, OG page, wrong-token edit, report-hide', async () => {
  // A 1×1 transparent PNG, generated here — no fixture file needed.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'kyoto.png');
  form.append('alt', 'A quiet street in Kyoto at dawn');
  form.append('destination', 'Kyoto');
  const upload = await fetch(`${BASE}/api/reels/upload`, { method: 'POST', body: form });
  assert.equal(upload.status, 200, 'upload succeeds');
  const uploadJson = await upload.json();
  const media = uploadJson.media;
  assert.equal(media.kind, 'photo');
  assert.equal(media.storage, 'local-dev', 'Spaces is not configured here, so the store says so');
  assert.ok(uploadJson.note.includes('not configured') || uploadJson.note.includes('this server'), 'the storage note is honest');

  const created = await fetch(`${BASE}/api/reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author: 'Mina',
      destination: 'Kyoto',
      routeLine: 'Kyoto',
      month: 1,
      caption: 'Go early, before the crowds — the bamboo grove at 7am.',
      overallRating: 5,
      media: [media],
      tripId: 'trip-test',
      tripLabel: 'Kyoto plan',
      verified: true,
    }),
  });
  assert.equal(created.status, 201, 'post is created');
  const createdJson = await created.json();
  const post = createdJson.post;
  assert.equal(post.moderation, 'published', 'a clean post auto-publishes to the feed');
  assert.equal(post.verified, true, 'a booked trip earns the badge');
  assert.equal(typeof createdJson.posterToken, 'string', 'the poster token is returned once');
  assert.ok(!('posterToken' in post), 'the token is not part of the public post');

  const feed = await fetch(`${BASE}/api/reels?view=feed&destination=Kyoto`);
  assert.equal(feed.status, 200);
  const feedJson = await feed.json();
  assert.ok(feedJson.posts.some((p) => p.id === post.id), 'the new post is in the feed');

  const single = await fetch(`${BASE}/api/reels/${post.id}`);
  assert.equal(single.status, 200);
  const singleJson = await single.json();
  assert.equal(singleJson.post.caption, 'Go early, before the crowds — the bamboo grove at 7am.');

  // The wrong token cannot edit the post.
  const badEdit = await fetch(`${BASE}/api/reels/${post.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption: 'Hijacked.', posterToken: 'wrong-token' }),
  });
  assert.equal(badEdit.status, 403, 'editing needs the poster token');

  // The OG share target renders the post with its route and price.
  const page = await fetch(`${BASE}/reels/${post.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Kyoto'), 'share page shows the destination');
  assert.ok(html.includes('Plan this trip'), 'share page offers the plan-this-trip path');
  assert.ok(html.includes('og:title') || html.includes('property="og:title"'), 'share page carries the OG card');

  // The feed page itself renders.
  const feedPage = await fetch(`${BASE}/reels`);
  assert.equal(feedPage.status, 200);
  assert.ok((await feedPage.text()).includes('reels'), 'feed page renders');

  // Three reports auto-hide the post from the feed.
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}/api/reels/${post.id}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Not a real trip' }),
    });
    assert.equal(r.status, 200, `report ${i + 1} accepted`);
    const rj = await r.json();
    // The reporter hides it on their own device immediately (client-side);
    // the server hides it from the feed only at the 3-report threshold.
    assert.equal(rj.hidden, i === 2, `report ${i + 1} hidden flag`);
  }
  const feedAfter = await fetch(`${BASE}/api/reels?view=feed&destination=Kyoto`);
  const feedAfterJson = await feedAfter.json();
  assert.ok(!feedAfterJson.posts.some((p) => p.id === post.id), 'three reports hide the post from the feed');

  // The review queue sees it as under review (the human step).
  const queue = await fetch(`${BASE}/api/reels/review`);
  assert.equal(queue.status, 200);
  const queueJson = await queue.json();
  assert.ok(queueJson.queue.some((q) => q.id === post.id && q.moderation === 'under_review'), 'the queue lists it for a human');
  assert.ok(queueJson.auth.startsWith('not_configured'), 'review auth is honestly labeled unset');
});

test('reels: the strip is empty until a human approves a verified post, and a flagged post waits in the queue', async () => {
  const strip = await fetch(`${BASE}/api/reels?view=strip&destination=Kyoto`);
  assert.equal(strip.status, 200);
  const stripJson = await strip.json();
  assert.equal(Array.isArray(stripJson.posts), true);
  assert.ok(stripJson.average, 'the strip answers with its average line');
  assert.ok(typeof stripJson.average.count === 'number');

  const flagged = await fetch(`${BASE}/api/reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author: 'Spammer',
      destination: 'Kyoto',
      routeLine: 'Kyoto',
      month: 1,
      caption: 'Double your money with free crypto now — see my link!',
      media: [{ id: 'mx', kind: 'photo', url: '/api/reels/media/mx', storage: 'local-dev', alt: 'Photo' }],
    }),
  });
  assert.equal(flagged.status, 201);
  const flaggedJson = await flagged.json();
  assert.equal(flaggedJson.post.moderation, 'pending_review', 'a flagged caption waits for a human');
  const feed = await fetch(`${BASE}/api/reels?view=feed&destination=Kyoto`);
  const feedJson = await feed.json();
  assert.ok(!feedJson.posts.some((p) => p.id === flaggedJson.post.id), 'a flagged post is not in the feed');
  const queue = await fetch(`${BASE}/api/reels/review`);
  const queueJson = await queue.json();
  assert.ok(queueJson.queue.some((q) => q.id === flaggedJson.post.id), 'a flagged post is in the queue');
});

test('chat-first layout: full-bleed shell, app bar, wrapped chips, short placeholders', async () => {
  const r = await fetch(`${BASE}/chat`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // The chat section is full-bleed (chat-shell), not the 1080px .wrap;
  // the app bar is the top strip now — the slim hero was folded into
  // it, so it no longer pushes the app down. The old hero CTA is gone
  // — but the chat's own send action reads "Start planning" at S0
  // (first-screen rebuild, Nov 13), so the first screen still has
  // one clear action.
  assert.ok(html.includes('chat-shell'), 'the chat shell is full-bleed');
  assert.ok(html.includes('appbar'), 'the app bar renders');
  assert.ok(!html.includes('hero-slim'), 'the slim hero is gone — folded into the app bar');
  assert.ok(html.includes('My Trips'), 'the My Trips switcher renders in the app bar');
  assert.ok(html.includes('panel chat-panel'), 'the chat panel drops the bordered card');
  assert.ok(html.includes('Start planning'), 'the S0 send action reads Start planning');
  // Three starter chips (interface round M4) — the old fourth chip
  // ("Family of 4, $2,000") is gone; the chips wrap to two rows.
  for (const label of ['Central Europe in January', 'Warm beach in February', 'Surprise me']) {
    assert.ok(html.includes(label), `starter chip "${label}" renders`);
  }
  assert.ok(!html.includes('Family of 4, $2,000'), 'the fourth starter chip is gone');
  // Short placeholders — the old ones were cut off by the Send button.
  assert.ok(html.includes('Try: Bali, 2 travelers, surf and food'), 'the chat placeholder is short');
  assert.ok(html.includes('Paste a link or article text'), 'the link placeholder is short');
  assert.ok(!html.includes('next spring, $2,000'), 'the old long placeholder is gone');
  // The empty map placeholder is gone (interface round M1) — at S0 the
  // map simply does not render, so there is no "Your trip map" heading.
  assert.ok(!html.includes('Your trip map'), 'the empty map placeholder is gone');
  assert.ok(!html.includes('map-placeholder'), 'no map placeholder markup at S0');
});

test('interface round S0: only the chat renders — panel, map, zonebar, Book all gated (M1/M3)', async () => {
  // SSR-visible markers only — the panel's editable timeline, the
  // switcher menu and the map dialog mount client-side, so they are
  // covered by the pure-helper unit tests and the build, not by SSR.
  const r = await fetch(`${BASE}/chat`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // The chat zone renders, centered (chatmap-s0) — it is the only zone.
  assert.ok(html.includes('chatcol'), 'the chat zone renders');
  assert.ok(html.includes('chatmap-s0'), 'the S0 chat is centered at max 720px');
  assert.ok(html.includes('data-zone="chat"'), 'the chat zone is the default');
  // Nothing else renders before its data exists: no trip panel (and no
  // "No trip yet" empty state), no map column, no zone switcher — at S0
  // there is only one zone, so there is nothing to switch between.
  assert.ok(!html.includes('trippanel'), 'the trip panel does not render before a plan exists');
  assert.ok(!html.includes('No trip yet'), 'the panel empty state is gone');
  assert.ok(!html.includes('mapcol'), 'the map zone does not render before a route exists');
  assert.ok(!html.includes('zonebar'), 'the zone switcher does not render with one zone');
  assert.ok(!html.includes('zonebar-btn'), 'no zone button renders at S0 (the "Trip" in "FujinTrip" is the logo, not a zone button)');
  // The site header is gone (first-screen rebuild, Nov 13) — one bar,
  // brand once: the app bar is the only header at first paint. (The
  // privacy page keeps its own topbar; this is the homepage.)
  assert.ok(!html.includes('topbar'), 'the site header is gone — one bar, brand once');
  assert.ok(!html.includes('Quality + affordable prices'), 'the site-header tagline is gone with it');
  // The app bar has no total and no Book at S0 (M3) — the first screen
  // is the chat, not a price.
  assert.ok(!html.includes('appbar-book'), 'the app bar Book action does not render before a plan exists');
  assert.ok(!html.includes('appbar-total'), 'the app bar total does not render before a trip exists');
  // The 8-tab bar is gone (M2) — one quiet "Prefer forms?" disclosure
  // under the chat input instead.
  assert.ok(!html.includes('class="tabs"'), 'the 8-tab bar is gone');
  assert.ok(html.includes('Prefer forms?'), 'the Prefer forms disclosure renders');
  // The greeting is a headline, not a bubble (S0) — and since the
  // first-screen rebuild it is a SHORT headline: two lines of promise,
  // not a paragraph explaining the product, and the tiers leave the
  // first screen entirely.
  assert.ok(html.includes('bubble greeting'), 'the S0 greeting renders as a headline');
  assert.ok(html.includes('Tell me where. I’ll plan the rest.'), 'the S0 greeting is a short headline');
  assert.ok(!html.includes('I’ll gather flights, hotels, cars'), 'the old paragraph greeting is gone');
  assert.ok(!html.includes('Gathers everything into one plan'), 'the S0 tagline is gone from the first screen');
  // One hero photo beside the chat (first-screen rebuild) — the
  // Kyoto torii gates, the template photo already in lib/data.ts.
  assert.ok(html.includes('hero-photo'), 'the S0 hero photo renders');
  assert.ok(html.includes('photo-1493976040374-85c8e12f0c0e'), 'the hero photo is Kyoto');
  // Chips fill, don't fire (item 5): the starter chips carry their full
  // prompt as data-fill, and the input is what receives it.
  assert.ok(html.includes('data-fill="Surprise me"'), 'Surprise me chip carries data-fill');
  assert.ok(html.includes('data-fill="I want a warm beach in February"'), 'a starter chip carries its full prompt as data-fill');
  // Full-screen map (item 3): the hook is gone at S0 (interface round
  // M1) — "Open the map" appears with the map, not before it.
  assert.ok(!html.includes('Open the map'), 'Open the map does not render before the map exists');
});

test('interface round S0 busy budget: at most 10 interactive elements in the first viewport', async () => {
  // The budget (§4) is counted in the SSR HTML, not by eye: the first
  // viewport is the chat shell up to the below-the-fold tools — the
  // app bar + chat column + hero photo. "Prefer forms?" and "Start
  // from a link" moved below the fold (first-screen rebuild, Nov 13),
  // so the first viewport is now theme toggle, My Trips, input, Start
  // planning, 3 chips = 6. "Build my plan" is not counted — it appears
  // after the first message.
  const r = await fetch(`${BASE}/chat`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  const shellStart = html.indexOf('chat-shell');
  const foldStart = html.indexOf('below-fold-tools', shellStart);
  assert.ok(shellStart !== -1 && foldStart !== -1, 'the chat shell precedes the below-fold tools');
  const shell = html.slice(shellStart, foldStart);
  const interactive = shell.match(/<(button|input|select|textarea|a)([\s>])/g) || [];
  assert.ok(interactive.length <= 10, `S0 first viewport has ${interactive.length} interactive elements (budget 10): ${interactive.join(' ')}`);
  // And the one that must be there is.
  assert.ok(shell.includes('Start planning'), 'the Start planning action is in the first viewport');
  // "Prefer forms?" and "Start from a link" are NOT in the first
  // viewport — they live below the fold now — but they still exist on
  // the page, one scroll down.
  assert.ok(!shell.includes('Prefer forms?'), 'the forms disclosure is below the fold, not in the first viewport');
  assert.ok(!shell.includes('Start from a link'), 'the link card is below the fold, not in the first viewport');
  assert.ok(!shell.includes('Start from this'), 'the link action is below the fold, not in the first viewport');
  assert.ok(html.includes('Prefer forms?'), 'the forms disclosure still renders below the fold');
  assert.ok(html.includes('Start from a link'), 'the link card still renders below the fold');
  // "Build my plan" is NOT in the first viewport — it appears after
  // the first message, when there is a trip to build (progressive
  // reveal); with no trip yet it would build a Kyoto default nobody
  // asked for.
  assert.ok(!shell.includes('Build my plan'), 'Build my plan waits for the first message');
});

test('SOS: no SOS markup at S0 (minimal-first) — the button and sheet only exist with a trip', async () => {
  const r = await fetch(`${BASE}/chat`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // The SOS button lives in the trip panel, the Today view and the map
  // bar — all S1/S2 — and the sheet mounts only while open, so at S0
  // the first screen is the chat and nothing SOS-shaped is in the SSR.
  assert.ok(!html.includes('sos-btn'), 'no SOS button at S0');
  assert.ok(!html.includes('sosdialog'), 'no emergency sheet at S0');
  assert.ok(!html.includes('Emergency — get help'), 'no sheet label at S0');
  // But the stylesheet the page serves carries the SOS styles, so the
  // button renders styled the moment a trip exists.
  const cssHref = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  let css = '';
  if (cssHref) {
    css = await (await fetch(cssHref.startsWith('http') ? cssHref : `${BASE}${cssHref}`)).text();
  }
  if (!css.includes('.sos-btn')) {
    css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  }
  assert.ok(css.includes('.sos-btn'), 'stylesheet has the SOS button styles');
  assert.ok(css.includes('.sosdialog'), 'stylesheet has the emergency sheet styles');
  assert.ok(css.includes('.sos-missed'), 'stylesheet has the missed check-in banner');
});

test('popular destinations (direction v3): 8 cards + expander, per-traveler price lines, no filter pills, no pagination', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // Eight cards on load; the rest wait behind the expander (26 total).
  assert.ok(html.includes('Show more destinations (18 more)'), 'the expander counts the remaining 18');
  // The first 8 are the first discovery entries, so the standalone
  // destinations (Maldives, Paris) are not on it.
  assert.ok(!html.includes('>Maldives<'), 'Maldives waits behind the expander');
  assert.ok(!html.includes('>Paris<'), 'Paris waits behind the expander');
  // A card carries the per-traveler Best value price line, never a
  // counts line or a guessed rate. Central Europe is $3,600 for 2.
  assert.ok(html.includes('from $1,800 per traveler'), 'Central Europe card carries the per-traveler price line');
  assert.ok(html.includes('Best value · 2 travelers · planning estimate'), 'the price line is labeled a planning estimate');
  // The card action prefills the search widget — it never seeds the
  // chat, and the old library actions are gone.
  assert.ok(html.includes('Search this destination'), 'the card action prefills the search widget');
  assert.ok(!html.includes('Make it yours'), 'no Make it yours on the new cards');
  assert.ok(!html.includes('Plan this trip'), 'no Plan this trip on the homepage');
  // No filter pills, no pagination: the library is browse-only now.
  assert.ok(!html.includes('Filter packages by kind'), 'no filter pills group');
  assert.ok(!html.includes('All (26)'), 'no All pill');
  assert.ok(!html.includes('Page 1 of 3'), 'no pagination');
});

test('discovery map (direction v3): off the homepage, kept for the Stays results map toggle', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // The homepage is a search-and-browse site now — no map section.
  assert.ok(!html.includes('Where to go — explore the map'), 'no discovery map section on the homepage');
  assert.ok(!html.includes('Best month to go:'), 'no pin panel on the homepage');
  assert.ok(!html.includes('Central Europe · $3,600'), 'no pin chip list on the homepage');
  // The map survives where it belongs: the Stays results toggle.
  const stays = await fetch(`${BASE}/?tab=hotels&dest=Central%20Europe&depart=2027-01-04&return=2027-01-17&guests=2&rooms=1`);
  assert.equal(stays.status, 200);
  const staysHtml = await stays.text();
  assert.ok(staysHtml.includes('Show on map'), 'the Stays results keep the map toggle');
});

test('competitor fares: without a token the route stays honestly empty', async () => {
  // No TRAVELPAYOUTS_TOKEN in this environment, so the route must say
  // so — never an invented fare, and the token never leaks into the reply.
  const r = await fetch(`${BASE}/api/competitor-fares?origin=New%20York&destination=Central%20Europe&depart=2027-01-04&return=2027-01-17&travelers=2`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.available, false);
  assert.equal(j.configured, false);
  assert.equal(j.reason, 'not-configured');
  assert.equal(j.farePerTraveler, null);
  assert.equal(j.total, null);
  assert.ok(typeof j.label === 'string' && j.label.length > 0, 'an honest label is returned');
  assert.ok(!('token' in j), 'the route returns no token field (the label names the env var to set, never a value)');
  // Bad dates degrade the same way instead of erroring.
  const bad = await fetch(`${BASE}/api/competitor-fares?origin=New%20York&destination=Central%20Europe&depart=soon&return=later&travelers=2`);
  assert.equal(bad.status, 200);
  assert.equal((await bad.json()).available, false);
});

test('places endpoint: live suggestions for a prefix, honest empties for short and junk queries', async () => {
  // GET /api/places (API phase round 1): Travelpayouts autocomplete,
  // then Nominatim, then the known list. Any source may answer here —
  // what is pinned is the shape and the honesty, not the source.
  const r = await fetch(`${BASE}/api/places?q=lon`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.places), 'places is an array');
  assert.ok(j.places.length > 0, 'a real prefix suggests something');
  assert.ok(j.places.some((p) => p.name === 'London'), 'London suggests for "lon"');
  for (const p of j.places) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.value, 'string');
    assert.ok(['city', 'airport', 'region'].includes(p.kind), `kind is one of city/airport/region, got ${p.kind}`);
    if (p.iata !== undefined) assert.match(p.iata, /^[A-Z]{3}$/, 'an IATA code is only ever a real 3-letter code');
  }
  assert.ok(['travelpayouts', 'nominatim', 'known'].includes(j.source), `a source is named, got ${j.source}`);
  assert.ok(!('token' in j), 'no token ever leaks into the reply');
  // A route display name suggests from the known list even though no
  // live gazetteer knows "Central Europe" as a place.
  const central = await fetch(`${BASE}/api/places?q=Central%20Europe`);
  const cj = await central.json();
  assert.ok(cj.places.some((p) => p.name === 'Central Europe'), 'Central Europe suggests');
  // Short query: honest empty, no guessing from one letter.
  const short = await fetch(`${BASE}/api/places?q=x`);
  const sj = await short.json();
  assert.deepEqual(sj.places, []);
  assert.equal(sj.reason, 'type-more');
  const empty = await fetch(`${BASE}/api/places?q=`);
  assert.equal((await empty.json()).reason, 'type-more');
  // Junk: honest empty, never an invented place.
  const junk = await fetch(`${BASE}/api/places?q=Zzzqxwv`);
  const jj = await junk.json();
  assert.deepEqual(jj.places, []);
  assert.equal(jj.source, 'none');
  assert.equal(jj.reason, 'no-matches');
});

test('search widget: place fields are combobox type-aheads, the datalist is gone', async () => {
  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  assert.ok(!html.includes('fujin-places'), 'the hardcoded datalist is gone from the homepage');
  assert.ok(!html.includes('<datalist'), 'no datalist anywhere on the homepage');
  assert.ok(html.includes('role="combobox"'), 'place fields render as comboboxes');
  const flights = await fetch(`${BASE}/?tab=flights`);
  const fhtml = await flights.text();
  assert.equal((fhtml.match(/role="combobox"/g) || []).length, 2, 'Flights has two place fields (From + To)');
  assert.ok(fhtml.includes('aria-label="Flying from"'), 'From field is labelled');
  assert.ok(fhtml.includes('aria-label="Flying to"'), 'To field is labelled');
});

test('hero alt: the chat hero photo describes the Yasaka pagoda street, never torii gates', async () => {
  // The homepage hero is white now (Nov 15, 2026) — the Kyoto photo
  // lives on /chat, where its alt must still describe the actual
  // photo: the Yasaka pagoda street at sunset, not torii gates.
  const r = await fetch(`${BASE}/chat`);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes('Yasaka pagoda street at sunset, Kyoto'), 'hero alt describes the actual photo');
  assert.ok(!html.includes('Torii gates'), 'no torii-gates alt anywhere on /chat');
});

test('fujin: every reply carries liveFares (null here — no key, no trip slots), so the card can thread it', async () => {
  // No DUFFEL_API_KEY in this environment and no departure city in the
  // message, so no fares are fetched — but the key must be present in
  // the reply shape either way, because the client threads liveFares
  // into the trip card from every /api/fujin response. A missing key
  // would silently leave the card on planner estimates forever.
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Central Europe in January' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(typeof j.reply, 'string');
  assert.ok('liveFares' in j, 'liveFares key present in the reply');
  assert.equal(j.liveFares, null);
});

test('fujin: a multi-stop trip carries per-city voices (round 3 #1)', async () => {
  // Shape only, not content: the Wikivoyage fetch is live network and
  // may return empty under load — what must never break is the shape
  // the plan view renders (one entry per stop city, in route order).
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Central Europe in January, 14 days',
      tripState: { destination: 'Central Europe', travelers: 2, origin: 'New York', month: 1, durationDays: 14 },
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.cityVoices), 'cityVoices key present in the reply');
  assert.deepEqual(
    j.cityVoices.map((c) => c.city),
    ['Prague', 'Vienna', 'Budapest'],
    'one entry per stop city, in route order'
  );
  for (const c of j.cityVoices) {
    assert.equal(typeof c.voices.text, 'string', 'each city carries a voices text (possibly empty)');
  }
});

test('fujin: a tight passport expiry warns on the Europe Trip Summary (round 3 #5)', async () => {
  // The trip returns 2027-01-18 (first Monday of January 2027 + 14
  // days); a passport expiring March 2027 is only ~2 months past the
  // return, so the Schengen 3-month rule fails — the fallback reply
  // must carry the warning on the Trip Summary, and must never ask
  // for the passport number. The message is a fresh trip (no
  // tripState destination): with an established trip, a budget mention
  // is a budget REVISION and the reply is the budget fit, not the
  // Trip Summary — so the expiry rides in tripState alone.
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Central Europe in January for 14 days, flying from New York, budget $2000',
      tripState: { passportExpiry: { month: 3, year: 2027 } },
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.reply.includes('Passport check'), 'the warning is on the reply');
  assert.ok(j.reply.includes('denied boarding'), 'the consequence is named');
  assert.ok(!j.reply.toLowerCase().includes('passport number'), 'never asks for the number');
});

test('round 4 #1 pace: a relaxed-pace Tokyo trip warns about the packed day on the Trip Summary', async () => {
  // Tokyo day 1 has 6 experiences — over the relaxed max of 4, so the
  // fallback's Trip Summary must carry the pace warning (the guards
  // are built from the trip the fallback itself resolved, so a fresh
  // trip with all slots in one message warns too). The budget is in
  // the message so the guided flow reaches the summary instead of
  // asking for the budget; the pace slot rides in tripState.
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Tokyo in January for 3 days, flying from New York, relaxed pace, budget $3000',
      tripState: { preferences: { pace: 'slow' } },
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.reply.includes('Here is your trip —'), 'the reply is the Trip Summary');
  assert.ok(j.reply.includes('over pace'), 'the packed day is named');
  assert.ok(j.reply.includes('drop one, or add a day?'), 'the drop-one-or-add-a-day choice is offered');
});

test('round 4 #3 arrival: a 7am landing anchors Day 1 instead of a 3pm check-in', async () => {
  // The landing time rides in the message (the route parses it into
  // the guard slots), so Day 1 starts from 08:30 exploring — not
  // from the typical 3pm check-in.
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Tokyo in January for 3 days, flying from New York, landing at 7am, budget $3000',
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.reply.includes('Here is your trip —'), 'the reply is the Trip Summary');
  assert.ok(j.reply.includes('08:30'), 'Day 1 starts exploring at 08:30');
  assert.ok(j.reply.includes('3pm'), 'the 3pm check-in is named as the thing Day 1 does NOT start with');
});

test('round 4 #4 all-in: a Japan trip shows the real trip total on the Trip Summary', async () => {
  // The plan total is not the whole trip cost — the guards append the
  // all-in reality check, labeled as planning estimates, on the
  // summary itself.
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Japan in January for 10 days, flying from New York, budget $3000',
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.reply.includes('Here is your trip —'), 'the reply is the Trip Summary');
  assert.ok(j.reply.includes('All-in reality check'), 'the all-in line is on the summary');
  assert.ok(j.reply.includes('real trip total'), 'the real trip total is named');
  assert.ok(j.reply.includes('planning estimates'), 'the forgotten lines stay labeled estimates');
});

test('round 4 #5 feasibility: a clean trip says the check passed on the Trip Summary', async () => {
  // No day trip on a flight day and the audit passes — the summary
  // says so in one line, so the traveler sees the check happened.
  const r = await fetch(`${BASE}/api/fujin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Tokyo in January for 3 days, flying from New York, budget $3000',
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.reply.includes('Here is your trip —'), 'the reply is the Trip Summary');
  assert.ok(j.reply.includes('Feasibility: no flags'), 'the feasibility pass line is on the summary');
});

test('Layla-dynamic: motion CSS and map styles are served', async () => {
  // The library filter pills and Make-it-yours actions are gone with
  // direction v3 (the library is Popular destinations now). What
  // survives from the Layla-dynamic round is the motion system and
  // the map styles — both plain CSS in globals.css.
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const rawHtml = await r.text();
  // Motion: the served stylesheet carries the panel entrance and the
  // expandable-row transition — read it from the page's own stylesheet
  // link, falling back to the source file.
  const cssHref = rawHtml.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  let css = '';
  if (cssHref) {
    css = await (await fetch(cssHref.startsWith('http') ? cssHref : `${BASE}${cssHref}`)).text();
  }
  if (!css.includes('expandable-body')) {
    css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  }
  assert.ok(css.includes('expandable-body'), 'stylesheet has the expandable-row styles');
  assert.ok(css.includes('panel-in'), 'stylesheet has the panel-entrance keyframes');
  assert.ok(css.includes('.mapdialog'), 'stylesheet has the full-screen map dialog styles');
  // Modern map (Nov 13): the full-bleed map container and the floating
  // itinerary rail over it — plain CSS in globals.css, so the served
  // stylesheet (or the source fallback) carries them.
  assert.ok(css.includes('.map-fullbleed'), 'stylesheet has the full-bleed map container');
  assert.ok(css.includes('.map-rail'), 'stylesheet has the floating itinerary rail');
});

test('ground transport: checkout status lists the trains category with nothing live', async () => {
  // The registry now has 38 suppliers (31 + 7 new ground entries:
  // trainline-api, trainline-affiliate, omio, rail-europe, eurail,
  // karhoo, holidaytaxis). Nothing in it is live — the trains
  // category is tracked, not bookable, until the user's partner steps.
  const r = await fetch(`${BASE}/api/checkout`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.suppliers.total, 38);
  assert.equal(j.suppliers.live, 0);
  const ids = j.suppliers.states.map((s) => s.id);
  for (const id of ['trainline-api', 'trainline-affiliate', 'omio', 'rail-europe', 'eurail', 'karhoo', 'holidaytaxis']) {
    assert.ok(ids.includes(id), `checkout status lists ${id}`);
  }
  assert.equal(j.suppliers.states.find((s) => s.id === 'holidaytaxis').state, 'unavailable');
});

test('images: no img on / or /chat is display:none — the lazy + display:none deadlock (Nov 14)', async () => {
  // SafeImg/PhotoCarousel used to hide the not-yet-loaded image with
  // display:none; a lazy image with no layout box never intersects
  // the viewport, so the browser never fetches it and the shimmer
  // shows forever (0 decoded images on the homepage). The server
  // HTML carries the pre-load markup, so this pins the pattern there.
  for (const path of ['/', '/chat']) {
    const r = await fetch(`${BASE}${path}`);
    assert.equal(r.status, 200);
    const html = await r.text();
    const imgs = html.match(/<img[^>]*>/g) || [];
    assert.ok(imgs.length > 0, `${path} renders img tags`);
    for (const tag of imgs) {
      assert.ok(!/display\s*:\s*none/i.test(tag), `${path}: no img is display:none — ${tag.slice(0, 120)}`);
    }
    // The Kyoto photo URL is still present on the homepage — as the
    // Kyoto destination card, not a hero background (white hero,
    // Nov 15, 2026).
    if (path === '/') {
      assert.ok(html.includes('photo-1493976040374-85c8e12f0c0e'), 'Kyoto card photo renders on the homepage');
    }
  }
});

test('theme: the pre-paint script is in the served HTML, so the first paint already has the resolved theme', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('fujintrip-theme'), 'theme script sets the stored theme before paint');
  assert.ok(html.includes('data-theme'), 'theme script writes data-theme on <html>');
});

test('account gate: /sign-in and /sign-up render the not-set-up state with no Clerk keys (Nov 14)', async () => {
  // No Clerk keys are set in this environment, so the prebuilt forms
  // cannot render — the pages must say so plainly instead of crashing
  // or looping, and the guarded middleware must let the requests through.
  for (const path of ['/sign-in', '/sign-up']) {
    const r = await fetch(`${BASE}${path}`);
    assert.equal(r.status, 200, `${path} 200 without Clerk keys`);
    const html = await r.text();
    assert.ok(html.includes('isn'), `${path} explains sign-in isn't set up yet`);
    assert.ok(!html.includes('Missing publishable key'), `${path}: no Clerk key error`);
    assert.ok(!html.includes('Clerk: '), `${path}: no Clerk error text`);
  }
});

test('account gate: the homepage and /chat still work with no Clerk keys, and My Trips says sign-in is not set up (Nov 14)', async () => {
  for (const path of ['/', '/chat']) {
    const r = await fetch(`${BASE}${path}`);
    assert.equal(r.status, 200, `${path} 200 without Clerk keys`);
    const html = await r.text();
    assert.ok(!html.includes('Missing publishable key'), `${path}: no Clerk key error`);
    assert.ok(!html.includes('Clerk: '), `${path}: no Clerk error text`);
  }
  // The My Trips account box renders server-side with the honest
  // not-configured state — the gate never blocks the page itself.
  const home = await (await fetch(`${BASE}/`)).text();
  assert.ok(home.includes('Free account'), 'My Trips shows the free-account box');
  assert.ok(home.includes('sign-in isn'), 'My Trips says sign-in is not set up yet');
});

test('mobile: viewport meta is device-width and the hamburger is served', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('name="viewport"'), 'viewport meta is present');
  assert.ok(/content="width=device-width/.test(html), 'viewport is device-width');
  assert.ok(html.includes('Open menu'), 'the hamburger button is served with its label');
});

test('mobile: the served stylesheet carries the phone rules', async () => {
  const rawHtml = await (await fetch(`${BASE}/`)).text();
  const cssHref = rawHtml.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  let css = '';
  if (cssHref) {
    css = await (await fetch(cssHref.startsWith('http') ? cssHref : `${BASE}${cssHref}`)).text();
  }
  if (!css.includes('overflow-x:clip')) {
    css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  }
  assert.ok(css.includes('Mobile layout (Nov 15'), 'the mobile block is in the served stylesheet');
  assert.ok(css.includes('input,select,textarea{font-size:16px}'), '16px form fields at phone width');
  assert.ok(css.includes('.results-bar{flex-wrap:wrap'), 'the results bar wraps on a phone');
  assert.ok(css.includes('.results-bar{top:65px}'), 'the results bar clears the phone header');
});

test('homepage restructure: sections in order — packages, fares, deals, destinations, tiles, how it works, stories, voices, near you, trust (Nov 15 2026)', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  // The order is the restructure: the hero + widget first, then the
  // packages centerpiece, the fares strip, the deals, and only then
  // the browse sections — Travelers' stories moved up, the trust
  // strip now closes the page after My Trips.
  const order = [
    'Where to?',
    'Ready-made packages',
    'The lowest prices across our routes',
    'Our lowest prices this week',
    'Popular destinations',
    'What do you need for your trip?',
    'Plan, book, follow',
    "Travelers' stories",
    'What travelers say, from the places you go',
    'Weekend trips near you',
    'id="mytrips"',
    'All-in prices — the price you see is the price you pay',
  ];
  let prev = -1;
  for (const marker of order) {
    const i = html.indexOf(marker);
    assert.ok(i > prev, `${marker} renders after the previous section (at ${i}, prev ${prev})`);
    prev = i;
  }
});

test('homepage restructure: package cards are honest — planning estimates, Save first, never Book now (Nov 15 2026)', async () => {
  const r = await fetch(`${BASE}/`);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes('Pick a trip, ready to go'), 'packages heading renders');
  assert.ok(html.includes('Ready-made trips'), 'packages eyebrow renders');
  // 6 featured packages + 3 deals = 9 cards, each with both actions.
  assert.equal((html.match(/View package/g) || []).length, 9, '9 package cards render View package');
  assert.equal((html.match(/Save this search/g) || []).length, 9, '9 package cards render Save this search');
  // Every card price is a planning estimate — 9 cards + 8 fare chips.
  assert.ok((html.match(/planning estimate/g) || []).length >= 17, 'every package and fare-chip price is labeled planning estimate');
  assert.ok(html.includes('Planning estimates, not live quotes'), 'the fares strip says the estimates are not live quotes');
  assert.ok(html.includes('The lowest prices across our routes'), 'cheapest-fares strip renders');
  assert.ok(html.includes('Our lowest prices this week'), 'deals of the week renders');
  assert.ok(html.includes('How it works') || html.includes('Plan, book, follow'), 'how it works renders');
  assert.ok(html.includes('What travelers say, from the places you go'), 'local voices teaser renders');
  assert.equal((html.match(/Book now/g) || []).length, 0, 'no Book now on the packages either');
});

test('homepage restructure: no emoji icons anywhere in the served homepage (Nov 15 2026)', async () => {
  const r = await fetch(`${BASE}/`);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  for (const e of ['🏨', '✈️', '🚗', '🎡', '🚢', '🚌', '🚕', '✦', '☀', '☾', '☰', '✕']) {
    assert.ok(!html.includes(e), `homepage HTML has no ${e}`);
  }
  // The Lucide icons render as inline svg, not as text.
  assert.ok(html.includes('<svg'), 'icons render as svg');
});
