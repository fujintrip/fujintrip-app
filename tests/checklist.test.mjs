// Pre-departure checklist + packing list (round 4 #2, UGC learning
// §3 — FamGo: "a passport closer to expiring than I realized").
// The checklist is generated from the actual trip: passport validity,
// visa/eTA deadlines, insurance, weather-driven packing, kids' ages,
// activities. Every deadline is computed from the trip's start date.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/checklist.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChecklist, checklistKeyFor, CHECKLIST_CATEGORIES } from '../lib/checklist.ts';
import { buildTripCard } from '../lib/tripCard.ts';
import { visaForDestination } from '../lib/visa.ts';
import { checkPassportValidity } from '../lib/passport.ts';

test('buildChecklist: a January Central Europe trip generates layers + waterproofs, with no visa to apply for', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  const items = buildChecklist({ card, visaInfos: visaForDestination('Central Europe') });
  const labels = items.map((i) => i.label);
  assert.ok(labels.some((l) => l.includes('Pack warm layers')), 'Prague in January is 37°F — layers');
  assert.ok(labels.some((l) => l.includes('waterproof jacket')), 'January gets the waterproof line');
  assert.ok(labels.some((l) => l.includes('Check your passport expiry')), 'no expiry on file — the item is to check it');
  assert.ok(labels.some((l) => l.includes('Schengen days')), 'the trip spends days in Schengen');
  assert.ok(labels.some((l) => l.includes('travel insurance within 14 days')), 'the insurance window is named');
  assert.ok(!labels.some((l) => l.includes('Apply for')), 'a US passport needs no visa for Central Europe — no invented apply item');
  const warm = items.find((i) => i.label.includes('Pack warm layers'));
  assert.ok(warm?.detail?.includes('37°F'), 'the packing line names the seasonal average it came from');
  assert.ok(warm?.dueLabel?.startsWith('pack by'), 'packing is due a week before the trip');
  // Every item has a category the UI knows how to group.
  for (const item of items) {
    assert.ok(CHECKLIST_CATEGORIES[item.category], `category ${item.category} is known`);
  }
});

