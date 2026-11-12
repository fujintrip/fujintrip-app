// Unit tests for lib/reels.ts + lib/spaces.ts — travelers' reels.
// Run: node --no-warnings --import ./tests/register-loader.mjs --test tests/reels.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_VERIFIED_FOR_AVERAGE,
  REPORTS_TO_HIDE,
  REEL_LIMITS,
  feedFor,
  moderateCaption,
  ogForPost,
  publicPost,
  routeAverage,
  stripFor,
  validatePostInput,
} from '../lib/reels.ts';
import { canonicalRequest, signRequest, spacesConfigured } from '../lib/spaces.ts';

function makePost(overrides = {}) {
  return {
    id: 'reel_test1',
    createdAt: '2026-11-11T10:00:00.000Z',
    author: 'Mina',
    tripId: 'trip1',
    tripLabel: 'Kyoto plan',
    destination: 'Kyoto',
    routeLine: 'Kyoto',
    month: 1,
    caption: 'The bamboo grove at 7am, before anyone else — go early.',
    media: [{ id: 'm1', kind: 'photo', url: '/api/reels/media/m1', storage: 'local-dev', alt: 'Photo from Kyoto' }],
    verified: true,
    verifiedNote: 'Verified trip',
    moderation: 'published',
    moderationNote: '',
    likes: 3,
    saves: 1,
    reports: [],
    posterToken: 'secret-token',
    ...overrides,
  };
}

test('validatePostInput: a good post passes; the rules catch the bad ones', () => {
  const good = validatePostInput({
    author: 'Mina',
    destination: 'Kyoto',
    routeLine: 'Kyoto',
    month: 1,
    caption: 'Go early.',
    media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'Photo' }],
    tripId: 'trip1',
    verified: true,
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.verified, true);

  // Verified must be tied to a trip — a bare claim without a trip id is not verified.
  const claimed = validatePostInput({
    author: 'Mina',
    destination: 'Kyoto',
    routeLine: 'Kyoto',
    month: 1,
    caption: 'Go early.',
    media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'Photo' }],
    verified: true,
  });
  assert.equal(claimed.ok, true);
  if (claimed.ok) assert.equal(claimed.value.verified, false);

  const cases = [
    [{ author: '', destination: 'Kyoto', routeLine: 'Kyoto', month: 1, caption: 'x', media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'a' }] }, 'name'],
    [{ author: 'Mina', destination: 'Kyoto', routeLine: 'Kyoto', month: 1, caption: 'x'.repeat(281), media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'a' }] }, '281-char caption'],
    [{ author: 'Mina', destination: 'Kyoto', routeLine: 'Kyoto', month: 13, caption: 'x', media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'a' }] }, 'month 13'],
    [{ author: 'Mina', destination: 'Kyoto', routeLine: 'Kyoto', month: 1, caption: 'x', media: [] }, 'no media'],
    [{ author: 'Mina', destination: 'Kyoto', routeLine: 'Kyoto', month: 1, caption: 'x', media: Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, kind: 'photo', url: '/x', storage: 'local-dev', alt: 'a' })) }, '7 photos'],
    [{ author: 'Mina', destination: 'Kyoto', routeLine: 'Kyoto', month: 1, caption: 'x', media: [{ id: 'v1', kind: 'video', url: '/x', storage: 'local-dev', alt: 'a', durationSec: 61 }] }, '61s video'],
    [{ author: 'Mina', destination: 'Kyoto', routeLine: 'Kyoto', month: 1, caption: 'x', overallRating: 6, media: [{ id: 'm1', kind: 'photo', url: '/x', storage: 'local-dev', alt: 'a' }] }, 'rating 6'],
  ];
  for (const [input, why] of cases) {
    const out = validatePostInput({ ...input, media: input.media });
    assert.equal(out.ok, false, why);
  }
  assert.equal(REEL_LIMITS.maxPhotos, 6);
  assert.equal(REEL_LIMITS.maxVideoSec, 60);
});

test('moderateCaption: the keyword filter flags the obvious, passes the plain', () => {
  assert.equal(moderateCaption('The bamboo grove at 7am — go early.', 'Mina').flagged, false);
  const profane = moderateCaption('This place is fucking amazing', 'Mina');
  assert.equal(profane.flagged, true);
  const link = moderateCaption('See my blog https://example.com/deals', 'Mina');
  assert.equal(link.flagged, true);
  assert.ok(link.reasons.join(' ').includes('link'));
  const spam = moderateCaption('Double your money with free bitcoin now', 'Mina');
  assert.equal(spam.flagged, true);
});

