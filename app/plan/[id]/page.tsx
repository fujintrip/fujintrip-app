// Shared plan — /plan/<id> (community round).
//
// Opens a plan someone sent to this device: the same Today view, from
// the snapshot stored on the server. Read-only (a copy — the traveler's
// done-toggles and edits stay on their own device), and it saves the
// snapshot to this device's localStorage on load so the plan opens
// offline from here on.
//
// No login wall: a stranger who taps the link sees the trip, the route
// and the price, and the same "Plan this trip" path as the homepage.
import { notFound } from 'next/navigation';
import { getShare } from '../../../lib/planShareStore';
import { parseTripCard } from '../../../lib/today';
import SharedPlanClient from './SharedPlanClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const snapshot = await getShare(params.id);
  if (!snapshot) return { title: 'Plan not found — FujinTrip' };
  return {
    title: `${snapshot.days}-day ${snapshot.destination} trip — FujinTrip`,
    description: `A shared FujinTrip plan: ${snapshot.destination} for ${snapshot.travelers} traveler${snapshot.travelers > 1 ? 's' : ''}, ${snapshot.days} days. Open the plan, the route and the day-by-day — no account needed.`,
  };
}

export default async function SharedPlanPage({ params }: { params: { id: string } }) {
  const snapshot = await getShare(params.id);
  if (!snapshot) notFound();
  const card = parseTripCard(JSON.stringify(snapshot.card));
  if (!card) notFound();
  return (
    <SharedPlanClient
      snapshot={{
        destination: snapshot.destination,
        travelers: snapshot.travelers,
        days: snapshot.days,
        month: snapshot.month,
        origin: snapshot.origin,
        choice: snapshot.choice,
        savedAt: snapshot.savedAt,
      }}
      cardJson={JSON.stringify(snapshot.card)}
    />
  );
}
