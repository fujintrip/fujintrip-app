import { ROUTE_STOPS, routeKeyForDestination } from './planner';

/**
 * Visa & entry requirements per route country (competitor learning,
 * Nov 11: Sherpa).
 *
 * For a US passport, for tourism — the app's default traveler. Rules
 * depend on nationality, so every entry links to the OFFICIAL source
 * and the panel is labeled "check before you book".
 *
 * Every rule below was verified against official sources / the US
 * State Department on 2026-11-11 (see LAST_CHECKED). Two things the
 * check caught that an unresearched draft would have got wrong:
 *  - Thailand's visa exemption was CUT from 60 to 30 days on
 *    15 Sept 2026, and the Thailand Digital Arrival Card (TDAC) is
 *    now required before arrival.
 *  - ETIAS (the EU's travel authorisation) is NOT in operation — no
 *    launch date has been announced, and the EU promises several
 *    months' notice. Any site selling an ETIAS application is a scam.
 *
 * Fees change without notice — the panel shows the fee as "about" and
 * points at the official portal for the current amount. Never invent a
 * rule: a country with no verified entry is not in this table at all,
 * and visaForCountry returns null for it.
 */
export const VISA_LAST_CHECKED = '2026-11-11';
export const VISA_PASSPORT_NOTE =
  'For a US passport, for tourism. Other nationalities can differ — check the official source before you book. Rules change; this is a starting point, not legal advice.';

export type VisaInfo = {
  country: string;
  // One short line: the visa rule for a US passport.
  visa: string;
  // Passport validity rule.
  passport: string;
  // Anything else the traveler must do before the trip (ETA, arrival
  // card, e-visa portal) — each a short plain line.
  notes: string[];
  // Official source: name + URL. The URL is the official portal the
  // traveler applies/checks on — never a reseller.
  source: string;
  sourceUrl: string;
};

// Schengen is one rule for all member states (90 days in any 180,
// counted across the whole area) — the shared entry below is used for
// every Schengen country on our routes.
const SCHENGEN: Omit<VisaInfo, 'country'> = {
  visa: 'Visa-free — up to 90 days in any 180-day period, counted across all Schengen countries together.',
  passport: 'Valid at least 3 months beyond your planned departure from Schengen, and issued within the last 10 years.',
  notes: [
    'ETIAS — the EU travel authorisation — is NOT in operation yet (no launch date announced; the EU promises several months’ notice). You cannot apply for it, and no airline will ask for it. Check travel-europe.europa.eu before you book.',
    'The Entry/Exit System (EES) is live: fingerprints and a photo are taken at the border on your first entry.',
  ],
  source: 'European Union — ETIAS / travel-europe.europa.eu',
  sourceUrl: 'https://travel-europe.europa.eu/etias_en',
};

