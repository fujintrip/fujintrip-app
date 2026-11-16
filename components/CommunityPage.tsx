// The Community page (social/community, Nov 15 2026) — the in-app
// home of travelers' posts. The feed is the existing ReelsFeed
// (same posts, same moderation, same empty state — nothing is seeded
// here, and nothing is pulled in from Instagram, Facebook or X: only
// content travelers post from FujinTrip itself).
//
// The composer opens with the traveler's own My Trips (localStorage,
// same as the homepage) so a post can be attached to a trip they
// actually took — the verification hook for the "Verified trip"
// badge. The honest notes below stay with the feed: moderation is a
// keyword filter (not an AI model), posts live on this server until
// the next redeploy, and the verified badge is device-local until
// accounts land.
'use client';
import { useEffect, useState } from 'react';
import ReelsFeed from './ReelsFeed';
import ReelComposer, { type ComposerTrip } from './ReelComposer';

function readTrips(): ComposerTrip[] {
  try {
    const raw = localStorage.getItem('fujintrip-trips');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ComposerTrip[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function CommunityPage() {
  const [trips, setTrips] = useState<ComposerTrip[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDest, setComposerDest] = useState('');

  useEffect(() => {
    setTrips(readTrips());
  }, []);

  const openComposer = (destination?: string) => {
    setComposerDest(destination ?? '');
    setComposerOpen(true);
    document.getElementById('reel-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" className="primary" onClick={() => openComposer()}>
          Share your experience
        </button>
        <a className="ghost" href="/reels" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Travelers&apos; reels →
        </a>
      </div>
      {composerOpen && (
        <div className="panel" id="reel-composer" style={{ marginBottom: 16 }}>
          <ReelComposer trips={trips} prefillDestination={composerDest} onPosted={() => {}} onClose={() => setComposerOpen(false)} />
        </div>
      )}
      <div className="box" style={{ marginBottom: 16 }}>
        <p className="plan-muted" style={{ margin: 0 }}>
          Posts here are from travelers who posted from FujinTrip — nothing is pulled in from Instagram, Facebook or X, and nothing is
          invented. Moderation is a keyword filter, not an AI model — flagged posts go to a human review queue. A &ldquo;Verified
          trip&rdquo; badge means the post is attached to a booked trip in My Trips on the poster&apos;s device; server verification arrives
          with accounts. Posts live on this server for now and do not survive a redeploy.
        </p>
      </div>
      <ReelsFeed onPost={() => openComposer()} />
    </div>
  );
}
