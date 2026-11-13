// Emergency (SOS) helpers — the emergency-button build (user, Nov 12,
// "we need to add emergency button to alert any relative or authority
// in case of emergency").
//
// The numbers are VERIFIED, checked 2026-11-13. Primary source:
// TripoSIM "Emergency Numbers by Country (2026)", numbers checked 22
// October 2026, cross-checked against Telcomia (2026-10-20) and
// OneWorld24 (Oct 6, 2026, updated Oct 12, 2026); Cambodia via GOV.UK
// FCDO (checked 03/11/2026). Re-verified 2026-11-13 by a second source
// where the table flagged one: Maldives 911 (Maldives Police Service,
// police.gov.mv, "Emergency 911", + the 15 Nov 2024 national launch
// reported by Atoll Times) and the Japan Visitor Hotline 050-3816-2787
// (JNTO's own site, japan.travel/en/plan/hotline/). The Cambodia
// tourist line in the draft table (+855 31 601 2345) did NOT check out
// — the confirmed tourist-police numbers are city-specific (Phnom Penh
// 012 942 484, Siem Reap 012 402 424), so the sheet uses the Siem Reap
// one: that is the route's city. Maldives ambulance is omitted on
// purpose: NDMA says 100, FCDO says 102 — conflicting sources, and the
// single 911 call centre routes to an ambulance anyway.
//
// A country with no verified number returns null — the sheet says so,
// never guesses. Full table + sources:
// files/emergency-numbers-verified.md.
export const EMERGENCY_NUMBERS_CHECKED = '2026-11-13';

export type EmergencyService = { label: string; number: string };
export type EmergencyCountry = {
  name: string;
  services: EmergencyService[];
  note?: string;
};

// One entry per country the app can send a traveler to. "Emergency" is
// the number to dial when unsure; a dash in the source table means the
// country has no single number, so there is no Emergency service here
// — the sheet lists Police / Ambulance / Fire instead.
const TABLE: Record<string, EmergencyCountry> = {
  portugal: {
    name: 'Portugal',
    services: [{ label: 'Emergency', number: '112' }],
  },
  spain: {
    name: 'Spain',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '091' },
      { label: 'Ambulance', number: '061' },
    ],
  },
  france: {
    name: 'France',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '17' },
      { label: 'Ambulance', number: '15' },
      { label: 'Fire', number: '18' },
    ],
  },
  italy: {
    name: 'Italy',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '113' },
      { label: 'Ambulance', number: '118' },
      { label: 'Fire', number: '115' },
    ],
  },
  greece: {
    name: 'Greece',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '100' },
      { label: 'Ambulance', number: '166' },
      { label: 'Fire', number: '199' },
      { label: 'Tourist police', number: '1571' },
    ],
  },
  'czech republic': {
    name: 'Czech Republic',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '158' },
      { label: 'Ambulance', number: '155' },
      { label: 'Fire', number: '150' },
    ],
  },
  austria: {
    name: 'Austria',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '133' },
      { label: 'Ambulance', number: '144' },
      { label: 'Fire', number: '122' },
    ],
  },
  hungary: {
    name: 'Hungary',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '107' },
      { label: 'Ambulance', number: '104' },
      { label: 'Fire', number: '105' },
    ],
  },
  'united kingdom': {
    name: 'United Kingdom',
    services: [{ label: 'Emergency', number: '999' }],
    note: '112 also works',
  },
  turkey: {
    name: 'Turkey',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '155' },
      { label: 'Fire', number: '110' },
    ],
  },
  egypt: {
    name: 'Egypt',
    services: [
      { label: 'Police', number: '122' },
      { label: 'Ambulance', number: '123' },
      { label: 'Fire', number: '180' },
      { label: 'Tourist police', number: '126' },
    ],
    note: '112 also works from a mobile',
  },
  morocco: {
    name: 'Morocco',
    services: [
      { label: 'Police', number: '19' },
      { label: 'Ambulance', number: '15' },
      { label: 'Fire', number: '15' },
    ],
  },
  japan: {
    name: 'Japan',
    services: [
      { label: 'Police', number: '110' },
      { label: 'Ambulance', number: '119' },
      { label: 'Fire', number: '119' },
      { label: 'Japan Visitor Hotline — 24h, English', number: '050-3816-2787' },
    ],
  },
  thailand: {
    name: 'Thailand',
    services: [
      { label: 'Emergency', number: '191' },
      { label: 'Ambulance', number: '1669' },
      { label: 'Fire', number: '199' },
      { label: 'Tourist police', number: '1155' },
    ],
  },
  vietnam: {
    name: 'Vietnam',
    services: [
      { label: 'Police', number: '113' },
      { label: 'Ambulance', number: '115' },
      { label: 'Fire', number: '114' },
    ],
  },
  cambodia: {
    name: 'Cambodia',
    services: [
      { label: 'Police', number: '117' },
      { label: 'Ambulance', number: '119' },
      { label: 'Fire', number: '118' },
      { label: 'Tourist police — Siem Reap', number: '012 402 424' },
    ],
  },
  india: {
    name: 'India',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '100' },
      { label: 'Ambulance', number: '102' },
      { label: 'Fire', number: '101' },
      { label: 'Tourist helpline', number: '1363' },
    ],
  },
  indonesia: {
    name: 'Indonesia',
    services: [
      { label: 'Emergency', number: '112' },
      { label: 'Police', number: '110' },
      { label: 'Ambulance', number: '118' },
      { label: 'Fire', number: '113' },
    ],
  },
  'united states': {
    name: 'United States',
    services: [{ label: 'Emergency', number: '911' }],
  },
  mexico: {
    name: 'Mexico',
    services: [
      { label: 'Emergency', number: '911' },
      { label: 'Tourist hotline', number: '078' },
    ],
  },
  maldives: {
    name: 'Maldives',
    services: [
      { label: 'Emergency', number: '911' },
      { label: 'Police', number: '119' },
      { label: 'Fire', number: '118' },
      { label: 'Tourist police hotline', number: '1478' },
    ],
  },
};

