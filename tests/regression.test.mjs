// Round-1 / round-2 regression invariants, rebuilt durably here after
// the originals were lost from /tmp (see the design round's lesson).
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/regression.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  childFareFactor,
  comparisonFor,
  COUNTRY_ROUTES,
  distributeNights,
  flightPassengerFactor,
  serviceFee,
} from '../lib/planner.ts';
import { buildTripCard, mapStopsKey, priceTagAnchorY } from '../lib/tripCard.ts';
import { settleUp } from '../lib/settle.ts';
import { addLeg, bundleFromLegs, bundleTotal, hasLeg } from '../lib/bundle.ts';
import { CLOSURES, CLOSURES_LAST_CHECKED, applySwaps, checkClosures } from '../lib/daySwap.ts';
import { bestTimeFor, seasonFor } from '../lib/bestTime.ts';
import { goNowLine, refundLine } from '../lib/disruption.ts';
import { VISA_LAST_CHECKED, visaForCountry, visaForRoute, visaLine } from '../lib/visa.ts';
import { appendObservation, trendLine } from '../lib/duffel.ts';

test('planner: child fares — under 2 at 10%, 2–11 at 75%, 12+ adult', () => {
  assert.equal(childFareFactor(1), 0.1);
  assert.equal(childFareFactor(2), 0.75);
  assert.equal(childFareFactor(11), 0.75);
  assert.equal(childFareFactor(12), 1);
  assert.equal(childFareFactor(17), 1);
  // 2 adults + 2 kids (4, 7) price flights at 3.5 adult-equivalents.
  assert.equal(flightPassengerFactor(4, { kids: [4, 7] }), 3.5);
  assert.equal(flightPassengerFactor(2), 2);
});

test('planner: the tiered service fee — $19 / $35 / $49, boundaries exact', () => {
  assert.equal(serviceFee(100), 19);
  assert.equal(serviceFee(249), 19);
  assert.equal(serviceFee(250), 35);
  assert.equal(serviceFee(300), 35);
  assert.equal(serviceFee(800), 35);
  assert.equal(serviceFee(801), 49);
  assert.equal(serviceFee(2000), 49);
});

test('planner: Central Europe, 1 traveler — $1,152 / $1,800 / $2,952; separate $2,069, save $269', () => {
  // Base $1,800, approved by the user Nov 12, 2026 (per-route bases).
  // Was $960 / $1,500 / $2,460 under the old $1,500 default base — the
  // Layla-verified totals from Nov 11; the change is the approved table,
  // not a regression.
  const plan = buildPlan('Central Europe', 1, 3);
  assert.deepEqual(plan.options.map((o) => o.total), [1152, 1800, 2952]);
  const c = comparisonFor('Central Europe', 1);
  assert.equal(c.separate.total, 2069);
  assert.equal(c.save, 269);
  // The separate-booking parts sum exactly to the separate total.
  assert.equal(c.separate.flight + c.separate.hotel + c.separate.car + c.separate.activities, c.separate.total);
});

test('planner: distributeNights sums to days - 1 (or one night per stop, when the trip is short)', () => {
  for (const days of [3, 7, 14, 15]) {
    const nights = distributeNights('centraleurope', days);
    // A 3-day trip over 3 stops still needs 1 night per stop — the rule
    // is max(stops, days - 1), not days - 1 alone.
    assert.equal(nights.reduce((s, n) => s + n.nights, 0), Math.max(nights.length, days - 1), `${days} days`);
    assert.ok(nights.every((n) => n.nights >= 1));
  }
  const nights = distributeNights('southeastasia', 15);
  assert.deepEqual(nights.map((n) => n.nights), [4, 3, 7]);
});

