// Unit tests for lib/today.ts — the portable plan / "Today" view.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/today.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTripCard } from '../lib/tripCard.ts';
import {
  BLOCK_WINDOWS,
  dayBlocks,
  dayIndexFor,
  doneKeyFor,
  essentialsFor,
  mapsDirectionsUrl,
  offlineKeyFor,
  parseSnapshot,
  parseTripCard,
  phaseFor,
  serializeTripCard,
  snapshotFor,
  stopAndDayFor,
  todaySummary,
} from '../lib/today.ts';

function kyotoCard() {
  const card = buildTripCard({ destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York' });
  assert.ok(card, 'Kyoto card builds');
  return card;
}

test('dayIndexFor: before, during and after the trip', () => {
  const card = kyotoCard();
  // Suggested start is the first Monday of January (2027-01-04).
  assert.equal(card.startDate.toISOString().slice(0, 10), '2027-01-04');
  assert.equal(card.endDate.toISOString().slice(0, 10), '2027-01-06');
  assert.equal(dayIndexFor(card, new Date('2027-01-03T10:00:00')), -1);
  assert.equal(dayIndexFor(card, new Date('2027-01-04T10:00:00')), 0);
  assert.equal(dayIndexFor(card, new Date('2027-01-05T10:00:00')), 1);
  assert.equal(dayIndexFor(card, new Date('2027-01-06T23:00:00')), 2);
  assert.equal(dayIndexFor(card, new Date('2027-01-07T10:00:00')), 3);
});

test('phaseFor: morning / afternoon / evening / night', () => {
  assert.equal(phaseFor(new Date('2027-01-04T08:00:00')), 'morning');
  assert.equal(phaseFor(new Date('2027-01-04T13:00:00')), 'afternoon');
  assert.equal(phaseFor(new Date('2027-01-04T19:00:00')), 'evening');
  assert.equal(phaseFor(new Date('2027-01-04T23:00:00')), 'night');
  assert.equal(phaseFor(new Date('2027-01-05T03:00:00')), 'night');
});

test('stopAndDayFor: real sight titles from the trip card, in order', () => {
  const card = kyotoCard();
  const d0 = stopAndDayFor(card, 0);
  assert.equal(d0?.stop.city, 'Kyoto');
  assert.equal(d0?.day.title, 'Fushimi Inari and the Eastern Hills');
  const d2 = stopAndDayFor(card, 2);
  // Day 3 (index 2) is the departure day: the card's day entries cover
  // the 2 nights, so there is no day title — the Today view shows the
  // flight home instead.
  assert.equal(d2?.stop.city, 'Kyoto');
  assert.equal(d2?.day, null);
  assert.equal(stopAndDayFor(card, 99)?.stop.city, 'Kyoto'); // clamped to last day
});

test('dayBlocks: the departure day shows the flight home, not an invented activity', () => {
  const card = kyotoCard();
  const dep = dayBlocks(card, 2);
  assert.equal(dep.length, 2);
  assert.equal(dep[0].kind, 'travel');
  assert.ok(dep[0].title.includes('Kyoto'));
  assert.ok(dep[0].title.includes('New York'));
  assert.equal(dep[1].kind, 'free');
  assert.ok(dep[1].title.includes('Check out'));
});

test('dayBlocks: travel on the first day of a stop, activity is the real title', () => {
  const card = kyotoCard();
  const day0 = dayBlocks(card, 0);
  assert.equal(day0.length, 4);
  assert.equal(day0[0].kind, 'travel');
  assert.ok(day0[0].title.includes('Arrive'));
  assert.equal(day0[1].kind, 'activity');
  assert.equal(day0[1].title, 'Fushimi Inari and the Eastern Hills');
  assert.equal(day0[1].time, BLOCK_WINDOWS.activity);
  assert.equal(day0[2].kind, 'free');
  assert.equal(day0[3].kind, 'dinner');
  assert.equal(day0[3].city, 'Kyoto');
  // Day 1 is not the first day of the stop — no travel block.
  const day1 = dayBlocks(card, 1);
  assert.equal(day1.length, 3);
  assert.ok(day1.every((b) => b.kind !== 'travel'));
});

test('dayBlocks: a multi-city trip gets a travel block when the city changes', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  // Find the first day of the second stop from the card itself.
  const second = card.stops[1];
  const firstDay = second.days[0].day - 1;
  assert.ok(firstDay > 0);
  const blocks = dayBlocks(card, firstDay);
  assert.equal(blocks[0].kind, 'travel');
  assert.ok(blocks[0].title.includes(second.city));
  assert.ok(blocks[0].title.includes(card.stops[0].city));
});

test('todaySummary: now/next follows the time of day', () => {
  const card = kyotoCard();
  const morning = todaySummary(card, new Date('2027-01-04T10:00:00'));
  assert.equal(morning.status, 'during');
  assert.equal(morning.dayIndex, 0);
  assert.equal(morning.nowBlock?.kind, 'activity');
  assert.equal(morning.nextBlock?.kind, 'free');
  const evening = todaySummary(card, new Date('2027-01-04T19:30:00'));
  assert.equal(evening.nowBlock?.kind, 'dinner');
  // After dinner, next is tomorrow's first block — Kyoto is one stop, so
  // day 1 has no travel block; its first block is the morning activity.
  assert.equal(evening.nextBlock?.kind, 'activity');
  assert.equal(evening.nextDayTitle, 'Arashiyama Bamboo Grove');
  const before = todaySummary(card, new Date('2027-01-03T10:00:00'));
  assert.equal(before.status, 'before');
  assert.equal(before.nowBlock, null);
  assert.equal(before.nextBlock?.kind, 'travel');
  const after = todaySummary(card, new Date('2027-01-08T10:00:00'));
  assert.equal(after.status, 'after');
  assert.equal(after.nowBlock, null);
  assert.equal(after.nextBlock, null);
});

test('essentialsFor: stay line names no hotel, trip total is the legs summed', () => {
  const card = kyotoCard();
  const e = essentialsFor(card, 0, new Date('2027-01-04T10:00:00'));
  assert.equal(e.tonightCity, 'Kyoto');
  assert.equal(e.tonightNights, 2);
  assert.ok(e.tonightStayLine.includes('Kyoto'));
  assert.ok(!/Hilton|Marriott|Hotel [A-Z]/.test(e.tonightStayLine), 'no invented hotel name');
  assert.equal(e.tripTotal, card.legs.reduce((s, l) => s + l.price, 0));
  assert.ok(e.nextFlightLine?.includes('New York'));
  assert.ok(e.nextFlightLine?.includes('Kyoto'));
  assert.equal(e.daysLeft, 3);
  const lastDay = essentialsFor(card, 2, new Date('2027-01-06T10:00:00'));
  assert.equal(lastDay.daysLeft, 1);
});

test('mapsDirectionsUrl points at the city center', () => {
  const url = mapsDirectionsUrl(35.01, 135.77);
  assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=35.01,135.77');
});

test('serialize/parse round-trip keeps the card and its dates', () => {
  const card = kyotoCard();
  const back = parseTripCard(serializeTripCard(card));
  assert.ok(back);
  assert.equal(back.title, card.title);
  assert.ok(back.startDate instanceof Date);
  assert.equal(back.startDate.toISOString(), card.startDate.toISOString());
  assert.equal(back.stops.length, card.stops.length);
  assert.equal(back.stops[0].days[0].title, card.stops[0].days[0].title);
  assert.equal(parseTripCard('not json'), null);
  assert.equal(parseTripCard('{"stops":"nope"}'), null);
});

test('offline snapshot round-trip', () => {
  const card = kyotoCard();
  const snap = snapshotFor(card, { destination: 'Kyoto', travelers: 2, days: 3, month: 1, origin: 'New York', choice: 1 });
  assert.equal(snap.v, 1);
  const back = parseSnapshot(JSON.stringify(snap));
  assert.ok(back);
  assert.equal(back.destination, 'Kyoto');
  assert.ok(back.card.stops[0].startDate instanceof Date);
  assert.equal(parseSnapshot('{"v":2}'), null);
});

test('storage keys are stable per trip', () => {
  assert.equal(offlineKeyFor('Kyoto', 2, 3), 'fujintrip-offline-plan:Kyoto:2:3');
  assert.equal(doneKeyFor('Kyoto', 2, 3), 'fujintrip-today-done:Kyoto:2:3');
  assert.notEqual(offlineKeyFor('Kyoto', 2, 3), offlineKeyFor('Kyoto', 2, 7));
});
