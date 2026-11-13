// Emergency (SOS) helpers — the emergency-button build.
//
// The numbers are verified, checked 2026-11-13 (see lib/emergency.ts
// for sources). These tests pin the table: every country the app can
// send a traveler to resolves, nothing unknown resolves, and the
// single-source lines that did NOT check out stay out of the table.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/emergency.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITY_INFO } from '../lib/tripCard.ts';
import {
  EMERGENCY_NUMBERS_CHECKED,
  buildAlertMessage,
  checkInKeyFor,
  checkInMissed,
  emergencyForCountries,
  emergencyForCountry,
  formatCheckIn,
  nextCheckInAt,
  parseCheckIn,
  smsHref,
  telHref,
  whatsappHref,
} from '../lib/emergency.ts';

test('EMERGENCY_NUMBERS_CHECKED: the table carries its check stamp', () => {
  assert.equal(EMERGENCY_NUMBERS_CHECKED, '2026-11-13');
});

test('emergencyForCountry: every city country in the app resolves verified', () => {
  // Every country CITY_INFO can put a traveler in must have a verified
  // number — a new city added later without one fails loudly here.
  const countries = [...new Set(Object.values(CITY_INFO).map((c) => c.country))];
  assert.ok(countries.length >= 20, `expected 20+ countries, found ${countries.length}`);
  for (const country of countries) {
    const entry = emergencyForCountry(country);
    assert.ok(entry, `${country} has no verified emergency number`);
    assert.ok(entry.services.length > 0, `${country} has no services`);
    assert.ok(entry.services.every((s) => s.label && s.number), `${country} has a service without a label or number`);
  }
});

test('emergencyForCountry: aliases resolve to the table country', () => {
  assert.equal(emergencyForCountry('Czechia')?.name, 'Czech Republic');
  assert.equal(emergencyForCountry('USA')?.name, 'United States');
  assert.equal(emergencyForCountry('US')?.name, 'United States');
  assert.equal(emergencyForCountry('UK')?.name, 'United Kingdom');
  assert.equal(emergencyForCountry('Türkiye')?.name, 'Turkey');
  assert.equal(emergencyForCountry('Viet Nam')?.name, 'Vietnam');
  assert.equal(emergencyForCountry('Bali')?.name, 'Indonesia');
  assert.equal(emergencyForCountry('  france  ')?.name, 'France');
});

test('emergencyForCountry: unknown places never resolve — no guessing', () => {
  assert.equal(emergencyForCountry('Caribbean'), null);
  assert.equal(emergencyForCountry('Zanzibar'), null);
  assert.equal(emergencyForCountry(''), null);
  assert.equal(emergencyForCountry('   '), null);
  assert.equal(emergencyForCountry('Atlantis'), null);
});

test('emergencyForCountry: the re-verified lines are in, the unchecked ones are out', () => {
  // Maldives 911 re-verified 2026-11-13 (police.gov.mv + the 15 Nov
  // 2024 national launch): main 911, police 119, fire 118, tourist
  // police hotline 1478. Ambulance is deliberately absent — NDMA says
  // 100, FCDO says 102, and the single 911 centre routes to one.
  const maldives = emergencyForCountry('Maldives');
  assert.ok(maldives);
  assert.equal(maldives.services.find((s) => s.label === 'Emergency')?.number, '911');
  assert.equal(maldives.services.find((s) => s.label === 'Police')?.number, '119');
  assert.equal(maldives.services.find((s) => s.label === 'Fire')?.number, '118');
  assert.equal(maldives.services.find((s) => s.label === 'Tourist police hotline')?.number, '1478');
  assert.equal(maldives.services.find((s) => s.label === 'Ambulance'), undefined);
  // Japan Visitor Hotline re-verified via JNTO's own site.
  const japan = emergencyForCountry('Japan');
  assert.ok(japan?.services.some((s) => s.number === '050-3816-2787'));
  // Cambodia: the draft table's +855 31 601 2345 did NOT check out —
  // the confirmed tourist-police number is the Siem Reap one.
  const cambodia = emergencyForCountry('Cambodia');
  assert.ok(cambodia?.services.some((s) => s.label === 'Tourist police — Siem Reap' && s.number === '012 402 424'));
  assert.ok(!cambodia?.services.some((s) => s.number.includes('31 601 2345') || s.number.includes('316012345')));
  // Egypt and Morocco have no single number (a dash in the source
  // table) — the sheet lists the services instead of inventing one.
  assert.equal(emergencyForCountry('Egypt')?.services.find((s) => s.label === 'Emergency'), undefined);
  assert.equal(emergencyForCountry('Morocco')?.services.find((s) => s.label === 'Emergency'), undefined);
  assert.equal(emergencyForCountry('Egypt')?.note, '112 also works from a mobile');
});

