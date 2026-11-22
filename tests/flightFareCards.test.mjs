// Rich flight fare cards (Nov 15, 2026): the fare rows are full
// cards now — airline logo, times + airport codes, stops with the
// layover airport + wait computed from the offer's own segments,
// flight numbers, cabin, baggage and aircraft only when Duffel
// provides them, total price largest with the per-traveler price
// underneath. No live network: the offers are canned Duffel payloads
// in the shape Offer Requests return. Run: node --no-warnings
// --import ./tests/register-loader.mjs --test tests/flightFareCards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  airlineInitials,
  airlineLogoUrl,
  formatMinutes,
  isTestCarrier,
  layoversFor,
  parseDuffelOffers,
  parseLiveFares,
  perTravelerPrice,
} from '../lib/duffel.ts';
import { serviceFee } from '../lib/planner.ts';

// A two-segment offer with the full Duffel detail: carrier codes,
// flight numbers, airport codes, times, durations, aircraft,
// baggage. The layover is LIS, 06:25 → 07:30 = 65 minutes.
const fullPayload = {
  offers: [
    {
      id: 'off_tap',
      total_amount: '300.00',
      total_currency: 'USD',
      slices: [
        {
          duration: 'PT11H45M',
          segments: [
            {
              operating_carrier: { name: 'TAP Air Portugal', iata_code: 'TP' },
              marketing_carrier: { name: 'TAP Air Portugal', iata_code: 'TP' },
              marketing_carrier_flight_number: '178',
              operating_carrier_flight_number: '178',
              origin: { iata_code: 'JFK', name: 'John F. Kennedy International Airport' },
              destination: { iata_code: 'LIS', name: 'Lisbon Humberto Delgado Airport' },
              departing_at: '2027-01-15T17:40:00',
              arriving_at: '2027-01-16T06:25:00',
              duration: 'PT6H45M',
              aircraft: { name: 'Airbus A330-900' },
              baggages: [{ type: 'carry_on', quantity: 1 }],
            },
            {
              operating_carrier: { name: 'TAP Air Portugal', iata_code: 'TP' },
              marketing_carrier: { name: 'TAP Air Portugal', iata_code: 'TP' },
              marketing_carrier_flight_number: '1024',
              origin: { iata_code: 'LIS' },
              destination: { iata_code: 'FCO', name: 'Leonardo da Vinci–Fiumicino Airport' },
              departing_at: '2027-01-16T07:30:00',
              arriving_at: '2027-01-16T11:25:00',
              duration: 'PT2H55M',
              aircraft: { name: 'Airbus A320neo' },
              baggages: [],
            },
          ],
        },
      ],
    },
  ],
};

test('airlineLogoUrl: built from the carrier code, never hardcoded per airline', () => {
  assert.equal(airlineLogoUrl('BA'), 'https://images.kiwi.com/airlines/64x64/BA.png');
  assert.equal(airlineLogoUrl('aa'), 'https://images.kiwi.com/airlines/64x64/AA.png', 'codes are normalized to uppercase');
  assert.equal(airlineLogoUrl(' tp '), 'https://images.kiwi.com/airlines/64x64/TP.png', 'codes are trimmed');
  assert.equal(airlineLogoUrl('LH'), 'https://images.kiwi.com/airlines/64x64/LH.png');
  assert.equal(airlineLogoUrl('EK'), 'https://images.kiwi.com/airlines/64x64/EK.png');
});

test('airlineInitials: first letters of the first two words', () => {
  assert.equal(airlineInitials('British Airways'), 'BA');
  assert.equal(airlineInitials('TAP Air Portugal'), 'TA');
  assert.equal(airlineInitials('American'), 'A');
  assert.equal(airlineInitials('Duffel Airways'), 'DA');
  assert.equal(airlineInitials(''), '?');
});

test('isTestCarrier: Duffel Airways is the fictional test carrier, real airlines are not', () => {
  assert.equal(isTestCarrier('Duffel Airways'), true);
  assert.equal(isTestCarrier('DUFFEL AIRWAYS'), true);
  assert.equal(isTestCarrier('British Airways'), false);
  assert.equal(isTestCarrier('TAP Air Portugal'), false);
  assert.equal(isTestCarrier(''), false);
});