// Aliases the traveler (or the trip card) may use for a table country.
const ALIASES: Record<string, string> = {
  czechia: 'czech republic',
  'czech rep': 'czech republic',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  usa: 'united states',
  us: 'united states',
  'united states of america': 'united states',
  america: 'united states',
  turkiye: 'turkey',
  'republic of turkey': 'turkey',
  'viet nam': 'vietnam',
  bali: 'indonesia',
};

function normalizeCountry(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The verified numbers for a country, or null when no number is
// verified for it — the caller must say "no verified number", never
// guess one.
export function emergencyForCountry(country: string): EmergencyCountry | null {
  if (!country || !country.trim()) return null;
  const key = normalizeCountry(country);
  return TABLE[ALIASES[key] ?? key] ?? null;
}

// One lookup per country on the route, in route order, deduped — the
// sheet lists every country the trip visits, verified or not.
export function emergencyForCountries(countries: string[]): { country: string; entry: EmergencyCountry | null }[] {
  const seen = new Set<string>();
  const out: { country: string; entry: EmergencyCountry | null }[] = [];
  for (const c of countries) {
    const key = normalizeCountry(c);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ country: c, entry: emergencyForCountry(c) });
  }
  return out;
}

// A tel: link for a number as printed — spaces, dashes and brackets
// stripped, a leading + kept.
export function telHref(number: string): string {
  const trimmed = number.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return `tel:${plus}${trimmed.replace(/[^0-9]/g, '')}`;
}

function digitsFor(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export function smsHref(phone: string, message: string): string {
  const digits = digitsFor(phone);
  if (!digits) return '';
  // `?&` works on both iOS (expects &) and Android (expects ?).
  return `sms:${phone.trim().startsWith('+') ? '+' : ''}${digits}?&body=${encodeURIComponent(message)}`;
}

export function whatsappHref(phone: string, message: string): string {
  const digits = digitsFor(phone);
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// The pre-filled alert text for the saved emergency contact — trip
// details first (so the contact knows where the traveler is meant to
// be), then the live location link when the traveler chose to share
// it. The message is sent by the traveler from their own messaging
// app; nothing here sends anything by itself.
export function buildAlertMessage(opts: {
  destination: string;
  routeLine: string;
  travelers: number;
  days: number;
  datesLine: string;
  origin: string;
  location?: { lat: number; lng: number } | null;
}): string {
  const lines = [
    'SOS — I need help.',
    `I'm on a FujinTrip trip: ${opts.destination} (${opts.routeLine}), ${opts.datesLine}, ${opts.days} day${opts.days === 1 ? '' : 's'}, ${opts.travelers} traveler${opts.travelers === 1 ? '' : 's'}, from ${opts.origin || 'home'}.`,
  ];
  if (opts.location) {
    lines.push(`My location right now: https://maps.google.com/?q=${opts.location.lat},${opts.location.lng}`);
  }
  lines.push('Sent from FujinTrip — I tapped send, this is not automatic.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Check-in timer — the S slice of the UGC solo-safety item. The timer
// only runs while the app is open: the sheet (or the app) surfaces the
// alert prompt when the time passes, and only once per check-in.
// ---------------------------------------------------------------------------

export function checkInKeyFor(destination: string, travelers: number, days: number): string {
  return `fujintrip-checkin:${destination}:${travelers}:${days}`;
}

export type CheckIn = { due: number; surfaced: boolean };

export function parseCheckIn(value: unknown): CheckIn | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { due?: unknown; surfaced?: unknown };
  if (typeof v.due !== 'number' || !Number.isFinite(v.due) || v.due <= 0) return null;
  return { due: v.due, surfaced: v.surfaced === true };
}

export function checkInMissed(checkIn: CheckIn | null, now: number = Date.now()): boolean {
  return !!checkIn && now > checkIn.due;
}

// "today at 9:00 PM" / "tomorrow at 8:00 AM" — a check-in is always
// set for a clock time, so the day word is what the traveler needs.
export function formatCheckIn(due: number, now: number = Date.now()): string {
  const d = new Date(due);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayOf = (t: number) => {
    const x = new Date(t);
    return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  };
  if (dayOf(due) === dayOf(now)) return `today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayOf(due) === dayOf(tomorrow.getTime())) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

// The next occurrence of a "HH:MM" clock time — today, or tomorrow if
// that time already passed. Returns null for a malformed value.
export function nextCheckInAt(hhmm: string, now: number = Date.now()): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
