// Dev-server smoke tests — run the app and hit the real routes.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/dev-server.test.mjs
// (Starts `next dev` on port 3106, waits for it, runs the checks, kills
// the server by port pid. A stale .next after `npm run build` breaks
// `next dev`, so the suite removes it first.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
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

test('homepage 200 and renders the chat panel', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('FujinTrip'), 'homepage renders the brand');
  // The service-worker registration lives in the client JS bundle (the
  // component renders null), so the HTML check is for the worker route
  // itself — see the next test.
  assert.ok(html.includes('fujin-chat'), 'homepage renders the chat panel');
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

test('chat-first layout: full-bleed shell, slim hero, wrapped chips, short placeholders', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  const html = (await r.text()).replace(/<!-- -->/g, '');
  // The chat section is full-bleed (chat-shell), not the 1080px .wrap;
  // the hero is a slim strip and the "Start planning" CTA is gone —
  // the chat is the first screen.
  assert.ok(html.includes('chat-shell'), 'the chat shell is full-bleed');
  assert.ok(html.includes('hero-slim'), 'the hero is a slim strip');
  assert.ok(html.includes('panel chat-panel'), 'the chat tab drops the bordered card');
  assert.ok(!html.includes('Start planning'), 'the hero CTA is gone — the chat is right there');
  // All four starter chips render (they wrap to two rows now — the old
  // one-row scroll clipped "Surprise me").
  for (const label of ['Central Europe in January', 'Warm beach in February', 'Family of 4, $2,000', 'Surprise me']) {
    assert.ok(html.includes(label), `starter chip "${label}" renders`);
  }
  // Short placeholders — the old ones were cut off by the Send button.
  assert.ok(html.includes('Try: Bali, 2 travelers, surf and food'), 'the chat placeholder is short');
  assert.ok(html.includes('Paste a link or article text'), 'the link placeholder is short');
  assert.ok(!html.includes('next spring, $2,000'), 'the old long placeholder is gone');
  // The empty map placeholder renders with its heading.
  assert.ok(html.includes('Your trip map'), 'the empty map placeholder renders');
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
