// Per-person + total and settle-up (competitor learning round 2 #8).
//
// Two separate jobs, one rule: NO money moves here. FujinTrip records
// who paid what and simplifies who owes whom — the travelers settle up
// between themselves, in cash or on their own apps. Nothing is charged,
// transferred or held by FujinTrip.
//
// Amounts are worked in whole cents internally so a split never loses
// a cent: each expense's shares add up to its amount exactly (the
// leftover cents go to the first sharer), and the balances always sum
// to zero.

export type Expense = {
  id: string;
  payer: string;
  amount: number; // dollars, as the traveler typed it
  shares: string[]; // the people who split this expense (empty = everyone)
  note?: string;
};

export type PersonBalance = {
  person: string;
  paid: number; // dollars this person paid
  share: number; // dollars of the shared costs this person owes
  balance: number; // paid - share; positive = others owe them
};

export type Settlement = { from: string; to: string; amount: number };

const toCents = (dollars: number): number => Math.round(dollars * 100);
const toDollars = (cents: number): number => cents / 100;

export function settleUp(expenses: Expense[], people: string[]): { balances: PersonBalance[]; payments: Settlement[] } {
  const clean = people.filter(Boolean);
  const paidCents = new Map<string, number>();
  const shareCents = new Map<string, number>();
  for (const p of clean) {
    paidCents.set(p, 0);
    shareCents.set(p, 0);
  }
  for (const e of expenses ?? []) {
    const amount = toCents(e.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const sharers = (e.shares ?? []).filter((s) => clean.includes(s));
    const split = sharers.length ? sharers : clean;
    if (!split.length) continue;
    if (clean.includes(e.payer)) paidCents.set(e.payer, (paidCents.get(e.payer) ?? 0) + amount);
    // Split equally; the remainder cents (from rounding down) go to the
    // first sharer so the shares always add up to the amount exactly.
    const each = Math.floor(amount / split.length);
    const remainder = amount - each * split.length;
    split.forEach((s, i) => {
      shareCents.set(s, (shareCents.get(s) ?? 0) + each + (i === 0 ? remainder : 0));
    });
  }
  const balances: PersonBalance[] = clean.map((person) => {
    const paid = paidCents.get(person) ?? 0;
    const share = shareCents.get(person) ?? 0;
    return { person, paid: toDollars(paid), share: toDollars(share), balance: toDollars(paid - share) };
  });
  // Greedy min-cash-flow: the person owed the most is paid first by the
  // person who owes the most — the fewest payments that settle everyone.
  const owed: { person: string; cents: number }[] = [];
  const owes: { person: string; cents: number }[] = [];
  for (const b of balances) {
    const cents = toCents(b.balance);
    if (cents > 0) owed.push({ person: b.person, cents });
    else if (cents < 0) owes.push({ person: b.person, cents: -cents });
  }
  owed.sort((a, b) => b.cents - a.cents);
  owes.sort((a, b) => b.cents - a.cents);
  const payments: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < owes.length && j < owed.length) {
    const take = Math.min(owes[i].cents, owed[j].cents);
    if (take > 0) payments.push({ from: owes[i].person, to: owed[j].person, amount: toDollars(take) });
    owes[i].cents -= take;
    owed[j].cents -= take;
    if (owes[i].cents === 0) i++;
    if (owed[j].cents === 0) j++;
  }
  return { balances, payments };
}

// A readable one-liner for the settle-up table: who pays whom, how much.
export function settlementLine(s: Settlement): string {
  return `${s.from} owes ${s.to} $${s.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