test('AirlineLogo: initials tile on missing code, test carrier, or load error — never a broken image', () => {
  const src = readFileSync(new URL('../components/AirlineLogo.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('airlineLogoUrl(code)'), 'the logo URL comes from the carrier code');
  assert.ok(src.includes("loading=\"lazy\""), 'the logo loads lazily');
  assert.ok(src.includes('onError={() => setFailed(true)}'), 'a failed load flips to the fallback');
  assert.ok(src.includes('airlineInitials(name)'), 'the fallback is the initials tile');
  assert.ok(src.includes('isTestCarrier(name)'), 'the test carrier gets the initials tile, never a fetched logo');
  assert.ok(src.includes('!code'), 'a missing code gets the initials tile');
  assert.ok(src.includes('img.naturalWidth === 0'), 'a cached image that never decoded also falls back');
  assert.ok(src.includes('className="airline-logo-fallback"'), 'the fallback is a styled tile, not an img');
  assert.ok(!src.includes('<img') || src.includes('alt=""'), 'the logo img is decorative — the airline name is text beside it');
});

test('formatMinutes: layover and duration minutes read like Google Flights', () => {
  assert.equal(formatMinutes(65), '1h 5m');
  assert.equal(formatMinutes(45), '45m');
  assert.equal(formatMinutes(120), '2h');
  assert.equal(formatMinutes(0), '0m');
  assert.equal(formatMinutes(705), '11h 45m');
  assert.equal(formatMinutes(-5), '');
  assert.equal(formatMinutes(Number.NaN), '');
});

test('layoversFor: computed from the segments absolute times, never guessed', () => {
  const [tap] = parseDuffelOffers(fullPayload);
  const layovers = layoversFor(tap);
  assert.equal(layovers.length, 1, 'two segments is one layover');
  assert.equal(layovers[0].airport, 'LIS', 'the layover airport is the arriving segment destination');
  assert.equal(layovers[0].minutes, 65, '06:25 → 07:30 is 65 minutes');
  // A nonstop offer has no layovers at all.
  const [nonstop] = parseDuffelOffers({
    offers: [
      {
        total_amount: '434.00',
        total_currency: 'USD',
        slices: [{ duration: 'PT7H5M', segments: [{ operating_carrier: { name: 'American Airlines', iata_code: 'AA' }, departing_at: '2027-01-15T08:30:00', arriving_at: '2027-01-15T20:35:00' }] }],
      },
    ],
  });
  assert.deepEqual(layoversFor(nonstop), []);
  // Midnight crossing: 23:40 → 00:50 next day is 70 minutes.
  const cross = {
    airline: 'X',
    price: 100,
    currency: 'USD',
    stops: 1,
    duration: '5h',
    segments: [
      { carrierName: 'X', from: 'JFK', to: 'LIS', arriveIso: '2027-01-15T23:40:00' },
      { carrierName: 'X', from: 'LIS', to: 'FCO', departIso: '2027-01-16T00:50:00' },
    ],
  };
  assert.equal(layoversFor(cross)[0].minutes, 70);
  // Missing times: the airport is still named, the wait is unknown.
  const unknown = {
    airline: 'X',
    price: 100,
    currency: 'USD',
    stops: 1,
    duration: '5h',
    segments: [
      { carrierName: 'X', from: 'JFK', to: 'LIS' },
      { carrierName: 'X', from: 'LIS', to: 'FCO' },
    ],
  };
  assert.deepEqual(layoversFor(unknown), [{ airport: 'LIS', minutes: undefined }]);
  // No segments: no layovers, no crash.
  assert.deepEqual(layoversFor({ airline: 'X', price: 100, currency: 'USD', stops: 0, duration: '5h' }), []);
});

test('perTravelerPrice: the party total divided, rounded, never a fraction', () => {
  assert.equal(perTravelerPrice(434, 2), 217);
  assert.equal(perTravelerPrice(435, 2), 218, 'odd totals round to the nearest dollar');
  assert.equal(perTravelerPrice(300, 1), 300);
  assert.equal(perTravelerPrice(300, 0), 300, 'a bad party size is the total itself');
  assert.equal(perTravelerPrice(900, 3), 300);
});

test('parseDuffelOffers: full segment detail parses — code, flight numbers, aircraft, airports', () => {
  const [tap] = parseDuffelOffers(fullPayload);
  assert.equal(tap.airline, 'TAP Air Portugal');
  assert.equal(tap.carrierCode, 'TP', 'the offer carries the operating carrier code for the logo');
  assert.equal(tap.price, 300);
  assert.equal(tap.stops, 1);
  assert.equal(tap.duration, '11h 45m');
  assert.equal(tap.departTime, '5:40 PM');
  assert.equal(tap.arriveTime, '11:25 AM');
  assert.equal(tap.bags, 'carry-on only (no checked bag included)');
  assert.equal(tap.segments?.length, 2);
  const [first, second] = tap.segments ?? [];
  assert.equal(first.carrierCode, 'TP');
  assert.equal(first.carrierName, 'TAP Air Portugal');
  assert.equal(first.flightNumber, 'TP178', 'the flight number is the marketing code + number');
  assert.equal(first.from, 'JFK');
  assert.equal(first.to, 'LIS');
  assert.equal(first.departTime, '5:40 PM');
  assert.equal(first.arriveTime, '6:25 AM');
  assert.equal(first.duration, '6h 45m');
  assert.equal(first.aircraft, 'Airbus A330-900');
  assert.equal(second.flightNumber, 'TP1024');
  assert.equal(second.from, 'LIS');
  assert.equal(second.to, 'FCO');
  assert.equal(second.aircraft, 'Airbus A320neo');
  // The old flat fields still work for existing callers.
  assert.equal(tap.departMinutes, 17 * 60 + 40);
  assert.equal(tap.durationMinutes, 705);
});

test('parseDuffelOffers: segments without detail stay honest — no invented codes, numbers, or aircraft', () => {
  const [ba] = parseDuffelOffers({
    offers: [
      {
        total_amount: '500.00',
        total_currency: 'USD',
        slices: [
          {
            duration: 'PT9H20M',
            segments: [{ operating_carrier: { name: 'British Airways' }, baggages: [] }],
          },
        ],
      },
    ],
  });
  assert.equal(ba.carrierCode, undefined, 'no code from Duffel means no code on the offer');
  assert.equal(ba.segments?.length, 1);
  assert.equal(ba.segments?.[0].carrierName, 'British Airways');
  assert.equal(ba.segments?.[0].flightNumber, undefined, 'no flight number from Duffel means none shown');
  assert.equal(ba.segments?.[0].from, '', 'no airport code from Duffel means an empty code, never guessed');
  assert.equal(ba.segments?.[0].to, '');
  assert.equal(ba.segments?.[0].aircraft, undefined, 'no aircraft from Duffel means none shown');
  assert.equal(ba.bags, undefined, 'no baggage data means no baggage line');
  // An offer with no slices still drops, as before.
  assert.deepEqual(parseDuffelOffers({ offers: [{ total_amount: '100', slices: [] }] }), []);
});

test('parseLiveFares: offers with segments pass, malformed segments fail', () => {
  const good = {
    live: true,
    origin: 'New York',
    destCity: 'London',
    departDate: '2027-01-15',
    returnDate: '2027-01-22',
    travelers: 2,
    out: [
      {
        airline: 'TAP Air Portugal',
        price: 300,
        currency: 'USD',
        stops: 1,
        duration: '11h 45m',
        carrierCode: 'TP',
        segments: [{ carrierName: 'TAP Air Portugal', carrierCode: 'TP', flightNumber: 'TP178', from: 'JFK', to: 'LIS', departTime: '5:40 PM', arriveTime: '6:25 AM', duration: '6h 45m', durationMinutes: 405, aircraft: 'Airbus A330-900' }],
      },
    ],
    back: [],
  };
  assert.deepEqual(parseLiveFares(good), good, 'a well-formed segmented offer passes through');
  assert.equal(
    parseLiveFares({ ...good, out: [{ ...good.out[0], segments: [{ carrierName: 'X', from: 'JFK', to: 'LIS', durationMinutes: '405' }] }] }),
    null,
    'a malformed segment duration fails the payload'
  );
  assert.equal(
    parseLiveFares({ ...good, out: [{ ...good.out[0], carrierCode: 42 }] }),
    null,
    'a malformed carrier code fails the payload'
  );
  assert.equal(
    parseLiveFares({ ...good, out: [{ ...good.out[0], segments: [{ from: 'JFK', to: 'LIS' }] }] }),
    null,
    'a segment without a carrier name fails the payload'
  );
});

test('serviceFee tiers: the fee line on the Duffel column follows the displayed total', () => {
  assert.equal(serviceFee(240), 19, 'under $250 is $19');
  assert.equal(serviceFee(250), 35, '$250 is $35');
  assert.equal(serviceFee(434), 35, 'the $434 test total is $35');
  assert.equal(serviceFee(800), 35, '$800 is $35');
  assert.equal(serviceFee(2609), 49, 'over $800 is $49');
});

test('FareCard: logo, timeline, stops with layovers, details toggle, price — in all three trip types', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('<FareCard'), 'the rich card replaces the thin fare row');
  assert.ok(!src.includes('fareRow'), 'no thin fare row remains');
  assert.ok(src.includes('<AirlineLogo code={offer.carrierCode} name={offer.airline}'), 'the logo comes from the offer carrier code');
  assert.ok(src.includes('layoversFor(offer)'), 'layovers are computed from the offer segments');
  assert.ok(src.includes('Flight details'), 'each card has an expandable details toggle');
  assert.ok(src.includes('aria-expanded={open}'), 'the toggle announces its state');
  assert.ok(src.includes('fare-card-segments'), 'the expanded details list the segments');
  assert.ok(src.includes('Layover in {layovers[i].airport}'), 'each layover names its airport');
  // The per-traveler figure comes from the shared breakdown
  // helper (rendered-check fix, Nov 21 2026 — the helper renders
  // the line even for one traveler, where the old perPerson
  // variable returned null and the card showed no line at all).
  assert.ok(src.includes('flightBreakdownParts(offer.price, travelers)'), 'the card shows the per-traveler price');
  assert.ok(src.includes('offer.bags &&'), 'baggage shows only when Duffel provides it');
  assert.ok(src.includes('{s.aircraft &&'), 'aircraft shows only when Duffel provides it');
  assert.ok(src.includes('{singleFlight &&'), 'the flight number shows on a single-segment card');
  assert.ok(src.includes('serviceFee(total)'), 'the pair total carries the fee on the card itself');
  assert.ok(src.includes('serviceFee(offer.price)'), 'the one-way total carries the fee on the card itself');
  assert.ok(src.includes('serviceFee(cheapestMultiCityTotal(legLists))'), 'the multi-city total carries the fee line');
  assert.ok(src.includes('travelers={query.travelers}'), 'the card knows the party size');
  assert.ok(src.includes('cabin={query.cabin}'), 'the card shows the searched cabin');
  // All three trip types render the card — Duffel's fares and
  // Ignav's, one merged live list (Nov 15, 2026: the per-source
  // column headers are gone; each fare carries its own small tag).
  // Nov 16, 2026: the merged grid shares one IgnavItineraryGroup
  // for one-way and round-trip itineraries and one DuffelPairCard
  // for the round-trip legs, so the count is 6, not 7 — the
  // one-way Ignav block's separate FareCard is gone, its itineraries
  // now render through the shared group. LetsFG adds a seventh: the
  // LetsfgItineraryGroup renders its legs through FareCard too, the
  // same shared pattern as the Ignav group. Hacker Fares add two
  // more (roadmap, Nov 21 2026 — F13): the hacker card renders one
  // FareCard per leg, out and back, so the count is 9.
  const cardUses = (src.match(/<FareCard/g) ?? []).length;
  assert.equal(
    cardUses,
    9,
    'Duffel: one-way, multi-city, pair out, pair back; Ignav: itinerary-group legs, per-leg multi-city; LetsFG: itinerary-group legs; Hacker: out leg, back leg'
  );
  assert.ok(src.includes('hidePrice'), 'Ignav itinerary groups hide the per-card price — the trip total shows once');
  assert.ok(!src.includes('>Book now<'), 'no rendered Book now button in the results');
});

