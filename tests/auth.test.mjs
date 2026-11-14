// Free-account gate — Clerk sign-in (user chose Clerk + email magic
// link, Nov 14 2026). The gate rule and the one-tap merge bookkeeping
// are pure logic in lib/auth.ts, so they are tested here without keys.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/auth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gateDecision,
  isClerkConfigured,
  mergeKeyFor,
  mergeOfferNeeded,
  readMergeRecord,
  recordMerge,
} from '../lib/auth.ts';

test('isClerkConfigured: real publishable keys pass, everything else does not', () => {
  assert.equal(isClerkConfigured('pk_test_abcdefghij1234567890'), true);
  assert.equal(isClerkConfigured('pk_live_abcdefghij1234567890'), true);
  assert.equal(isClerkConfigured('  pk_test_abcdefghij1234567890  '), true);
  assert.equal(isClerkConfigured(''), false);
  assert.equal(isClerkConfigured(undefined), false);
  assert.equal(isClerkConfigured(null), false);
  assert.equal(isClerkConfigured('pk_test_'), false);
  assert.equal(isClerkConfigured('pk_test_REPLACE_ME'), false);
  // A secret key pasted by mistake must not count as "configured" —
  // the publishable key is the only one the browser ever sees.
  assert.equal(isClerkConfigured('sk_test_abcdefghij1234567890'), false);
  assert.equal(isClerkConfigured('sk_live_abcdefghij1234567890'), false);
});

test('gateDecision: no keys → not-configured; signed out → needs-signin; signed in → allowed', () => {
  assert.equal(gateDecision({ configured: false, signedIn: false }), 'not-configured');
  assert.equal(gateDecision({ configured: false, signedIn: true }), 'not-configured');
  assert.equal(gateDecision({ configured: true, signedIn: false }), 'needs-signin');
  assert.equal(gateDecision({ configured: true, signedIn: true }), 'allowed');
});

// Map-backed fake storage — the merge helpers only touch getItem/setItem.
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    _map: map,
  };
}

test('merge record: round-trips per user, and a foreign or corrupt record reads as no merge', () => {
  const storage = fakeStorage();
  assert.equal(readMergeRecord('user_1', storage), null);
  const record = recordMerge('user_1', ['t1', 't2'], storage, new Date('2026-11-14T11:00:00Z'));
  assert.equal(record.userId, 'user_1');
  assert.deepEqual(record.tripIds, ['t1', 't2']);
  assert.equal(record.movedAt, '2026-11-14T11:00:00.000Z');
  assert.deepEqual(readMergeRecord('user_1', storage), record);
  // Another account sees nothing — the key is per user.
  assert.equal(readMergeRecord('user_2', storage), null);
  // A record stamped for a different user is not a merge for this one.
  const foreign = fakeStorage({ [mergeKeyFor('user_1')]: JSON.stringify({ userId: 'user_9', movedAt: '2026-11-14T11:00:00.000Z', tripIds: ['t1'] }) });
  assert.equal(readMergeRecord('user_1', foreign), null);
  // Corrupt JSON or wrong shape never throws — it reads as no merge.
  const corrupt = fakeStorage({ [mergeKeyFor('user_1')]: '{not json' });
  assert.equal(readMergeRecord('user_1', corrupt), null);
  const wrongShape = fakeStorage({ [mergeKeyFor('user_1')]: JSON.stringify({ userId: 'user_1', movedAt: 'x', tripIds: 't1' }) });
  assert.equal(readMergeRecord('user_1', wrongShape), null);
});

test('mergeOfferNeeded: only a signed-in traveler with unmerged local trips gets the offer', () => {
  const base = { signedIn: true, userId: 'user_1', tripCount: 3, merged: false };
  assert.equal(mergeOfferNeeded(base), true);
  assert.equal(mergeOfferNeeded({ ...base, signedIn: false }), false);
  assert.equal(mergeOfferNeeded({ ...base, userId: null }), false);
  assert.equal(mergeOfferNeeded({ ...base, tripCount: 0 }), false);
  assert.equal(mergeOfferNeeded({ ...base, merged: true }), false);
});
