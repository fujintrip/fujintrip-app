// The Community page (social/community, Nov 15 2026) — travelers'
// stories and reels, posted from FujinTrip, in one place.
import type { Metadata } from 'next';
import CommunityPage from '../../components/CommunityPage';

export const metadata: Metadata = {
  title: 'Community — FujinTrip',
  description:
    'Travel stories and reels posted by FujinTrip travelers — share your experience from a trip you took, and see what others shared.',
};

export default function Community() {
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <header style={{ marginBottom: 16 }}>
        <div className="logo">
          Fujin<span>Trip</span>
        </div>
        <p className="plan-muted">Ride the wind. Pay less. Travel globally, act locally.</p>
      </header>
      <h1 style={{ fontSize: 28 }}>Community</h1>
      <p className="plan-muted">
        Travel stories and reels from travelers who took the trip — posted here, from FujinTrip, attached to the trip they belong to. Share
        your own experience from My Trips, or post it here; and share any trip, reel or package out to your own social media from the
        Share button on it.
      </p>
      <CommunityPage />
      <p style={{ marginTop: 24 }}>
        <a href="/">← Back to FujinTrip — plan a trip</a>
      </p>
    </div>
  );
}
