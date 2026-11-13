// Passport-validity check + Schengen 90/180 counter (round 3 #5,
// competitor learning §3 — Sherpa/IATA, Staywise).
//
// Rules come from lib/visa.ts's verified dataset (checked 2026-11-11):
// Schengen 3 months beyond departure from Schengen, most other
// countries 6 months, UK/Mexico/USA/Japan valid for the whole stay.
// Only the expiry MONTH and YEAR are ever stored — never the number.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/passport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  checkPassportValidity,
  endOfExpiryMonth,
  isSchengenCountry,
  parsePassportExpiry,
  parsePassportExpiryValue,
  passportMonthsRequired,
  passportWarningLine,
  schengenRemaining,
  wholeMonthsBetween,
} from '../lib/passport.ts';

test('passportMonthsRequired: Schengen 3, most others 6, UK/Mexico/USA/Japan 0, unknown null', () => {
  assert.equal(passportMonthsRequired('France'), 3);
  assert.equal(passportMonthsRequired('Hungary'), 3);
  assert.equal(passportMonthsRequired('Egypt'), 6);
  assert.equal(passportMonthsRequired('Thailand'), 6);
  assert.equal(passportMonthsRequired('Morocco'), 6);
  assert.equal(passportMonthsRequired('United Kingdom'), 0);
  assert.equal(passportMonthsRequired('Mexico'), 0);
  assert.equal(passportMonthsRequired('USA'), 0);
  assert.equal(passportMonthsRequired('Japan'), 0);
  assert.equal(passportMonthsRequired('Zanzibar'), null, 'no verified rule — unknown, never guessed');
  assert.equal(passportMonthsRequired(''), null);
});

test('isSchengenCountry: the same set as lib/visa.ts SCHENGEN', () => {
  for (const c of ['Portugal', 'Spain', 'France', 'Italy', 'Greece', 'Czech Republic', 'Austria', 'Hungary']) {
    assert.ok(isSchengenCountry(c), `${c} is Schengen`);
  }
  assert.ok(!isSchengenCountry('United Kingdom'), 'post-Brexit UK is not Schengen');
  assert.ok(!isSchengenCountry('Turkey'));
});

test('endOfExpiryMonth: a passport expiring in March 2027 is valid through 31 March 2027', () => {
  const end = endOfExpiryMonth({ month: 3, year: 2027 });
  assert.equal(end.getFullYear(), 2027);
  assert.equal(end.getMonth(), 2);
  assert.equal(end.getDate(), 31);
});

test('addMonths: clamps to the end of the target month (31 Jan + 1 month = 28 Feb)', () => {
  const d = addMonths(new Date(2027, 0, 31), 1);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 28);
  assert.equal(addMonths(new Date(2027, 0, 15), 3).getMonth(), 3);
});

test('wholeMonthsBetween: counts whole months, not rounded', () => {
  assert.equal(wholeMonthsBetween(new Date(2027, 0, 20), new Date(2027, 5, 31)), 5);
  assert.equal(wholeMonthsBetween(new Date(2027, 0, 20), new Date(2027, 0, 31)), 0);
  assert.equal(wholeMonthsBetween(new Date(2027, 5, 20), new Date(2027, 0, 20)), -5);
});

test('checkPassportValidity: the 5-months denied-boarding trap — Schengen fail', () => {
  // Trip returns 2027-01-20 from France; passport expires June 2027
  // (5 months past return) — Schengen needs 3 months beyond return,
  // so June is fine; make it fail: expiry March 2027 (2 months past).
  const fail = checkPassportValidity({ month: 3, year: 2027 }, new Date(2027, 0, 20), ['France']);
  assert.equal(fail[0].status, 'fail');
  assert.equal(fail[0].required, 3);
  // Expiry April 2027 = exactly 3 months past the return (valid
  // through 30 April, required until 20 April) — ok, but within 2
  // months of the required date, so tight: renew soon.
  const tight = checkPassportValidity({ month: 4, year: 2027 }, new Date(2027, 0, 20), ['France']);
  assert.equal(tight[0].status, 'tight');
  // Expiry December 2027 — comfortable.
  const ok = checkPassportValidity({ month: 12, year: 2027 }, new Date(2027, 0, 20), ['France']);
  assert.equal(ok[0].status, 'ok');
});

