/**
 * Forgotten-cost all-in lines (round 4 #4, UGC learning §3 — "Most
 * travellers underestimate true costs by 20 to 40 percent because
 * they forget about transport, daily activities, tips, visas, travel
 * insurance, currency conversion fees, and unexpected expenses" and
 * "I blew $4,200 on a 10-day trip to Japan last year. Planned
 * budget? $2,800.").
 *
 * FujinTrip's all-in honesty covers flights + stays + legs; the
 * categories travelers actually forget (food, local transport, bags,
 * resort fees, tips, SIM, insurance, transfers) are invisible in the
 * total. These lines close the gap between the quoted total and the
 * real trip — each shown as a line, each labeled a planning estimate,
 * so the quoted total is the real trip total.
 *
 * The rates are per-region planning estimates (food and transport per
 * day per traveler, transfers per trip, bags per traveler per flight
 * order, tourist tax per night per traveler, tips per day per traveler,
 * SIM per trip, insurance ~7% of the plan total). They are estimates
 * from the region, not live prices — the UI labels every line as such
 * until live inventory exists. A region with no verified tax rate gets
 * no tax line and a warning instead of a guessed number.
 */

export type ForgottenLine = {
  id: string;
  label: string;
  amount: number;
  note: string;
};

export type ForgottenCosts = {
  lines: ForgottenLine[];
  total: number;
  feeWarning: string;
};

type RegionRates = {
  food: number; // per day per traveler
  transport: number; // per day per traveler
  transfer: number; // per airport transfer, per trip
  bag: number; // per checked bag, per traveler per flight order
  tax: number | null; // per night per traveler; null = no verified rate
  tips: number; // per day per traveler (0 where tipping isn't customary)
  sim: number; // per trip
};

const RATES: Record<string, RegionRates> = {
  europe: { food: 45, transport: 12, transfer: 45, bag: 60, tax: 4, tips: 10, sim: 15 },
  japan: { food: 50, transport: 10, transfer: 40, bag: 60, tax: 2, tips: 0, sim: 15 },
  asia: { food: 20, transport: 6, transfer: 20, bag: 40, tax: 1, tips: 3, sim: 15 },
  egypt: { food: 25, transport: 8, transfer: 25, bag: 40, tax: 1, tips: 5, sim: 15 },
  usa: { food: 55, transport: 15, transfer: 50, bag: 60, tax: 5, tips: 15, sim: 15 },
  mexico: { food: 30, transport: 8, transfer: 25, bag: 40, tax: 2, tips: 5, sim: 15 },
  default: { food: 35, transport: 10, transfer: 35, bag: 50, tax: null, tips: 5, sim: 15 },
};

const ROUTE_GROUP: Record<string, keyof typeof RATES> = {
  europe: 'europe',
  centraleurope: 'europe',
  portugal: 'europe',
  france: 'europe',
  italy: 'europe',
  spain: 'europe',
  greece: 'europe',
  uk: 'europe',
  morocco: 'europe',
  turkey: 'europe',
  japan: 'japan',
  thailand: 'asia',
  southeastasia: 'asia',
  india: 'asia',
  egypt: 'egypt',
  usa: 'usa',
  mexico: 'mexico',
};

export function forgottenRatesFor(routeKey: string): RegionRates {
  return RATES[ROUTE_GROUP[routeKey] ?? 'default'];
}

export function forgottenCostLines(opts: {
  planTotal: number;
  days: number;
  travelers: number;
  routeKey: string;
  nights: number;
}): ForgottenCosts {
  const r = forgottenRatesFor(opts.routeKey);
  const lines: ForgottenLine[] = [
    {
      id: 'food',
      label: 'Food & drink',
      amount: r.food * opts.days * opts.travelers,
      note: `about $${r.food} a day per traveler — planning estimate`,
    },
    {
      id: 'transport',
      label: 'Local transport',
      amount: r.transport * opts.days * opts.travelers,
      note: `about $${r.transport} a day per traveler — planning estimate`,
    },
    {
      id: 'transfers',
      label: 'Airport transfers',
      amount: r.transfer * 2,
      note: 'airport ↔ hotel, both ends, per trip — planning estimate',
    },
    {
      id: 'bags',
      label: 'Checked bags',
      amount: r.bag * opts.travelers,
      note: 'one checked bag each, per flight order — planning estimate',
    },
  ];
  if (r.tax !== null) {
    lines.push({
      id: 'tax',
      label: 'Resort / tourist tax',
      amount: r.tax * opts.nights * opts.travelers,
      note: `about $${r.tax} a night per traveler — planning estimate, confirm the exact amount at booking`,
    });
  }
  lines.push({
    id: 'tips',
    label: 'Tips',
    amount: r.tips * opts.days * opts.travelers,
    note:
      r.tips === 0
        ? 'tipping is not customary in Japan — $0, checked'
        : `about $${r.tips} a day per traveler — planning estimate`,
  });
  lines.push({
    id: 'sim',
    label: 'SIM / eSIM',
    amount: r.sim,
    note: 'per trip — planning estimate',
  });
  lines.push({
    id: 'insurance',
    label: 'Travel insurance',
    amount: Math.round(opts.planTotal * 0.07),
    note: 'about 7% of the plan total — planning estimate',
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const feeWarning =
    r.tax === null
      ? 'This total may exclude resort fee / tourist tax — no verified rate for this route, check before booking.'
      : 'This total may exclude resort fee / tourist tax — the tax line above is an estimate, confirm the exact amount at booking.';
  return { lines, total, feeWarning };
}

// The one-line reality check for the chat reply — the plan total, the
// forgotten lines, and the real trip total, all in one sentence.
export function allInLine(planTotal: number, forgotten: ForgottenCosts): string {
  return `All-in reality check (planning estimates): the plan total is $${planTotal.toLocaleString()}, and the costs travelers forget — food, local transport, bags, resort/tourist tax, tips, SIM and insurance — add about $${forgotten.total.toLocaleString()}, for a real trip total of about $${(planTotal + forgotten.total).toLocaleString()}. ${forgotten.feeWarning}`;
}
