/**
 * Passport-validity check + Schengen 90/180 counter (round 3 #5,
 * competitor learning §3 — Sherpa/IATA, Staywise).
 *
 * The rules come from lib/visa.ts's verified dataset (checked
 * 2026-11-11): Schengen needs 3 months beyond the planned departure
 * from Schengen; most other countries need 6 months; the UK, Mexico
 * and the USA need the passport valid for the whole stay; Japan the
 * same, with 6 months as the safe rule. A country with no verified
 * rule is "unknown" — never guessed.
 *
 * Only the expiry MONTH and YEAR are ever stored (tripState only).
 * Never the passport number — it is never asked for, never stored.
 */

export type PassportExpiry = { month: number; year: number };

// Schengen member states on our routes — the same set as lib/visa.ts's
// SCHENGEN entry (Portugal, Spain, France, Italy, Greece, Czech
// Republic, Austria, Hungary).
export const SCHENGEN_COUNTRIES: ReadonlySet<string> = new Set([
  'Portugal',
  'Spain',
  'France',
  'Italy',
  'Greece',
  'Czech Republic',
  'Austria',
  'Hungary',
]);

export function isSchengenCountry(country: string): boolean {
  return SCHENGEN_COUNTRIES.has(country);
}

// Required passport validity, in whole months beyond the planned
// departure from that country, for a US passport. null = no verified
// rule for this country (unknown, never guessed).
export function passportMonthsRequired(country: string): number | null {
  if (SCHENGEN_COUNTRIES.has(country)) return 3;
  switch (country) {
    case 'United Kingdom':
    case 'Mexico':
    case 'USA':
      return 0; // valid for the whole stay
    case 'Japan':
      return 0; // valid for the whole stay; 6 months is the safe rule
    case 'Egypt':
    case 'Thailand':
    case 'Cambodia':
    case 'Vietnam':
    case 'Turkey':
    case 'Morocco':
    case 'India':
    case 'Indonesia':
    case 'Maldives':
      return 6;
    default:
      return null;
  }
}

// The safe-rule note for countries whose rule is "valid for the whole
// stay" but where a longer validity is the prudent choice.
export function passportSafeNote(country: string): string {
  if (country === 'Japan') return '6 months’ validity is the safe rule for Japan.';
  return '';
}

// Last day of the expiry month — a passport expiring in March 2027 is
// valid through 31 March 2027.
export function endOfExpiryMonth(expiry: PassportExpiry): Date {
  return new Date(expiry.year, expiry.month, 0);
}

// Add whole months to a date, clamped to the end of the target month
// (31 January + 1 month = 28/29 February, not 3 March).
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

// Whole months from `from` to `to` (negative when `to` is before
// `from`), for the "about X months left" display.
export function wholeMonthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return months;
}

export type PassportCheck = {
  country: string;
  required: number | null;
  monthsLeft: number | null;
  // ok: valid past the required date with margin. tight: valid past
  // the required date but within 2 months of it — renew soon. fail:
  // expires before the required date — a real denied-boarding risk.
  // unknown: no verified rule for this country.
  status: 'ok' | 'tight' | 'fail' | 'unknown';
  note?: string;
};

export function checkPassportValidity(
  expiry: PassportExpiry,
  returnDate: Date,
  countries: string[]
): PassportCheck[] {
  const expiryEnd = endOfExpiryMonth(expiry);
  const seen = new Set<string>();
  const out: PassportCheck[] = [];
  for (const country of countries) {
    if (!country || seen.has(country)) continue;
    seen.add(country);
    const required = passportMonthsRequired(country);
    if (required === null) {
      out.push({ country, required: null, monthsLeft: null, status: 'unknown' });
      continue;
    }
    const requiredUntil = addMonths(returnDate, required);
    const monthsLeft = wholeMonthsBetween(returnDate, expiryEnd);
    const status =
      expiryEnd < requiredUntil ? 'fail' : expiryEnd < addMonths(requiredUntil, 2) ? 'tight' : 'ok';
    const note = passportSafeNote(country);
    out.push({ country, required, monthsLeft, status, ...(note ? { note } : {}) });
  }
  return out;
}

// One warning line for the chat reply / trip card — failures and tight
// cases only, with the action (renew). Nothing when everything is fine.
export function passportWarningLine(checks: PassportCheck[]): string {
  const bad = checks.filter((c) => c.status === 'fail' || c.status === 'tight');
  if (!bad.length) return '';
  const bits = bad.map((c) => {
    const need = c.required === 0 ? 'valid for your whole stay' : `valid at least ${c.required} months beyond your return`;
    if (c.status === 'fail') {
      return `${c.country}: your passport expires before it needs to be ${need} — renew it before you book, or you can be denied boarding`;
    }
    return `${c.country}: your passport is only valid ${c.monthsLeft ?? '?'} months past your return (needs ${need}) — renew it soon`;
  });
  return `Passport check: ${bits.join('; ')}.`;
}

// Schengen 90/180: 90 days in any 180-day period, counted across all
// Schengen countries together. `used` is what the traveler already
// spent in the last 180 days; `trip` is this trip's Schengen days.
export function schengenRemaining(
  usedDays: number,
  tripDays: number
): { used: number; trip: number; remaining: number; over: boolean } {
  const used = Math.min(90, Math.max(0, Math.floor(usedDays) || 0));
  const trip = Math.max(0, Math.floor(tripDays) || 0);
  const remaining = 90 - used - trip;
  return { used, trip, remaining, over: remaining < 0 };
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// "My passport expires in March 2027", "expires 03/2027",
// "expires 3/27" — month name or MM/YYYY, never the passport number.
// A 2-digit year means 20xx. Years outside 2026–2045 are rejected.
export function parsePassportExpiry(text: string): PassportExpiry | null {
  const lower = (text ?? '').toLowerCase();
  if (!/passport|expir/.test(lower)) return null;
  const nameMatch = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4}|\d{2})\b/
  );
  if (nameMatch) {
    const month = MONTH_NAMES.indexOf(nameMatch[1]) + 1;
    let year = Number(nameMatch[2]);
    if (year < 100) year += 2000;
    if (month >= 1 && year >= 2026 && year <= 2045) return { month, year };
    return null;
  }
  const numMatch = lower.match(/\b(0?[1-9]|1[0-2])[/\-.](\d{4}|\d{2})\b/);
  if (numMatch) {
    const month = Number(numMatch[1]);
    let year = Number(numMatch[2]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && year >= 2026 && year <= 2045) return { month, year };
    return null;
  }
  return null;
}

// Validate an unknown value (tripState, localStorage) into an expiry —
// month 1–12, year 2026–2045, nothing else.
export function parsePassportExpiryValue(value: unknown): PassportExpiry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const month = typeof o.month === 'number' ? o.month : NaN;
  const year = typeof o.year === 'number' ? o.year : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2026 || year > 2045) return null;
  return { month, year };
}
