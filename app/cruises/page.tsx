// Cruises landing page. The planner does not break out a cruise
// leg yet, so the page shows full-trip planning estimates and says
// so — never a cruise price invented from a trip total. Live cruise
// comparison arrives as suppliers connect.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.cruises.metaTitle,
  description: CATEGORY_LANDING.cruises.metaDescription,
};

export default function CruisesPage() {
  return <CategoryLanding tab="cruises" />;
}
