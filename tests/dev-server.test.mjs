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
