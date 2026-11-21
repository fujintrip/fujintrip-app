// The community seed (UX direction round 2, Nov 21 2026 — P0-6d):
// the Community band must render deterministically with a price line.
// The only published, verified reel — Mina's Kyoto note — used to live
// only in data/reels.json, which is gitignored and therefore never
// reached the deployed site, so the Community band flashed and
// vanished on live. This seed is checked in, so the band is present
// on every deploy. listPosts() returns it only when no data file
// exists at all, so a post the user deletes from the file never
// resurrects, and a post the user publishes later renders instead
// of (or alongside) the seed. The media is the verified Kyoto pool
// photo (GLOBAL_DESTINATIONS, Unsplash photo-1493976040374-85c8e12f0c0e),
// not the 70-byte placeholder PNG the file's media endpoint served —
// the stored media is not deployed either. The price line comes from
// ReelCard's own priceFor('Kyoto') (Best value, planning estimate),
// not from this seed. posterToken is empty: the seed has no browser
// owner, so it cannot be deleted or edited through the API.
import type { ReelPost } from './reels';

export const REELS_SEED: ReelPost[] = [
  {
    id: 'reel_mwd0vb6yfe42c28c',
    createdAt: '2026-11-12T04:02:45.994Z',
    author: 'Mina',
    tripId: 'trip-test',
    tripLabel: 'Kyoto plan',
    destination: 'Kyoto',
    routeLine: 'Kyoto',
    month: 1,
    caption: 'Go early, before the crowds — the bamboo grove at 7am.',
    overallRating: 5,
    media: [
      {
        id: 'media_seed_kyoto',
        kind: 'photo',
        url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e',
        storage: 'seed',
        alt: 'A quiet street in Kyoto at dawn',
      },
    ],
    verified: true,
    verifiedNote: 'Verified trip — attached to a trip in My Trips, marked booked on this device. Server verification arrives with accounts.',
    moderation: 'published',
    moderationNote: 'Passed the keyword filter — published to the feed. A human reviews the queue within 24 hours.',
    likes: 0,
    saves: 0,
    reports: [{ reason: 'Not a real trip', at: '2026-11-12T04:02:49.319Z' }],
    posterToken: '',
  },
];