test('fare cards: the time row wraps as a unit — no overlap at desktop width', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.fare-card{border:1px solid var(--line);border-radius:var(--r-lg)'), 'the card is a 24px-rounded card, not a bare row');
  assert.ok(css.includes('.fare-card-price strong{display:block;font-family:var(--font-display);font-size:24px'), 'the total is the largest type on the card');
  assert.ok(css.includes('.fare-card-toggle{'), 'the details toggle is styled');
  assert.ok(css.includes('min-height:44px'), 'the toggle is a 44px touch target');
  assert.ok(css.includes('.fare-card-chevron{transition:transform 200ms ease'), 'the chevron micro-interaction is 150–300ms, transform only');
  assert.ok(css.includes('.fare-card-details{animation:fare-details-in 200ms ease'), 'the details region fades in 200ms');
  assert.ok(css.includes('@keyframes fare-details-in{from{opacity:0;transform:translateY(-4px)}'), 'the details entrance is opacity + transform only');
  // The Nov 15 overlap defect: .fare-card-main was flex nowrap with
  // the timeline min-width:0, so in a ~335px column the duration
  // overflowed over the times and the price was pushed past the
  // card's right edge. The main row now wraps at every width, the
  // timeline needs a 260px basis before it takes its own row, and
  // the price never shrinks.
  assert.ok(css.includes('.fare-card-main{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}'), 'the card row wraps at every width, not just on a phone');
  assert.ok(css.includes('.fare-card-times{display:flex;align-items:center;gap:12px;flex:1 1 260px'), 'the timeline takes its own full row below ~260px');
  assert.ok(css.includes('.fare-card-airline{display:flex;gap:10px;align-items:center;min-width:0;flex:0 1 180px}'), 'the airline may shrink a little, never below its name');
  assert.ok(css.includes('.fare-card-price{margin-left:auto;text-align:right;flex:0 0 auto}'), 'the price never shrinks — it wraps, never clips');
  assert.ok(css.includes('.fare-card-source{font-size:12px'), 'each fare carries its small source tag');
  assert.ok(css.includes('.fare-card-main{flex-wrap:wrap}'), 'the card wraps on a phone');
  assert.ok(css.includes('.fare-card-airline{flex:1 1 100%}'), 'logo + name take the full phone row');
  assert.ok(css.includes('.fare-card-times{flex:1 1 100%}'), 'the timeline takes its own phone row');
  assert.ok(css.includes('.fare-card-price{margin-left:0;text-align:left'), 'the price drops below, left-aligned, on a phone');
  assert.ok(css.includes('.airline-logo{width:32px;height:32px'), 'the logo is 32px (64px retina asset)');
});