test('feedFor: only published/strip show; destination first, then newest', () => {
  const posts = [
    makePost({ id: 'a', destination: 'Kyoto', moderation: 'published', createdAt: '2026-11-10T10:00:00.000Z' }),
    makePost({ id: 'b', destination: 'Kyoto', moderation: 'pending_review', createdAt: '2026-11-11T10:00:00.000Z' }),
    makePost({ id: 'c', destination: 'Paris', moderation: 'strip', createdAt: '2026-11-11T09:00:00.000Z' }),
    makePost({ id: 'd', destination: 'Kyoto', moderation: 'under_review', createdAt: '2026-11-11T11:00:00.000Z' }),
    makePost({ id: 'e', destination: 'Kyoto', moderation: 'removed', createdAt: '2026-11-11T12:00:00.000Z' }),
  ];
  const page = feedFor(posts, { destination: 'Kyoto', limit: 10 });
  assert.deepEqual(page.posts.map((p) => p.id), ['a', 'c']);
  assert.equal(page.total, 2);
  const page2 = feedFor(posts, { limit: 1 });
  assert.equal(page2.posts.length, 1);
  assert.equal(page2.nextCursor, 'c');
  const page3 = feedFor(posts, { limit: 1, cursor: 'c' });
  assert.deepEqual(page3.posts.map((p) => p.id), ['a']);
});

test('stripFor: only human-approved, verified-trip posts on the route', () => {
  const posts = [
    makePost({ id: 'a', destination: 'Kyoto', moderation: 'strip', verified: true }),
    makePost({ id: 'b', destination: 'Kyoto', moderation: 'published', verified: true }),
    makePost({ id: 'c', destination: 'Kyoto', moderation: 'strip', verified: false }),
    makePost({ id: 'd', destination: 'Paris', moderation: 'strip', verified: true }),
  ];
  assert.deepEqual(stripFor(posts, 'Kyoto').map((p) => p.id), ['a']);
});

test('routeAverage: no aggregate until 5 verified posts', () => {
  assert.equal(MIN_VERIFIED_FOR_AVERAGE, 5);
  const few = Array.from({ length: 4 }, (_, i) =>
    makePost({ id: `p${i}`, destination: 'Kyoto', verified: true, overallRating: 5 })
  );
  assert.equal(routeAverage(few, 'Kyoto').average, null);
  assert.equal(routeAverage(few, 'Kyoto').count, 4);
  const enough = Array.from({ length: 5 }, (_, i) =>
    makePost({ id: `p${i}`, destination: 'Kyoto', verified: true, overallRating: i < 4 ? 5 : 4 })
  );
  assert.equal(routeAverage(enough, 'Kyoto').average, 4.8);
  // Unverified posts never count toward the average.
  const mixed = [...enough, makePost({ id: 'u', destination: 'Kyoto', verified: false, overallRating: 1 })];
  assert.equal(routeAverage(mixed, 'Kyoto').count, 5);
});

test('publicPost strips the poster token', () => {
  const pub = publicPost(makePost());
  assert.equal('posterToken' in pub, false);
  assert.equal(pub.author, 'Mina');
});

test('ogForPost: the shared card is the trip, not a bare URL', () => {
  const og = ogForPost(makePost({ caption: 'Go early, before the crowds.' }), 1500);
  assert.ok(og.title.includes('Kyoto'));
  assert.ok(og.description.includes('from $1,500 total'));
  assert.ok(og.description.includes('Planned with FujinTrip'));
});

test('REPORTS_TO_HIDE is 3', () => {
  assert.equal(REPORTS_TO_HIDE, 3);
});

// AWS SigV4 published test vector (docs.aws.amazon.com, "Signature
// Version 4 Test Suite" — the IAM ListUsers example):
// secret wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY, region us-east-1,
// service iam, date 20150830T123600Z. The string to sign hashes to
// f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59 and
// the signature is 5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7.
test('spaces SigV4: matches the AWS published test vector', () => {
  const canonical = canonicalRequest({
    method: 'GET',
    path: '/',
    query: 'Action=ListUsers&Version=2010-05-08',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      host: 'iam.amazonaws.com',
      'x-amz-date': '20150830T123600Z',
    },
    signedHeaders: ['content-type', 'host', 'x-amz-date'],
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  });
  const expectedCanonical = [
    'GET',
    '/',
    'Action=ListUsers&Version=2010-05-08',
    'content-type:application/x-www-form-urlencoded; charset=utf-8',
    'host:iam.amazonaws.com',
    'x-amz-date:20150830T123600Z',
    '',
    'content-type;host;x-amz-date',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ].join('\n');
  assert.equal(canonical, expectedCanonical);
  const { signature } = signRequest({
    method: 'GET',
    url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      Host: 'iam.amazonaws.com',
      'X-Amz-Date': '20150830T123600Z',
    },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    region: 'us-east-1',
    service: 'iam',
    accessKey: 'AKIDEXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    amzDate: '20150830T123600Z',
  });
  assert.equal(signature, '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
});

test('spacesConfigured is false without credentials in this environment', () => {
  assert.equal(spacesConfigured(), false);
});
