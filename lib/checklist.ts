/**
 * Pre-departure checklist + packing list (round 4 #2, UGC learning §3 —
 * FamGo's origin story: "something important slipped through the
 * cracks: socks, my kid's shoes, a ticket I swore I'd already printed,
 * a passport closer to expiring than I realized").
 *
 * The checklist is GENERATED from the actual trip — not a generic
 * template the traveler types into. It reads the facts FujinTrip
 * already holds: the passport check (lib/passport.ts), the visa panel
 * (lib/visa.ts), the typical weather (lib/tripCard.ts), the kids' ages
 * and the day titles. Every item carries its source or a "check before
 * you book" label; every deadline is computed from the trip's start
 * date (passport renewal 8 weeks out, e-visas by the portal's own lead
 * time, packing a week out). Nothing is invented: a country with no
 * verified entry action gets no apply item, and a packing line names
 * the seasonal average it came from.
 *
 * Ticks persist on this device only (localStorage), matching the
 * current architecture — no accounts, no sync.
 */

import { addDays, typicalTemp, type TripCard } from './tripCard';
import { isSchengenCountry, type PassportCheck, type PassportExpiry } from './passport';
import { MONTH_NAMES } from './planner';
import type { VisaInfo } from './visa';

export type ChecklistCategory = 'documents' | 'money' | 'packing';

export const CHECKLIST_CATEGORIES: Record<ChecklistCategory, string> = {
  documents: 'Documents & entry',
  money: 'Money & insurance',
  packing: 'Packing',
};

export type ChecklistItem = {
  id: string;
  category: ChecklistCategory;
  label: string;
  detail?: string;
  // ISO date the item is due — computed from the trip's start date.
  dueBy?: string;
  // Human label for the due date, e.g. "by 3 Dec 2026".
  dueLabel?: string;
};

export function checklistKeyFor(destination: string, travelers: number, days: number): string {
  return `fujintrip-checklist:${destination}:${travelers}:${days}`;
}

const fmtDue = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Beach / island stops — the swim-kit line comes from the route, not a
// guess about the traveler's plans.
const BEACH_CITIES = new Set(['Santorini', 'Bali', 'Krabi', 'Tulum', 'Sharm El Sheikh', 'Crete', 'Antalya', 'Nice']);

// The visa dataset's action notes, mapped to checklist items. The
// mapper reads the visa line AND each note for the action words, so a
// new verified entry in lib/visa.ts lands in the checklist without a
// code change. One item per (country, action) — an e-visa and its
// arrival card are two actions, not one.
function visaActionItems(info: VisaInfo, startDate: Date): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const seen = new Set<string>();
  const country = info.country.split(' · ')[0]; // merged Schengen rows share one rule; actions are per country anyway
  // Notes first: the note carries the lead time ("at least 7 days
  // before arrival") that the visa line only summarizes — the first
  // match for an action wins, so the note's detail and deadline land.
  const texts = [...info.notes, info.visa];
  for (const text of texts) {
    const lower = text.toLowerCase();
    const leadMatch = text.match(/at least (\d+)\s+days? before/i);
    const withinMatch = text.match(/within (\d+)\s+days? before/i);
    const leadDays = leadMatch ? Number(leadMatch[1]) : 0;
    const dueBy = leadDays > 0 ? addDays(startDate, -leadDays) : startDate;
    const dueLabel = leadDays > 0
      ? `by ${fmtDue(dueBy)} — at least ${leadDays} days before arrival`
      : withinMatch
        ? `within ${withinMatch[1]} days before arrival`
        : 'before you travel';
    const push = (kind: string, label: string) => {
      if (seen.has(kind)) return;
      seen.add(kind);
      out.push({
        id: `visa-${country}-${kind}`,
        category: 'documents',
        label,
        detail: `${text} — check the official source in the Visa & entry panel before you book.`,
        dueBy: isoDate(dueBy),
        dueLabel,
      });
    };
    if (/e-?voa/i.test(text) && !/scam/i.test(text)) push('evisa', `Apply for the ${country} e-VOA (visa on arrival, online)`);
    else if (/e-visa/i.test(text) && !/scam/i.test(text)) push('evisa', `Apply for the ${country} e-visa`);
    else if (/ETA\b/.test(text)) push('eta', `Apply for the ${country} ETA`);
    else if (/arrival card/i.test(text)) push('arrival-card', `Complete the ${country} arrival card`);
    else if (/traveller declaration/i.test(text)) push('declaration', `Submit the ${country} traveller declaration`);
    else if (/levy/i.test(text)) push('levy', `Pay the ${country} tourist levy`);
  }
  return out;
}