test('settle: whole-cent splits, balances sum to zero, minimal payments', () => {
  const { balances, payments } = settleUp(
    [{ id: 'e1', payer: 'Ana', amount: 100, shares: ['Ana', 'Bo'] }],
    ['Ana', 'Bo']
  );
  assert.equal(balances.find((b) => b.person === 'Ana')?.balance, 50);
  assert.equal(balances.find((b) => b.person === 'Bo')?.balance, -50);
  assert.equal(balances.reduce((s, b) => s + b.balance, 0), 0);
  assert.deepEqual(payments, [{ from: 'Bo', to: 'Ana', amount: 50 }]);
  // $10 split 3 ways: the shares add up exactly, no lost cent.
  const three = settleUp([{ id: 'e2', payer: 'Ana', amount: 10, shares: ['Ana', 'Bo', 'Cy'] }], ['Ana', 'Bo', 'Cy']);
  assert.equal(three.balances.reduce((s, b) => s + b.share, 0), 10);
  assert.equal(three.balances.reduce((s, b) => s + b.balance, 0), 0);
  assert.ok(three.payments.length <= 2);
});

test('bundle: exact totals, adding the same leg twice dedupes', () => {
  const card = buildTripCard({ destination: 'Kyoto', travelers: 2, days: 3, month: 0, origin: '' });
  assert.ok(card.legs.length > 0);
  const sum = card.legs.reduce((s, l) => s + l.price, 0);
  const bundle = bundleFromLegs(card.legs, card.legs.map((l) => l.id));
  assert.equal(bundleTotal(bundle), sum);
  const one = bundleFromLegs(card.legs, [card.legs[0].id]);
  const added = addLeg(one, card.legs[0]);
  assert.equal(bundleTotal(added), bundleTotal(one));
  assert.ok(hasLeg(added, card.legs[0].id));
});

test('tripCard: legs sum exactly to the planner totals per kind, for every tier', () => {
  const check = (destination, travelers, days) => {
    for (const tier of [0, 1, 2]) {
      const card = buildTripCard({ destination, travelers, days, month: 0, origin: '', tier });
      const plan = buildPlan(destination, travelers, days).options[tier];
      const sumKind = (kind) => card.legs.filter((l) => l.kind === kind).reduce((s, l) => s + l.price, 0);
      // Flight is split 40% out / 40% back / 20% between cities — the
      // intercity 'transport' legs are part of the flight total.
      assert.equal(sumKind('flight') + sumKind('transport'), plan.flight, `${destination} tier ${tier} flight`);
      // Stays are nudged so they add up exactly to the hotel total.
      assert.equal(sumKind('stay'), plan.hotel, `${destination} tier ${tier} hotel`);
      // Cars split by nights with per-stop rounding — nudged to the exact total.
      assert.equal(sumKind('car'), plan.car, `${destination} tier ${tier} car`);
      // Activities have no leg, so legs sum to total minus activities.
      assert.equal(card.legs.reduce((s, l) => s + l.price, 0), plan.total - plan.activities, `${destination} tier ${tier} legs`);
    }
  };
  check('Central Europe', 1, 14);
  // Single places too: one stop means no intercity legs, so the flight
  // splits 50/50 out/back (Nov 12 fix — the 40/40/20 split stranded 20%
  // of the fare on a Kyoto card).
  check('Kyoto', 2, 3);
  check('Bali', 2, 3);
  // Every route, at its own approved per-route base (Nov 12, 2026):
  // the per-leg rounding that the $1,500 default never exposed must not
  // break the legs-sum invariant anywhere.
  for (const { display } of Object.values(COUNTRY_ROUTES)) check(display, 2, 10);
});

test('tripCard: price-tag anchors stack per city, 46px apart, clear of the marker', () => {
  // Nov 12 layout rebuild: Budapest carries 4 legs (flight-back, train,
  // stay, car) and the old single anchor piled them into one unreadable
  // stack. Anchors must be distinct per city, 46px apart, bottom tag
  // 62px above the city point (clear of the numbered marker).
  const check = (destination, travelers, days) => {
    const card = buildTripCard({ destination, travelers, days, month: 0, origin: '' });
    const anchors = priceTagAnchorY(card.legs);
    assert.equal(anchors.size, card.legs.length, `${destination}: every leg gets an anchor`);
    const byCity = new Map();
    for (const leg of card.legs) {
      const g = byCity.get(leg.city) ?? [];
      g.push(anchors.get(leg.id));
      byCity.set(leg.city, g);
    }
    for (const [city, vals] of byCity) {
      const sorted = [...vals].sort((a, b) => b - a);
      assert.equal(new Set(vals).size, vals.length, `${destination} ${city}: no two tags share an anchor`);
      assert.equal(Math.min(...vals), 62, `${destination} ${city}: bottom tag sits 62px above the city`);
      for (let i = 1; i < sorted.length; i++) {
        assert.equal(sorted[i - 1] - sorted[i], 46, `${destination} ${city}: tags are 46px apart`);
      }
    }
    // Budapest is the worst case on the Central Europe route: 4 legs.
    if (destination === 'Central Europe') {
      assert.equal(byCity.get('Budapest').length, 4, 'Budapest carries 4 legs');
    }
  };
  check('Central Europe', 2, 14);
  check('Kyoto', 2, 3);
});

