// Attractions landing page (route /activities, matching the
// existing /activities/[code] detail route). Live attraction
// prices arrive as suppliers connect — today the page shows the
// planner's Best value estimates, labelled planning estimates.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.tours.metaTitle,
  description: CATEGORY_LANDING.tours.metaDescription,
};

export default function ActivitiesPage() {
  return <CategoryLanding tab="tours" />;
}
