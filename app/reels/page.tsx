// Travelers' reels — the feed page (community round, design §6).
import type { Metadata } from 'next';
import ReelsFeed from '../../components/ReelsFeed';

export const metadata: Metadata = {
  title: "Travelers' reels — FujinTrip",
  description: 'Short reels and feedback from travelers who took the trip — verified trips only on the trip cards, shareable to social media.',
};

export default function ReelsPage() {
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <header style={{ marginBottom: 16 }}>
        <div className="logo">
          Fujin<span>Trip</span>
        </div>
        <p className="plan-muted">Ride the wind. Pay less. Travel globally, act locally.</p>
      </header>
      <h1 style={{ fontSize: 28 }}>Travelers&apos; reels</h1>
      <p className="plan-muted">
        Photos and short reels from travelers who took the trip — not a review site, not a forum: posts from trips, attached to the trip they
        belong to. A post with a “Verified trip” badge is attached to a booked FujinTrip trip; everything else is labeled as a traveler post.
      </p>
      <ReelsFeed />
      <p style={{ marginTop: 24 }}>
        <a href="/">← Back to FujinTrip — plan a trip</a>
      </p>
    </div>
  );
}
