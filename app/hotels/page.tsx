// Stays landing page (route /hotels, matching the existing
// /hotels/[code] detail route and the 'hotels' tab id). Live hotel
// prices arrive as suppliers connect — today the page shows the
// planner's Best value estimates, labelled planning estimates.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.hotels.metaTitle,
  description: CATEGORY_LANDING.hotels.metaDescription,
};

export default function StaysPage() {
  return <CategoryLanding tab="hotels" />;
}