export const VISA_INFO: Record<string, VisaInfo> = {
  Portugal: { country: 'Portugal', ...SCHENGEN },
  Spain: { country: 'Spain', ...SCHENGEN },
  France: { country: 'France', ...SCHENGEN },
  Italy: { country: 'Italy', ...SCHENGEN },
  Greece: { country: 'Greece', ...SCHENGEN },
  'Czech Republic': { country: 'Czech Republic', ...SCHENGEN },
  Austria: { country: 'Austria', ...SCHENGEN },
  Hungary: { country: 'Hungary', ...SCHENGEN },
  'United Kingdom': {
    country: 'United Kingdom',
    visa: 'No visa for visits up to 6 months — but a UK ETA (Electronic Travel Authorisation) is required before you travel.',
    passport: 'Valid for your whole stay.',
    notes: [
      'UK ETA: required for US citizens since 8 January 2025. £20 per person, valid 2 years or until your passport expires. Apply only on gov.uk/eta or the official UK ETA app — third-party sites charge extra.',
      'Airside transit (international-to-international, never crossing the UK border) at Heathrow or Manchester is temporarily exempt, but that exemption is under review.',
    ],
    source: 'GOV.UK — Electronic travel authorisation (ETA)',
    sourceUrl: 'https://www.gov.uk/eta',
  },
  Egypt: {
    country: 'Egypt',
    visa: 'Tourist visa required — e-visa online in advance, or visa on arrival at the airport. Single entry, 30 days.',
    passport: 'Valid at least 6 months from your date of entry (Egypt enforces this strictly).',
    notes: [
      'E-visa: apply at least 7 days before arrival on the official portal visa2egypt.gov.eg — about $25–30 for a single entry; confirm the current fee on the portal (it moved in 2026).',
      'Visa on arrival: buy the sticker at the airport bank window before passport control, in cash US dollars — about $25–30.',
      'Sharm El Sheikh and the Sinai resorts only, up to 15 days: a free entry stamp instead of a visa.',
    ],
    source: 'Government of Egypt — official e-visa portal',
    sourceUrl: 'https://www.visa2egypt.gov.eg',
  },
  Japan: {
    country: 'Japan',
    visa: 'Visa-free — up to 90 days for tourism.',
    passport: 'Valid for your whole stay (6 months’ validity is the safe rule).',
    notes: [],
    source: 'U.S. Department of State — Japan travel information',
    sourceUrl: 'https://travel.state.gov',
  },
  Thailand: {
    country: 'Thailand',
    visa: 'Visa-free — 30 days for tourism. (The exemption was cut from 60 to 30 days on 15 September 2026.)',
    passport: 'Valid at least 6 months beyond your arrival.',
    notes: [
      'Thailand Digital Arrival Card (TDAC): complete it online at tdac.immigration.go.th within 3 days before arrival — it is required for entry by air, land or sea.',
    ],
    source: 'Thailand Immigration — Digital Arrival Card',
    sourceUrl: 'https://tdac.immigration.go.th',
  },
  Cambodia: {
    country: 'Cambodia',
    visa: 'E-visa online in advance, or visa on arrival at the airport. 30 days.',
    passport: 'Valid at least 6 months beyond your arrival.',
    notes: [
      'E-visa: apply on the official portal evisa.gov.kh — $30 plus a $6 processing fee. The free e-Arrival form (arrival.gov.kh) is separate.',
    ],
    source: 'Kingdom of Cambodia — official e-visa portal',
    sourceUrl: 'https://www.evisa.gov.kh',
  },
  Vietnam: {
    country: 'Vietnam',
    visa: 'E-visa required before travel — 90 days, single or multiple entry.',
    passport: 'Valid at least 6 months beyond your arrival.',
    notes: [
      'E-visa: apply on the official portal evisa.gov.vn — $25 single entry, $50 multiple entry; about 3 working days to process.',
    ],
    source: 'Government of Vietnam — official e-visa portal',
    sourceUrl: 'https://evisa.gov.vn',
  },
  Turkey: {
    country: 'Turkey',
    visa: 'Visa-free — up to 90 days in any 180-day period for tourism.',
    passport: 'Valid at least 6 months beyond your entry date (the safe rule — Turkish law asks for 60 days beyond your stay).',
    notes: [],
    source: 'Republic of Türkiye — e-visa portal',
    sourceUrl: 'https://evisa.gov.tr',
  },
  Morocco: {
    country: 'Morocco',
    visa: 'Visa-free — up to 90 days for tourism.',
    passport: 'Valid at least 6 months beyond your arrival.',
    notes: [],
    source: 'U.S. Department of State — Morocco travel information',
    sourceUrl: 'https://travel.state.gov',
  },
  India: {
    country: 'India',
    visa: 'E-visa required before travel — apply at least 4 days ahead. Tourist e-visa: 30 days, 1 year or 5 years.',
    passport: 'Valid at least 6 months at the time of application, with at least 2 blank pages.',
    notes: [
      'Apply ONLY on indianvisaonline.gov.in — the only official site. Any other site selling an Indian e-visa is a scam. Fees start at $10 plus a bank charge and depend on the visa type.',
      'The online e-Arrival Card is mandatory for all travelers entering India.',
    ],
    source: 'Government of India — official e-visa portal',
    sourceUrl: 'https://indianvisaonline.gov.in',
  },
  Mexico: {
    country: 'Mexico',
    visa: 'Visa-free — up to 180 days for tourism.',
    passport: 'Valid for your whole stay.',
    notes: ['Fill out the FMM tourist card on arrival (given on the plane or at immigration).'],
    source: 'U.S. Department of State — Mexico travel information',
    sourceUrl: 'https://travel.state.gov',
  },
  USA: {
    country: 'USA',
    visa: 'Domestic travel — no visa or passport needed for US citizens.',
    passport: 'A government photo ID is enough for domestic flights.',
    notes: [],
    source: 'U.S. Department of State — travel information',
    sourceUrl: 'https://travel.state.gov',
  },
  Indonesia: {
    country: 'Indonesia',
    visa: 'Visa on arrival or e-VOA online — 30 days, extendable once for another 30 days.',
    passport: 'Valid at least 6 months beyond your arrival, with at least one blank page.',
    notes: [
      'E-VOA: apply on the official portal evisa.imigrasi.go.id — IDR 500,000 (about $28). The same visa on arrival is sold at the airport.',
      'All Indonesia arrival card: complete the free form at allindonesia.imigrasi.go.id from 3 days before arrival.',
      'Bali tourist levy: IDR 150,000 (about $8) per visit, paid on lovebali.baliprov.go.id or on arrival.',
    ],
    source: 'Indonesia Immigration — official e-visa portal',
    sourceUrl: 'https://evisa.imigrasi.go.id',
  },
  Maldives: {
    country: 'Maldives',
    visa: 'Free 30-day visa on arrival for almost all nationalities.',
    passport: 'Valid at least 6 months beyond your arrival.',
    notes: [
      'IMUGA Traveller Declaration: every visitor must submit it online at imuga.immigration.gov.mv within 96 hours before arrival. It is free — sites charging a fee for “IMUGA help” are not affiliated with the government.',
    ],
    source: 'Maldives Immigration — IMUGA Traveller Declaration',
    sourceUrl: 'https://imuga.immigration.gov.mv',
  },
};