test('daySwap: the verified closures — Louvre Tue, Uffizi Mon, Vatican Sun except last Sunday', () => {
  assert.equal(CLOSURES_LAST_CHECKED, '2026-11-12');
  const louvre = CLOSURES.find((c) => c.attraction === 'Louvre');
  assert.ok(louvre);
  // Tue 2027-01-05 vs Wed 2027-01-06.
  assert.equal(louvre.closedOn(new Date(2027, 0, 5)), true);
  assert.equal(louvre.closedOn(new Date(2027, 0, 6)), false);
  const uffizi = CLOSURES.find((c) => c.attraction === 'Uffizi Gallery');
  assert.ok(uffizi);
  assert.equal(uffizi.closedOn(new Date(2027, 0, 4)), true); // Monday
  assert.equal(uffizi.closedOn(new Date(2027, 0, 5)), false);
  const vatican = CLOSURES.find((c) => c.attraction === 'Vatican Museums');
  assert.ok(vatican);
  assert.equal(vatican.closedOn(new Date(2026, 10, 22)), true); // Sunday, not last
  assert.equal(vatican.closedOn(new Date(2026, 10, 29)), false); // last Sunday of Nov 2026
  assert.equal(vatican.closedOn(new Date(2026, 10, 30)), false); // Monday
  assert.ok(vatican.note.includes('last Sunday'));
});

test('daySwap: checkClosures flags a Louvre Tuesday, applySwaps moves the day', () => {
  const card = buildTripCard({ destination: 'Paris', travelers: 2, days: 3, month: 0, origin: '' });
  assert.ok(card);
  // Deterministic dates: day 1 is Tue 2027-01-05 (Louvre closed), day 2
  // is Wed 2027-01-06 (open) — the card's real dates are ignored here.
  const withLouvre = {
    ...card,
    stops: card.stops.map((s, i) =>
      i === 0
        ? {
            ...s,
            days: [
              { day: 1, date: new Date(2027, 0, 5), title: 'Louvre and museums', experiences: 3, weatherF: 45 },
              { day: 2, date: new Date(2027, 0, 6), title: 'Seine river walk', experiences: 2, weatherF: 46 },
            ],
          }
        : s
    ),
  };
  const hits = checkClosures(withLouvre);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].attraction, 'Louvre');
  assert.equal(hits[0].day, 1);
  // Swap the two days: the Louvre title moves to Wednesday, which is open.
  const swapped = applySwaps(withLouvre, [
    {
      type: 'weather',
      city: 'Paris',
      fromDay: 1,
      toDay: 2,
      fromTitle: 'Louvre and museums',
      toTitle: 'Seine river walk',
      reason: 'Rain on Tuesday — move the outdoor day.',
    },
  ]);
  assert.equal(checkClosures(swapped).length, 0);
});

