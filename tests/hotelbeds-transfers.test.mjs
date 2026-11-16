// Hotelbeds sandbox transfers (Nov 16, 2026): the Taxis tab's
// airport-transfer source, in TEST mode — wired, toggle OFF.
// The sample payloads below are built from Hotelbeds' own
// Transfers docs (Availability Simple page + OpenAPI spec, read
// live Nov 16, 2026) — not from live calls: the keys do not exist
// in this VM. The mapping (incl. price), the URL shape, the
// sandbox labeling, the toggle gating, and the cache/degrade
// behavior are all pinned here; sandbox transfers are verified
// after Deploy, once the keys are in DigitalOcean and the toggle
// is flipped.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/hotelbeds-transfers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOTELBEDS_PRODUCTS } from '../lib/hotelbeds.ts';
import {
  clearHotelbedsTransfersCache,
  hotelbedsTransfersEmptyMessage,
  hotelbedsTransfersSandboxTag,
  mapAvailabilityTransfers,
  parseTransfersResponse,
  searchHotelbedsTransfers,
  transferAvailabilityPath,
} from '../lib/hotelbeds-transfers.ts';

const realFetch = globalThis.fetch;
const realKey = process.env.HOTELBEDS_TRANSFERS_API_KEY;
const realSecret = process.env.HOTELBEDS_TRANSFERS_API_SECRET;

function restore() {
  globalThis.fetch = realFetch;
  clearHotelbedsTransfersCache();
  HOTELBEDS_PRODUCTS.transfers = false;
  if (realKey === undefined) delete process.env.HOTELBEDS_TRANSFERS_API_KEY;
  else process.env.HOTELBEDS_TRANSFERS_API_KEY = realKey;
  if (realSecret === undefined) delete process.env.HOTELBEDS_TRANSFERS_API_SECRET;
  else process.env.HOTELBEDS_TRANSFERS_API_SECRET = realSecret;
}

function withKeys() {
  process.env.HOTELBEDS_TRANSFERS_API_KEY = 'test-trf-key';
  process.env.HOTELBEDS_TRANSFERS_API_SECRET = 'test-trf-secret';
}

function enable() {
  HOTELBEDS_PRODUCTS.transfers = true;
}

// A canned availability reply (official response shape:
// {search, services: [{id, direction, transferType, vehicle:
// {code, name}, category: {code, name}, pickupInformation:
// {date, time, from, to}, minPaxCapacity, maxPaxCapacity,
// content: {transferRemarks: {description}, images: [{url,
// type}]}, price: {currencyId, netAmount, totalAmount}, rateKey,
// cancellationPolicies}]}). The cheapest service is deliberately
// second, so the min-pick is actually tested.
const AVAILABILITY_SAMPLE = {
  search: { language: 'en' },
  services: [
    {
      id: 1,
      direction: 'DEPARTURE',
      transferType: 'PRIVATE',
      vehicle: { code: 'PVT', name: 'Private Sedan' },
      category: { code: 'STND', name: 'Standard' },
      pickupInformation: {
        date: '2027-01-15',
        time: '12:00',
        from: { code: 'CDG', description: 'Paris Charles de Gaulle Airport' },
        to: { code: '48.86,2.35', description: 'Paris city centre' },
      },
      minPaxCapacity: 1,
      maxPaxCapacity: 3,
      content: {
        transferRemarks: { type: 'CONTRACT', description: 'Meet at arrivals.' },
        images: [],
      },
      price: { currencyId: 'EUR', netAmount: 55, totalAmount: 65 },
      rateKey: 'rk-private',
      cancellationPolicies: [],
    },
    {
      id: 2,
      direction: 'DEPARTURE',
      transferType: 'SHARED',
      vehicle: { code: 'SHU', name: 'Shared Shuttle' },
      category: { code: 'STND', name: 'Standard' },
      pickupInformation: {
        date: '2027-01-15',
        time: '12:00',
        from: { code: 'CDG', description: 'Paris Charles de Gaulle Airport' },
        to: { code: '48.86,2.35', description: 'Paris city centre' },
      },
      minPaxCapacity: 1,
      maxPaxCapacity: 8,
      content: { transferRemarks: { type: 'CONTRACT', description: 'Shuttle departs every 30 minutes.' }, images: [] },
      price: { currencyId: 'EUR', netAmount: 20, totalAmount: 25 },
      rateKey: 'rk-shared',
      cancellationPolicies: [],
    },
    // Unknown transfer type: dropped, never shown as a mystery service.
    {
      id: 3,
      direction: 'DEPARTURE',
      transferType: 'LUXURY',
      vehicle: { code: 'LIMO', name: 'Limousine' },
      category: { code: 'LUX', name: 'Luxury' },
      pickupInformation: { date: '2027-01-15', time: '12:00' },
      price: { currencyId: 'EUR', netAmount: 200, totalAmount: 220 },
      rateKey: 'rk-limo',
    },
    // No price: dropped, never a $0 card.
    {
      id: 4,
      direction: 'DEPARTURE',
      transferType: 'PRIVATE',
      vehicle: { code: 'PVT', name: 'Private Sedan' },
      category: { code: 'STND', name: 'Standard' },
      pickupInformation: { date: '2027-01-15', time: '12:00' },
      price: { currencyId: 'EUR' },
      rateKey: 'rk-noprice',
    },
  ],
};