export function visaForCountry(country: string): VisaInfo | null {
  return VISA_INFO[country] ?? null;
}

// The route's countries, in the order the trip visits them — one panel
// row per country, so a multi-country trip shows every border it crosses.
// Countries sharing the exact same rule (the Schengen states) merge
// into one row — three identical rows would be noise, not information.
export function visaForRoute(routeKey: string): VisaInfo[] {
  const stops = ROUTE_STOPS[routeKey];
  if (!stops) return [];
  const seen = new Set<string>();
  const out: VisaInfo[] = [];
  for (const stop of stops) {
    if (seen.has(stop.country)) continue;
    seen.add(stop.country);
    const info = VISA_INFO[stop.country];
    if (!info) continue;
    const same = out.find(
      (o) => o.visa === info.visa && o.passport === info.passport && o.sourceUrl === info.sourceUrl
    );
    if (same) {
      same.country = `${same.country} · ${info.country}`;
    } else {
      out.push({ ...info, notes: [...info.notes] });
    }
  }
  return out;
}

// A single-city destination's country (Kyoto → Japan, Bali → Indonesia).
// "Caribbean" is deliberately absent: it is many countries, not one,
// and guessing a country for it would be wrong — no panel is shown.
const DESTINATION_COUNTRY: Record<string, string> = {
  Kyoto: 'Japan',
  Bali: 'Indonesia',
  Santorini: 'Greece',
  Maldives: 'Maldives',
  Paris: 'France',
};

// The visa panel for a destination: the route's countries when it maps
// to a route, otherwise the destination's own country.
export function visaForDestination(destination: string): VisaInfo[] {
  const routeKey = routeKeyForDestination(destination);
  if (routeKey) return visaForRoute(routeKey);
  const country = DESTINATION_COUNTRY[destination];
  if (country) {
    const info = VISA_INFO[country];
    return info ? [info] : [];
  }
  return [];
}

// One line for the chat reply — the visa headline for the trip's
// countries, so the traveler hears it before the plan view's panel.
export function visaLine(destination: string): string {
  const infos = visaForDestination(destination);
  if (!infos.length) return '';
  const bits = infos.map((info) => {
    const short = info.visa.split('—')[0].trim();
    return `${info.country}: ${short}`;
  });
  return `Entry (US passport): ${bits.join('; ')}. Full details with official source links are in the plan view's Visa & entry panel — check before you book.`;
}