test('buildChecklist: an Egypt trip generates the e-visa apply-by date from the portal\'s own lead time', () => {
  const card = buildTripCard({ destination: 'Egypt', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  const items = buildChecklist({ card, visaInfos: visaForDestination('Egypt') });
  const evisa = items.find((i) => i.label.includes('Apply for the Egypt e-visa'));
  assert.ok(evisa, 'the e-visa item exists');
  assert.ok(evisa?.detail?.includes('visa2egypt.gov.eg'), 'the official portal is named');
  assert.ok(evisa?.dueLabel?.includes('at least 7 days before arrival'), 'the lead time comes from the visa note');
  // The e-visa is due 7 days before the trip starts.
  const start = new Date(card.startDate);
  const due = new Date(evisa?.dueBy ?? '');
  assert.equal(Math.round((start.getTime() - due.getTime()) / 86400000), 7, 'due exactly 7 days before departure');
  assert.ok(!items.some((i) => i.label.includes('visa on arrival')), 'the VOA alternative is not a second item');
});

test('buildChecklist: Thailand generates the TDAC arrival card, the UK the ETA, Indonesia the levy', () => {
  const thai = buildTripCard({ destination: 'Thailand', travelers: 2, days: 14, month: 2, origin: 'New York' });
  assert.ok(thai);
  const thaiItems = buildChecklist({ card: thai, visaInfos: visaForDestination('Thailand') });
  const tdac = thaiItems.find((i) => i.label.includes('Thailand Digital Arrival Card') || i.label.includes('arrival card'));
  assert.ok(tdac, 'the TDAC item exists');
  assert.ok(tdac?.dueLabel?.includes('within 3 days before arrival'), 'the TDAC window is named');
  const uk = buildTripCard({ destination: 'UK', travelers: 2, days: 7, month: 5, origin: 'New York' });
  assert.ok(uk);
  const ukItems = buildChecklist({ card: uk, visaInfos: visaForDestination('UK') });
  assert.ok(ukItems.some((i) => i.label.includes('Apply for the United Kingdom ETA')), 'the ETA item exists');
  const bali = buildTripCard({ destination: 'Bali', travelers: 2, days: 7, month: 6, origin: 'New York' });
  assert.ok(bali);
  const baliItems = buildChecklist({ card: bali, visaInfos: visaForDestination('Bali') });
  assert.ok(baliItems.some((i) => i.label.includes('e-VOA')), 'the Indonesia e-VOA item exists');
  assert.ok(baliItems.some((i) => i.label.includes('tourist levy')), 'the Bali levy item exists');
  assert.ok(baliItems.some((i) => i.label.includes('Swim kit')), 'Bali gets the swim kit');
});

test('buildChecklist: a tight passport expiry generates a renew-by item 8 weeks before the trip', () => {
  const card = buildTripCard({ destination: 'Central Europe', travelers: 2, days: 14, month: 1, origin: 'New York' });
  assert.ok(card);
  // The trip returns 2027-01-18; a passport expiring March 2027 is
  // only ~2 months past the return, so the Schengen 3-month rule fails.
  const expiry = { month: 3, year: 2027 };
  const checks = checkPassportValidity(expiry, new Date(card.endDate), ['Czech Republic', 'Austria', 'Hungary']);
  const items = buildChecklist({ card, visaInfos: visaForDestination('Central Europe'), passportExpiry: expiry, passportChecks: checks });
  const renew = items.find((i) => i.id === 'passport-renew');
  assert.ok(renew, 'the renew item exists');
  assert.ok(renew?.label.includes('3 months'), 'the rule is named');
  assert.ok(renew?.detail?.includes('denied boarding'), 'the consequence is named');
  const start = new Date(card.startDate);
  const due = new Date(renew?.dueBy ?? '');
  assert.equal(Math.round((start.getTime() - due.getTime()) / 86400000), 56, 'renewal starts 8 weeks before departure');
  assert.ok(!items.some((i) => i.id === 'passport-check'), 'an expiry on file replaces the check item');
});

test('buildChecklist: kids\' ages drive the packing — diapers for a baby, teen gear for a teenager', () => {
  const baby = buildTripCard({ destination: 'Japan', travelers: 3, days: 7, month: 4, origin: 'New York', kids: [1, 4] });
  assert.ok(baby);
  const babyItems = buildChecklist({ card: baby, visaInfos: visaForDestination('Japan') });
  assert.ok(babyItems.some((i) => i.label.includes('Diapers + wipes')), 'a 1-year-old gets diapers');
  assert.ok(babyItems.some((i) => i.label.includes('Snacks, a change of clothes')), 'a 4-year-old gets the toddler kit');
  const teen = buildTripCard({ destination: 'Japan', travelers: 3, days: 7, month: 4, origin: 'New York', kids: [14] });
  assert.ok(teen);
  const teenItems = buildChecklist({ card: teen, visaInfos: visaForDestination('Japan') });
  assert.ok(teenItems.some((i) => i.label.includes('Teen gear')), 'a 14-year-old gets teen gear');
  assert.ok(!teenItems.some((i) => i.label.includes('Diapers')), 'no diapers for a teenager');
});

test('buildChecklist: activities drive the packing — hiking shoes, balloon layer, swim kit', () => {
  // St. George has a Zion day (hiking) and Crete has a gorge day.
  const stg = buildTripCard({ destination: 'St. George', travelers: 2, days: 3, month: 5, origin: 'New York' });
  assert.ok(stg);
  const stgItems = buildChecklist({ card: stg, visaInfos: [] });
  assert.ok(stgItems.some((i) => i.label.includes('Hiking shoes')), 'a Zion day needs hiking shoes');
  const cap = buildTripCard({ destination: 'Turkey', travelers: 2, days: 7, month: 5, origin: 'New York' });
  assert.ok(cap);
  const capItems = buildChecklist({ card: cap, visaInfos: visaForDestination('Turkey') });
  assert.ok(capItems.some((i) => i.label.includes('sunrise balloon')), 'a balloon day needs a warm layer');
  assert.ok(capItems.some((i) => i.label.includes('Swim kit')), 'Antalya is a beach stop');
});

test('checklistKeyFor: one key per trip, stable across views', () => {
  assert.equal(checklistKeyFor('Central Europe', 2, 14), 'fujintrip-checklist:Central Europe:2:14');
  assert.notEqual(checklistKeyFor('Central Europe', 2, 14), checklistKeyFor('Japan', 2, 14));
});