const PARIS_AIRPORT = {
  fromType: 'IATA',
  fromCode: 'CDG',
  toType: 'GPS',
  toCode: '48.86,2.35',
  fromLabel: 'Paris',
  toLabel: 'Paris',
  outbound: '2027-01-15T12:00:00',
  adults: 2,
};

test('toggle: transfers is wired but switched off by default', () => {
  assert.equal(HOTELBEDS_PRODUCTS.transfers, false);
});

test('endpoint: the Availability Simple path matches the docs shape exactly', () => {
  assert.equal(
    transferAvailabilityPath(PARIS_AIRPORT),
    '/transfer-api/1.0/availability/en/from/IATA/CDG/to/GPS/48.86,2.35/2027-01-15T12:00:00/2/0/0'
  );
});

test('mapping: cheapest first, total price for the party, vehicle + pickup carried', () => {
  const transfers = mapAvailabilityTransfers(AVAILABILITY_SAMPLE, 2);
  assert.ok(transfers);
  assert.equal(transfers.length, 2);
  assert.equal(transfers[0].id, 2);
  assert.equal(transfers[0].transferType, 'SHARED');
  assert.equal(transfers[0].vehicleName, 'Shared Shuttle');
  assert.equal(transfers[0].price, 25);
  assert.equal(transfers[0].perTraveler, 13);
  assert.equal(transfers[0].currency, 'EUR');
  assert.equal(transfers[0].maxPaxCapacity, 8);
  assert.equal(transfers[0].pickupDate, '2027-01-15');
  assert.equal(transfers[0].pickupTime, '12:00');
  assert.equal(transfers[0].fromDescription, 'Paris Charles de Gaulle Airport');
  assert.equal(transfers[0].toDescription, 'Paris city centre');
  assert.equal(transfers[0].remarks, 'Shuttle departs every 30 minutes.');
  assert.equal(transfers[1].id, 1);
  assert.equal(transfers[1].transferType, 'PRIVATE');
  assert.equal(transfers[1].price, 65);
  assert.equal(transfers[1].perTraveler, 33);
  assert.ok(!transfers.some((t) => t.id === 3 || t.id === 4));
});

test('mapping: malformed responses are null, never guessed transfers', () => {
  assert.equal(mapAvailabilityTransfers({}, 2), null);
  assert.equal(mapAvailabilityTransfers({ services: 'nope' }, 2), null);
  assert.equal(parseTransfersResponse(AVAILABILITY_SAMPLE)?.length, 4);
  assert.equal(parseTransfersResponse(null), null);
});

test('sandbox labeling: every tag says sandbox + test data + not bookable, with the check date', () => {
  const tag = hotelbedsTransfersSandboxTag('2027-01-15');
  assert.match(tag, /Hotelbeds/i);
  assert.match(tag, /Sandbox/i);
  assert.match(tag, /test data/i);
  assert.match(tag, /not a bookable transfer/i);
  assert.ok(tag.includes('2027-01-15'), 'check date is in the tag');
});

test('empty messages: disabled, no key, no airport, and quota each name the real cause', () => {
  assert.match(hotelbedsTransfersEmptyMessage('disabled'), /switched off/);
  assert.match(hotelbedsTransfersEmptyMessage('no_key'), /not connected yet/);
  assert.match(hotelbedsTransfersEmptyMessage('no_key'), /HOTELBEDS_TRANSFERS_API_KEY/);
  assert.match(hotelbedsTransfersEmptyMessage('no_airport'), /to and from airports/);
  assert.match(hotelbedsTransfersEmptyMessage('quota_exceeded'), /50 requests a day/);
  assert.match(hotelbedsTransfersEmptyMessage('no_transfers'), /no test transfers/);
});

