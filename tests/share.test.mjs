// Unit tests for lib/share.ts — the share-out helpers, plus the
// community feed rules they sit beside (empty feed, unreviewed posts
// never public). Run:
// node --no-warnings --import ./tests/register-loader.mjs --test tests/share.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWebShare, sharePathFor, shareTargets, shareTextFor, shareUrlFor } from '../lib/share.ts';
import { feedFor, moderateCaption } from '../lib/reels.ts';

test('sharePathFor: every kind lands on a real public URL', () => {
  assert.equal(sharePathFor('reel', 'reel_abc'), '/reels/reel_abc');
  assert.equal(sharePathFor('plan', 'aB1cD2'), '/plan/aB1cD2');
  // No per-package page exists — the link lands on the packages grid.
  assert.equal(sharePathFor('package', 'kyoto'), '/#packages');
  assert.equal(sharePathFor('destination', 'Kyoto'), '/?tab=hotels&dest=Kyoto');
  assert.equal(sharePathFor('destination', 'New York'), '/?tab=hotels&dest=New%20York');
  assert.equal(sharePathFor('destination', 'São Paulo'), '/?tab=hotels&dest=S%C3%A3o%20Paulo');
});

test('shareUrlFor: origin joins cleanly, with or without a trailing slash', () => {
  assert.equal(shareUrlFor('https://fujintrip.com', 'reel', 'r1'), 'https://fujintrip.com/reels/r1');
  assert.equal(shareUrlFor('https://fujintrip.com/', 'plan', 'p1'), 'https://fujintrip.com/plan/p1');
  assert.equal(shareUrlFor('https://fujintrip.com', 'package', 'kyoto'), 'https://fujintrip.com/#packages');
});

test('shareTextFor: the text names what is shared, never invents a price', () => {
  assert.equal(shareTextFor('reel', 'Kyoto'), 'Kyoto — a trip shared on FujinTrip');
  assert.equal(shareTextFor('plan', 'Central Europe trip'), 'Central Europe trip — planned with FujinTrip');
  assert.equal(
    shareTextFor('package', 'Kyoto', 'from $1,950 per traveler · planning estimate'),
    'Kyoto — a ready-made FujinTrip package · from $1,950 per traveler · planning estimate'
  );
  assert.equal(shareTextFor('destination', 'Bali'), 'Bali — plan a trip on FujinTrip');
});

test('shareTargets: X, Facebook, WhatsApp and Telegram links encode text and URL', () => {
  const url = 'https://fujintrip.com/reels/r1';
  const text = 'Kyoto — a trip by Mina';
  const t = shareTargets(url, text);
  assert.equal(
    t.x,
    'https://twitter.com/intent/tweet?text=Kyoto%20%E2%80%94%20a%20trip%20by%20Mina&url=https%3A%2F%2Ffujintrip.com%2Freels%2Fr1'
  );
  assert.equal(t.facebook, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Ffujintrip.com%2Freels%2Fr1');
  assert.equal(
    t.whatsapp,
    'https://wa.me/?text=Kyoto%20%E2%80%94%20a%20trip%20by%20Mina%20https%3A%2F%2Ffujintrip.com%2Freels%2Fr1'
  );
  assert.equal(
    t.telegram,
    'https://t.me/share/url?url=https%3A%2F%2Ffujintrip.com%2Freels%2Fr1&text=Kyoto%20%E2%80%94%20a%20trip%20by%20Mina'
  );
  // An & in the text must not break the query string of any target.
  const tricky = shareTargets('https://fujintrip.com/plan/p1?x=1', 'Kyoto & Osaka — flights, stays & food');
  assert.ok(tricky.x.includes('Kyoto%20%26%20Osaka'), 'ampersand is encoded in the X text');
  assert.ok(tricky.x.includes('url=https%3A%2F%2Ffujintrip.com%2Fplan%2Fp1%3Fx%3D1'), 'ampersand is encoded in the X url');
  assert.ok(tricky.telegram.includes('text=Kyoto%20%26%20Osaka'), 'ampersand is encoded in the Telegram text');
});

test('hasWebShare: only a real share function counts', () => {
  assert.equal(hasWebShare(undefined), false);
  assert.equal(hasWebShare(null), false);
  assert.equal(hasWebShare({}), false);
  assert.equal(hasWebShare({ share: 'yes' }), false);
  assert.equal(hasWebShare({ share: () => {} }), true);
});

function makePost(overrides = {}) {
  return {
    id: 'reel_c1',
    createdAt: '2026-11-15T10:00:00.000Z',
    author: 'Mina',
    tripId: 'trip1',
    tripLabel: 'Kyoto plan',
    destination: 'Kyoto',
    routeLine: 'Kyoto',
    month: 1,
    caption: 'The bamboo grove at 7am — go early.',
    media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'Photo' }],
    verified: true,
    verifiedNote: 'Verified trip',
    moderation: 'published',
    moderationNote: '',
    likes: 0,
    saves: 0,
    reports: [],
    posterToken: 'secret-token',
    ...overrides,
  };
}

test('community feed: empty stays empty — nothing is seeded, nothing invented', () => {
  const empty = feedFor([], { limit: 10 });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.posts, []);
  assert.equal(empty.nextCursor, null);
});

test('community feed: a keyword-flagged post waits in the queue, never in the public feed', () => {
  const flagged = makePost({
    id: 'reel_flagged',
    caption: 'Double your money with free bitcoin now',
    moderation: 'pending_review',
  });
  assert.equal(moderateCaption(flagged.caption, flagged.author).flagged, true);
  const published = makePost({ id: 'reel_ok' });
  const feed = feedFor([flagged, published], { limit: 10 });
  assert.deepEqual(feed.posts.map((p) => p.id), ['reel_ok']);
  assert.equal(feed.total, 1);
  // Under review (reported) and rejected posts are hidden the same way.
  const underReview = makePost({ id: 'reel_ur', moderation: 'under_review' });
  const rejected = makePost({ id: 'reel_rej', moderation: 'rejected' });
  const feed2 = feedFor([underReview, rejected, published], { limit: 10 });
  assert.deepEqual(feed2.posts.map((p) => p.id), ['reel_ok']);
});