test('checkPassportValidity: 6-month countries fail earlier than Schengen', () => {
  // Same expiry, Egypt needs 6 months: June 2027 (5 months past
  // return) fails for Egypt but passes for France.
  const checks = checkPassportValidity({ month: 6, year: 2027 }, new Date(2027, 0, 20), ['France', 'Egypt']);
  assert.equal(checks[0].status, 'ok');
  assert.equal(checks[1].status, 'fail');
  assert.equal(checks[1].required, 6);
});

test('checkPassportValidity: unknown country is unknown, duplicates collapse', () => {
  const checks = checkPassportValidity({ month: 12, year: 2027 }, new Date(2027, 0, 20), ['Zanzibar', 'France', 'France']);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].status, 'unknown');
  assert.equal(checks[0].required, null);
  assert.equal(checks[1].status, 'ok');
});

test('passportWarningLine: empty when fine, names the failure and the action when not', () => {
  const fine = checkPassportValidity({ month: 12, year: 2027 }, new Date(2027, 0, 20), ['France']);
  assert.equal(passportWarningLine(fine), '');
  const bad = checkPassportValidity({ month: 3, year: 2027 }, new Date(2027, 0, 20), ['France', 'Egypt']);
  const line = passportWarningLine(bad);
  assert.ok(line.includes('France'), 'names the failing country');
  assert.ok(line.includes('Egypt'));
  assert.ok(line.includes('denied boarding'), 'names the consequence');
  assert.ok(line.includes('renew'), 'names the action');
  assert.ok(!line.includes('passport number'), 'never asks for the number');
});

test('schengenRemaining: 90-day budget, trip days subtract, over is flagged', () => {
  assert.deepEqual(schengenRemaining(0, 14), { used: 0, trip: 14, remaining: 76, over: false });
  assert.deepEqual(schengenRemaining(80, 14), { used: 80, trip: 14, remaining: -4, over: true });
  assert.deepEqual(schengenRemaining(76, 14), { used: 76, trip: 14, remaining: 0, over: false });
  assert.deepEqual(schengenRemaining(100, 0), { used: 90, trip: 0, remaining: 0, over: false });
  assert.deepEqual(schengenRemaining(-5, 0), { used: 0, trip: 0, remaining: 90, over: false });
});

test('parsePassportExpiry: month name + year, MM/YYYY, and 2-digit year', () => {
  assert.deepEqual(parsePassportExpiry('my passport expires in March 2027'), { month: 3, year: 2027 });
  assert.deepEqual(parsePassportExpiry('passport expires 03/2027'), { month: 3, year: 2027 });
  assert.deepEqual(parsePassportExpiry('passport expires 3/27'), { month: 3, year: 2027 });
  assert.deepEqual(parsePassportExpiry('passport expires December 2028'), { month: 12, year: 2028 });
  assert.equal(parsePassportExpiry('I want to go to Kyoto in January'), null, 'a trip month is not a passport expiry');
  assert.equal(parsePassportExpiry('my passport expires in March 2019'), null, 'past years are rejected');
  assert.equal(parsePassportExpiry('passport expires 13/2027'), null, 'month 13 is rejected');
});

test('parsePassportExpiryValue: validates unknown values, drops the number', () => {
  assert.deepEqual(parsePassportExpiryValue({ month: 3, year: 2027 }), { month: 3, year: 2027 });
  assert.equal(parsePassportExpiryValue({ month: 0, year: 2027 }), null);
  assert.equal(parsePassportExpiryValue({ month: 3, year: 1999 }), null);
  assert.equal(parsePassportExpiryValue({ month: '3', year: 2027 }), null);
  assert.equal(parsePassportExpiryValue({ number: '123456789' }), null, 'a passport number is never an expiry');
  assert.equal(parsePassportExpiryValue(null), null);
});
