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

test('homepage hero: one question, one search box, 7 tabs, one big AI button, no Ask Fujin AI link, no chat shell', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  // One solid question + one search box (TripAdvisor model).
  assert.ok(html.includes('Where to?'), 'hero asks Where to?');
  assert.equal((html.match(/aria-label="Where to\?"/g) || []).length, 1, 'exactly one hero search box');
  assert.ok(html.includes('hero-ta-search'), 'hero search box renders');
  // Seven bookable categories as tabs, visible on page load under the hero.
  assert.equal((html.match(/role="tab"/g) || []).length, 7, '7 tabs');
  for (const label of ['Tours &amp; sightseeing', 'Flights', 'Hotels', 'Car rental', 'Cruises', 'Buses', 'Taxis']) {
    assert.ok(html.includes(label), `tab ${label} renders`);
  }
  // Exactly ONE AI entry point on the homepage — the big button under
  // the search box (direction v2). The header "Ask Fujin AI" link is
  // gone; the chat itself is not on this page.
  assert.equal((html.match(/Build full plan with AI/g) || []).length, 1, 'exactly one Build full plan with AI button');
  assert.equal((html.match(/Ask Fujin AI/g) || []).length, 0, 'no Ask Fujin AI link on the homepage');
  assert.ok(html.includes('href="/chat"'), 'the AI button leads to /chat');
  // The search box is a combobox: typing offers known destinations.
  assert.ok(html.includes('role="combobox"'), 'hero search is a combobox');
  assert.ok(html.includes('aria-controls="hero-suggestions"'), 'hero search controls the suggestions list');
  // The chat shell, panel and map live on /chat only.
  assert.ok(!html.includes('fujin-chat'), 'no chat panel on the homepage');
  assert.ok(!html.includes('chat-shell'), 'no chat shell on the homepage');
  assert.ok(!html.includes('trippanel'), 'no trip panel on the homepage');
  assert.ok(!html.includes('mapcol'), 'no map column on the homepage');
  // The Kyoto torii hero photo stays as the hero visual.
  assert.ok(html.includes('photo-1493976040374-85c8e12f0c0e'), 'the hero photo is Kyoto');
  // The booking section below the fold: tabs + link box.
  assert.ok(html.includes('id="book"'), 'booking section renders');
  assert.ok(html.includes('Paste a link or article text'), 'Start from a link is reachable below the fold');
});

test('tabs: Flights is the default panel — search form, planner flight budget, live-fares loading state', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // The default tab is Flights (the one with live data).
  assert.ok(html.includes('Search Flights'), 'the Flights search form renders');
  assert.ok(html.includes('Plan flight budget'), 'the planner flight budget line renders');
  assert.ok(html.includes('$1,512'), 'the Central Europe flight budget is $1,512 for 2 travelers');
  assert.ok(html.includes('Checking live fares'), 'the live-fares fetch shows its loading state');
  assert.ok(html.includes('Flights by destination'), 'the per-route flight estimates render');
  assert.ok(html.includes('from $756 per traveler'), 'Central Europe flights from $756 per traveler');
  assert.ok(html.includes('planning estimate'), 'the estimates are labeled');
  // The other panels do not render until their tab is picked.
  assert.ok(!html.includes('Search Hotels'), 'the Hotels form waits for its tab');
});

