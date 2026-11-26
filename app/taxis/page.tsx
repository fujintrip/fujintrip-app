// Taxis & transfers landing page. The planner does not break out
// a taxi leg yet, so the page shows full-trip planning estimates
// and says so — never a taxi price invented from a trip total.
// Live transfer comparison arrives as suppliers connect.
import type { Metadata } from 'next';
import CategoryLanding from '../../components/CategoryLanding';
import { CATEGORY_LANDING } from '../../lib/categoryLanding';

export const metadata: Metadata = {
  title: CATEGORY_LANDING.taxis.metaTitle,
  description: CATEGORY_LANDING.taxis.metaDescription,
};

export default function TaxisPage() {
  return <CategoryLanding tab="taxis" />;
}
