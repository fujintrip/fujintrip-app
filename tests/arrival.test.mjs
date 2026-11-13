// Arrival-time anchoring (round 4 #3, UGC learning §3 — Threads: the
// traveler lands at 7am and the plan starts with a 3pm check-in).
// Day 1 starts from the flight's landing time + transfer + hotel
// check-in time, not from a generic morning; the last day ends at the
// airport. Check-in is labeled "typically 3pm — confirm with the
// stay" until live hotels exist; no flight time is ever invented.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/arrival.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrivalAnchor,
  departureAnchor,
  parseDepartureTime,
  parseHHMM,
  parseLandingTime,
  toHHMM,
} from '../lib/arrival.ts';
import { buildTripCard } from '../lib/tripCard.ts';
import { dayBlocks } from '../lib/today.ts';

test('parseLandingTime: the traveler\'s own words, morning hours, nothing invented', () => {
  assert.equal(parseLandingTime('we land at 7am'), '07:00');
  assert.equal(parseLandingTime('landing at 7:35am'), '07:35');
  assert.equal(parseLandingTime('arrive around 6pm'), '18:00');
  assert.equal(parseLandingTime('touch down at 9:20'), '09:20');
  assert.equal(parseLandingTime('our flight lands at 11:45pm'), '23:45');
  assert.equal(parseLandingTime('we land at 12'), '12:00');
  assert.equal(parseLandingTime('we land at 25'), null, 'out-of-range hours are dropped');
  assert.equal(parseLandingTime('we land at 7:99'), null);
  assert.equal(parseLandingTime('I love Tokyo'), null, 'no landing time is invented');
  assert.equal(parseLandingTime(''), null);
});

test('parseDepartureTime: the flight home, morning hours', () => {
  assert.equal(parseDepartureTime('flight home at 7:35am'), '07:35');
  assert.equal(parseDepartureTime('we depart at 6pm'), '18:00');
  assert.equal(parseDepartureTime('leaving at 9:20'), '09:20');
  assert.equal(parseDepartureTime('take off at 10'), '10:00');
  assert.equal(parseDepartureTime('I love Tokyo'), null);
});

test('parseHHMM / toHHMM: validation and normalization', () => {
  assert.equal(parseHHMM('07:00'), '07:00');
  assert.equal(parseHHMM('7:00'), null, 'a bare hour is not a stored time');
  assert.equal(parseHHMM('25:00'), null);
  assert.equal(parseHHMM('07:60'), null);
  assert.equal(parseHHMM(700), null);
  assert.equal(toHHMM(7, 5), '07:05');
  assert.equal(toHHMM(25, 0), '01:00', 'wraps past midnight');
});

test('arrivalAnchor: a 7am landing no longer produces a Day 1 that starts with a 3pm check-in', () => {
  const a = arrivalAnchor({ landingTime: '07:00', firstCity: 'Prague' });
  assert.equal(a.anchored, true);
  assert.equal(a.landingTime, '07:00');
  assert.equal(a.atHotel, '08:00', 'about an hour to the hotel');
  assert.equal(a.firstActivityFrom, '08:30', 'transfer + a 30-minute buffer');
  assert.equal(a.checkIn, '15:00');
  assert.ok(a.line.includes('You land at 07:00'), 'the line names the landing');
  assert.ok(a.line.includes('08:00'), 'the hotel time is named');
  assert.ok(a.line.includes('from about 08:30'), 'Day 1 starts with exploring, not check-in');
  assert.ok(a.line.includes('typically 3pm'), 'check-in is labeled typical');
  assert.ok(a.line.includes('confirm with the stay'), 'the stay is the source, not us');
  // An afternoon landing: the room should be ready.
  const late = arrivalAnchor({ landingTime: '14:00', firstCity: 'Prague' });
  assert.equal(late.anchored, true);
  assert.ok(late.line.includes('Your room should be ready'), 'a 2pm landing reaches a 3pm check-in');
  assert.ok(!late.line.includes('from about'), 'no explore-first line when the room is ready');
});

test('arrivalAnchor: no landing time, no invented morning — the anchor asks for it', () => {
  const a = arrivalAnchor({ firstCity: 'Prague' });
  assert.equal(a.anchored, false);
  assert.equal(a.landingTime, undefined);
  assert.ok(a.line.includes('tell Fujin your landing time'), 'the anchor asks instead of guessing');
  assert.ok(a.line.includes('typically 3pm'), 'check-in is still labeled');
});

test('departureAnchor: the last day ends at the airport, 3h international / 2h domestic', () => {
  const intl = departureAnchor({ departureTime: '10:00', lastCity: 'Budapest', international: true });
  assert.equal(intl.leaveBy, '07:00', '3 hours before an international flight');
  assert.equal(intl.bufferMins, 180);
  assert.ok(intl.line.includes('leave for the airport by 07:00'));
  assert.ok(intl.line.includes('international'));
  assert.ok(intl.line.includes('confirm with your airline'), 'the airline is the source');
  const dom = departureAnchor({ departureTime: '10:00', lastCity: 'New York', international: false });
  assert.equal(dom.leaveBy, '08:00', '2 hours before a domestic flight');
  assert.equal(dom.bufferMins, 120);
  const unknown = departureAnchor({ lastCity: 'Budapest', international: true });
  assert.equal(unknown.leaveBy, undefined, 'no departure time, no leave-by time');
  assert.ok(unknown.line.includes('Last day ends at the airport'), 'the last day still ends at the airport');
  assert.ok(unknown.line.includes('3 hours before your flight'), 'the default buffer is named');
});

test('buildTripCard: the anchor rides on the card, international when the origin country differs', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', landingTime: '07:00', departureTime: '10:00' });
  assert.ok(card);
  assert.equal(card.arrival.anchored, true);
  assert.equal(card.arrival.firstActivityFrom, '08:30');
  assert.equal(card.departure.leaveBy, '07:00', 'New York → Central Europe is international');
  const domestic = buildTripCard({ destination: 'USA', travelers: 2, days: 7, month: 5, origin: 'New York', landingTime: '09:00', departureTime: '11:00' });
  assert.ok(domestic);
  assert.equal(domestic.departure.bufferMins, 120, 'USA from New York is domestic');
  const unanchored = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(unanchored);
  assert.equal(unanchored.arrival.anchored, false);
  assert.ok(unanchored.departure.line.includes('Last day ends at the airport'));
});

test('dayBlocks: Day 1 starts at the landing time, and the departure day ends at the airport', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York', landingTime: '07:00', departureTime: '10:00' });
  assert.ok(card);
  const day0 = dayBlocks(card, 0);
  const travel = day0.find((b) => b.kind === 'travel');
  assert.ok(travel, 'Day 1 has a travel block');
  assert.equal(travel.time, '07:00–08:00', 'the travel block runs landing → hotel');
  assert.ok(travel.title.includes('Land'), 'the block says landing, not a generic morning');
  const activity = day0.find((b) => b.kind === 'activity');
  assert.ok(activity);
  assert.equal(activity.time, '08:30–12:00', 'exploring starts after the transfer + buffer');
  assert.ok(activity.detail.includes('Check-in is typically 3pm'), 'the check-in note is on the activity block');
  const last = dayBlocks(card, card.days - 1);
  assert.equal(last.length, 2, 'the departure day is flight home + checkout, never an invented activity');
  assert.ok(last[0].title.includes('Flight'), 'the first block is the flight home');
  assert.ok(last[0].detail.includes('leave for the airport by 07:00'), 'the leave-by time is on the flight block');
});
