import type { Metadata } from 'next';
import FujinApp from '../../components/FujinApp';

export const metadata: Metadata = {
  title: 'Ask Fujin AI — FujinTrip',
  description: 'Plan your trip with Fujin AI — flights, hotels, cars and sightseeing in one plan: Cheapest, Best value, Premium.',
};

export default function ChatPage() {
  return <FujinApp variant="chat" />;
}
