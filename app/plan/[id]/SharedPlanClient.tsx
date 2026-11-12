// Shared plan, client side — /plan/<id>.
//
// Renders the Today view from the snapshot, read-only, and saves the
// snapshot to this device's localStorage on load so the plan opens
// offline from here on. A "Plan this trip" link takes the traveler to
// the homepage chat with the destination pre-seeded.
'use client';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { offlineKeyFor, parseTripCard } from '../../../lib/today';

const TodayView = dynamic(() => import('../../../components/TodayView'), { ssr: false });

export default function SharedPlanClient({
  snapshot,
  cardJson,
}: {
  snapshot: { destination: string; travelers: number; days: number; month: number; origin: string; choice: number; savedAt: string };
  cardJson: string;
}) {
  const card = parseTripCard(cardJson);
  useEffect(() => {
    // Save the shared plan on this device — it opens offline from here.
    if (!card) return;
    try {
      localStorage.setItem(
        offlineKeyFor(snapshot.destination, snapshot.travelers, snapshot.days),
        JSON.stringify({ ...snapshot, v: 1, card: JSON.parse(cardJson) })
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardJson]);
  if (!card) return <p style={{ padding: 24 }}>This plan could not be read.</p>;
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <header style={{ marginBottom: 16 }}>
        <div className="logo">
          Fujin<span>Trip</span>
        </div>
        <p className="plan-muted">A shared plan — a copy. The traveler&apos;s own edits stay on their device.</p>
      </header>
      <h1 style={{ fontSize: 28 }}>
        {snapshot.days}-day {snapshot.destination} trip
      </h1>
      <p className="plan-muted">
        {snapshot.travelers} traveler{snapshot.travelers > 1 ? 's' : ''} · shared {new Date(snapshot.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·
        saved on this device, so it opens offline from here.
      </p>
      <p style={{ marginTop: 12 }}>
        <a className="hero-cta" href={`/?plan=${encodeURIComponent(snapshot.destination)}`}>
          Plan this trip with Fujin AI
        </a>
      </p>
      <div style={{ marginTop: 20, border: '1px solid var(--line)', borderRadius: 16, padding: 16 }}>
        <TodayView
          card={card}
          destination={snapshot.destination}
          travelers={snapshot.travelers}
          days={snapshot.days}
          month={snapshot.month}
          origin={snapshot.origin}
          choice={snapshot.choice}
          readOnly
        />
      </div>
      <p className="notice">Prices are planning estimates, not live quotes. No account needed to view this plan.</p>
    </div>
  );
}
