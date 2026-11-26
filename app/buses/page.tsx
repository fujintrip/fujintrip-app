// Buses landing page. The planner does not break out a bus leg
// yet, so the page shows full-trip planning estimates and says so
// — never a bus price invented from a trip total. Live bus
// comparison arrives as suppliers connect.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.buses.metaTitle,
  description: CATEGORY_LANDING.buses.metaDescription,
};

export default function BusesPage() {
  return <CategoryLanding tab="buses" />;
}