test('emergencyForCountries: route order, deduped, unverified kept as null', () => {
  const out = emergencyForCountries(['Czech Republic', 'Austria', 'Czech Republic', 'Caribbean', 'Hungary']);
  assert.deepEqual(
    out.map((o) => o.country),
    ['Czech Republic', 'Austria', 'Caribbean', 'Hungary']
  );
  assert.equal(out[0].entry?.name, 'Czech Republic');
  assert.equal(out[2].entry, null);
});

test('telHref: spaces and dashes stripped, leading + kept', () => {
  assert.equal(telHref('112'), 'tel:112');
  assert.equal(telHref('050-3816-2787'), 'tel:05038162787');
  assert.equal(telHref('012 402 424'), 'tel:012402424');
  assert.equal(telHref('+855 12 345 678'), 'tel:+85512345678');
});

test('smsHref/whatsappHref: message encoded, WhatsApp digits only', () => {
  const sms = smsHref('+1 555 010 1234', 'SOS — I need help.');
  assert.ok(sms.startsWith('sms:+15550101234?'), sms);
  assert.ok(sms.includes('body=SOS%20%E2%80%94%20I%20need%20help.'), sms);
  const wa = whatsappHref('+1 (555) 010-1234', 'SOS — I need help.');
  assert.ok(wa.startsWith('https://wa.me/15550101234?text='), wa);
  assert.ok(wa.includes('SOS%20%E2%80%94%20I%20need%20help.'), wa);
  assert.equal(smsHref('', 'x'), '');
  assert.equal(whatsappHref('', 'x'), '');
});

test('buildAlertMessage: trip first, location link only when shared', () => {
  const base = {
    destination: 'Central Europe',
    routeLine: 'Prague → Vienna → Budapest',
    travelers: 2,
    days: 14,
    datesLine: 'Jan 4–Jan 17',
    origin: 'New York',
  };
  const msg = buildAlertMessage(base);
  assert.ok(msg.startsWith('SOS — I need help.'), 'the alert opens with the ask');
  assert.ok(msg.includes('Central Europe (Prague → Vienna → Budapest)'), 'route in the message');
  assert.ok(msg.includes('Jan 4–Jan 17'), 'dates in the message');
  assert.ok(msg.includes('2 travelers'), 'party size in the message');
  assert.ok(msg.includes('from New York'), 'origin in the message');
  assert.ok(!msg.includes('maps.google.com'), 'no location link when none was shared');
  assert.ok(msg.includes('I tapped send, this is not automatic'), 'the message says it was sent by hand');
  const withLoc = buildAlertMessage({ ...base, location: { lat: 50.08, lng: 14.44 } });
  assert.ok(withLoc.includes('https://maps.google.com/?q=50.08,14.44'), 'the shared location is a maps link');
});

test('check-in: key per trip, parse validates, missed is a strict past-due', () => {
  assert.equal(checkInKeyFor('Central Europe', 2, 14), 'fujintrip-checkin:Central Europe:2:14');
  assert.notEqual(checkInKeyFor('Central Europe', 2, 14), checkInKeyFor('Japan', 2, 14));
  assert.deepEqual(parseCheckIn({ due: 1790000000000, surfaced: false }), { due: 1790000000000, surfaced: false });
  assert.deepEqual(parseCheckIn({ due: 1790000000000 }), { due: 1790000000000, surfaced: false });
  assert.equal(parseCheckIn(null), null);
  assert.equal(parseCheckIn({ due: 'soon' }), null);
  assert.equal(parseCheckIn({ due: -5 }), null);
  assert.equal(parseCheckIn({}), null);
  const due = Date.parse('2027-01-04T21:00:00');
  assert.equal(checkInMissed({ due, surfaced: false }, due - 1000), false);
  assert.equal(checkInMissed({ due, surfaced: false }, due + 1000), true);
  assert.equal(checkInMissed(null, due + 1000), false);
});

test('formatCheckIn/nextCheckInAt: today/tomorrow wording, next occurrence of a clock time', () => {
  const now = Date.parse('2027-01-04T12:00:00');
  assert.equal(formatCheckIn(Date.parse('2027-01-04T21:00:00'), now), 'today at 9:00 PM');
  assert.equal(formatCheckIn(Date.parse('2027-01-05T08:00:00'), now), 'tomorrow at 8:00 AM');
  assert.ok(formatCheckIn(Date.parse('2027-01-10T08:00:00'), now).startsWith('Jan 10 at '), 'later dates carry the date');
  assert.equal(nextCheckInAt('21:00', now), Date.parse('2027-01-04T21:00:00'));
  assert.equal(nextCheckInAt('08:00', now), Date.parse('2027-01-05T08:00:00'));
  assert.equal(nextCheckInAt('25:00', now), null);
  assert.equal(nextCheckInAt('9pm', now), null);
  assert.equal(nextCheckInAt('', now), null);
});
