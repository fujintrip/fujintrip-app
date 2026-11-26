// Fujin AI chat — rebuilt from scratch (Nov 24, 2026). The old chat
// was one 3,300-line file rendering everything at once; the new chat
// is a split screen (chat column + canvas) with the same engine
// underneath. These pins guard the rebuild: the engine still works
// exactly as before, and the crowded features are really gone.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/chat-rebuild.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../components/FujinChat.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('chat rebuild: the engine is intact — same API, same fallback, same persistence', () => {
  // Streaming with Stop, atomic fallback, 10-turn history, tripState.
  assert.ok(chat.includes("fetch('/api/fujin'"), 'the chat posts to /api/fujin');
  assert.ok(chat.includes('stream: true'), 'streaming is requested first');
  assert.ok(chat.includes('AbortController'), 'Stop aborts the stream');
  assert.ok(chat.includes('askFujin('), 'the built-in planner is the fallback');
  assert.ok(chat.includes('msgs.slice(-10)'), '10 turns of history ride along');
  assert.ok(chat.includes('tripState'), 'tripState rides along on every request');
  // Client-side plan, three tiers.
  assert.ok(chat.includes('buildPlan('), 'the plan is built client-side');
  assert.ok(chat.includes('tripDays('), 'the plan spans the trip length');
  // In-progress trip + plan survive a reload.
  assert.ok(chat.includes("localStorage.getItem('fujintrip-current-trip')"), 'the trip restores from localStorage');
  assert.ok(chat.includes("localStorage.getItem('fujintrip-current-plan')"), 'the plan restores from localStorage');
  assert.ok(chat.includes("localStorage.getItem('fujintrip-pending-message')"), 'a homepage message still opens the chat');
  // $1 PDF + Clerk gate on download only; the chat itself is never gated.
  assert.ok(chat.includes('PlanPdfPayment'), 'the $1 PDF payment renders');
  assert.ok(chat.includes('gateDecision'), 'the free-account gate decides the download');
  assert.ok(chat.includes('/api/plan-download'), 'the $1 decision comes from the server route');
  // The map and the trip card still drive the canvas.
  assert.ok(chat.includes('TripMap'), 'the map lives in the canvas');
  assert.ok(chat.includes('buildTripCard('), 'the plan artefact is built from the trip card');
  assert.ok(chat.includes('cardComparison('), 'the comparison line comes from the card');
  // Interface state still gates the canvas: S0 chat only, S1 trip
  // known, S2 plan built.
  assert.ok(chat.includes('interfaceState('), 'the S0/S1/S2 state machine still gates the canvas');
});

test('chat rebuild: the crowded features left the chat', () => {
  // No hardcoded hero photo — the S0 canvas photo comes from the pool.
  assert.ok(!chat.includes('HERO_PHOTO'), 'no hardcoded HERO_PHOTO survives');
  assert.ok(!chat.includes('images.unsplash.com/photo-1493976040374'), 'no hardcoded Kyoto URL survives');
  // On-trip mode is out of the chat entirely.
  assert.ok(!chat.includes('TodayView'), 'no Today view in the chat');
  assert.ok(!chat.includes('EmergencySheet'), 'no emergency sheet in the chat');
  assert.ok(!chat.includes('tripMode'), 'no on-trip mode state in the chat');
  assert.ok(!chat.includes('flightStatus'), 'no flight-status box in the chat');
  assert.ok(!chat.includes('sos-btn'), 'no SOS button in the chat');
  // Forms, link import, dietary row, trip panel, zone switcher: gone.
  assert.ok(!chat.includes('SearchForm'), 'no search form inside the chat');
  assert.ok(!chat.includes('Prefer forms?'), 'no Prefer forms disclosure in the chat');
  assert.ok(!chat.includes('Start from a link'), 'no link-import card in the chat');
  assert.ok(!chat.includes('dietary'), 'no dietary row in the chat');
  assert.ok(!chat.includes('TripPanel'), 'no trip panel in the chat');
  assert.ok(!chat.includes('zonebar'), 'no zone switcher in the chat');
  assert.ok(!chat.includes('ai-pill'), 'no duplicated Plan with AI pill in the chat');
  // The old plan-area clutter (bundle legs, expenses, checklist,
  // feasibility, weather, schengen) is gone with the old file.
  assert.ok(!chat.includes('fujintrip-bundle'), 'no bundle persistence in the chat');
  assert.ok(!chat.includes('fujintrip-expenses'), 'no expense splitting in the chat');
  assert.ok(!chat.includes('fujintrip-schengen-used'), 'no Schengen counter in the chat');
  assert.ok(!chat.includes('setWeatherCheck'), 'no weather check in the chat');
});

test('chat rebuild: one next step — confirm before building, one build, one book', () => {
  assert.ok(chat.includes('Does this look right?'), 'the confirm card asks before building');
  assert.ok(chat.includes('Looks right — build my plan'), 'one confirm action builds the plan');
  assert.ok(chat.includes('Change something'), 'one confirm action changes the trip');
  assert.ok(chat.includes('slotsFilled'), 'the build action waits for the slots');
  assert.ok(chat.includes('Book — '), 'one Book action in the canvas');
  assert.ok(chat.includes('Save as PDF'), 'one Save as PDF action in the canvas');
  assert.ok(chat.includes('Start a new trip'), 'one quiet new-trip action');
  // Chips answer only the current question: they derive from the
  // last reply's missing list, one category per row.
  assert.ok(chat.includes('lastMissing'), 'the chips read the last missing list');
  assert.ok(chat.includes('firstHard'), 'only the first hard missing item drives the row');
  // The reply is shown as the server wrote it — the chat never appends
  // a missing list or a "tap Build" line; the canvas shows it instead.
  assert.ok(!chat.includes('To finish the plan I still need'), 'no appended missing list in replies');
  assert.ok(!chat.includes('Tap Build my plan below'), 'no appended build line in replies');
  // Dates are never invented: the summary shows month + length, the
  // plan labels its start as suggested.
  assert.ok(chat.includes('Suggested start:'), 'the plan start is labelled as suggested');
});

test('chat rebuild: split-screen CSS exists', () => {
  assert.ok(css.includes('.chat-split{position:relative;display:grid;grid-template-columns:1fr 1fr;'), 'the split layout is an exact 50/50 two-column grid');
  assert.ok(css.includes('.chat-split .chatcol{'), 'the chat column has its own card');
  assert.ok(css.includes('.chat-split .canvas{'), 'the canvas has its own column');
  assert.ok(css.includes('.chat-split .summary-line{'), 'the summary rows are tappable');
  assert.ok(css.includes('.chat-split .confirm-card{'), 'the confirm card is styled');
  assert.ok(css.includes('.chat-split .day-strip{'), 'the day strip is styled');
  assert.ok(css.includes('.chat-split .plan-actions{'), 'the plan actions are styled');
  assert.ok(css.includes('@media(max-width:900px)') && css.includes('.chat-split{grid-template-columns:1fr'), 'the canvas stacks below the chat on a phone');
});