test('search: switched off means disabled and no network call, whatever the keys', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    withKeys();
    const res = await searchHotelbedsTransfers(PARIS_AIRPORT);
    assert.equal(res.live, false);
    assert.equal(res.enabled, false);
    assert.equal(res.reason, 'disabled');
    assert.equal(res.sandbox, true);
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test('search: on + keys means one GET, services mapped, second search cached', async () => {
  const calls = [];
  let seenUrl = '';
  let seenHeaders = null;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    seenUrl = String(url);
    seenHeaders = init.headers;
    return { ok: true, status: 200, json: async () => AVAILABILITY_SAMPLE };
  };
  try {
    enable();
    withKeys();
    const res = await searchHotelbedsTransfers(PARIS_AIRPORT);
    assert.equal(res.live, true);
    assert.equal(res.enabled, true);
    assert.equal(res.active, true);
    assert.equal(res.transfers.length, 2);
    assert.equal(res.checkedAt, new Date().toISOString().slice(0, 10));
    assert.equal(res.outbound, '2027-01-15T12:00:00');
    assert.ok(seenUrl.includes('/transfer-api/1.0/availability/en/from/IATA/CDG/to/GPS/48.86,2.35/2027-01-15T12:00:00/2/0/0'));
    assert.equal(seenHeaders['Api-key'], 'test-trf-key');
    assert.match(seenHeaders['X-Signature'], /^[0-9a-f]{64}$/);
    assert.equal(calls.length, 1);
    const again = await searchHotelbedsTransfers(PARIS_AIRPORT);
    assert.equal(again.live, true);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test('search: a 204 is no_transfers, an honest empty — not an error', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 204, json: async () => ({}) });
  try {
    enable();
    withKeys();
    const res = await searchHotelbedsTransfers(PARIS_AIRPORT);
    assert.equal(res.live, false);
    assert.equal(res.reason, 'no_transfers');
    assert.deepEqual(res.transfers, []);
  } finally {
    restore();
  }
});

test('search: a 403 quota answer blocks further calls without burning the quota', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 403, json: async () => ({}) };
  };
  try {
    enable();
    withKeys();
    const first = await searchHotelbedsTransfers(PARIS_AIRPORT);
    assert.equal(first.reason, 'quota_exceeded');
    const second = await searchHotelbedsTransfers(PARIS_AIRPORT);
    assert.equal(second.reason, 'quota_exceeded');
    assert.equal(calls, 1, 'the second search never hit the network');
  } finally {
    restore();
  }
});

test('wiring: the Taxis tab gates the section on the toggle and keeps its header while off', () => {
  const src = readFileSync(new URL('../components/SearchResults.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('HotelbedsTransfers'), 'TaxiResults renders the Hotelbeds section');
  assert.ok(src.includes("hotelbedsProductEnabled('transfers')"), 'the section mounts only while the toggle is on');
  assert.ok(src.includes('/api/hotelbeds-transfers'), 'the section fetches the new route');
  assert.ok(src.includes('hotelbedsTransfersSandboxTag'), 'every transfer card carries the sandbox tag');
  assert.ok(
    src.includes('Live taxi prices arrive when Uber / Lyft / Mozio connect.'),
    'the header still says live taxis arrive with Uber — the product is off, so nothing claims otherwise'
  );
  const cardStart = src.indexOf('function HotelbedsTransferCard');
  const cardEnd = src.indexOf('function HotelbedsTransfers');
  assert.ok(cardStart > -1 && cardEnd > cardStart, 'transfer card component exists');
  const card = src.slice(cardStart, cardEnd);
  assert.ok(card.includes('Save this search'), 'transfer cards keep Save this search');
  assert.ok(!/Book now/i.test(card), 'no Book now on a sandbox transfer card');
  const route = readFileSync(new URL('../app/api/hotelbeds-transfers/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('CITY_IATA'), 'the route resolves airport codes, never a guessed terminal');
  assert.ok(route.includes("sandbox: true"), 'the route marks every response sandbox');
  assert.ok(route.includes('no_airport'), 'the route requires an airport on one end');
});