test('icons: the fare card details use the shared Lucide set', () => {
  const icons = readFileSync(new URL('../components/icons.tsx', import.meta.url), 'utf8');
  for (const name of ['luggage', 'chevronDown']) {
    assert.ok(icons.includes(`${name}:`), `the icon set carries ${name}`);
  }
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('<Icon name="luggage"'), 'baggage carries the luggage icon');
  assert.ok(src.includes('<Icon name="chevronDown"'), 'the details toggle carries the chevron icon');
});

test('audit round Nov 17: every flight card has one primary pill + one text link', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  // Duffel cards already had Save; Ignav and LetsFG cards only
  // offered booking, so the cheapest live fare could not be picked.
  // Every trip card now carries the same two actions: one primary
  // pill (Save this fare) + one text link (See booking options).
  // The Ignav card's third action, Set price alert (roadmap,
  // Nov 21 2026 — F5), is a ghost button — still one primary
  // pill + one text link per card.
  for (const group of ['IgnavItineraryGroup', 'LetsfgItineraryGroup']) {
    assert.ok(src.includes(`function ${group}({`), `${group} exists`);
    assert.ok(src.includes('onSaveFare: (fareLabel: string) => void'), `${group} takes the save action`);
  }
  assert.equal((src.match(/\{saved \? 'Saved ✓' : 'Save this fare'\}/g) || []).length, 5, 'Duffel pair + one-way + Ignav + LetsFG + Hacker all offer Save this fare');
  assert.ok(src.includes('onSaveFare={onSaveFare}'), 'the merged grid passes Save to every group');
  // Ignav's booking lookup is the text link now, not a second
  // primary pill; LetsFG's link-out already was one.
  assert.ok(src.includes('<button type="button" className="linklike" onClick={load}>'), 'See booking options is a text link');
  assert.ok(src.includes('See booking options on LetsFG'), 'the LetsFG link-out is still on the card');
  assert.ok(!src.includes('<button type="button" className="primary" onClick={load}>'), 'no primary booking-lookup button remains');
});
