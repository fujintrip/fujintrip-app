// Flights landing page: compare live fares from many sellers,
// then book on the seller's site (referral-first, Google Flights
// model). Server component — the search widget and live-fare strip
// inside CategoryLanding are client components.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.flights.metaTitle,
  description: CATEGORY_LANDING.flights.metaDescription,
};

export default function FlightsPage() {
  return <CategoryLanding tab="flights" />;
}