// Kids' packing, by age band — a packing list for a 2-year-old looks
// nothing like one for a 9-year-old (report, family slice).
function kidPackingItems(kids: number[]): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const has = (lo: number, hi: number) => kids.some((a) => a >= lo && a <= hi);
  if (has(0, 1)) {
    out.push({ id: 'pack-baby', category: 'packing', label: 'Diapers + wipes for the flight and the first day', detail: 'For the youngest traveler — pack more than you think you need for the flight.' });
  }
  if (has(2, 5)) {
    out.push({ id: 'pack-toddler', category: 'packing', label: 'Snacks, a change of clothes and a small toy for the flight', detail: 'For the 2–5 year olds — the flight and the first afternoon.' });
  }
  if (has(6, 11)) {
    out.push({ id: 'pack-kid', category: 'packing', label: 'Chargers + headphones for the kids', detail: 'For the 6–11 year olds — the flight and the hotel evenings.' });
  }
  if (has(12, 17)) {
    out.push({ id: 'pack-teen', category: 'packing', label: 'Teen gear — chargers, headphones, a day bag', detail: 'For the teenagers — a day bag each so they carry their own water and layers.' });
  }
  return out;
}

export function buildChecklist(input: {
  card: TripCard;
  visaInfos?: VisaInfo[];
  passportExpiry?: PassportExpiry | null;
  passportChecks?: PassportCheck[];
}): ChecklistItem[] {
  const { card } = input;
  const items: ChecklistItem[] = [];
  const startDate = new Date(card.startDate);
  const packBy = addDays(startDate, -7);
  const firstCity = card.stops[0]?.city ?? card.destination;

  // --- Documents -------------------------------------------------------
  const badPassport = (input.passportChecks ?? []).filter((c) => c.status === 'fail' || c.status === 'tight');
  if (badPassport.length) {
    const worst = badPassport[0];
    const renewBy = addDays(startDate, -56); // 8 weeks — renewal takes time
    items.push({
      id: 'passport-renew',
      category: 'documents',
      label: `Renew your passport — ${worst.country} needs it valid ${worst.required === 0 ? 'for your whole stay' : `at least ${worst.required} months beyond your return`}`,
      detail: worst.status === 'fail'
        ? `Your passport expires before it needs to be valid — renew it before you book, or you can be denied boarding.`
        : `Your passport is only valid ${worst.monthsLeft ?? '?'} months past your return — renew it soon.`,
      dueBy: isoDate(renewBy),
      dueLabel: `start renewal by ${fmtDue(renewBy)}`,
    });
  } else if (!input.passportExpiry) {
    // No expiry on file: the item is to check it, not a verdict.
    const required = Math.max(
      0,
      ...card.stops.map((s) => {
        const c = (input.passportChecks ?? []).find((p) => p.country === s.country);
        return c?.required ?? 0;
      })
    );
    items.push({
      id: 'passport-check',
      category: 'documents',
      label: 'Check your passport expiry',
      detail: required > 0
        ? `This trip needs your passport valid at least ${required} months beyond your return on ${fmtDue(new Date(card.endDate))} — add your expiry month/year in the Visa & entry panel and FujinTrip checks it.`
        : `Add your passport expiry month/year in the Visa & entry panel and FujinTrip checks it against every country on this trip.`,
    });
  }
  for (const info of input.visaInfos ?? []) {
    items.push(...visaActionItems(info, startDate));
  }
  // Schengen 90/180: the trip's own Schengen days, counted from the
  // card's stops — a real number, not a generic reminder.
  const schengenDays = card.stops
    .filter((s) => isSchengenCountry(s.country))
    .reduce((sum, s) => sum + s.nights, 0);
  if (schengenDays > 0) {
    items.push({
      id: 'schengen-count',
      category: 'documents',
      label: `Count your Schengen days — this trip spends ${schengenDays} day${schengenDays === 1 ? '' : 's'} in Schengen`,
      detail: 'US citizens can spend 90 days in Schengen in any 180-day period, counted across all Schengen countries together. The plan view has the counter — add the days you already used.',
    });
  }

  // --- Money & insurance ----------------------------------------------
  items.push({
    id: 'insurance',
    category: 'money',
    label: 'Buy travel insurance within 14 days of your first payment',
    detail: 'The 14-day window keeps pre-existing-condition cover; after that, cover may exclude it. Insurance is a planning estimate in the all-in total — the price depends on your policy.',
  });
  items.push({
    id: 'bank',
    category: 'money',
    label: "Tell your bank you're traveling",
    detail: "So your card isn't blocked abroad — most banks take the travel notice in the app.",
  });

  // --- Packing, from the trip's own weather, route and activities -----
  const temp = typicalTemp(firstCity, card.month);
  const monthName = MONTH_NAMES[card.month - 1] ?? '';
  if (temp > 0 && temp <= 55) {
    items.push({
      id: 'pack-warm',
      category: 'packing',
      label: 'Pack warm layers, hat and gloves',
      detail: `The typical high in ${firstCity} in ${monthName} is ${temp}°F — a seasonal average, not a forecast. Check the forecast closer to departure.`,
      dueBy: isoDate(packBy),
      dueLabel: `pack by ${fmtDue(packBy)}`,
    });
  }
  if (temp >= 85) {
    items.push({
      id: 'pack-heat',
      category: 'packing',
      label: 'Light clothes, sun protection and a refillable water bottle',
      detail: `The typical high in ${firstCity} in ${monthName} is ${temp}°F — a seasonal average, not a forecast.`,
      dueBy: isoDate(packBy),
      dueLabel: `pack by ${fmtDue(packBy)}`,
    });
  }
  if (card.month === 11 || card.month === 12 || card.month === 1 || card.month === 2) {
    items.push({
      id: 'pack-waterproof',
      category: 'packing',
      label: 'Pack a waterproof jacket',
      detail: 'Winter rain is possible on this trip — check the forecast closer to departure and pack layers that dry fast.',
      dueBy: isoDate(packBy),
      dueLabel: `pack by ${fmtDue(packBy)}`,
    });
  }
  if (card.stops.some((s) => BEACH_CITIES.has(s.city))) {
    items.push({
      id: 'pack-swim',
      category: 'packing',
      label: 'Swim kit — swimsuit, reef-safe sunscreen, a dry bag',
      detail: 'This route has a beach or island stop — pack the swim kit before you go, not at the resort shop.',
      dueBy: isoDate(packBy),
      dueLabel: `pack by ${fmtDue(packBy)}`,
    });
  }
  const titles = card.stops.flatMap((s) => s.days.map((d) => d.title)).join(' ');
  if (/hike|gorge|trail|climb|mountain/i.test(titles)) {
    items.push({
      id: 'pack-hiking',
      category: 'packing',
      label: 'Hiking shoes with grip',
      detail: 'This trip has a hike, gorge or mountain day — trainers will not do on the trails.',
      dueBy: isoDate(packBy),
      dueLabel: `pack by ${fmtDue(packBy)}`,
    });
  }
  if (/balloon/i.test(titles)) {
    items.push({
      id: 'pack-balloon',
      category: 'packing',
      label: 'Warm layer for the sunrise balloon',
      detail: 'The balloon goes up before dawn — it is cold up there even on a warm day.',
      dueBy: isoDate(packBy),
      dueLabel: `pack by ${fmtDue(packBy)}`,
    });
  }
  items.push(...kidPackingItems(card.kids));
  for (const item of items) {
    if (item.category === 'packing' && !item.dueBy && item.id.startsWith('pack-')) {
      item.dueBy = isoDate(packBy);
      item.dueLabel = `pack by ${fmtDue(packBy)}`;
    }
  }
  return items;
}