test('tabs: ?tab=hotels shows the Hotels panel with leg prices and planning-estimate labels', async () => {
  const r = await fetch(`${BASE}/?tab=hotels`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Search Hotels'), 'the Hotels search form renders');
  assert.ok(html.includes('from $594 per traveler'), 'Central Europe stays from $594 per traveler');
  assert.ok(html.includes('Best value · planning estimate'), 'the rows are labeled planning estimates');
  assert.ok(!html.includes('Search Flights'), 'the Flights form waits for its tab');
});

test('tabs: ?tab=cruises shows the honest not-connected note and full-trip estimates', async () => {
  const r = await fetch(`${BASE}/?tab=cruises`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
  assert.ok(html.includes('Search Cruises'), 'the Cruises search form renders');
  assert.ok(html.includes("aren't broken out"), 'the gap is named');
  assert.ok(html.includes('Full trip · planning estimate'), 'the rows say they are full-trip totals');
  assert.ok(html.includes('from $1,800 per traveler'), 'Central Europe full trip $1,800 per traveler');
});

test('tabs: ?tab=bogus falls back to Flights', async () => {
  const r = await fetch(`${BASE}/?tab=bogus`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  assert.ok(html.includes('Search Flights'), 'a bad tab param falls back to Flights');
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

test('template library (interface round S2): 26 cards, real filter counts, 12 per page', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // Filter pills carry real counts from the 26 library names — every
  // pill has cards behind it, none is empty.
  assert.ok(html.includes('All (26)'), 'All pill counts the 26 library entries');
  assert.ok(html.includes('Cities &amp; culture (22)') || html.includes('Cities & culture (22)'), 'Cities & culture pill with real count');
  assert.ok(html.includes('Beach &amp; islands (11)') || html.includes('Beach & islands (11)'), 'Beach & islands pill with real count');
  assert.ok(html.includes('Mountains &amp; nature (4)') || html.includes('Mountains & nature (4)'), 'Mountains & nature pill with real count');
  assert.ok(html.includes('Food (15)'), 'Food pill with real count');
  // Page 1 shows 12 cards; page 3 holds the last two standalone
  // destinations, so Maldives and Paris are not on page 1.
  assert.ok(html.includes('Page 1 of 3'), 'pagination renders Page 1 of 3');
  assert.ok(!html.includes('>Maldives<'), 'Maldives is on page 3, not page 1');
  assert.ok(!html.includes('>Paris<'), 'Paris is on page 3, not page 1');
  // A page-1 card carries the one-line counts shape: stays ·
  // transports · from $X total · Best value · 2 travelers · planning
  // estimate. Central Europe is the second discovery entry.
  assert.ok(html.includes('3 stays · 4 transports · from $3,600 total · Best value · 2 travelers · planning estimate'), 'Central Europe card carries the counts line');
  // The route line renders when there is more than one stop.
  assert.ok(html.includes('Prague → Vienna → Budapest'), 'Central Europe card carries the route line');
  // "Make it yours" is the primary CTA on every library card.
  assert.ok(html.includes('Make it yours'), 'the library cards offer Make it yours');
});

test('discovery map: section renders with a priced default pin and a Plan this trip action', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // React SSR puts comment separators between literal text and
  // expressions, so the checks run on the HTML with them stripped.
  assert.ok(html.includes('Where to go — explore the map'), 'the discovery section renders');
  // The default-selected pin is the first one (Europe): its essentials
  // are server-rendered — the route line, the best month, and the
  // planner's exact Best value total for 2 travelers.
  assert.ok(html.includes('Lisbon (3 nights)'), 'the default pin shows its route line');
  assert.ok(html.includes('Best month to go: May'), 'the default pin shows its best month');
  assert.ok(html.includes('from $4,400 total'), 'the default pin shows the planner price');
  assert.ok(html.includes('planning estimate'), 'the price is labeled a planning estimate');
  assert.ok(html.includes('not live quotes'), 'the section says the prices are not live quotes');
  // The chip list is the keyboard / small-screen way to pick a pin.
  assert.ok(html.includes('Central Europe · $3,600'), 'the chip list names a route with its price');
  assert.ok(html.includes('Plan this trip'), 'the essentials panel has the Plan this trip action');
  // The price bubbles themselves are client-only (Leaflet, ssr:false),
  // so they are not in the SSR HTML — their rendering needs the live
  // visual check after Deploy, not this test.
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

test('Layla-dynamic: filter pills, fill-don\'t-fire chips, map dialog hook and motion CSS are served', async () => {
  // SSR-visible markers only — the plan view's expandable rows and the
  // map dialog render client-side (after "Build my plan"), so they are
  // covered by the pure-helper unit tests and the build, not by SSR.
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const rawHtml = await r.text();
  // React SSR separates JSX text from expressions with comment markers
  // ("All (<!-- -->6<!-- -->)"), so strip them before matching text.
  const html = rawHtml.replace(/<!-- -->/g, '');
  // Template filters (interface round S2): honest pills with real
  // counts from the 26-card library — every pill has cards behind it,
  // including Mountains & nature (4: St. George, Tacoma, Hilo, Turkey).
  assert.ok(html.includes('Filter packages by kind'), 'filter pills group renders');
  assert.ok(html.includes('All (26)'), 'All pill counts the 26 library entries');
  assert.ok(html.includes('Cities &amp; culture (22)') || html.includes('Cities & culture (22)'), 'Cities & culture pill with real count');
  assert.ok(html.includes('Beach &amp; islands (11)') || html.includes('Beach & islands (11)'), 'Beach & islands pill with real count');
  assert.ok(html.includes('Food (15)'), 'Food pill with real count');
  assert.ok(html.includes('Mountains &amp; nature (4)') || html.includes('Mountains & nature (4)'), 'Mountains & nature pill with real count');
  assert.ok(!html.includes('Mountains &amp; nature (0)') && !html.includes('Mountains & nature (0)'), 'no empty category pill is rendered');
  // Templates are one click from the chat: every library card on page 1
  // (12) plus the discovery panel (1) and the hidden gems (3) offer
  // "Make it yours" — which seeds /chat with the trip.
  const makeItYours = (html.match(/Make it yours/g) || []).length;
  assert.equal(makeItYours, 16, `12 library cards + discovery panel + 3 hidden gems offer Make it yours (found ${makeItYours})`);
  // Motion (item 6): the served stylesheet carries the panel entrance
  // and the expandable-row transition — read it from the page's own
  // stylesheet link, falling back to the source file.
  const cssHref = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
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