test('bestTime: 12 months for a destination', () => {
  const bt = bestTimeFor('Kyoto');
  assert.equal(bt.months.length, 12);
  assert.deepEqual(bt.months.map((m) => m.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(['peak', 'shoulder', 'low'].includes(seasonFor('kyoto', 4)));
});

test('disruption: Go Now only inside 4 hours; refund line names the regime', () => {
  assert.equal(goNowLine(null), null);
  assert.equal(goNowLine(undefined), null);
  const now = new Date('2026-11-11T12:00:00.000Z').getTime();
  assert.ok(goNowLine(new Date('2026-11-11T12:30:00.000Z').toISOString(), now)?.includes('30 minutes'));
  assert.equal(goNowLine(new Date('2026-11-12T12:00:00.000Z').toISOString(), now), null); // >4h out
  assert.ok(refundLine('europe', 'New York').includes('EU261') || refundLine('europe', 'New York').includes('7'));
});

test('visa: US-passport answers carry an official source URL', () => {
  assert.equal(VISA_LAST_CHECKED, '2026-11-11');
  const france = visaForCountry('France');
  assert.ok(france);
  assert.ok(france.sourceUrl.startsWith('https://'));
  const route = visaForRoute('centraleurope');
  assert.ok(route.length >= 1);
  assert.ok(route.every((v) => v.sourceUrl.startsWith('https://')));
  const line = visaLine('Paris');
  assert.ok(line.includes('Entry (US passport)'));
  assert.ok(line.includes('France'));
  assert.ok(line.includes('official source links'));
});

test('duffel trend: same-day same-total dedupes; confidence low then medium', () => {
  const day = '2026-11-11T10:00:00.000Z';
  let obs = appendObservation([], 250, day);
  assert.equal(obs.length, 1);
  obs = appendObservation(obs, 250, '2026-11-11T18:00:00.000Z');
  assert.equal(obs.length, 1); // same day, same total — not a new observation
  obs = appendObservation(obs, 240, '2026-11-12T10:00:00.000Z');
  assert.equal(obs.length, 2);
  const two = trendLine(obs);
  assert.equal(two.confidence, 'low');
  assert.ok(two.line.includes('$240'));
  obs = appendObservation(obs, 235, '2026-11-13T10:00:00.000Z');
  assert.equal(trendLine(obs).confidence, 'medium');
  assert.equal(trendLine([]).confidence, 'none');
  assert.equal(trendLine(obs.slice(0, 1)).confidence, 'none');
});

test('live panel: mapStopsKey is stable for the same route, different for a revision', () => {
  // The map refits only when this key changes — a re-render with the
  // same stops must not refit (typing the chat would otherwise jump
  // the map), and a revision must refit to the new route.
  const base = [{ city: 'Prague' }, { city: 'Vienna' }, { city: 'Budapest' }];
  assert.equal(mapStopsKey(base), mapStopsKey([...base]));
  assert.equal(mapStopsKey(base), 'Prague → Vienna → Budapest');
  assert.notEqual(mapStopsKey(base), mapStopsKey([{ city: 'Prague' }, { city: 'Krakow' }, { city: 'Vienna' }]));
  assert.notEqual(mapStopsKey(base), mapStopsKey([{ city: 'Vienna' }, { city: 'Prague' }, { city: 'Budapest' }]));
  assert.equal(mapStopsKey([]), '');
});

test('live panel: a route revision re-cards the trip — buildTripCard follows routeOverride', () => {
  // Layla-dynamic round: the live panel re-renders on revision, and
  // the card underneath is this — same destination, new stops, nights
  // still summing to the trip length.
  const base = { destination: 'Central Europe', travelers: 2, days: 14, month: 0, origin: 'New York' };
  const original = buildTripCard(base);
  assert.deepEqual(original.stops.map((s) => s.city), ['Prague', 'Vienna', 'Budapest']);
  const revised = buildTripCard({ ...base, routeOverride: { cities: ['Prague', 'Krakow', 'Vienna'], label: 'Prague → Krakow → Vienna' } });
  assert.deepEqual(revised.stops.map((s) => s.city), ['Prague', 'Krakow', 'Vienna']);
  assert.equal(revised.stops.reduce((n, s) => n + s.nights, 0), 13); // days - 1
  // The revised card still covers the same trip length — the totals
  // the panel shows never drift from the plan. (13 itinerary day
  // entries: the 14th day is the departure day, which belongs to no
  // stop — it is the return flight, shown separately.)
  assert.equal(revised.stops.reduce((n, s) => n + s.days.length, 0), 13);
  assert.deepEqual(revised.stops.flatMap((s) => s.days.map((d) => d.day)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  // And the trip signature the panel keys on differs between the two.
  const sig = (override) => [base.destination, base.travelers, base.origin, base.month, base.days, JSON.stringify(override ?? null), 1].join('|');
  assert.notEqual(sig(null), sig({ cities: ['Prague', 'Krakow', 'Vienna'], label: 'Prague → Krakow → Vienna' }));
});
